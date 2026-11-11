use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tauri::State;

use crate::ai::{
    AiError, AiLocalData, AiService, AiSettings, ChatRequest, ChatResponse, InteractionRecord,
    PromptTemplateRecord,
};
use crate::db::{
    self, AppError, Chapter, CodexEntry, CodexEntryDetail, Database, Project, ProjectDetail, Scene,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub version: u32,
    pub themes: Value,
    pub selected_theme_id: String,
    pub theme: String,
    pub text_scale: String,
}

pub struct AppearanceStore {
    path: PathBuf,
}

impl AppearanceStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
    fn load(&self) -> Result<AppearanceSettings, String> {
        match std::fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|_| "Stored appearance settings are invalid.".to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AppearanceSettings {
                version: 1,
                themes: Value::Array(vec![]),
                selected_theme_id: String::new(),
                theme: "light".into(),
                text_scale: "1".into(),
            }),
            Err(_) => Err("Appearance settings could not be read.".into()),
        }
    }
    fn save(&self, settings: AppearanceSettings) -> Result<(), String> {
        if settings.version != 1
            || settings
                .themes
                .as_array()
                .map_or(true, |items| items.len() > 100)
            || settings.selected_theme_id.chars().count() > 80
            || !matches!(settings.theme.as_str(), "light" | "dark")
            || !matches!(settings.text_scale.as_str(), "1" | "1.15" | "1.3")
        {
            return Err("Appearance settings are invalid.".into());
        }
        if let Some(themes) = settings.themes.as_array() {
            let mut ids = std::collections::HashSet::new();
            for theme in themes {
                let object = theme
                    .as_object()
                    .ok_or_else(|| "Appearance theme is invalid.".to_string())?;
                let id = object
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty() && id.chars().count() <= 80)
                    .ok_or_else(|| "Appearance theme ID is invalid.".to_string())?;
                if !ids.insert(id.to_owned()) {
                    return Err("Appearance theme IDs must be unique.".into());
                }
            }
        }
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "Appearance settings path is invalid.".to_string())?;
        std::fs::create_dir_all(parent)
            .map_err(|_| "Appearance settings could not be saved.".to_string())?;
        let bytes = serde_json::to_vec_pretty(&settings)
            .map_err(|_| "Appearance settings could not be saved.".to_string())?;
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, bytes)
            .map_err(|_| "Appearance settings could not be saved.".to_string())?;
        std::fs::rename(temporary, &self.path)
            .map_err(|_| "Appearance settings could not be saved.".to_string())
    }
}

#[tauri::command]
pub fn get_appearance_settings(
    store: State<'_, AppearanceStore>,
) -> Result<AppearanceSettings, String> {
    store.load()
}

#[tauri::command]
pub fn save_appearance_settings(
    store: State<'_, AppearanceStore>,
    settings: AppearanceSettings,
) -> Result<(), String> {
    store.save(settings)
}

#[cfg(test)]
mod appearance_tests {
    use super::{AppearanceSettings, AppearanceStore};
    use serde_json::Value;

