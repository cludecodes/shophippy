use axum::{http::StatusCode, response::IntoResponse, Json};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("resource not found")]
    NotFound,
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("connector error: {0}")]
    Connector(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        Self::Internal(anyhow::Error::new(e).context("database error"))
    }
}

impl From<redis::RedisError> for ApiError {
    fn from(e: redis::RedisError) -> Self {
        Self::Internal(anyhow::Error::new(e).context("redis error"))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let (status, code, msg) = match &self {
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not_found", "resource not found".to_string()),
            ApiError::Unauthorized(m) => (StatusCode::UNAUTHORIZED, "unauthorized", m.clone()),
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, "bad_request", m.clone()),
            ApiError::Conflict(m) => (StatusCode::CONFLICT, "conflict", m.clone()),
            ApiError::Connector(m) => (StatusCode::BAD_GATEWAY, "connector_error", m.clone()),
            ApiError::Internal(e) => {
                tracing::error!("internal error: {e:?}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "unexpected server error".to_string(),
                )
            }
        };

        (
            status,
            Json(json!({ "error": { "code": code, "message": msg } })),
        )
            .into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
