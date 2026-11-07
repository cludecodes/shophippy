//! Admin console authentication.
//!
//! Two credential paths guard `/admin/*` and `/v1/admin/*` routes:
//! 1. the static ops token (`SHOPHIPPY_ADMIN_TOKEN`, compared constant-time),
//! 2. email + password logins minted by [`login`], stored as opaque DB
//!    sessions (argon2id password hashes only; the plaintext is never kept).

use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use chrono::{DateTime, Duration, Utc};
use rand_core::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};

const SESSION_TTL_DAYS: i64 = 7;

pub fn sha256_hex(input: &str) -> String {
    hex::encode(Sha256::digest(input.as_bytes()))
}

#[derive(Debug, Serialize)]
pub struct AdminSession {
    pub email: String,
    pub session_token: String,
    pub expires_at: DateTime<Utc>,
}

/// Seed the first admin account from `SHOPHIPPY_ADMIN_EMAIL` +
/// `SHOPHIPPY_ADMIN_PASSWORD` on startup. No-op when the email already
/// exists (password is only written at first creation; rotate via DB).
pub async fn seed_from_env(pool: &PgPool) -> anyhow::Result<()> {
    let email = match std::env::var("SHOPHIPPY_ADMIN_EMAIL") {
        Ok(e) if !e.trim().is_empty() => e.trim().to_lowercase(),
        _ => {
            tracing::info!("SHOPHIPPY_ADMIN_EMAIL unset — admin login disabled (ops token still valid)");
            return Ok(());
        }
    };
    let password = std::env::var("SHOPHIPPY_ADMIN_PASSWORD").unwrap_or_default();
    if password.is_empty() {
        anyhow::bail!("SHOPHIPPY_ADMIN_EMAIL is set but SHOPHIPPY_ADMIN_PASSWORD is missing");
    }

    let exists: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM admin_users WHERE email = $1")
            .bind(&email)
            .fetch_optional(pool)
            .await?;
    if exists.is_some() {
        tracing::info!("admin console login already exists for '{email}'");
        return Ok(());
    }

    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("argon2 hashing failed: {e}"))?
        .to_string();

    sqlx::query("INSERT INTO admin_users (id, email, password_hash) VALUES ($1, $2, $3)")
        .bind(Uuid::new_v4())
        .bind(&email)
        .bind(&hash)
        .execute(pool)
        .await?;
    tracing::info!("admin console login created for '{email}'");
    Ok(())
}

/// Verify email + password and mint an opaque 7-day session.
pub async fn login(pool: &PgPool, email: &str, password: &str) -> ApiResult<AdminSession> {
    let email = email.trim().to_lowercase();
    let hash: Option<String> = sqlx::query_scalar(
        "SELECT password_hash FROM admin_users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(pool)
    .await?;

    let hash = hash.ok_or_else(|| ApiError::Unauthorized("invalid admin credentials".into()))?;
    let parsed = PasswordHash::new(&hash)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("stored hash unreadable: {e}")))?;
    if Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_err()
    {
        return Err(ApiError::Unauthorized("invalid admin credentials".into()));
    }

    // Opaque bearer token: 32 random bytes, hex-encoded; only its sha256 is stored.
    let mut buf = [0u8; 32];
    OsRng.fill_bytes(&mut buf);
    let token = hex::encode(buf);
    let expires_at = Utc::now() + Duration::days(SESSION_TTL_DAYS);

    let admin_id: Uuid = sqlx::query_scalar("SELECT id FROM admin_users WHERE email = $1")
        .bind(&email)
        .fetch_one(pool)
        .await?;
    sqlx::query(
        "INSERT INTO admin_sessions (token_hash, admin_id, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (token_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at",
    )
    .bind(sha256_hex(&token))
    .bind(admin_id)
    .bind(expires_at)
    .execute(pool)
    .await?;

    tracing::info!("admin session opened for '{email}' (expires {expires_at})");
    Ok(AdminSession {
        email,
        session_token: token,
        expires_at,
    })
}

/// Resolve a bearer session token to its admin identity, if still valid.
pub async fn verify_session(pool: &PgPool, token: &str) -> Option<String> {
    sqlx::query_as::<_, (String, DateTime<Utc>)>(
        "SELECT u.email, s.expires_at
           FROM admin_sessions s
           JOIN admin_users u ON u.id = s.admin_id
          WHERE s.token_hash = $1 AND s.expires_at > now()",
    )
    .bind(sha256_hex(token))
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .map(|(email, _)| email)
}