    #[test]
    fn appearance_store_persists_valid_versioned_preferences_and_rejects_invalid_values() {
        let path =
            std::env::temp_dir().join(format!("noveler-appearance-{}.json", uuid::Uuid::new_v4()));
        let store = AppearanceStore::new(path.clone());
        let settings = AppearanceSettings {
            version: 1,
            themes: Value::Array(vec![serde_json::json!({ "id": "paper", "name": "Paper" })]),
            selected_theme_id: "paper".into(),
            theme: "dark".into(),
            text_scale: "1.15".into(),
        };
        store.save(settings.clone()).unwrap();
        assert_eq!(store.load().unwrap(), settings);
        let mut invalid = settings;
        invalid.theme = "sepia".into();
        assert!(store.save(invalid).is_err());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn appearance_store_limits_theme_count_and_selected_id() {
        let path = std::env::temp_dir().join(format!(
            "noveler-appearance-limit-{}.json",
            uuid::Uuid::new_v4()
        ));
        let store = AppearanceStore::new(path.clone());
        let mut settings = AppearanceSettings {
            version: 1,
            themes: Value::Array(vec![Value::Null; 101]),
            selected_theme_id: String::new(),
            theme: "light".into(),
            text_scale: "1".into(),
        };
        assert!(store.save(settings.clone()).is_err());
        settings.themes = Value::Array(vec![]);
        settings.selected_theme_id = "x".repeat(81);
        assert!(store.save(settings).is_err());
        let duplicate = AppearanceSettings {
            version: 1,
            themes: Value::Array(vec![
                serde_json::json!({ "id": "same" }),
                serde_json::json!({ "id": "same" }),
            ]),
            selected_theme_id: "same".into(),
            theme: "light".into(),
            text_scale: "1".into(),
        };
        assert!(store.save(duplicate).is_err());
        let _ = std::fs::remove_file(path);
    }
}

fn user_error(error: AppError) -> String {
    match error {
		AppError::Validation(message) | AppError::NotFound(message) => message,
		AppError::Database(_) => "The local database could not complete that operation. Your existing writing has not been changed.".into(),
		AppError::Json(_) => "The Codex structured data could not be processed. Check the fields and try again.".into(),
		AppError::Internal(message) => message,
	}
}

fn ai_user_error(error: AiError) -> String {
    match error {
        AiError::InvalidSettings(message) => format!("AI settings: {message}"),
        other => other.to_string(),
    }
}

#[tauri::command]
pub fn list_projects(database: State<'_, Database>) -> Result<Vec<Project>, String> {
    database
        .with_connection(|connection| db::repository::list_projects(connection))
        .map_err(user_error)
}

#[tauri::command]
pub fn create_project(database: State<'_, Database>, title: String) -> Result<Project, String> {
    database
        .with_connection(|connection| db::repository::create_project(connection, &title))
        .map_err(user_error)
}

#[tauri::command]
pub fn rename_project(
    database: State<'_, Database>,
    id: String,
    title: String,
) -> Result<Project, String> {
    database
        .with_connection(|connection| db::repository::rename_project(connection, &id, &title))
        .map_err(user_error)
}

#[tauri::command]
pub fn delete_project(database: State<'_, Database>, id: String) -> Result<(), String> {
    database
        .with_connection(|connection| db::repository::delete_project(connection, &id))
        .map_err(user_error)
}

#[tauri::command]
pub fn open_project(database: State<'_, Database>, id: String) -> Result<ProjectDetail, String> {
    database
        .with_connection(|connection| db::repository::get_project_detail(connection, &id))
        .map_err(user_error)
}

#[tauri::command]
pub fn create_chapter(
    database: State<'_, Database>,
    project_id: String,
    title: String,
) -> Result<Chapter, String> {
    database
        .with_connection(|connection| {
            db::repository::create_chapter(connection, &project_id, &title)
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn rename_chapter(
    database: State<'_, Database>,
    id: String,
    title: String,
) -> Result<Chapter, String> {
    database
        .with_connection(|connection| db::repository::rename_chapter(connection, &id, &title))
        .map_err(user_error)
}

#[tauri::command]
pub fn delete_chapter(database: State<'_, Database>, id: String) -> Result<(), String> {
    database
        .with_connection(|connection| db::repository::delete_chapter(connection, &id))
        .map_err(user_error)
}

#[tauri::command]
pub fn reorder_chapters(
    database: State<'_, Database>,
    project_id: String,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    database
        .with_connection(|connection| {
            db::repository::reorder_chapters(connection, &project_id, &ordered_ids)
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn create_scene(
    database: State<'_, Database>,
    chapter_id: String,
    title: String,
) -> Result<Scene, String> {
    database
        .with_connection(|connection| db::repository::create_scene(connection, &chapter_id, &title))
        .map_err(user_error)
}

#[tauri::command]
pub fn rename_scene(
    database: State<'_, Database>,
    id: String,
    title: String,
) -> Result<Scene, String> {
    database
        .with_connection(|connection| db::repository::rename_scene(connection, &id, &title))
        .map_err(user_error)
}

#[tauri::command]
pub fn delete_scene(database: State<'_, Database>, id: String) -> Result<(), String> {
    database
        .with_connection(|connection| db::repository::delete_scene(connection, &id))
        .map_err(user_error)
}

#[tauri::command]
pub fn reorder_scenes(
    database: State<'_, Database>,
    chapter_id: String,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    database
        .with_connection(|connection| {
            db::repository::reorder_scenes(connection, &chapter_id, &ordered_ids)
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn save_scene_content(
    database: State<'_, Database>,
    id: String,
    content: String,
) -> Result<Scene, String> {
    database
        .with_connection(|connection| {
            db::repository::update_scene_content(connection, &id, &content)
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn save_chapter_scene_contents(
    database: State<'_, Database>,
    chapter_id: String,
    updates: Vec<db::repository::SceneContentUpdate>,
) -> Result<Vec<Scene>, String> {
    database
        .with_connection(|connection| {
            db::repository::update_chapter_scene_contents(connection, &chapter_id, &updates)
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn list_codex_entries(
    database: State<'_, Database>,
    project_id: String,
    query: String,
    kind: Option<String>,
) -> Result<Vec<CodexEntry>, String> {
    database
        .with_connection(|connection| {
            db::repository::list_codex_entries(connection, &project_id, &query, kind.as_deref())
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn create_codex_entry(
    database: State<'_, Database>,
    project_id: String,
    kind: String,
    title: String,
    description: String,
    tags: Vec<String>,
    fields: Value,
) -> Result<CodexEntry, String> {
    database
        .with_connection(|connection| {
            db::repository::create_codex_entry(
                connection,
                &project_id,
                &kind,
                &title,
                &description,
                &tags,
                &fields,
            )
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn create_codex_entry_with_sources(
    database: State<'_, Database>,
    project_id: String,
    kind: String,
    title: String,
    description: String,
    tags: Vec<String>,
    fields: Value,
    scene_ids: Vec<String>,
) -> Result<CodexEntry, String> {
    database
        .with_connection(|connection| {
            db::repository::create_codex_entry_with_sources(
                connection,
                &project_id,
                &kind,
                &title,
                &description,
                &tags,
                &fields,
                &scene_ids,
            )
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn update_codex_entry(
    database: State<'_, Database>,
    id: String,
    kind: String,
    title: String,
    description: String,
    tags: Vec<String>,
    fields: Value,
) -> Result<CodexEntry, String> {
    database
        .with_connection(|connection| {
            db::repository::update_codex_entry(
                connection,
                &id,
                &kind,
                &title,
                &description,
                &tags,
                &fields,
            )
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn delete_codex_entry(database: State<'_, Database>, id: String) -> Result<(), String> {
    database
        .with_connection(|connection| db::repository::delete_codex_entry(connection, &id))
        .map_err(user_error)
}

#[tauri::command]
pub fn get_codex_entry_detail(
    database: State<'_, Database>,
    id: String,
) -> Result<CodexEntryDetail, String> {
    database
        .with_connection(|connection| db::repository::get_codex_entry_detail(connection, &id))
        .map_err(user_error)
}

#[tauri::command]
pub fn set_codex_entry_link(
    database: State<'_, Database>,
    source_id: String,
    target_id: String,
    label: String,
    linked: bool,
) -> Result<(), String> {
    database
        .with_connection(|connection| {
            db::repository::set_codex_entry_link(connection, &source_id, &target_id, &label, linked)
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn add_codex_manuscript_link(
    database: State<'_, Database>,
    entry_id: String,
    chapter_id: Option<String>,
    scene_id: Option<String>,
) -> Result<(), String> {
    database
        .with_connection(|connection| {
            db::repository::add_codex_manuscript_link(
                connection,
                &entry_id,
                chapter_id.as_deref(),
                scene_id.as_deref(),
            )
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn remove_codex_manuscript_link(
    database: State<'_, Database>,
    entry_id: String,
    chapter_id: Option<String>,
    scene_id: Option<String>,
) -> Result<(), String> {
    database
        .with_connection(|connection| {
            db::repository::remove_codex_manuscript_link(
                connection,
                &entry_id,
                chapter_id.as_deref(),
                scene_id.as_deref(),
            )
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn search_everything(
    database: State<'_, Database>,
    query: String,
) -> Result<Vec<db::portable::SearchResult>, String> {
    database
        .with_connection(|connection| db::portable::search(connection, &query))
        .map_err(user_error)
}

#[tauri::command]
pub fn export_project_backup(
    database: State<'_, Database>,
    project_id: String,
) -> Result<String, String> {
    database
        .with_connection(|connection| db::portable::export_backup(connection, &project_id))
        .map_err(user_error)
}

#[tauri::command]
pub fn restore_project_backup(
    database: State<'_, Database>,
    payload: String,
    replace_project_id: Option<String>,
) -> Result<Project, String> {
    database
        .with_connection(|connection| {
            db::portable::restore_backup(connection, &payload, replace_project_id.as_deref())
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn export_manuscript(
    database: State<'_, Database>,
    project_id: String,
    format: String,
) -> Result<String, String> {
    database
        .with_connection(|connection| {
            db::portable::export_manuscript(connection, &project_id, &format)
        })
        .map_err(user_error)
}

#[tauri::command]
pub fn list_timeline_events(
    database: State<'_, Database>,
    project_id: String,
) -> Result<Vec<db::repository::TimelineEvent>, String> {
    database
        .with_connection(|connection| db::repository::list_timeline_events(connection, &project_id))
        .map_err(user_error)
}

#[tauri::command]
pub fn create_timeline_event(
    database: State<'_, Database>,
    input: db::repository::TimelineEventInput,
) -> Result<db::repository::TimelineEvent, String> {
    database
        .with_connection(|connection| db::repository::create_timeline_event(connection, &input))
        .map_err(user_error)
}

#[tauri::command]
pub fn update_timeline_event(
    database: State<'_, Database>,
    input: db::repository::TimelineEvent,
) -> Result<db::repository::TimelineEvent, String> {
    database
        .with_connection(|connection| db::repository::update_timeline_event(connection, &input))
        .map_err(user_error)
}

#[tauri::command]
pub fn delete_timeline_event(database: State<'_, Database>, id: String) -> Result<(), String> {
    database
        .with_connection(|connection| db::repository::delete_timeline_event(connection, &id))
        .map_err(user_error)
}

#[tauri::command]
pub fn import_manuscript(
    database: State<'_, Database>,
    input: db::repository::ManuscriptImport,
) -> Result<Project, String> {
    database
        .with_connection(|connection| db::repository::import_manuscript(connection, &input))
        .map_err(user_error)
}

#[tauri::command]
pub fn get_ai_settings(service: State<'_, AiService>) -> Result<AiSettings, String> {
    service.settings.load().map_err(ai_user_error)
}

#[tauri::command]
pub fn save_ai_settings(
    service: State<'_, AiService>,
    settings: AiSettings,
) -> Result<AiSettings, String> {
    service.save_settings(settings).map_err(ai_user_error)
}

#[tauri::command]
pub fn configure_ai_provider(
    service: State<'_, AiService>,
    provider: String,
) -> Result<AiSettings, String> {
    service.configure_provider(provider).map_err(ai_user_error)
}

#[tauri::command]
pub fn ai_has_credential(service: State<'_, AiService>, provider: String) -> Result<bool, String> {
    service.has_credential(&provider).map_err(ai_user_error)
}

#[tauri::command]
pub fn ai_save_credential(
    service: State<'_, AiService>,
    provider: String,
    secret: String,
) -> Result<(), String> {
    service
        .save_credential(&provider, &secret)
        .map_err(ai_user_error)
}

#[tauri::command]
pub fn ai_delete_credential(service: State<'_, AiService>, provider: String) -> Result<(), String> {
    service.delete_credential(&provider).map_err(ai_user_error)
}

#[tauri::command]
pub async fn ai_test_connection(service: State<'_, AiService>) -> Result<(), String> {
    service.test_connection().await.map_err(ai_user_error)
}

#[tauri::command]
pub async fn ai_list_ollama_models(endpoint: String) -> Result<Vec<String>, String> {
    crate::ai::OpenAiCompatibleProvider::list_ollama_models(&endpoint)
        .await
        .map_err(ai_user_error)
}

/// Called only from an explicit user action. Request content is not persisted or logged.
#[tauri::command]
pub async fn ai_chat(
    service: State<'_, AiService>,
    request: ChatRequest,
) -> Result<ChatResponse, String> {
    service.complete(&request).await.map_err(ai_user_error)
}

#[tauri::command]
pub fn ai_get_local_data(service: State<'_, AiService>) -> Result<AiLocalData, String> {
    service.local_data.load().map_err(ai_user_error)
}

#[tauri::command]
pub fn ai_save_templates(
    service: State<'_, AiService>,
    templates: Vec<PromptTemplateRecord>,
) -> Result<(), String> {
    if templates.len() > 100
        || templates.iter().any(|template| {
            template.name.trim().is_empty()
                || template.name.chars().count() > 100
                || template.description.chars().count() > 500
                || template.body.chars().count() > 20_000
        })
    {
        return Err("Prompt templates require a name, may have at most 100 entries, and each prompt must be under 20,000 characters.".into());
    }
    service
        .local_data
        .save_templates(&templates)
        .map_err(ai_user_error)
}

#[tauri::command]
pub fn ai_record_interaction(
    service: State<'_, AiService>,
    item: InteractionRecord,
) -> Result<(), String> {
    if item.id.is_empty()
        || item.template_name.chars().count() > 100
        || item.included_context.len() > 20
    {
        return Err("Interaction metadata is invalid.".into());
    }
    service
        .local_data
        .record_interaction(&item)
        .map_err(ai_user_error)
}

#[tauri::command]
pub fn ai_clear_history(service: State<'_, AiService>) -> Result<(), String> {
    service.local_data.clear_history().map_err(ai_user_error)
}
