use async_trait::async_trait;
use reqwest::{header, Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    pub provider: String,
    pub model: String,
    pub endpoint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub text: String,
    pub model: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AiError {
    #[error("Provider settings are invalid: {0}")]
    InvalidSettings(String),
    #[error("No API key is configured for this provider.")]
    MissingCredential,
    #[error("The provider rejected the API key. Check the key in Settings.")]
    Unauthorized,
    #[error("The provider rate limit was reached. Wait a moment and try again.")]
    RateLimited,
    #[error("The provider service returned an error ({0}).")]
    ProviderStatus(u16),
    #[error("The provider response was invalid or incomplete.")]
    InvalidResponse,
    #[allow(dead_code)]
    #[error("The request was cancelled.")]
    Cancelled,
    #[error("The provider request timed out. Try again or use a smaller context.")]
    Timeout,
    #[error(
        "Could not connect to the configured provider. Check the endpoint and network connection."
    )]
    Network,
    #[error("The secure credential store is unavailable: {0}")]
    CredentialStore(String),
    #[error("Could not save provider settings: {0}")]
    SettingsStore(String),
}

#[async_trait]
pub trait ChatProvider: Send + Sync {
    async fn complete(
        &self,
        settings: &ProviderSettings,
        api_key: &str,
        request: &ChatRequest,
    ) -> Result<ChatResponse, AiError>;
    async fn test_connection(
        &self,
        settings: &ProviderSettings,
        api_key: &str,
    ) -> Result<(), AiError>;
}

pub struct OpenAiCompatibleProvider {
    client: Client,
    credential_required: bool,
    provider_name: &'static str,
}

impl OpenAiCompatibleProvider {
    pub fn new(provider_name: &'static str, credential_required: bool) -> Result<Self, AiError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(90))
            .build()
            .map_err(|_| AiError::Network)?;
        Ok(Self {
            client,
            credential_required,
            provider_name,
        })
    }

    fn validate(settings: &ProviderSettings) -> Result<(), AiError> {
        if settings.model.trim().is_empty() {
            return Err(AiError::InvalidSettings("model is required".into()));
        }
        let endpoint = reqwest::Url::parse(&settings.endpoint)
            .map_err(|_| AiError::InvalidSettings("endpoint must be a valid HTTPS URL".into()))?;
        if endpoint.scheme() != "https"
            && !matches!(endpoint.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
        {
            return Err(AiError::InvalidSettings(
                "endpoint must use HTTPS (HTTP is allowed for localhost)".into(),
            ));
        }
        Ok(())
    }

    fn completion_url(settings: &ProviderSettings) -> Result<String, AiError> {
        Self::validate(settings)?;
        let mut endpoint = reqwest::Url::parse(&settings.endpoint)
            .map_err(|_| AiError::InvalidSettings("endpoint must be a valid HTTPS URL".into()))?;
        let path = endpoint.path().trim_end_matches('/');
        if !path.ends_with("/chat/completions") {
            let path = format!("{path}/chat/completions");
            endpoint.set_path(&path);
        }
        Ok(endpoint.to_string())
    }

    async fn post(
        &self,
        settings: &ProviderSettings,
        api_key: &str,
        payload: Value,
    ) -> Result<reqwest::Response, AiError> {
        if self.credential_required && api_key.trim().is_empty() {
            return Err(AiError::MissingCredential);
        }
        if self.provider_name == "ollama" {
            let endpoint = reqwest::Url::parse(&settings.endpoint)
                .map_err(|_| AiError::InvalidSettings("Ollama endpoint URL is invalid".into()))?;
            let host = endpoint.host_str().ok_or_else(|| {
                AiError::InvalidSettings("Ollama endpoint must use loopback".into())
            })?;
            if !matches!(host, "localhost" | "127.0.0.1" | "::1") {
                return Err(AiError::InvalidSettings(
                    "Ollama must use a local loopback endpoint".into(),
                ));
            }
            let port = endpoint.port_or_known_default().ok_or_else(|| {
                AiError::InvalidSettings("Ollama endpoint must include a valid port".into())
            })?;
            let addresses = tokio::net::lookup_host((host, port)).await.map_err(|_| {
                AiError::InvalidSettings("Ollama endpoint must resolve to this device".into())
            })?;
            if addresses
                .into_iter()
                .any(|address| !address.ip().is_loopback())
            {
                return Err(AiError::InvalidSettings(
                    "Ollama endpoint resolves to a non-local address".into(),
                ));
            }
        }
        let url = Self::completion_url(settings)?;
        let mut request = self
            .client
            .post(url)
            .header(header::CONTENT_TYPE, "application/json");
        if !api_key.trim().is_empty() {
            request = request.header(header::AUTHORIZATION, format!("Bearer {api_key}"));
        }
        if self.provider_name == "openrouter" {
            request = request.header("X-Title", "Noveler");
        }
        let response = request.json(&payload).send().await.map_err(|error| {
            if error.is_timeout() {
                AiError::Timeout
            } else {
                AiError::Network
            }
        })?;
        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(AiError::Unauthorized),
            StatusCode::TOO_MANY_REQUESTS => Err(AiError::RateLimited),
            status if !status.is_success() => Err(AiError::ProviderStatus(status.as_u16())),
            _ => Ok(response),
        }
    }
}

