use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_server")]
    pub server: ServerConfig,
    #[serde(default)]
    pub llm: Option<LlmConfig>,
    #[serde(default = "default_mqtt")]
    pub mqtt: MqttConfig,
    #[serde(default = "default_db_path")]
    pub db_path: String,
    #[serde(default)]
    pub config_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_port")]
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub provider: String,
    pub api_key: String,
    #[serde(default = "default_model_for_config")]
    pub model: String,
    #[serde(default)]
    pub api_base: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MqttConfig {
    #[serde(default = "default_client_id")]
    pub client_id: String,
}

fn default_server() -> ServerConfig {
    ServerConfig { port: default_port() }
}

fn default_mqtt() -> MqttConfig {
    MqttConfig {
        client_id: default_client_id(),
    }
}

fn default_port() -> u16 { 9733 }
fn default_client_id() -> String { "pi-sense".into() }
fn default_db_path() -> String { "pi-sense.db".into() }
fn default_model_for_config() -> String { String::new() }

#[allow(dead_code)]
pub fn default_model_for_provider(provider: &str) -> String {
    match provider {
        "ppq" => "deepseek-chat".into(),
        "togetherai" => "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo".into(),
        "openrouter" => "deepseek/deepseek-chat-v3-0324".into(),
        _ => "deepseek-chat".into(),
    }
}

pub fn provider_api_base(provider: &str) -> String {
    match provider {
        "ppq" => "https://api.ppq.ai".into(),
        "togetherai" => "https://api.togetherai.com/v1".into(),
        "openrouter" => "https://openrouter.ai/api/v1".into(),
        other => format!("https://api.{other}.com/v1"),
    }
}

#[allow(dead_code)]
pub fn provider_models_url(provider: &str) -> String {
    match provider {
        "ppq" => "https://api.ppq.ai/v1/models".into(),
        _ => format!("{}/models", provider_api_base(provider).trim_end_matches('/')),
    }
}

#[allow(dead_code)]
pub const PROVIDERS: &[&str] = &["PPQ", "TogetherAI", "OpenRouter"];

impl Default for Config {
    fn default() -> Self {
        Self {
            server: default_server(),
            llm: None,
            mqtt: default_mqtt(),
            db_path: default_db_path(),
            config_path: None,
        }
    }
}

impl Config {
    pub fn load(path: &str) -> Self {
        match std::fs::read_to_string(path) {
            Ok(content) => {
                let mut config: Config = serde_json::from_str(&content).unwrap_or_default();
                config.config_path = Some(path.into());
                config.apply_env_overrides();
                config
            }
            Err(_) => {
                let mut config = Config::default();
                config.config_path = Some(path.into());
                config
            }
        }
    }

    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let path = self.config_path.as_deref().unwrap_or("pi-sense.json");
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(path, json)?;
        Ok(())
    }

    fn apply_env_overrides(&mut self) {
        if let Some(ref mut llm) = self.llm {
            if let Ok(key) = std::env::var("PISENSE_LLM_API_KEY") {
                llm.api_key = key;
            }
            if let Ok(model) = std::env::var("PISENSE_LLM_MODEL") {
                llm.model = model;
            }
            if let Ok(base) = std::env::var("PISENSE_LLM_API_BASE") {
                llm.api_base = Some(base);
            }
        }
        if let Ok(port) = std::env::var("PISENSE_SERVER_PORT") {
            if let Ok(p) = port.parse() {
                self.server.port = p;
            }
        }
    }

    pub fn llm_api_base(&self) -> Option<String> {
        self.llm.as_ref().map(|llm| {
            if let Some(ref base) = llm.api_base {
                base.clone()
            } else {
                provider_api_base(&llm.provider)
            }
        })
    }
}

#[allow(dead_code)]
pub async fn fetch_models(provider: &str, api_key: &str) -> Result<Vec<String>, String> {
    let url = provider_models_url(provider);
    let resp = reqwest::Client::new()
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| format!("fetch error: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("API returned {status}: {body}"));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parse error: {e}"))?;

    json.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            let mut models: Vec<String> = arr
                .iter()
                .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
                .collect();
            models.sort();
            models
        })
        .ok_or_else(|| "unexpected response format: no 'data' array".into())
}