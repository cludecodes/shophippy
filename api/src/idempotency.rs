//! Redis-backed idempotency store.
//!
//! A payment request carries an `Idempotency-Key` header. Before executing the
//! connector call we check Redis for a stored response under
//! `idempotency:{merchant}:{key}` (TTL 48h); a hit replays the stored response
//! without charging again. When Redis is unavailable we degrade gracefully —
//! the `payments(merchant_id, idempotency_key)` unique index still blocks
//! duplicate inserts.

use redis::aio::ConnectionManager;

pub const TTL_SECS: u64 = 48 * 60 * 60;

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

pub async fn get(redis: Option<&ConnectionManager>, key: &str) -> Option<String> {
    let cm = redis?;
    let mut conn = cm.clone();
    redis::cmd("GET").arg(key).query_async(&mut conn).await.ok()?
}

pub async fn store(
    redis: Option<&ConnectionManager>,
    key: &str,
    value: &serde_json::Value,
) {
    if let Some(cm) = redis {
        let mut conn = cm.clone();
        let payload = serde_json::to_string(value).unwrap_or_default();
        if let Err(e) = redis::cmd("SETEX")
            .arg(key)
            .arg(TTL_SECS as isize)
            .arg(payload)
            .query_async::<()>(&mut conn)
            .await
        {
            tracing::warn!("idempotency store failed: {e}");
        }
    }
}

/// Reserve the key if possible; returns true when we are the first writer.
pub async fn reserve(
    redis: Option<&ConnectionManager>,
    key: &str,
) -> bool {
    let Some(cm) = redis else { return true };
    let mut conn = cm.clone();
    matches!(
        redis::cmd("SET")
            .arg(key)
            .arg("reserved")
            .arg("EX")
            .arg(TTL_SECS as isize)
            .arg("NX")
            .query_async::<Option<()>>(&mut conn)
            .await,
        Ok(Some(_))
    )
}

pub async fn release(redis: Option<&ConnectionManager>, key: &str) {
    if let Some(cm) = redis {
        let mut conn = cm.clone();
        let _ = redis::cmd("DEL").arg(key).query_async::<()>(&mut conn).await;
    }
}