#[derive(Deserialize)]
struct CompletionEnvelope {
    choices: Vec<CompletionChoice>,
    model: Option<String>,
}

#[derive(Deserialize)]
struct CompletionChoice {
    message: CompletionMessage,
}

#[derive(Deserialize)]
struct CompletionMessage {
    content: String,
}

#[async_trait]
impl ChatProvider for OpenAiCompatibleProvider {
    async fn complete(
        &self,
        settings: &ProviderSettings,
        api_key: &str,
        request: &ChatRequest,
    ) -> Result<ChatResponse, AiError> {
        let messages: Vec<Value> = request
            .messages
            .iter()
            .map(|message| json!({"role": message.role, "content": message.content}))
            .collect();
        let mut payload = json!({"model": settings.model, "messages": messages, "stream": false});
        if let Some(max_tokens) = request.max_tokens {
            payload["max_tokens"] = json!(max_tokens);
        }
        let response = self.post(settings, api_key, payload).await?;
        let envelope: CompletionEnvelope = response
            .json()
            .await
            .map_err(|_| AiError::InvalidResponse)?;
        let text = envelope
            .choices
            .into_iter()
            .next()
            .map(|choice| choice.message.content)
            .filter(|text| !text.trim().is_empty())
            .ok_or(AiError::InvalidResponse)?;
        Ok(ChatResponse {
            text,
            model: envelope.model.unwrap_or_else(|| settings.model.clone()),
        })
    }

    async fn test_connection(
        &self,
        settings: &ProviderSettings,
        api_key: &str,
    ) -> Result<(), AiError> {
        let request = ChatRequest {
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "Reply with OK.".into(),
            }],
            max_tokens: Some(8),
        };
        self.complete(settings, api_key, &request).await.map(|_| ())
    }
}

pub struct ProviderRegistry {
    openai_compatible: Arc<dyn ChatProvider>,
    openrouter: Arc<dyn ChatProvider>,
    ollama: Arc<dyn ChatProvider>,
}

impl ProviderRegistry {
    pub fn new() -> Result<Self, AiError> {
        Ok(Self {
            openai_compatible: Arc::new(OpenAiCompatibleProvider::new("openai-compatible", true)?),
            openrouter: Arc::new(OpenAiCompatibleProvider::new("openrouter", true)?),
            ollama: Arc::new(OpenAiCompatibleProvider::new("ollama", false)?),
        })
    }

    pub fn provider(&self, id: &str) -> Result<&Arc<dyn ChatProvider>, AiError> {
        match id {
            "openai-compatible" => Ok(&self.openai_compatible),
            "openrouter" => Ok(&self.openrouter),
            "ollama" => Ok(&self.ollama),
            _ => Err(AiError::InvalidSettings("unsupported provider".into())),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub provider: String,
    pub model: String,
    pub endpoint: String,
}

impl From<&AiSettings> for ProviderSettings {
    fn from(settings: &AiSettings) -> Self {
        Self {
            provider: settings.provider.clone(),
            model: settings.model.clone(),
            endpoint: settings.endpoint.clone(),
        }
    }
}

impl AiSettings {
    fn provider_settings(&self) -> ProviderSettings {
        ProviderSettings::from(self)
    }
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider: "openai-compatible".into(),
            model: String::new(),
            endpoint: "https://api.openai.com/v1".into(),
        }
    }
}

