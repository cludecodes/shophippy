use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::idempotency;
use crate::ledger::{self, PaymentRow};
use crate::state::{AdminGuard, AppState, Merchant};

fn now() -> chrono::DateTime<Utc> {
    Utc::now()
}

#[derive(Deserialize)]
pub struct CreatePayment {
    pub amount_minor: i64,
    pub currency: String,
    #[serde(default)]
    pub presentment_currency: Option<String>,
    /// Connector name or omit for "auto" (stripe).
    #[serde(default)]
    pub connector: Option<String>,
    /// Example corridors: "EU-US", "EU-GB", "APAC-EU".
    #[serde(default)]
    pub corridor: Option<String>,
    #[serde(default)]
    pub destination_country: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub idempotency_key: Option<Uuid>,
}

/// POST /v1/payments — route one charge through the selected connector,
/// apply the percentage fee engine, and book it into the ledger.
pub async fn create_payment(
    State(state): State<AppState>,
    merchant: Merchant,
    headers: HeaderMap,
    body: Json<CreatePayment>,
) -> ApiResult<impl IntoResponse> {
    let body = body.0;
    if body.amount_minor <= 0 {
        return Err(ApiError::BadRequest("amount_minor must be positive".into()));
    }
    let currency = body.currency.to_ascii_uppercase();
    if currency.len() != 3 || !currency.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err(ApiError::BadRequest("currency must be a 3-letter code".into()));
    }

    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| Uuid::parse_str(v).ok())
        .or(body.idempotency_key)
        .unwrap_or_else(Uuid::new_v4);

    let cache_key = idempotency::cache_key(&merchant.id, &idempotency_key);

    // Replay a completed request verbatim.
    if let Some(stored) = idempotency::get(state.redis.as_ref(), &cache_key).await {
        let mut value: Value = serde_json::from_str(&stored)
            .unwrap_or_else(|_| json!({ "replayed": true }));
        value["replayed"] = json!(true);
        return Ok((axum::http::StatusCode::OK, Json(value)));
    }

    // Two in-flight requests with the same key => conflict, do not double charge.
    if !idempotency::reserve(state.redis.as_ref(), &cache_key).await {
        return Err(ApiError::Conflict(
            "an idempotent request with this key is already in flight".into(),
        ));
    }

    let corridor = body.corridor.clone();
    let fee = crate::fees::evaluate(
        &state.pool,
        &state.config,
        &merchant,
        corridor.as_deref(),
        body.amount_minor,
    )
    .await
    .map_err(ApiError::from)?;

    let gateway_fee_minor = crate::fees::apply(body.amount_minor, fee.bps);

    let connector = state
        .connectors
        .get(body.connector.as_deref())
        .map_err(|e| match e {
            ApiError::BadRequest(m) => ApiError::BadRequest(m),
            other => other,
        })?;

    let charge_req = crate::connectors::ChargeRequest {
        idempotency_key,
        amount_minor: body.amount_minor,
        currency: currency.clone(),
        description: body.description.clone(),
        destination_country: body.destination_country.clone(),
    };

    let charge = match connector.charge(charge_req).await {
        Ok(c) => c,
        Err(e) => {
            idempotency::release(state.redis.as_ref(), &cache_key).await;
            return Err(e);
        }
    };
    if charge.status == "failed" {
        idempotency::release(state.redis.as_ref(), &cache_key).await;
        return Err(ApiError::Connector("connector reported failure".into()));
    }

    let payment_id = Uuid::new_v4();
    let currency2 = currency.clone();
    let connector_name = connector.name().to_string();
    let insert = sqlx::query(
        "INSERT INTO payments
            (id, merchant_id, status, connector, connector_ref, connector_fee_minor,
             amount_minor, currency, presentment_currency, corridor, destination_country,
             gateway_fee_bps, gateway_fee_minor, fee_source, idempotency_key, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
         ON CONFLICT (merchant_id, idempotency_key) DO NOTHING",
    )
    .bind(payment_id)
    .bind(merchant.id)
    .bind(normalize_status(&charge.status))
    .bind(&connector_name)
    .bind(&charge.connector_ref)
    .bind(charge.connector_fee_minor)
    .bind(body.amount_minor)
    .bind(&currency2)
    .bind(body.presentment_currency.as_deref().map(|s| s.to_ascii_uppercase()))
    .bind(corridor.as_deref())
    .bind(body.destination_country.as_deref())
    .bind(fee.bps)
    .bind(gateway_fee_minor)
    .bind(&fee.source)
    .bind(idempotency_key)
    .bind(body.description.as_deref())
    .bind(now())
    .execute(&state.pool)
    .await;

    if let Err(e) = insert {
        idempotency::release(state.redis.as_ref(), &cache_key).await;
        return Err(ApiError::from(e));
    }

    // DB-level idempotency (covers the no-Redis fallback): if the conflicts
    // stripped our insert, replay the original row instead of a 404.
    let row = match fetch_payment(&state, merchant.id, payment_id).await {
        Ok(row) => row,
        Err(ApiError::NotFound) => {
            let stored_id: Uuid = sqlx::query_scalar(
                "SELECT id FROM payments WHERE merchant_id = $1 AND idempotency_key = $2",
            )
            .bind(merchant.id)
            .bind(idempotency_key)
            .fetch_one(&state.pool)
            .await
            .map_err(ApiError::from)?;
            fetch_payment(&state, merchant.id, stored_id).await?
        }
        Err(e) => return Err(e),
    };

    // Book the double-entry records for the freshly created payment.
    if row.id == payment_id {
        ledger::book_charge(
            &state.pool,
            payment_id,
            merchant.id,
            &connector_name,
            &currency2,
            body.amount_minor,
            gateway_fee_minor,
        )
        .await
        .map_err(ApiError::from)?;
    }
    let mut payload = serde_json::to_value(&row).map_err(|e| anyhow::anyhow!(e))?;
    payload["replayed"] = json!(false);
    payload["sandbox"] = json!(connector.is_sandbox());

    idempotency::store(state.redis.as_ref(), &cache_key, &payload).await;
    Ok((axum::http::StatusCode::CREATED, Json(payload)))
}

