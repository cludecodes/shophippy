//! Percentage fee engine.
//!
//! Shophippy's managed cloud earns a percentage fee of 50–155 bps
//! (0.5 %–1.5 %) per transaction. The self-hosted core runs free (0 bps).
//!
//! Evaluation order (highest priority wins):
//!   1. `merchant`-scoped rules for the calling merchant
//!   2. `corridor`-scoped rules matching the payment corridor (e.g. "EU-US")
//!   3. volume-tier schedule (tier 0 => 150 bps ... tier 3 => 50 bps)

use std::sync::Arc;

use sqlx::PgPool;
use uuid::Uuid;

use crate::config::Config;
use crate::state::Merchant;

/// Volume-tier schedule in basis points.
pub fn tier_bps(tier: i32) -> i64 {
    match tier {
        0 => 150, // 1.5% — starter
        1 => 100, // 1.0% — growth
        2 => 75,  // 0.75% — scale
        _ => 50,  // 0.5% — enterprise; lowest allowed managed fee
    }
}

#[derive(Debug, Clone)]
pub struct FeeDecision {
    pub bps: i64,
    /// machine-readable justification: self_hosted | merchant | corridor | tier
    pub source: String,
}

impl FeeDecision {
    fn self_hosted() -> Self {
        Self { bps: 0, source: "self_hosted".into() }
    }
}

fn apply(amount_minor: i64, bps: i64) -> i64 {
    if bps <= 0 || amount_minor <= 0 {
        return 0;
    }
    // Round up to the nearest minor unit so the fee can never erode to zero.
    (amount_minor * bps + 9_999) / 10_000
}

/// Compute the gateway fee for a payment, including its justification.
pub async fn evaluate(
    pool: &PgPool,
    cfg: &Arc<Config>,
    merchant: &Merchant,
    corridor: Option<&str>,
    amount_minor: i64,
) -> anyhow::Result<FeeDecision> {
    if !cfg.managed_cloud {
        return Ok(FeeDecision::self_hosted());
    }

    // 1) Merchant override — most specific wins.
    let merchant_rule: Option<i64> = sqlx::query_scalar(
        "SELECT bps FROM fee_rules
          WHERE scope = 'merchant' AND active AND merchant_id = $1
          ORDER BY priority DESC, created_at DESC
          LIMIT 1",
    )
    .bind(merchant.id)
    .fetch_optional(pool)
    .await?;
    if let Some(bps) = merchant_rule {
        return Ok(FeeDecision { bps, source: "merchant".into() });
    }

    // 2) Corridor rule — must also satisfy the minimum amount bound.
    if let Some(corridor) = corridor {
        let corridor_rule: Option<i64> = sqlx::query_scalar(
            "SELECT bps FROM fee_rules
              WHERE scope = 'corridor' AND active AND corridor = $1
                AND min_amount_minor <= $2
              ORDER BY priority DESC, created_at DESC
              LIMIT 1",
        )
        .bind(corridor)
        .bind(amount_minor)
        .fetch_optional(pool)
        .await?;
        if let Some(bps) = corridor_rule {
            return Ok(FeeDecision { bps, source: "corridor".into() });
        }
    }

    // 3) Volume-tier schedule.
    Ok(FeeDecision {
        bps: tier_bps(merchant.tier),
        source: "tier".into(),
    })
}

/// Record a new rule. Caller is responsible for authorization (AdminGuard).
pub async fn upsert_rule(
    pool: &PgPool,
    scope: &str,
    merchant_id: Option<Uuid>,
    corridor: Option<&str>,
    bps: i64,
    min_amount_minor: i64,
    priority: i32,
) -> anyhow::Result<Uuid> {
    anyhow::ensure!((0..=155).contains(&bps), "bps must be within 0..=155");
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO fee_rules (id, scope, merchant_id, corridor, bps, min_amount_minor, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(scope)
    .bind(merchant_id)
    .bind(corridor)
    .bind(bps)
    .bind(min_amount_minor)
    .bind(priority)
    .execute(pool)
    .await?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_up_to_minor_unit() {
        assert_eq!(apply(10_500, 150), 158); // 1.5% of 105.00 => 1.58
        assert_eq!(apply(1, 150), 1);
        assert_eq!(apply(0, 150), 0);
        assert_eq!(apply(10_500, 0), 0);
    }

    #[test]
    fn tier_schedule_is_complete() {
        assert_eq!(tier_bps(0), 150);
        assert_eq!(tier_bps(1), 100);
        assert_eq!(tier_bps(2), 75);
        assert_eq!(tier_bps(9), 50);
    }
}