impl AiSettings {
    fn default_endpoint(provider: &str) -> Option<&'static str> {
        match provider {
            "openai-compatible" => Some("https://api.openai.com/v1"),
            "openrouter" => Some("https://openrouter.ai/api/v1"),
            "ollama" => Some("http://127.0.0.1:11434/v1"),
            _ => None,
        }
    }

    fn validate(&self) -> Result<(), AiError> {
        if self.model.trim().is_empty() {
            return Err(AiError::InvalidSettings("model is required".into()));
        }
        let endpoint = reqwest::Url::parse(&self.endpoint)
            .map_err(|_| AiError::InvalidSettings("endpoint must be a valid HTTPS URL".into()))?;
        if self.provider == "ollama"
            && !matches!(endpoint.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
        {
            return Err(AiError::InvalidSettings(
                "Ollama must use a local endpoint for private, on-device inference".into(),
            ));
        }
        OpenAiCompatibleProvider::validate(&self.provider_settings())
    }
}

pub trait CredentialStore: Send + Sync {
    fn set(&self, account: &str, secret: &str) -> Result<(), AiError>;
    fn get(&self, account: &str) -> Result<String, AiError>;
    fn delete(&self, account: &str) -> Result<(), AiError>;
}

pub struct OsCredentialStore {
    service: String,
}

impl OsCredentialStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, account: &str) -> Result<keyring::Entry, AiError> {
        keyring::Entry::new(&self.service, account)
            .map_err(|error| AiError::CredentialStore(error.to_string()))
    }
}

impl CredentialStore for OsCredentialStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), AiError> {
        self.entry(account)?
            .set_password(secret)
            .map_err(|error| AiError::CredentialStore(error.to_string()))
    }
    fn get(&self, account: &str) -> Result<String, AiError> {
        self.entry(account)?
            .get_password()
            .map_err(|error| match error {
                keyring::Error::NoEntry => AiError::MissingCredential,
                other => AiError::CredentialStore(other.to_string()),
            })
    }
    fn delete(&self, account: &str) -> Result<(), AiError> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(AiError::CredentialStore(error.to_string())),
        }
    }
}

pub trait SettingsStore: Send + Sync {
    fn load(&self) -> Result<AiSettings, AiError>;
    fn save(&self, settings: &AiSettings) -> Result<(), AiError>;
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptTemplateRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionRecord {
    pub id: String,
    pub at: String,
    pub template_name: String,
    pub model: String,
    pub included_context: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiLocalData {
    pub templates: Vec<PromptTemplateRecord>,
    pub history: Vec<InteractionRecord>,
}

pub trait AiLocalStore: Send + Sync {
    fn load(&self) -> Result<AiLocalData, AiError>;
    fn save_templates(&self, templates: &[PromptTemplateRecord]) -> Result<(), AiError>;
    fn record_interaction(&self, interaction: &InteractionRecord) -> Result<(), AiError>;
    fn clear_history(&self) -> Result<(), AiError>;
}

pub struct FileAiLocalStore {
    path: std::path::PathBuf,
}

fn validate_local_data(data: &AiLocalData) -> Result<(), AiError> {
    if data.templates.len() > 100 || data.history.len() > 200 {
        return Err(AiError::SettingsStore(
            "AI local metadata exceeds configured limits".into(),
        ));
    }
    if data.templates.iter().any(|template| {
        template.name.trim().is_empty()
            || template.name.chars().count() > 100
            || template.description.chars().count() > 500
            || template.body.chars().count() > 20_000
    }) {
        return Err(AiError::SettingsStore(
            "AI prompt template data is invalid or too large".into(),
        ));
    }
    if data.history.iter().any(|item| {
        item.id.is_empty()
            || item.template_name.chars().count() > 100
            || item.model.chars().count() > 200
            || item.included_context.len() > 20
    }) {
        return Err(AiError::SettingsStore(
            "AI interaction metadata is invalid".into(),
        ));
    }
    Ok(())
}

impl FileAiLocalStore {
    pub fn new(path: std::path::PathBuf) -> Self {
        Self { path }
    }
    fn write(&self, data: &AiLocalData) -> Result<(), AiError> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| AiError::SettingsStore("AI local data path has no parent".into()))?;
        std::fs::create_dir_all(parent)
            .map_err(|error| AiError::SettingsStore(error.to_string()))?;
        let bytes = serde_json::to_vec_pretty(data)
            .map_err(|error| AiError::SettingsStore(error.to_string()))?;
        std::fs::write(&self.path, bytes).map_err(|error| AiError::SettingsStore(error.to_string()))
    }
}

