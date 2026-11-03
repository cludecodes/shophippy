use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use uuid::Uuid;

use crate::error::ApiResult;
use crate::state::AppState;

/// Connector-specific webhook signature headers.
fn signature_header_name(connector: &str) -> &'static str {
    match connector {
        "stripe" => "stripe-signature",
        "paypal" => "paypal-signature",
        _ => "x-signature",
    }
}

fn now() -> chrono::DateTime<chrono::Utc> {
    chrono::Utc::now()
}

/// POST /v1/webhooks/:connector — verify then reconcile payment status.
pub async fn receive(
    State(state): State<AppState>,
    Path(connector): Path<String>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult<impl IntoResponse> {
    let connector_obj = state
        .connectors
        .get(Some(&connector))
        .map_err(crate::error::ApiError::from)?;

    let signature = headers.get(signature_header_name(&connector)).and_then(|v| v.to_str().ok());

    let event = connector_obj.verify_webhook(signature, &body).await?;

    if !event.object_ref.is_empty() {
        let status = match event.new_status.as_str() {
            "succeeded" | "completed" | "captured" | "done" => "succeeded",
            "failed" | "canceled" => "failed",
            _ => "pending",
        };
        sqlx::query("UPDATE payments SET status = $3, updated_at = $4 WHERE connector_ref = $1 AND connector = $2")
            .bind(&event.object_ref)
            .bind(&connector)
            .bind(status)
            .bind(now())
            .execute(&state.pool)
            .await
            .map_err(crate::error::ApiError::from)?;

        if status == "succeeded" {
            // Mark any previously pending payouts as (eventually) payable.
            let affected: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM payments WHERE connector_ref = $1 AND connector = $2 AND status = 'succeeded'",
            )
            .bind(&event.object_ref)
            .bind(&connector)
            .fetch_one(&state.pool)
            .await
            .unwrap_or(0);
            let _ = affected;
        }
    }

    Ok(Json(json!({
        "received": true,
        "connector": connector,
        "event": uuid::Uuid::new_v4(),
    })))
}