fn normalize_status(status: &str) -> String {
    match status.to_ascii_lowercase().as_str() {
        "succeeded" | "completed" | "succeeds" => "succeeded",
        "failed" => "failed",
        _ => "pending",
    }
    .to_string()
}

async fn fetch_payment(state: &AppState, merchant_id: Uuid, id: Uuid) -> ApiResult<PaymentRow> {
    sqlx::query_as::<_, PaymentRow>(
        "SELECT * FROM payments WHERE id = $1 AND merchant_id = $2",
    )
    .bind(id)
    .bind(merchant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?
    .ok_or(ApiError::NotFound)
}

/// GET /v1/payments/:id
pub async fn get_payment(
    State(state): State<AppState>,
    merchant: Merchant,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<PaymentRow>> {
    Ok(Json(fetch_payment(&state, merchant.id, id).await?))
}

/// GET /v1/payments?status=succeeded&limit=50
pub async fn list_payments(
    State(state): State<AppState>,
    merchant: Merchant,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult<Json<Vec<PaymentRow>>> {
    let limit: i64 = params
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(50)
        .clamp(1, 200);
    let status: Option<String> = params.get("status").cloned();

    let rows = if let Some(status) = status {
        sqlx::query_as::<_, PaymentRow>(
            "SELECT * FROM payments WHERE merchant_id = $1 AND status = $2
             ORDER BY created_at DESC LIMIT $3",
        )
        .bind(merchant.id)
        .bind(status)
        .bind(limit)
        .fetch_all(&state.pool)
        .await
        .map_err(ApiError::from)?
    } else {
        sqlx::query_as::<_, PaymentRow>(
            "SELECT * FROM payments WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT $2",
        )
        .bind(merchant.id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await
        .map_err(ApiError::from)?
    };
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct CreateRefund {
    /// Defaults to the full unrefunded remainder.
    #[serde(default)]
    pub amount_minor: Option<i64>,
}

/// POST /v1/payments/:id/refunds
pub async fn create_refund(
    State(state): State<AppState>,
    merchant: Merchant,
    Path(payment_id): Path<Uuid>,
    body: Option<Json<CreateRefund>>,
) -> ApiResult<impl IntoResponse> {
    let payment = fetch_payment(&state, merchant.id, payment_id).await?;
    if payment.status != "succeeded" {
        return Err(ApiError::BadRequest("only succeeded payments can be refunded".into()));
    }
    let refundable = payment.amount_minor - payment.refunded_minor;
    if refundable <= 0 {
        return Err(ApiError::BadRequest("payment already fully refunded".into()));
    }
    let amount_minor = body.map(|Json(b)| b.amount_minor).unwrap_or(None).unwrap_or(refundable);
    if amount_minor <= 0 || amount_minor > refundable {
        return Err(ApiError::BadRequest(format!(
            "amount_minor must be within 1..{refundable}"
        )));
    }

    let connector = state
        .connectors
        .get(Some(&payment.connector))
        .map_err(ApiError::from)?;
    let refund = connector
        .refund(crate::connectors::RefundRequest {
            payment_connector_ref: payment.connector_ref.clone().unwrap_or_default(),
            amount_minor,
            currency: payment.currency.clone(),
            idempotency_key: Uuid::new_v4(),
        })
        .await?;

    let refund_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO refunds (id, payment_id, merchant_id, amount_minor, status, connector_ref)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(refund_id)
    .bind(payment_id)
    .bind(merchant.id)
    .bind(amount_minor)
    .bind("succeeded")
    .bind(&refund.connector_ref)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;

    sqlx::query("UPDATE payments SET refunded_minor = refunded_minor + $2, updated_at = $3 WHERE id = $1")
        .bind(payment_id)
        .bind(amount_minor)
        .bind(now())
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;

    ledger::book_refund(
        &state.pool,
        payment_id,
        merchant.id,
        &payment.connector,
        &payment.currency,
        amount_minor,
    )
    .await
    .map_err(ApiError::from)?;

    let row: ledger::RefundRow = sqlx::query_as(
        "SELECT id, payment_id, merchant_id, amount_minor, status, connector_ref, created_at FROM refunds WHERE id = $1",
    )
    .bind(refund_id)
    .fetch_one(&state.pool)
    .await
    .map_err(ApiError::from)?;
    Ok((axum::http::StatusCode::CREATED, Json(json!(row))))
}

/// GET /v1/refunds/:id
pub async fn get_refund(
    State(state): State<AppState>,
    merchant: Merchant,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<ledger::RefundRow>> {
    let row: ledger::RefundRow = sqlx::query_as(
        "SELECT id, payment_id, merchant_id, amount_minor, status, connector_ref, created_at
           FROM refunds WHERE id = $1 AND merchant_id = $2",
    )
    .bind(id)
    .bind(merchant.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?
    .ok_or(ApiError::NotFound)?;
    Ok(Json(row))
}

#[derive(Deserialize)]
pub struct CreatePayout {
    pub amount_minor: i64,
    pub currency: String,
}

/// POST /v1/payouts — merchant requests a payout of their available balance.
pub async fn create_payout(
    State(state): State<AppState>,
    merchant: Merchant,
    Json(body): Json<CreatePayout>,
) -> ApiResult<impl IntoResponse> {
    if body.amount_minor <= 0 {
        return Err(ApiError::BadRequest("amount_minor must be positive".into()));
    }
    let available: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_minor - gateway_fee_minor - connector_fee_minor - refunded_minor), 0)
           FROM payments WHERE merchant_id = $1 AND status = 'succeeded'",
    )
    .bind(merchant.id)
    .fetch_one(&state.pool)
    .await
    .map_err(ApiError::from)?;
    if body.amount_minor > available {
        return Err(ApiError::BadRequest(format!(
            "amount exceeds available balance ({available})"
        )));
    }
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO payouts (id, merchant_id, currency, amount_minor, status, arrival_date)
         VALUES ($1, $2, $3, $4, 'pending', now() + interval '2 days')",
    )
    .bind(id)
    .bind(merchant.id)
    .bind(body.currency.to_ascii_uppercase())
    .bind(body.amount_minor)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "id": id, "status": "pending", "arrival": "+2 days" })),
    ))
}