impl AiLocalStore for FileAiLocalStore {
    fn load(&self) -> Result<AiLocalData, AiError> {
        match std::fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|error| AiError::SettingsStore(error.to_string())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AiLocalData {
                templates: Vec::new(),
                history: Vec::new(),
            }),
            Err(error) => Err(AiError::SettingsStore(error.to_string())),
        }
    }
    fn save_templates(&self, templates: &[PromptTemplateRecord]) -> Result<(), AiError> {
        let mut data = self.load()?;
        data.templates = templates.to_vec();
        validate_local_data(&data)?;
        self.write(&data)
    }
    fn record_interaction(&self, interaction: &InteractionRecord) -> Result<(), AiError> {
        let mut data = self.load()?;
        data.history.insert(0, interaction.clone());
        data.history.truncate(200);
        validate_local_data(&data)?;
        self.write(&data)
    }
    fn clear_history(&self) -> Result<(), AiError> {
        let mut data = self.load()?;
        data.history.clear();
        self.write(&data)
    }
}

pub struct FileSettingsStore {
    path: std::path::PathBuf,
}

impl FileSettingsStore {
    pub fn new(path: std::path::PathBuf) -> Self {
        Self { path }
    }
}

impl SettingsStore for FileSettingsStore {
    fn load(&self) -> Result<AiSettings, AiError> {
        match std::fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|error| AiError::SettingsStore(error.to_string())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AiSettings::default()),
            Err(error) => Err(AiError::SettingsStore(error.to_string())),
        }
    }
    fn save(&self, settings: &AiSettings) -> Result<(), AiError> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| AiError::SettingsStore("settings path has no parent".into()))?;
        std::fs::create_dir_all(parent)
            .map_err(|error| AiError::SettingsStore(error.to_string()))?;
        let bytes = serde_json::to_vec_pretty(settings)
            .map_err(|error| AiError::SettingsStore(error.to_string()))?;
        std::fs::write(&self.path, bytes).map_err(|error| AiError::SettingsStore(error.to_string()))
    }
}

pub struct AiService {
    pub settings: Box<dyn SettingsStore>,
    pub credentials: Box<dyn CredentialStore>,
    pub local_data: Box<dyn AiLocalStore>,
    pub providers: ProviderRegistry,
}

impl AiService {
    pub fn save_settings(&self, settings: AiSettings) -> Result<AiSettings, AiError> {
        self.providers.provider(&settings.provider)?;
        settings.validate()?;
        self.settings.save(&settings)?;
        Ok(settings)
    }

    pub fn configure_provider(&self, provider: String) -> Result<AiSettings, AiError> {
        let endpoint = AiSettings::default_endpoint(&provider)
            .ok_or_else(|| AiError::InvalidSettings("unsupported provider".into()))?;
        let current = self.settings.load()?;
        if provider == current.provider {
            return Ok(current);
        }
        let settings = AiSettings {
            provider,
            model: String::new(),
            endpoint: endpoint.into(),
        };
        self.providers.provider(&settings.provider)?;
        self.settings.save(&settings)?;
        Ok(settings)
    }

