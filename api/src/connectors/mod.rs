//! Pluggable connector interface.
//!
//! A connector handles one external payment provider (Stripe, PayPal, ...).
//! Adding a new connector means implementing [`Connector`] and registering it
//! in the [Registry] — no other code changes are required.

pub mod paypal;
pub mod registry;
pub mod stripe;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Request to charge a card / account through a connector.
#[derive(Debug, Clone, Serialize)]
pub struct ChargeRequest {
    pub idempotency_key: Uuid,
    pub amount_minor: i64,
    pub currency: String,
    pub description: Option<String>,
    /// ISO-3166 destination country, used by some connectors for routing.
    pub destination_country: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RefundRequest {
    pub payment_connector_ref: String,
    pub amount_minor: i64,
    pub currency: String,
    pub idempotency_key: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChargeResult {
    pub connector_ref: String,
    /// succeeded | requires_action | pending | failed
    pub status: String,
    /// Fee the connector itself charges (in minor units), when it reports one.
    pub connector_fee_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefundResult {
    pub connector_ref: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookEvent {
    pub connector: String,
    pub object_ref: String,
    pub new_status: String,
}

#[async_trait]
pub trait Connector: Send + Sync {
    /// Human-readable connector name used for lookup (e.g. "stripe").
    fn name(&self) -> &'static str;

    /// True when the connector runs without credentials and simulates results.
    fn is_sandbox(&self) -> bool {
        false
    }

    async fn charge(&self, req: ChargeRequest) -> Result<ChargeResult, super::error::ApiError>;

    async fn refund(&self, req: RefundRequest) -> Result<RefundResult, super::error::ApiError>;

    async fn verify_webhook(
        &self,
        signature: Option<&str>,
        body: &[u8],
    ) -> Result<WebhookEvent, super::error::ApiError>;
}

/// Helpers shared by connectors that operate against live APIs.
pub mod http {
    pub fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("reqwest client")
    }

    pub fn mock_ref(prefix: &str, key: impl std::fmt::Display) -> String {
        format!("{prefix}_{key}")
    }
}
