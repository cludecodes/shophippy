pub mod admin;
pub mod payments;
pub mod webhooks;

use axum::{routing, Router};

use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", routing::get(health))
        .route("/v1/payments", routing::post(payments::create_payment).get(payments::list_payments))
        .route("/v1/payments/:id", routing::get(payments::get_payment))
        .route("/v1/payments/:id/refunds", routing::post(payments::create_refund))
        .route("/v1/refunds/:id", routing::get(payments::get_refund))
        .route("/v1/payouts", routing::post(payments::create_payout).get(payments::list_payouts))
        .route("/v1/dashboard/summary", routing::get(payments::dashboard_summary))
        .route("/v1/webhooks/:connector", routing::post(webhooks::receive))
        .route("/v1/admin/login", routing::post(admin::login))
        .route("/v1/admin/merchants", routing::get(admin::list_merchants))
        .route(
            "/admin/fee-rules",
            routing::post(payments::create_fee_rule).get(payments::list_fee_rules),
        )
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}