    pub fn has_credential(&self, provider: &str) -> Result<bool, AiError> {
        match self.credentials.get(provider) {
            Ok(_) => Ok(true),
            Err(AiError::MissingCredential) => Ok(false),
            Err(error) => Err(error),
        }
    }

    pub fn save_credential(&self, provider: &str, secret: &str) -> Result<(), AiError> {
        self.providers.provider(provider)?;
        if secret.trim().is_empty() {
            return Err(AiError::MissingCredential);
        }
        self.credentials.set(provider, secret)
    }

    pub fn delete_credential(&self, provider: &str) -> Result<(), AiError> {
        self.providers.provider(provider)?;
        self.credentials.delete(provider)
    }

    pub async fn test_connection(&self) -> Result<(), AiError> {
        let settings = self.settings.load()?;
        settings.validate()?;
        let key = self.credential_for_provider(&settings)?;
        self.providers
            .provider(&settings.provider)?
            .test_connection(&settings.provider_settings(), &key)
            .await
    }

    pub async fn complete(&self, request: &ChatRequest) -> Result<ChatResponse, AiError> {
        if request.messages.is_empty()
            || request
                .messages
                .iter()
                .any(|message| message.content.trim().is_empty())
        {
            return Err(AiError::InvalidSettings(
                "messages must contain non-empty prompt text".into(),
            ));
        }
        if request
            .messages
            .iter()
            .any(|message| !matches!(message.role.as_str(), "system" | "user" | "assistant"))
        {
            return Err(AiError::InvalidSettings(
                "message role is unsupported".into(),
            ));
        }
        let settings = self.settings.load()?;
        settings.validate()?;
        let key = self.credential_for_provider(&settings)?;
        self.providers
            .provider(&settings.provider)?
            .complete(&settings.provider_settings(), &key, request)
            .await
    }

    fn credential_for_provider(&self, settings: &AiSettings) -> Result<String, AiError> {
        match self.credentials.get(&settings.provider) {
            Ok(key) => Ok(key),
            Err(AiError::MissingCredential) if settings.provider == "ollama" => Ok(String::new()),
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    struct MockCredentialStore(Mutex<Option<String>>);
    impl CredentialStore for MockCredentialStore {
        fn set(&self, _account: &str, secret: &str) -> Result<(), AiError> {
            *self.0.lock().unwrap() = Some(secret.to_owned());
            Ok(())
        }
        fn get(&self, _account: &str) -> Result<String, AiError> {
            self.0
                .lock()
                .unwrap()
                .clone()
                .ok_or(AiError::MissingCredential)
        }
        fn delete(&self, _account: &str) -> Result<(), AiError> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    fn mock_server(status: &str, body: &str) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let body = body.to_owned();
        let status = status.to_owned();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            use std::io::{Read, Write};
            let mut request = [0; 8192];
            let _ = stream.read(&mut request).unwrap();
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        (format!("http://{address}/v1"), handle)
    }

    fn request() -> ChatRequest {
        ChatRequest {
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "hello".into(),
            }],
            max_tokens: Some(12),
        }
    }

    fn settings(endpoint: String) -> ProviderSettings {
        ProviderSettings {
            provider: "openai-compatible".into(),
            model: "test-model".into(),
            endpoint,
        }
    }

    #[test]
    fn endpoint_validation_requires_https_except_loopback() {
        let mut settings = ProviderSettings {
            provider: "openai-compatible".into(),
            model: "test-model".into(),
            endpoint: "http://example.com/v1".into(),
        };
        assert!(OpenAiCompatibleProvider::validate(&settings).is_err());
        settings.endpoint = "http://127.0.0.1:1234/v1".into();
        assert!(OpenAiCompatibleProvider::validate(&settings).is_ok());
        settings.endpoint = "https://example.com/v1".into();
        assert!(OpenAiCompatibleProvider::validate(&settings).is_ok());
    }

