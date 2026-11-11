use serde_json::Value;
use tauri::State;

use crate::ai::{
    AiError, AiLocalData, AiService, AiSettings, ChatRequest, ChatResponse, InteractionRecord,
    PromptTemplateRecord,
};
use crate::db::{
    self, AppError, Chapter, CodexEntry, CodexEntryDetail, Database, Project, ProjectDetail, Scene,
};

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
