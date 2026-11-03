//! Redis-backed idempotency store.
//!
//! A payment request carries an `Idempotency-Key` header. Before executing the
//! connector call we check Redis for a stored response under
//! `idempotency:{merchant}:{key}` (TTL 48h); a hit replays the stored response
//! without charging again. When Redis is unavailable we degrade gracefully —
//! the `payments(merchant_id, idempotency_key)` unique index still blocks
//! duplicate inserts.

use redis::aio::ConnectionManager;
use redis::AsyncCommands;

pub const TTL_SECS: i64 = 48 * 60 * 60;

pub async fn connect(url: &str) -> Option<ConnectionManager> {
    match redis::Client::open(url) {
        Ok(client) => match client.get_connection_manager().await {
            Ok(cm) => Some(cm),
            Err(e) => {
                tracing::warn!("redis connect failed: {e}");
                None
            }
        },
        Err(e) => {
            tracing::warn!("invalid redis url: {e}");
            None
        }
    }
}

pub fn cache_key(merchant_id: &uuid::Uuid, key: &uuid::Uuid) -> String {
    format!("idempotency:{merchant_id}:{key}")
}

/// Replay value stored after a successful charge, if any.
pub async fn get(redis: Option<&ConnectionManager>, key: &str) -> Option<String> {
    let cm = redis?;
    let mut conn = cm.clone();
    conn.get(key).await.ok()?
}

/// Persist the final response payload with a TTL.
pub async fn store(
    redis: Option<&ConnectionManager>,
    key: &str,
    value: &serde_json::Value,
) {
    if let Some(cm) = redis {
        let mut conn = cm.clone();
        let payload = serde_json::to_string(value).unwrap_or_default();
        if let Err(e) = conn.set_ex::<_, _, ()>(key, payload, TTL_SECS as u64).await {
            tracing::warn!("idempotency store failed: {e}");
        }
    }
}

/// Reserve the key (SET NX) to block concurrent duplicate charges.
pub async fn reserve(redis: Option<&ConnectionManager>, key: &str) -> bool {
    let Some(cm) = redis else {
        // No Redis: rely on the DB unique index.
        return true;
    };
    let mut conn = cm.clone();
    match conn.set_nx::<_, _, Option<()>>(key, "in-flight").await {
        Ok(Some(_)) => {
            let _ = conn.expire::<_, ()>(key, TTL_SECS).await;
            true
        }
        Ok(None) => false,
        Err(e) => {
            tracing::warn!("idempotency reserve failed: {e}");
            true // fail open; DB constraints still protect us
        }
    }
}

pub async fn release(redis: Option<&ConnectionManager>, key: &str) {
    if let Some(cm) = redis {
        let mut conn = cm.clone();
        let _ = conn.del::<_, ()>(key).await;
    }
}
