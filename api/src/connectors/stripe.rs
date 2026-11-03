//! Stripe connector.
//!
//! When `STRIPE_API_KEY` is configured, charges are posted to
//! `https://api.stripe.com/v1/payment_intents`. Without credentials the
//! connector runs in **sandbox mode** and returns deterministic simulated
//! results — handy for local development and CI.

use async_trait::async_trait;
use serde_json::Value;

use super::http;
use super::{ChargeRequest, ChargeResult, Connector, RefundRequest, RefundResult, WebhookEvent};
use crate::error::ApiError;

const STRIPE_API: &str = "https://api.stripe.com/v1";

pub struct Stripe {
    api_key: Option<String>,
    http: reqwest::Client,
}

impl Stripe {
    pub fn new(api_key: Option<String>) -> Self {
        Self {
            api_key,
            http: http::client(),
        }
    }

    fn bearer(&self) -> Result<String, ApiError> {
        self.api_key
            .clone()
            .ok_or_else(|| ApiError::Connector("stripe api key not configured".into()))
    }
}

fn estimate_fee(amount_minor: i64) -> i64 {
    // Simulation only — mirrors Stripe's public 2.9% + $0.30 processing cost
    // so dashboards can be exercised without real keys.
    (amount_minor * 290 + 999_900) / 10_000 + 30
}

#[async_trait]
impl Connector for Stripe {
    fn name(&self) -> &'static str {
        "stripe"
    }

    fn is_sandbox(&self) -> bool {
        self.api_key.is_none()
    }

    async fn charge(&self, req: ChargeRequest) -> Result<ChargeResult, ApiError> {
        match self.api_key {
            None => Ok(ChargeResult {
                connector_ref: http::mock_ref("pi_sim", req.idempotency_key),
                status: "succeeded".into(),
                connector_fee_minor: estimate_fee(req.amount_minor),
            }),
            Some(_) => {
                let key = self.bearer()?;
                let params = [
                    ("amount", req.amount_minor.to_string()),
                    ("currency", req.currency.clone()),
                    ("confirm", "true".into()),
                    ("payment_method_types[]", "card".into()),
                    ("payment_method_data[card][token]", "tok_visa".into()),
                    (
                        "description",
                        req.description.clone().unwrap_or_default(),
                    ),
                ];
                let resp = self
                    .http
                    .post(format!("{STRIPE_API}/payment_intents"))
                    .bearer_auth(key)
                    .form(&params)
                    .send()
                    .await
                    .map_err(|e| ApiError::Connector(format!("stripe request failed: {e}")))?;

                let body: Value = resp
                    .json()
                    .await
                    .map_err(|e| ApiError::Connector(format!("stripe bad response: {e}")))?;

                if let Some(err) = body.get("error") {
                    return Err(ApiError::Connector(format!(
                        "stripe: {}",
                        err.get("message").and_then(|m| m.as_str()).unwrap_or("unknown error")
                    )));
                }

                Ok(ChargeResult {
                    connector_ref: body
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("pi_unknown")
                        .to_string(),
                    status: body
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("pending")
                        .to_string(),
                    connector_fee_minor: 0,
                })
            }
        }
    }

    async fn refund(&self, req: RefundRequest) -> Result<RefundResult, ApiError> {
        match self.api_key {
            None => Ok(RefundResult {
                connector_ref: http::mock_ref("re_sim", req.idempotency_key),
                status: "succeeded".into(),
            }),
            Some(_) => {
                let key = self.bearer()?;
                let params = [
                    ("payment_intent", req.payment_connector_ref.clone()),
                    ("amount", req.amount_minor.to_string()),
                ];
                let resp = self
                    .http
                    .post(format!("{STRIPE_API}/refunds"))
                    .bearer_auth(key)
                    .form(&params)
                    .send()
                    .await
                    .map_err(|e| ApiError::Connector(format!("stripe request failed: {e}")))?;

                let body: Value = resp
                    .json()
                    .await
                    .map_err(|e| ApiError::Connector(format!("stripe bad response: {e}")))?;

                if let Some(err) = body.get("error") {
                    return Err(ApiError::Connector(format!(
                        "stripe: {}",
                        err.get("message").and_then(|m| m.as_str()).unwrap_or("unknown error")
                    )));
                }

                Ok(RefundResult {
                    connector_ref: body
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("re_unknown")
                        .to_string(),
                    status: body
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("pending")
                        .to_string(),
                })
            }
        }
    }

    async fn verify_webhook(
        &self,
        signature: Option<&str>,
        body: &[u8],
    ) -> Result<WebhookEvent, ApiError> {
        // MVP: signature verification with endpoint secret is a follow-up;
        // sandbox mode accepts every event.
        if self.api_key.is_some() && signature.map(|s| s.is_empty()).unwrap_or(true) {
            return Err(ApiError::BadRequest("missing stripe-signature header".into()));
        }
        let value: Value = serde_json::from_slice(body)
            .map_err(|e| ApiError::BadRequest(format("invalid webhook payload: {e}")))?;

        let data = value.get("data").and_then(|d| d.get("object"));
        Ok(WebhookEvent {
            connector: "stripe".into(),
            object_ref: data
                .and_then(|d| d.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            new_status: value
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .trim_start_matches("payment_intent.")
                .to_string(),
        })
    }
}

fn format(msg: impl std::fmt::Display) -> String {
    msg.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sandbox_charge_is_deterministic() {
        let stripe = Stripe::new(None);
        let key = uuid::Uuid::new_v4();
        let result = stripe
            .charge(ChargeRequest {
                idempotency_key: key,
                amount_minor: 10_500,
                currency: "USD".into(),
                description: None,
                destination_country: None,
            })
            .await
            .unwrap();
        assert!(result.connector_ref.starts_with("pi_sim_"));
        assert_eq!(result.connector_fee_minor, estimate_fee(10_500));
    }
}
