use std::collections::HashMap;
use std::sync::Arc;

use super::Connector;

/// Name-keyed directory of available connectors.
/// "auto" resolves to the first registered connector (Stripe for the MVP).
#[derive(Default)]
pub struct Registry {
    connectors: HashMap<String, Arc<dyn Connector>>,
    default_name: Option<String>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, name: &str, connector: Arc<dyn Connector>) {
        if self.default_name.is_none() {
            self.default_name = Some(name.to_string());
        }
        self.connectors.insert(name.to_string(), connector);
    }

    pub fn names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.connectors.keys().cloned().collect();
        names.sort();
        names
    }

    /// Resolve a connector by name; `None` / "auto" maps to the default.
    pub fn get(&self, name: Option<&str>) -> Result<Arc<dyn Connector>, super::super::error::ApiError> {
        let name = name.unwrap_or("auto");
        let resolved = if name == "auto" {
            self.default_name.as_deref().ok_or_else(|| {
                super::super::error::ApiError::Connector("no connectors registered".into())
            })?
        } else {
            name
        };

        self.connectors.get(resolved).cloned().ok_or_else(|| {
            super::super::error::ApiError::BadRequest(format!("unknown connector '{name}'"))
        })
    }
}