#[derive(serde::Serialize, sqlx::FromRow)]
pub struct PayoutRow {
    pub id: Uuid,
    pub merchant_id: Uuid,
    pub currency: String,
    pub amount_minor: i64,
    pub status: String,
    pub arrival_date: Option<chrono::DateTime<Utc>>,
    pub created_at: chrono::DateTime<Utc>,
}

/// GET /v1/payouts
pub async fn list_payouts(
    State(state): State<AppState>,
    merchant: Merchant,
) -> ApiResult<Json<Vec<PayoutRow>>> {
    let rows = sqlx::query_as::<_, PayoutRow>(
        "SELECT id, merchant_id, currency, amount_minor, status, arrival_date, created_at
           FROM payouts WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 50",
    )
    .bind(merchant.id)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    Ok(Json(rows))
}

/// GET /v1/dashboard/summary — feeds the merchant dashboard.
pub async fn dashboard_summary(
    State(state): State<AppState>,
    merchant: Merchant,
) -> ApiResult<Json<ledger::Summary>> {
    let summary = ledger::dashboard_summary(&state.pool, merchant.id).await.map_err(ApiError::from)?;
    Ok(Json(summary))
}

#[derive(Deserialize)]
pub struct CreateFeeRule {
    pub scope: String, // global | merchant | corridor
    pub bps: i64,
    #[serde(default)]
    pub merchant_id: Option<Uuid>,
    #[serde(default)]
    pub corridor: Option<String>,
    #[serde(default)]
    pub min_amount_minor: i64,
    #[serde(default)]
    pub priority: i32,
}

