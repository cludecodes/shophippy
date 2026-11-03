use anyhow::Context;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub bind_addr: String,
    /// When true, the percentage fee engine charges 50-155 bps per payment.
    /// Self-hosted instances run with `false` => zero gateway fee (free core).
    pub managed_cloud: bool,
    pub demo_api_key: String,
    pub admin_token: String,
    pub stripe_api_key: Option<String>,
    pub paypal_client_id: Option<String>,
    pub paypal_client_secret: Option<String>,
    pub paypal_env: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let managed_cloud = std::env::var("SHOPHIPPY_MANAGED_CLOUD")
            .map(|v| !matches!(v.to_ascii_lowercase().as_str(), "0" | "false" | "no" | "off"))
            .unwrap_or(true);

        let stripe_api_key = std::env::var("STRIPE_API_KEY").ok().filter(|v| !v.is_empty());
        let paypal_client_id = std::env::var("PAYPAL_CLIENT_ID").ok().filter(|v| !v.is_empty());
        let paypal_client_secret =
            std::env::var("PAYPAL_CLIENT_SECRET").ok().filter(|v| !v.is_empty());

        Ok(Self {
            database_url: std::env::var("SHOPHIPPY_DATABASE_URL")
                .unwrap_or_else(|_| "postgres://shophippy:shophippy@localhost:5432/shophippy".into()),
            redis_url: std::env::var("SHOPHIPPY_REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".into()),
            bind_addr: std::env::var("SHOPHIPPY_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into()),
            managed_cloud,
            demo_api_key: std::env::var("SHOPHIPPY_DEMO_API_KEY")
                .unwrap_or_else(|_| "sk_live_demo_merchant".into()),
            admin_token: std::env::var("SHOPHIPPY_ADMIN_TOKEN").unwrap_or_else(|_| "dev_admin".into()),
            stripe_api_key,
            paypal_client_id,
            paypal_client_secret,
            paypal_env: std::env::var("PAYPAL_ENV").unwrap_or_else(|_| "sandbox".into()),
        })
    }

    /// sha256-hex of the API key, used as the lookup token for auth.
    pub fn hash_key(key: &str) -> String {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(key.as_bytes());
        hex::encode(digest)
    }

    pub fn database_url(&self) -> anyhow::Result<&str> {
        self.database_url
            .as_str()
            .split_whitespace()
            .next()
            .context("empty database url")
    }
}
