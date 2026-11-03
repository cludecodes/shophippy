use std::sync::Arc;

use async_trait::async_trait;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use redis::aio::ConnectionManager;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::Config;
use crate::connectors::registry::Registry;
use crate::error::ApiError;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub redis: Option<ConnectionManager>,
    pub config: Arc<Config>,
    pub connectors: Arc<Registry>,
}

/// Merchant identity authenticated from `X-Api-Key` (sha256 compared against
/// `merchants.api_key_hash`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Merchant {
    pub id: Uuid,
    pub name: String,
    pub country: String,
    pub tier: i32,
}

#[async_trait]
impl FromRequestParts<AppState> for Merchant {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let key = parts
            .headers
            .get("x-api-key")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| ApiError::Unauthorized("missing X-Api-Key header".into()))?;

        let hash = Config::hash_key(key);
        let row = sqlx::query_as::<_, (Uuid, String, String, i32)>(
            "SELECT id, name, country, tier FROM merchants WHERE api_key_hash = $1",
        )
        .bind(&hash)
        .fetch_optional(&state.pool)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::Unauthorized("invalid api key".into()))?;

        Ok(Self {
            id: row.0,
            name: row.1,
            country: row.2,
            tier: row.3,
        })
    }
}

/// Extractor guarding fee-rule admin endpoints with a shared token.
pub struct AdminGuard;

#[async_trait]
impl FromRequestParts<AppState> for AdminGuard {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get("x-admin-token")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| ApiError::Unauthorized("missing X-Admin-Token header".into()))?;

        if !constant_time_eq(token.as_bytes(), state.config.admin_token.as_bytes()) {
            return Err(ApiError::Unauthorized("invalid admin token".into()));
        }
        Ok(Self)
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