/// POST /admin/fee-rules — add a per-merchant or per-corridor fee rule.
pub async fn create_fee_rule(
    State(state): State<AppState>,
    _: AdminGuard,
    Json(body): Json<CreateFeeRule>,
) -> ApiResult<impl IntoResponse> {
    if !matches!(body.scope.as_str(), "global" | "merchant" | "corridor") {
        return Err(ApiError::BadRequest("scope must be global|merchant|corridor".into()));
    }
    let id = crate::fees::upsert_rule(
        &state.pool,
        &body.scope,
        body.merchant_id,
        body.corridor.as_deref(),
        body.bps,
        body.min_amount_minor,
        body.priority,
    )
    .await
    .map_err(ApiError::from)?;
    Ok((axum::http::StatusCode::CREATED, Json(json!({ "id": id, "scope": body.scope, "bps": body.bps }))))
}

#[derive(serde::Serialize, sqlx::FromRow)]
pub struct FeeRuleRow {
    pub id: Uuid,
    pub scope: String,
    pub merchant_id: Option<Uuid>,
    pub corridor: Option<String>,
    pub bps: i64,
    pub min_amount_minor: i64,
    pub priority: i32,
    pub active: bool,
    pub created_at: chrono::DateTime<Utc>,
}

/// GET /admin/fee-rules
pub async fn list_fee_rules(
    State(state): State<AppState>,
    _: AdminGuard,
) -> ApiResult<Json<Vec<FeeRuleRow>>> {
    let rows = sqlx::query_as::<_, FeeRuleRow>(
        "SELECT id, scope, merchant_id, corridor, bps, min_amount_minor, priority, active, created_at
           FROM fee_rules WHERE active ORDER BY priority DESC, created_at DESC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    Ok(Json(rows))
}
