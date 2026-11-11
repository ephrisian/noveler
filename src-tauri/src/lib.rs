mod ai;
mod commands;
mod db;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_wayland_webkit();
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let database = db::Database::open(data_dir.join("noveler.sqlite3"))?;
            app.manage(database);
            app.manage(commands::AppearanceStore::new(
                data_dir.join("appearance-settings.json"),
            ));
            let ai_service = ai::AiService {
                settings: Box::new(ai::FileSettingsStore::new(
                    data_dir.join("ai-settings.json"),
                )),
                credentials: Box::new(ai::OsCredentialStore::new("com.noveler.app.ai")),
                local_data: Box::new(ai::FileAiLocalStore::new(
                    data_dir.join("ai-local-data.json"),
                )),
                providers: ai::ProviderRegistry::new().map_err(std::io::Error::other)?,
            };
            app.manage(ai_service);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::create_project,
            commands::rename_project,
            commands::delete_project,
            commands::open_project,
            commands::create_chapter,
            commands::rename_chapter,
            commands::delete_chapter,
            commands::reorder_chapters,
            commands::create_scene,
            commands::rename_scene,
            commands::delete_scene,
            commands::reorder_scenes,
            commands::save_scene_content,
            commands::save_chapter_scene_contents,
            commands::list_codex_entries,
            commands::create_codex_entry,
            commands::create_codex_entry_with_sources,
            commands::update_codex_entry,
            commands::delete_codex_entry,
            commands::get_codex_entry_detail,
            commands::set_codex_entry_link,
            commands::add_codex_manuscript_link,
            commands::remove_codex_manuscript_link,
            commands::search_everything,
            commands::export_project_backup,
            commands::restore_project_backup,
            commands::export_manuscript,
            commands::get_appearance_settings,
            commands::save_appearance_settings,
            commands::list_timeline_events,
            commands::create_timeline_event,
            commands::update_timeline_event,
            commands::delete_timeline_event,
            commands::import_manuscript,
            commands::get_ai_settings,
            commands::save_ai_settings,
            commands::configure_ai_provider,
            commands::ai_has_credential,
            commands::ai_save_credential,
            commands::ai_delete_credential,
            commands::ai_test_connection,
            commands::ai_list_ollama_models,
            commands::ai_chat,
            commands::ai_get_local_data,
            commands::ai_save_templates,
            commands::ai_record_interaction,
            commands::ai_clear_history,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Noveler desktop application");
}

/// Work around WebKitGTK DMA-BUF buffer allocation failures seen in some
/// Fedora-family Wayland sessions (including Nobara/KDE). Respect an explicit
/// user setting if they already chose a renderer mode.
#[cfg(target_os = "linux")]
fn configure_wayland_webkit() {
    if std::env::var_os("WAYLAND_DISPLAY").is_some()
        && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

#[cfg(not(target_os = "linux"))]
fn configure_wayland_webkit() {}