    #[test]
    fn provider_defaults_and_ollama_loopback_policy_are_safe() {
        assert_eq!(
            AiSettings::default_endpoint("openai-compatible"),
            Some("https://api.openai.com/v1")
        );
        assert_eq!(
            AiSettings::default_endpoint("openrouter"),
            Some("https://openrouter.ai/api/v1")
        );
        assert_eq!(
            AiSettings::default_endpoint("ollama"),
            Some("http://127.0.0.1:11434/v1")
        );
        assert_eq!(AiSettings::default_endpoint("unknown"), None);

        let mut ollama = AiSettings {
            provider: "ollama".into(),
            model: "llama3.2".into(),
            endpoint: "http://127.0.0.1:11434/v1".into(),
        };
        assert!(ollama.validate().is_ok());
        ollama.endpoint = "https://remote.example/v1".into();
        assert!(ollama.validate().is_err());
    }

    #[test]
    fn provider_switch_uses_default_endpoint_and_clears_model() {
        let path = std::env::temp_dir().join(format!(
            "noveler-provider-settings-{}.json",
            uuid::Uuid::new_v4()
        ));
        let service = AiService {
            settings: Box::new(FileSettingsStore::new(path.clone())),
            credentials: Box::new(MockCredentialStore(Mutex::new(None))),
            local_data: Box::new(FileAiLocalStore::new(
                std::env::temp_dir().join("unused-ai-local-store.json"),
            )),
            providers: ProviderRegistry::new().unwrap(),
        };
        let switched = service.configure_provider("openrouter".into()).unwrap();
        assert_eq!(switched.provider, "openrouter");
        assert_eq!(switched.model, "");
        assert_eq!(switched.endpoint, "https://openrouter.ai/api/v1");
        assert_eq!(service.settings.load().unwrap().provider, "openrouter");
        assert!(service.configure_provider("unknown".into()).is_err());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn configure_provider_preserves_a_saved_credential_for_the_other_provider() {
        let path = std::env::temp_dir().join(format!(
            "noveler-provider-switch-{}.json",
            uuid::Uuid::new_v4()
        ));
        let credentials = MockCredentialStore(Mutex::new(None));
        credentials
            .set("openrouter", "saved-openrouter-key")
            .unwrap();
        let service = AiService {
            settings: Box::new(FileSettingsStore::new(path.clone())),
            credentials: Box::new(credentials),
            local_data: Box::new(FileAiLocalStore::new(
                std::env::temp_dir().join("unused-ai-local-store.json"),
            )),
            providers: ProviderRegistry::new().unwrap(),
        };
        service.configure_provider("ollama".into()).unwrap();
        assert_eq!(
            service.credentials.get("openrouter").unwrap(),
            "saved-openrouter-key"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn ollama_can_resolve_missing_api_key_to_empty_secret() {
        let service = AiService {
            settings: Box::new(FileSettingsStore::new(
                std::env::temp_dir().join("unused-ai-settings.json"),
            )),
            credentials: Box::new(MockCredentialStore(Mutex::new(None))),
            local_data: Box::new(FileAiLocalStore::new(
                std::env::temp_dir().join("unused-ai-data.json"),
            )),
            providers: ProviderRegistry::new().unwrap(),
        };
        let settings = AiSettings {
            provider: "ollama".into(),
            model: "llama3.2".into(),
            endpoint: "http://127.0.0.1:11434/v1".into(),
        };
        assert_eq!(service.credential_for_provider(&settings).unwrap(), "");
    }

    #[test]
    fn switching_provider_persists_its_endpoint_and_clears_model() {
        let path =
            std::env::temp_dir().join(format!("noveler-ai-settings-{}.json", uuid::Uuid::new_v4()));
        let store = FileSettingsStore::new(path.clone());
        store
            .save(&AiSettings {
                provider: "openai-compatible".into(),
                model: "old-model".into(),
                endpoint: "https://api.openai.com/v1".into(),
            })
            .unwrap();
        let service = AiService {
            settings: Box::new(store),
            credentials: Box::new(MockCredentialStore(Mutex::new(None))),
            local_data: Box::new(FileAiLocalStore::new(
                std::env::temp_dir().join("unused-ai-data.json"),
            )),
            providers: ProviderRegistry::new().unwrap(),
        };

        let switched = service.configure_provider("openrouter".into()).unwrap();
        assert_eq!(switched.provider, "openrouter");
        assert_eq!(switched.model, "");
        assert_eq!(switched.endpoint, "https://openrouter.ai/api/v1");
        assert_eq!(service.settings.load().unwrap().provider, "openrouter");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn api_key_is_only_kept_by_credential_store() {
        let store = MockCredentialStore(Mutex::new(None));
        store.set("openai-compatible", "test-secret").unwrap();
        assert_eq!(store.get("openai-compatible").unwrap(), "test-secret");
        store.delete("openai-compatible").unwrap();
        assert_eq!(
            store.get("openai-compatible"),
            Err(AiError::MissingCredential)
        );
    }

    #[tokio::test]
    async fn mocked_http_provider_maps_errors_without_echoing_secrets() {
        let (endpoint, server) = mock_server("401 Unauthorized", "{}");
        let provider = OpenAiCompatibleProvider::new("openai-compatible", true).unwrap();
        let error = provider
            .complete(&settings(endpoint), "never-log-this", &request())
            .await
            .unwrap_err();
        assert_eq!(error, AiError::Unauthorized);
        assert!(!error.to_string().contains("never-log-this"));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn mocked_http_provider_parses_successful_completion() {
        let body =
            r#"{"model":"test-model","choices":[{"message":{"content":"A safe preview."}}]}"#;
        let (endpoint, server) = mock_server("200 OK", body);
        let provider = OpenAiCompatibleProvider::new("openai-compatible", true).unwrap();
        let response = provider
            .complete(&settings(endpoint), "test-key", &request())
            .await
            .unwrap();
        assert_eq!(response.text, "A safe preview.");
        assert_eq!(response.model, "test-model");
        server.join().unwrap();
    }

    #[tokio::test]
    async fn ollama_provider_posts_without_an_api_key() {
        let (endpoint, server) = mock_server(
            "200 OK",
            r#"{"model":"llama3.2","choices":[{"message":{"content":"Local answer"}}]}"#,
        );
        let provider = OpenAiCompatibleProvider::new("ollama", false).unwrap();
        let settings = ProviderSettings {
            provider: "ollama".into(),
            model: "llama3.2".into(),
            endpoint,
        };
        let result = provider.complete(&settings, "", &request()).await.unwrap();
        assert_eq!(result.text, "Local answer");
        server.join().unwrap();
    }

    #[tokio::test]
    async fn openrouter_provider_sends_attribution_title_header() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = [0; 8192];
            let count = stream.read(&mut bytes).unwrap();
            let request = String::from_utf8_lossy(&bytes[..count]).to_ascii_lowercase();
            assert!(request.contains("x-title: noveler"));
            let body = r#"{"model":"openai/gpt-test","choices":[{"message":{"content":"ok"}}]}"#;
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        let provider = OpenAiCompatibleProvider::new("openrouter", true).unwrap();
        let settings = ProviderSettings {
            provider: "openrouter".into(),
            model: "openai/gpt-test".into(),
            endpoint: format!("http://{address}/api/v1"),
        };
        provider
            .complete(&settings, "test-key", &request())
            .await
            .unwrap();
        server.join().unwrap();
    }

    #[tokio::test]
    async fn mocked_http_provider_maps_rate_limit() {
        let (endpoint, server) = mock_server("429 Too Many Requests", "{}");
        let provider = OpenAiCompatibleProvider::new("openai-compatible", true).unwrap();
        let error = provider
            .complete(&settings(endpoint), "test-key", &request())
            .await
            .unwrap_err();
        assert_eq!(error, AiError::RateLimited);
        server.join().unwrap();
    }

    #[test]
    fn local_history_does_not_have_prompt_or_response_fields() {
        let interaction = InteractionRecord {
            id: "interaction-1".into(),
            at: "2026-01-01T00:00:00Z".into(),
            template_name: "Continue passage".into(),
            model: "test-model".into(),
            included_context: vec!["scene".into()],
        };
        let serialized = serde_json::to_string(&interaction).unwrap();
        assert!(!serialized.contains("prompt"));
        assert!(!serialized.contains("response"));
        assert!(serialized.contains("scene"));
    }
}
