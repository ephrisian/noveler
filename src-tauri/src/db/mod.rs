pub(crate) mod portable;
pub(crate) mod repository;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;
use thiserror::Error;

pub use repository::{Chapter, Project, ProjectDetail, Scene};
pub use repository::{CodexEntry, CodexEntryDetail};

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    NotFound(String),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Invalid structured Codex data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Application error: {0}")]
    Internal(String),
}

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> AppResult<Self> {
        let connection = Connection::open(path)?;
        Self::from_connection(connection)
    }

    #[cfg(test)]
    pub fn in_memory() -> AppResult<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(connection: Connection) -> AppResult<Self> {
        connection.pragma_update(None, "foreign_keys", "ON")?;
        migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn with_connection<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::Internal("The local database is unavailable.".into()))?;
        operation(&mut connection)
    }
}

fn migrate(connection: &Connection) -> AppResult<()> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version > 2 {
        return Err(AppError::Internal(format!(
			"This project database uses a newer schema version ({version}). Update Noveler before opening it."
		)));
    }
    if version < 1 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(include_str!("../../migrations/001_initial.sql"))?;
        transaction.pragma_update(None, "user_version", 1)?;
        transaction.commit()?;
    }
    let current_version: i64 =
        connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if current_version < 2 {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute_batch(include_str!("../../migrations/002_codex.sql"))?;
        transaction.pragma_update(None, "user_version", 2)?;
        transaction.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use repository::*;
    use serde_json::Value;

    #[test]
    fn initial_migration_creates_ordered_cascading_schema() {
        let database = Database::in_memory().unwrap();
        database
            .with_connection(|connection| {
                let version: i64 =
                    connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
                let foreign_keys: i64 =
                    connection.pragma_query_value(None, "foreign_keys", |row| row.get(0))?;
                assert_eq!(version, 2);
                assert_eq!(foreign_keys, 1);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn project_and_scene_content_survive_reopening_database() {
        let path = std::env::temp_dir().join(format!("noveler-{}.sqlite3", uuid::Uuid::new_v4()));
        {
            let database = Database::open(&path).unwrap();
            database
				.with_connection(|connection| {
					let project = create_project(connection, "Persistent project")?;
					let chapter = create_chapter(connection, &project.id, "Chapter")?;
                    assert_eq!(chapter.title, "Chapter");
                    let initial_detail = get_project_detail(connection, &project.id)?;
                    assert_eq!(initial_detail.chapters[0].scenes[0].title, "Scene");
                    let scene = initial_detail.chapters[0].scenes[0].clone();
                    assert_eq!(scene.title, "Scene");
					update_scene_content(connection, &scene.id, r#"{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Saved before closing."}]}]}"#)?;
					Ok(())
				})
				.unwrap();
        }
        {
            let database = Database::open(&path).unwrap();
            database
                .with_connection(|connection| {
                    let projects = list_projects(connection)?;
                    assert_eq!(projects.len(), 1);
                    let reopened = get_project_detail(connection, &projects[0].id)?;
                    assert!(reopened.chapters[0].scenes[0]
                        .content
                        .contains("Saved before closing."));
                    Ok(())
                })
                .unwrap();
        }
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn project_crud_cascades_to_manuscript() {
        let database = Database::in_memory().unwrap();
        database
			.with_connection(|connection| {
				let project = create_project(connection, "  The Quiet Map  ")?;
				assert_eq!(project.title, "The Quiet Map");
				assert_eq!(list_projects(connection)?.len(), 1);

				let renamed = rename_project(connection, &project.id, "A New Map")?;
				assert_eq!(renamed.title, "A New Map");
                create_chapter(connection, &project.id, "Chapter One")?;
                let scene = get_project_detail(connection, &project.id)?.chapters[0].scenes[0].clone();
                assert_eq!(scene.title, "Scene");
				repository::update_scene_content(connection, &scene.id, r#"{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"A saved paragraph."}]}]}"#)?;
				let detail = get_project_detail(connection, &project.id)?;
				assert!(detail.chapters[0].scenes[0].content.contains("A saved paragraph."));

				delete_project(connection, &project.id)?;
				assert!(list_projects(connection)?.is_empty());
				assert!(get_project(connection, &project.id)?.is_none());
				let remaining_chapters: i64 = connection.query_row("SELECT COUNT(*) FROM chapters", [], |row| row.get(0))?;
				let remaining_scenes: i64 = connection.query_row("SELECT COUNT(*) FROM scenes", [], |row| row.get(0))?;
				assert_eq!(remaining_chapters, 0);
				assert_eq!(remaining_scenes, 0);
				Ok(())
			})
			.unwrap();
    }

    #[test]
    fn chapter_scene_crud_and_reorder_preserve_positions() {
        let database = Database::in_memory().unwrap();
        database
            .with_connection(|connection| {
                let project = create_project(connection, "Order test")?;
                let first = create_chapter(connection, &project.id, "First")?;
                let second = create_chapter(connection, &project.id, "Second")?;
                reorder_chapters(
                    connection,
                    &project.id,
                    &[second.id.clone(), first.id.clone()],
                )?;
                let starter_scene = get_project_detail(connection, &project.id)?
                    .chapters
                    .iter()
                    .find(|chapter| chapter.chapter.id == second.id)
                    .unwrap()
                    .scenes[0]
                    .clone();
                let first_scene = create_scene(connection, &second.id, "Scene A")?;
                let second_scene = create_scene(connection, &second.id, "Scene B")?;
                reorder_scenes(
                    connection,
                    &second.id,
                    &[
                        second_scene.id.clone(),
                        starter_scene.id.clone(),
                        first_scene.id.clone(),
                    ],
                )?;
                let detail = get_project_detail(&connection, &project.id)?;
                assert_eq!(detail.chapters[0].chapter.id, second.id);
                assert_eq!(detail.chapters[0].scenes[0].id, second_scene.id);
                assert_eq!(detail.chapters[0].scenes[0].position, 0);

                rename_chapter(connection, &second.id, "Renamed")?;
                rename_scene(connection, &first_scene.id, "Renamed scene")?;
                delete_scene(connection, &starter_scene.id)?;
                delete_scene(connection, &second_scene.id)?;
                delete_chapter(connection, &first.id)?;
                let detail = get_project_detail(&connection, &project.id)?;
                assert_eq!(detail.chapters.len(), 1);
                assert_eq!(detail.chapters[0].scenes[0].title, "Renamed scene");
                assert_eq!(detail.chapters[0].scenes[0].position, 0);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn chapter_scene_content_updates_are_complete_and_atomic() {
        use repository::SceneContentUpdate;

        let database = Database::in_memory().unwrap();
        database.with_connection(|connection| {
            let project = create_project(connection, "Chapter editing")?;
            let mut connection = connection;
            let chapter = create_chapter(&mut connection, &project.id, "Chapter 1")?;
            let detail = get_project_detail(&connection, &project.id)?;
            let starter = detail.chapters[0].scenes[0].clone();
            let second = create_scene(&mut connection, &chapter.id, "Scene 2")?;
            let document = |text: &str| format!(r#"{{"version":1,"type":"doc","content":[{{"type":"paragraph","content":[{{"type":"text","text":"{text}"}}]}}]}}"#);
            let updates = vec![
                SceneContentUpdate { scene_id: starter.id.clone(), content: document("First passage") },
                SceneContentUpdate { scene_id: second.id.clone(), content: document("Second passage") },
            ];
            let saved = repository::update_chapter_scene_contents(&mut connection, &chapter.id, &updates)?;
            assert!(saved[0].content.contains("First passage"));
            assert!(saved[1].content.contains("Second passage"));

            let partial = vec![SceneContentUpdate { scene_id: starter.id.clone(), content: document("Should not save") }];
            assert!(repository::update_chapter_scene_contents(&mut connection, &chapter.id, &partial).is_err());
            let after_rejection = get_project_detail(&connection, &project.id)?;
            assert!(after_rejection.chapters[0].scenes[0].content.contains("First passage"));
            Ok(())
        }).unwrap();
    }

    #[test]
    fn rejects_invalid_titles_and_reorder_payloads() {
        let database = Database::in_memory().unwrap();
        database
            .with_connection(|connection| {
                assert!(create_project(connection, "  ").is_err());
                let project = create_project(connection, "Valid")?;
                create_chapter(connection, &project.id, "One")?;
                assert!(reorder_chapters(connection, &project.id, &[]).is_err());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn codex_crud_search_links_and_manuscript_references_are_project_scoped() {
        let database = Database::in_memory().unwrap();
        database
            .with_connection(|connection| {
                let project = create_project(connection, "Codex project")?;
                let other_project = create_project(connection, "Other project")?;
                let mut connection = connection;
                let chapter = create_chapter(&mut connection, &project.id, "Chapter One")?;
                let scene = create_scene(&mut connection, &chapter.id, "The Crossing")?;
                let blank_fields = Value::Object(Default::default());
                let tags = vec!["royal family".to_owned(), "north".to_owned()];
                let character = create_codex_entry(
                    &mut connection,
                    &project.id,
                    "character",
                    "Mira",
                    "A cartographer.",
                    &tags,
                    &blank_fields,
                )?;
                let location = create_codex_entry(
                    &mut connection,
                    &project.id,
                    "location",
                    "North Reach",
                    "A cold coastline.",
                    &[],
                    &blank_fields,
                )?;
                let other = create_codex_entry(
                    &mut connection,
                    &other_project.id,
                    "item",
                    "Compass",
                    "A brass compass.",
                    &[],
                    &blank_fields,
                )?;
                assert_eq!(
                    list_codex_entries(&connection, &project.id, "MIRA", None)?.len(),
                    1
                );
                assert_eq!(
                    list_codex_entries(&connection, &project.id, "", Some("location"))?[0].id,
                    location.id
                );
                assert_eq!(
                    list_codex_entries(&connection, &project.id, "north", None)?[0].id,
                    character.id
                );
                assert!(
                    set_codex_entry_link(&mut connection, &character.id, &other.id, "", true)
                        .is_err()
                );
                set_codex_entry_link(&mut connection, &character.id, &location.id, "knows", true)?;
                add_codex_manuscript_link(&mut connection, &character.id, None, Some(&scene.id))?;
                let detail = get_codex_entry_detail(&connection, &location.id)?;
                assert_eq!(detail.links[0].id, character.id);
                let character_detail = get_codex_entry_detail(&connection, &character.id)?;
                assert_eq!(
                    character_detail.manuscript_links[0].scene_title.as_deref(),
                    Some("The Crossing")
                );
                let updated = update_codex_entry(
                    &mut connection,
                    &character.id,
                    "character",
                    "Mira Vale",
                    "A mapmaker.",
                    &tags,
                    &blank_fields,
                )?;
                assert_eq!(updated.title, "Mira Vale");
                delete_codex_entry(&mut connection, &location.id)?;
                assert!(get_codex_entry_detail(&connection, &character.id)?
                    .links
                    .is_empty());
                assert!(create_codex_entry(
                    &mut connection,
                    &project.id,
                    "",
                    "No kind",
                    "",
                    &[],
                    &blank_fields
                )
                .is_err());
                assert!(create_codex_entry(
                    &mut connection,
                    &project.id,
                    "general",
                    "Bad fields",
                    "",
                    &[],
                    &Value::Null
                )
                .is_err());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn codex_data_survives_database_reopen() {
        let path =
            std::env::temp_dir().join(format!("noveler-codex-{}.sqlite3", uuid::Uuid::new_v4()));
        let entry_id = {
            let database = Database::open(&path).unwrap();
            database
                .with_connection(|connection| {
                    let project = create_project(connection, "Codex persistence")?;
                    create_codex_entry(
                        connection,
                        &project.id,
                        "general",
                        "Moon rule",
                        "Tides turn twice.",
                        &[],
                        &serde_json::json!({"cycle": 2}),
                    )
                    .map(|entry| entry.id)
                })
                .unwrap()
        };
        {
            let database = Database::open(&path).unwrap();
            database
                .with_connection(|connection| {
                    assert_eq!(get_codex_entry(connection, &entry_id)?.fields["cycle"], 2);
                    Ok(())
                })
                .unwrap();
        }
        let _ = std::fs::remove_file(path);
    }
}
