//! Admin console routes: login, merchants overview.

use axum::{extract::State, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::admin::AdminSession;
use crate::error::ApiResult;
use crate::state::{AdminGuard, AppState};

#[derive(Deserialize)]
pub struct LoginReq {
    pub email: String,
    pub password: String,
}

/// POST /v1/admin/login
pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginReq>,
) -> ApiResult<Json<AdminSession>> {
    if req.password.is_empty() {
        return Err(crate::error::ApiError::BadRequest("password is required".into()));
    }
    let session = crate::admin::login(&state.pool, &req.email, &req.password).await?;
    Ok(Json(session))
}

#[derive(Serialize)]
pub struct AdminMerchant {
    pub id: Uuid,
    pub name: String,
    pub country: String,
    pub tier: i32,
    pub created_at: DateTime<Utc>,
}

/// GET /v1/admin/merchants — console overview of onboarded merchants.
pub async fn list_merchants(
    State(state): State<AppState>,
    _: AdminGuard,
) -> ApiResult<Json<Vec<AdminMerchant>>> {
    let rows = sqlx::query_as::<_, (Uuid, String, String, i32, DateTime<Utc>)>(
        "SELECT id, name, country, tier, created_at
           FROM merchants
          ORDER BY created_at DESC
          LIMIT 200",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(
        rows.into_iter()
            .map(|(id, name, country, tier, created_at)| AdminMerchant {
                id,
                name,
                country,
                tier,
                created_at,
            })
            .collect(),
    ))
}
