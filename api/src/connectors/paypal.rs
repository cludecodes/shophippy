//! PayPal connector (REST v2, sandbox or live).
//!
//! When `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` are configured, orders are
//! created against `https://api-m.<env>.paypal.com`. Without credentials the
//! connector runs in **sandbox mode** with simulated results.

use async_trait::async_trait;
use serde_json::{json, Value};

use super::http;
use super::{ChargeRequest, ChargeResult, Connector, RefundRequest, RefundResult, WebhookEvent};
use crate::error::ApiError;

pub struct PayPal {
    client_id: Option<String>,
    client_secret: Option<String>,
    env: String,
    http: reqwest::Client,
}

impl PayPal {
    pub fn new(client_id: Option<String>, client_secret: Option<String>, env: String) -> Self {
        Self {
            client_id,
            client_secret,
            env,
            http: http::client(),
        }
    }

    fn api_base(&self) -> String {
        match self.env.as_str() {
            "live" | "production" => "https://api-m.paypal.com".into(),
            _ => "https://api-m.sandbox.paypal.com".into(),
        }
    }

    fn creds(&self) -> Result<(String, String), ApiError> {
        match (self.client_id.clone(), self.client_secret.clone()) {
            (Some(id), Some(secret)) => Ok((id, secret)),
            _ => Err(ApiError::Connector("paypal credentials not configured".into())),
        }
    }

    async fn oauth_token(&self) -> Result<String, ApiError> {
        let (id, secret) = self.creds()?;
        let resp = self
            .http
            .post(format!("{}/v1/oauth2/token", self.api_base()))
            .basic_auth(id, Some(secret))
            .form(&[("grant_type", "client_credentials")])
            .send()
            .await
            .map_err(|e| ApiError::Connector(format!("paypal token request failed: {e}")))?;

        let body: Value = resp
            .json()
            .await
            .map_err(|e| ApiError::Connector(format!("paypal bad token response: {e}")))?;

        body.get("access_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ApiError::Connector("paypal: no access_token in response".into()))
    }
}

#[async_trait]
impl Connector for PayPal {
    fn name(&self) -> &'static str {
        "paypal"
    }

    fn is_sandbox(&self) -> bool {
        self.client_id.is_none() || self.client_secret.is_none()
    }

    async fn charge(&self, req: ChargeRequest) -> Result<ChargeResult, ApiError> {
        if self.is_sandbox() {
            // Simulated fee mirrors PayPal's public 3.49% + $0.49 cost so the
            // dashboard can be exercised without real credentials.
            return Ok(ChargeResult {
                connector_ref: http::mock_ref("ORD_sim", req.idempotency_key),
                status: "COMPLETED".into(),
                connector_fee_minor: (req.amount_minor * 349 + 999_900) / 10_000 + 49,
            });
        }

        let token = self.oauth_token().await?;
        let money = format!("{major}.{minor:02}", major = req.amount_minor / 100, minor = req.amount_minor % 100);

        let payload = json!({
            "intent": "CAPTURE",
            "purchase_units": [{
                "amount": { "currency_code": req.currency, "value": money },
                "description": req.description.clone().unwrap_or_default()
            }]
        });

        let resp = self
            .http
            .post(format!("{}/v2/checkout/orders", self.api_base()))
            .bearer_auth(token)
            .json(&payload)
            .send()
            .await
            .map_err(|e| ApiError::Connector(format!("paypal request failed: {e}")))?;

        let body: Value = resp
            .json()
            .await
            .map_err(|e| ApiError::Connector(format!("paypal bad response: {e}")))?;

        if body.get("name").and_then(|v| v.as_str()) == Some("INVALID_REQUEST") {
            return Err(ApiError::Connector("paypal rejected the charge".into()));
        }

        Ok(ChargeResult {
            connector_ref: body
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("ORD_unknown")
                .to_string(),
            status: body
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("CREATED")
                .to_string(),
            connector_fee_minor: 0,
        })
    }

    async fn refund(&self, req: RefundRequest) -> Result<RefundResult, ApiError> {
        if self.is_sandbox() {
            return Ok(RefundResult {
                connector_ref: http::mock_ref("RF_sim", req.idempotency_key),
                status: "COMPLETED".into(),
            });
        }

        // Orders created via /v2/checkout/orders must be captured before they
        // can be refunded via /v2/payments/captures/{capture_id}/refund. The
        // capture id lookup is a follow-up; live refunds are rejected for now.
        let _token = self.oauth_token().await?;
        Err(ApiError::Connector(
            "paypal live refunds require capture-id resolution (roadmap item)".into(),
        ))
    }

    async fn verify_webhook(
        &self,
        signature: Option<&str>,
        body: &[u8],
    ) -> Result<WebhookEvent, ApiError> {
        if self.client_id.is_some() && signature.map(|s| s.is_empty()).unwrap_or(true) {
            return Err(ApiError::BadRequest("missing paypal-signature".into()));
        }
        let value: Value = serde_json::from_slice(body)
            .map_err(|e| ApiError::BadRequest(format!("invalid webhook payload: {e}")))?;

        Ok(WebhookEvent {
            connector: "paypal".into(),
            object_ref: value
                .get("resource")
                .and_then(|r| r.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            new_status: value
                .get("event_type")
                .and_then(|v| v.as_str())
                .unwrap_or("UNKNOWN")
                .trim_start_matches("PAYMENT.")
                .to_ascii_lowercase(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sandbox_charge_succeeds() {
        let paypal = PayPal::new(None, None, "sandbox".into());
        let result = paypal
            .charge(ChargeRequest {
                idempotency_key: uuid::Uuid::new_v4(),
                amount_minor: 10_500,
                currency: "USD".into(),
                description: None,
                destination_country: None,
            })
            .await
            .unwrap();
        assert!(result.connector_ref.starts_with("ORD_sim_"));
        assert_eq!(result.status, "COMPLETED");
    }
}
