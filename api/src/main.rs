mod config;
mod connectors;
mod error;
mod fees;
mod idempotency;
mod ledger;
mod routes;
mod state;

use std::sync::Arc;

use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::connectors::paypal::PayPal;
use crate::connectors::registry::Registry;
use crate::connectors::stripe::Stripe;
use crate::error::ApiError;
use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "shophippy_api=debug,tower_http=info".into()),
        )
        .init();

    let cfg = Arc::new(Config::from_env()?);

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect(&cfg.database_url)
        .await?;
    sqlx::migrate!("migrations").run(&pool).await?;
    tracing::info!("database migrated");

    let redis = idempotency::connect(&cfg.redis_url).await;
    match &redis {
        Some(_) => tracing::info!("redis idempotency store connected"),
        None => tracing::warn!("redis unavailable — idempotency falls back to the DB unique index"),
    }

    let mut registry = Registry::new();
    registry.register("stripe", Arc::new(Stripe::new(cfg.stripe_api_key.clone())));
    registry.register(
        "paypal",
        Arc::new(PayPal::new(
            cfg.paypal_client_id.clone(),
            cfg.paypal_client_secret.clone(),
            cfg.paypal_env.clone(),
        )),
    );
    tracing::info!("connectors registered: {:?}", registry.names());

    ledger::seed_demo_data(&pool, &cfg).await?;

    let state = AppState {
        pool,
        redis,
        config: cfg,
        connectors: Arc::new(registry),
    };

    let app = routes::router(state).layer(TraceLayer::new_for_http()).layer(CorsLayer::permissive());

    let addr = state_addr()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("shophippy API listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

fn state_addr() -> anyhow::Result<std::net::SocketAddr> {
    let raw = std::env::var("SHOPHIPPY_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
    raw.parse().map_err(|e| {
        ApiError::Internal(anyhow::anyhow!("invalid SHOPHIPPY_BIND_ADDR '{raw}': {e}")).into()
    })
}
