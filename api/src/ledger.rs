//! PostgreSQL ledger: payments, refunds, payouts, fee rules and
//! double-entry style ledger entries. Also the dashboard aggregation queries.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::Config;

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
pub struct PaymentRow {
    pub id: Uuid,
    pub merchant_id: Uuid,
    pub status: String,
    pub connector: String,
    pub connector_ref: Option<String>,
    pub connector_fee_minor: i64,
    pub amount_minor: i64,
    pub currency: String,
    pub presentment_currency: Option<String>,
    pub fx_rate: Option<rust_decimal::Decimal>,
    pub corridor: Option<String>,
    pub destination_country: Option<String>,
    pub gateway_fee_bps: i64,
    pub gateway_fee_minor: i64,
    pub fee_source: String,
    pub refunded_minor: i64,
    pub idempotency_key: Uuid,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct RefundRow {
    pub id: Uuid,
    pub payment_id: Uuid,
    pub merchant_id: Uuid,
    pub amount_minor: i64,
    pub status: String,
    pub connector_ref: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Double-entry style booking of a settled charge.
/// Assets: connector settlement ledger. Liabilities: merchant balance +
/// platform revenue accounts for the gateway fee.
pub async fn book_charge(
    pool: &PgPool,
    payment_id: Uuid,
    merchant_id: Uuid,
    connector: &str,
    currency: &str,
    amount_minor: i64,
    gateway_fee_minor: i64,
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO ledger_entries (payment_id, merchant_id, account, entry_type, direction, currency, amount_minor)
         VALUES
           ($1, $2, $3, 'charge',          'debit',  $4, $5),
           ($1, $2, $6, 'charge',          'credit', $4, $5)",
    )
    .bind(payment_id)
    .bind(merchant_id)
    .bind(format!("asset:settlement:{connector}"))
    .bind(currency)
    .bind(amount_minor)
    .bind(format!("liability:merchant:{merchant_id}"))
    .execute(&mut tx)
    .await?;

    if gateway_fee_minor > 0 {
        sqlx::query(
            "INSERT INTO ledger_entries (payment_id, merchant_id, account, entry_type, direction, currency, amount_minor)
             VALUES
               ($1, $2, $6, 'gateway_fee', 'debit',  $3, $4),
               ($1, $2, $5, 'gateway_fee', 'credit', $3, $4)",
        )
        .bind(payment_id)
        .bind(merchant_id)
        .bind(currency)
        .bind(gateway_fee_minor)
        .bind("revenue:platform:gateway_fees")
        .bind(format!("liability:merchant:{merchant_id}:fees"))
        .execute(&mut tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn book_refund(
    pool: &PgPool,
    payment_id: Uuid,
    merchant_id: Uuid,
    connector: &str,
    currency: &str,
    amount_minor: i64,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO ledger_entries (payment_id, merchant_id, account, entry_type, direction, currency, amount_minor)
         VALUES
           ($1, $2, $3, 'refund', 'credit', $4, $5),
           ($1, $2, $6, 'refund', 'debit',  $4, $5)",
    )
    .bind(payment_id)
    .bind(merchant_id)
    .bind(format!("asset:settlement:{connector}"))
    .bind(currency)
    .bind(amount_minor)
    .bind(format!("liability:merchant:{merchant_id}"))
    .execute(pool)
    .await?;
    Ok(())
}

/// Insert the quick-start demo merchant (fee tier 0) plus two example
/// corridor rules, only when the merchants table is empty.
pub async fn seed_demo_data(pool: &PgPool, cfg: &Arc<Config>) -> anyhow::Result<()> {
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM merchants").fetch_one(pool).await?;
    if count > 0 {
        return Ok(());
    }

    let merchant_id = Uuid::new_v4();
    let hash = Config::hash_key(&cfg.demo_api_key);
    sqlx::query(
        "INSERT INTO merchants (id, name, api_key_hash, country, tier)
         VALUES ($1, 'Demo Merchant', $2, 'EU', 0)",
    )
    .bind(merchant_id)
    .bind(hash)
    .execute(pool)
    .await?;

    // Global default corridor rule example: EU-US express corridor at 150 bps.
    crate::fees::upsert_rule(pool, "corridor", None, Some("EU-US"), 150, 0, 10).await?;
    tracing::info!("seeded demo merchant + default corridor rules");
    Ok(())
}

#[derive(Debug, serde::Serialize)]
pub struct Summary {
    pub volume_minor: i64,
    pub gateway_fee_minor: i64,
    pub connector_fee_minor: i64,
    pub refunded_minor: i64,
    pub net_volume_minor: i64,
    pub succeeded_count: i64,
    pub failed_count: i64,
    pub refund_count: i64,
    pub by_connector: Vec<ConnectorSlice>,
    pub by_corridor: Vec<CorridorSlice>,
    pub recent: Vec<PaymentRow>,
}

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
pub struct ConnectorSlice {
    pub connector: String,
    pub volume_minor: i64,
    pub fees_minor: i64,
    pub txn_count: i64,
}

#[derive(Debug, sqlx::FromRow, serde::Serialize)]
pub struct CorridorSlice {
    pub corridor: String,
    pub volume_minor: i64,
    pub fees_minor: i64,
}

pub async fn dashboard_summary(pool: &PgPool, merchant_id: Uuid) -> anyhow::Result<Summary> {
    let (succeeded, failed, refund_count) = sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT
            COUNT(*) FILTER (WHERE status = 'succeeded'),
            COUNT(*) FILTER (WHERE status IN ('failed', 'canceled')),
            (SELECT COUNT(*) FROM refunds WHERE merchant_id = $1)
         FROM payments WHERE merchant_id = $1",
    )
    .bind(merchant_id)
    .fetch_one(pool)
    .await?;

    let volume: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(amount_minor),0) FROM payments WHERE merchant_id = $1 AND status = 'succeeded'")
            .bind(merchant_id)
            .fetch_one(pool)
            .await?;
    let gateway_fee: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(gateway_fee_minor),0) FROM payments WHERE merchant_id = $1 AND status = 'succeeded'")
            .bind(merchant_id)
            .fetch_one(pool)
            .await?;
    let connector_fee: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(connector_fee_minor),0) FROM payments WHERE merchant_id = $1 AND status = 'succeeded'")
            .bind(merchant_id)
            .fetch_one(pool)
            .await?;
    let refunded: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(refunded_minor),0) FROM payments WHERE merchant_id = $1 AND status = 'succeeded'")
            .bind(merchant_id)
            .fetch_one(pool)
            .await?;

    let by_connector = sqlx::query_as::<_, ConnectorSlice>(
        "SELECT connector,
                COALESCE(SUM(amount_minor), 0) AS volume_minor,
                COALESCE(SUM(gateway_fee_minor), 0) AS fees_minor,
                COUNT(*) AS txn_count
           FROM payments
          WHERE merchant_id = $1 AND status = 'succeeded'
          GROUP BY connector ORDER BY volume_minor DESC",
    )
    .bind(merchant_id)
    .fetch_all(pool)
    .await?;

    let by_corridor = sqlx::query_as::<_, CorridorSlice>(
        "SELECT COALESCE(corridor, 'domestic') AS corridor,
                COALESCE(SUM(amount_minor), 0) AS volume_minor,
                COALESCE(SUM(gateway_fee_minor), 0) AS fees_minor
           FROM payments
          WHERE merchant_id = $1 AND status = 'succeeded'
          GROUP BY 1 ORDER BY volume_minor DESC LIMIT 12",
    )
    .bind(merchant_id)
    .fetch_all(pool)
    .await?;

    let recent = sqlx::query_as::<_, PaymentRow>(
        "SELECT * FROM payments WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 25",
    )
    .bind(merchant_id)
    .fetch_all(pool)
    .await?;

        Ok(Summary {
            volume_minor: volume,
            gateway_fee_minor: gateway_fee,
            connector_fee_minor: connector_fee,
            refunded_minor: refunded,
            net_volume_minor: volume - gateway_fee - connector_fee,
            succeeded_count: succeeded,
            failed_count: failed,
            refund_count,
            by_connector,
            by_corridor,
            recent,
        })
    }
}