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
    // Runtime Migrator keeps the build hermetic (no compile-time path magic)
    // and works both with `cargo run` (cwd = api/) and the Docker image (/app).
    let migrations_dir = std::env::var("SHOPHIPPY_MIGRATIONS_DIR")
        .or_else(|_| std::env::var("SHOPHIPPY_BIN_MIGRATIONS"))
        .unwrap_or_else(|_| "migrations".into());
    let migrator = sqlx::migrate::Migrator::new(std::path::PathBuf::from(&migrations_dir)).await
    .map_err(|e| anyhow::anyhow!("failed to load migrations from '{migrations_dir}': {e}"))?;
    migrator.run(&pool).await?;
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

    let app = routes::router(state.clone())
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive());

    let addr: std::net::SocketAddr = state.config.bind_addr.parse().map_err(|e| {
        anyhow::anyhow!("invalid SHOPHIPPY_BIND_ADDR '{}': {e}", state.config.bind_addr)
    })?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("shophippy API listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}
