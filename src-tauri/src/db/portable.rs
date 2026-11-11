use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use super::{
    repository::{self, CodexEntry, Project},
    AppError, AppResult,
};

const BACKUP_VERSION: u32 = 1;
const MAX_BACKUP_BYTES: usize = 50 * 1024 * 1024;
const MAX_CHAPTERS: usize = 2_000;
const MAX_SCENES: usize = 20_000;
const MAX_CODEX_ENTRIES: usize = 20_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBackup {
    pub format: String,
    pub version: u32,
    pub project: Project,
    pub chapters: Vec<BackupChapter>,
    pub codex_entries: Vec<CodexEntry>,
    pub codex_links: Vec<BackupCodexLink>,
    pub codex_manuscript_links: Vec<BackupManuscriptLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupChapter {
    pub chapter: repository::Chapter,
    pub scenes: Vec<repository::Scene>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCodexLink {
    pub source_id: String,
    pub target_id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManuscriptLink {
    pub entry_id: String,
    pub chapter_id: Option<String>,
    pub scene_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub kind: String,
    pub project_id: String,
    pub project_title: String,
    pub title: String,
    pub snippet: String,
    pub chapter_id: Option<String>,
    pub scene_id: Option<String>,
    pub codex_entry_id: Option<String>,
}

fn invalid(message: &str) -> AppError {
    AppError::Validation(message.into())
}

pub fn search(connection: &Connection, query: &str) -> AppResult<Vec<SearchResult>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    if query.chars().count() > 200 {
        return Err(invalid("Search terms must be 200 characters or fewer."));
    }
    let pattern = format!("%{query}%");
    let mut results = Vec::new();
    {
        let mut statement = connection.prepare(
            "SELECT p.id, p.title, c.id, c.title FROM chapters c JOIN projects p ON p.id = c.project_id
             WHERE c.title LIKE ?1 COLLATE NOCASE
             ORDER BY p.title COLLATE NOCASE, c.position",
        )?;
        for row in statement.query_map([&pattern], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })? {
            let (project_id, project_title, chapter_id, chapter_title) = row?;
            let first_scene_id: Option<String> = connection
                .query_row(
                    "SELECT id FROM scenes WHERE chapter_id = ?1 ORDER BY position LIMIT 1",
                    [&chapter_id],
                    |scene| scene.get(0),
                )
                .optional()?;
            results.push(SearchResult {
                kind: "chapter".into(),
                project_id,
                project_title,
                title: chapter_title.clone(),
                snippet: chapter_title,
                chapter_id: Some(chapter_id),
                scene_id: first_scene_id,
                codex_entry_id: None,
            });
        }
    }
    {
        let mut statement = connection.prepare(
            "SELECT id, title FROM projects WHERE title LIKE ?1 COLLATE NOCASE ORDER BY title COLLATE NOCASE LIMIT 100",
        )?;
        for row in statement.query_map([&pattern], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })? {
            let (id, title) = row?;
            results.push(SearchResult {
                kind: "project".into(),
                project_id: id.clone(),
                project_title: title.clone(),
                title: title.clone(),
                snippet: "Project title".into(),
                chapter_id: None,
                scene_id: None,
                codex_entry_id: None,
            });
        }
    }
    {
        let mut statement = connection.prepare(
            "SELECT p.id, p.title, c.id, c.title, s.id, s.title, s.content
             FROM scenes s JOIN chapters c ON c.id = s.chapter_id JOIN projects p ON p.id = c.project_id
             ORDER BY p.title COLLATE NOCASE, c.position, s.position",
        )?;
        for row in statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })? {
            let (
                project_id,
                project_title,
                chapter_id,
                chapter_title,
                scene_id,
                scene_title,
                content,
            ) = row?;
            let lower_query = query.to_lowercase();
            let manuscript_text = searchable_scene_text(&content);
            if !scene_title.to_lowercase().contains(&lower_query)
                && !manuscript_text.to_lowercase().contains(&lower_query)
            {
                continue;
            }
            let source = if scene_title.to_lowercase().contains(&lower_query) {
                scene_title.clone()
            } else {
                manuscript_text
            };
            results.push(SearchResult {
                kind: "scene".into(),
                project_id,
                project_title,
                title: format!("{chapter_title} · {scene_title}"),
                snippet: excerpt(&source, query),
                chapter_id: Some(chapter_id),
                scene_id: Some(scene_id),
                codex_entry_id: None,
            });
        }
    }
    {
        let mut statement = connection.prepare(
            "SELECT p.id, p.title, e.id, e.title, e.description, e.tags_json, e.fields_json
             FROM codex_entries e JOIN projects p ON p.id = e.project_id
             WHERE e.title LIKE ?1 COLLATE NOCASE OR e.description LIKE ?1 COLLATE NOCASE
                OR e.tags_json LIKE ?1 COLLATE NOCASE OR e.fields_json LIKE ?1 COLLATE NOCASE
             ORDER BY p.title COLLATE NOCASE, e.title COLLATE NOCASE",
        )?;
        for row in statement.query_map([&pattern], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })? {
            let (project_id, project_title, id, title, description, tags, fields) = row?;
            let source = if title.to_lowercase().contains(&query.to_lowercase()) {
                title.clone()
            } else if description.to_lowercase().contains(&query.to_lowercase()) {
                description.clone()
            } else {
                format!("{tags} {fields}")
            };
            results.push(SearchResult {
                kind: "codex".into(),
                project_id,
                project_title,
                title,
                snippet: excerpt(&source, query),
                chapter_id: None,
                scene_id: None,
                codex_entry_id: Some(id),
            });
        }
    }
    results.truncate(1_000);
    Ok(results)
}

fn excerpt(text: &str, query: &str) -> String {
    let start = text
        .to_lowercase()
        .find(&query.to_lowercase())
        .map(|byte| {
            text.char_indices()
                .enumerate()
                .find(|(index, _)| *index >= byte)
                .map(|(_, (offset, _))| offset)
                .unwrap_or(text.len())
        })
        .unwrap_or(0);
    let start = start.saturating_sub(60);
    let end = (start + 180).min(text.len());
    let start = (0..=start)
        .rev()
        .find(|index| text.is_char_boundary(*index))
        .unwrap_or(0);
    let end = (start..=end)
        .rev()
        .find(|index| text.is_char_boundary(*index))
        .unwrap_or(text.len());
    let mut result = String::new();
    if start > 0 {
        result.push('…');
    }
    result.push_str(&text[start..end]);
    if end < text.len() {
        result.push('…');
    }
    result
}

fn searchable_scene_text(content: &str) -> String {
    serde_json::from_str::<Value>(content)
        .ok()
        .and_then(|value| value.get("content").cloned())
        .map(|document| document_text(&document))
        .unwrap_or_else(|| content.to_owned())
}

pub fn export_backup(connection: &Connection, project_id: &str) -> AppResult<String> {
    let detail = repository::get_project_detail(connection, project_id)?;
    let codex_entries = repository::list_codex_entries(connection, project_id, "", None)?;
    let codex_links = {
        let mut statement = connection.prepare(
            "SELECT l.source_id, l.target_id, l.label FROM codex_entry_links l
             JOIN codex_entries e ON e.id = l.source_id WHERE e.project_id = ?1 ORDER BY l.source_id, l.target_id",
        )?;
        let rows = statement.query_map([project_id], |row| {
            Ok(BackupCodexLink {
                source_id: row.get(0)?,
                target_id: row.get(1)?,
                label: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let codex_manuscript_links = {
        let mut statement = connection.prepare(
            "SELECT l.entry_id, l.chapter_id, l.scene_id FROM codex_manuscript_links l
             JOIN codex_entries e ON e.id = l.entry_id WHERE e.project_id = ?1 ORDER BY l.entry_id, l.chapter_id, l.scene_id",
        )?;
        let rows = statement.query_map([project_id], |row| {
            Ok(BackupManuscriptLink {
                entry_id: row.get(0)?,
                chapter_id: row.get(1)?,
                scene_id: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let backup = ProjectBackup {
        format: "noveler-project".into(),
        version: BACKUP_VERSION,
        project: detail.project,
        chapters: detail
            .chapters
            .into_iter()
            .map(|group| BackupChapter {
                chapter: group.chapter,
                scenes: group.scenes,
            })
            .collect(),
        codex_entries,
        codex_links,
        codex_manuscript_links,
    };
    let serialized = serde_json::to_string_pretty(&backup)?;
    if serialized.len() > MAX_BACKUP_BYTES {
        return Err(invalid("This project exceeds the 50 MB backup limit. Export its manuscript or reduce its data before backing it up."));
    }
    if backup.chapters.len() > MAX_CHAPTERS
        || backup
            .chapters
            .iter()
            .map(|chapter| chapter.scenes.len())
            .sum::<usize>()
            > MAX_SCENES
        || backup.codex_entries.len() > MAX_CODEX_ENTRIES
    {
        return Err(invalid(
            "This project exceeds the supported backup record limits.",
        ));
    }
    Ok(serialized)
}

pub fn export_manuscript(
    connection: &Connection,
    project_id: &str,
    format: &str,
) -> AppResult<String> {
    if format != "markdown" && format != "text" {
        return Err(invalid("Choose Markdown or plain text export."));
    }
    let detail = repository::get_project_detail(connection, project_id)?;
    let mut output = String::new();
    for (chapter_index, chapter) in detail.chapters.iter().enumerate() {
        if chapter_index > 0 {
            output.push_str("\n\n");
        }
        if format == "markdown" {
            output.push_str("# ");
            output.push_str(&chapter.chapter.title);
        } else {
            output.push_str(&chapter.chapter.title);
            output.push('\n');
            output.push_str(&"=".repeat(chapter.chapter.title.chars().count()));
        }
        for scene in &chapter.scenes {
            output.push_str("\n\n");
            if format == "markdown" {
                output.push_str("## ");
                output.push_str(&scene.title);
                output.push_str("\n\n");
            } else {
                output.push_str(&scene.title);
                output.push_str("\n\n");
            }
            let plain = serde_json::from_str::<Value>(&scene.content)
                .ok()
                .and_then(|value| value.get("content").cloned())
                .map(|content| document_text(&content))
                .unwrap_or_else(|| scene.content.clone());
            output.push_str(&plain);
        }
    }
    Ok(output)
}

fn document_text(value: &Value) -> String {
    fn walk(value: &Value, output: &mut String) {
        if let Some(array) = value.as_array() {
            for item in array {
                walk(item, output);
            }
        } else if let Some(object) = value.as_object() {
            if object.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(text) = object.get("text").and_then(Value::as_str) {
                    output.push_str(text);
                }
            }
            if object.get("type").and_then(Value::as_str) == Some("hardBreak") {
                output.push('\n');
            }
            if let Some(content) = object.get("content") {
                let before = output.len();
                walk(content, output);
                if matches!(
                    object.get("type").and_then(Value::as_str),
                    Some("paragraph" | "heading" | "blockquote" | "listItem")
                ) && output.len() > before
                    && !output.ends_with('\n')
                {
                    output.push('\n');
                }
            }
        }
    }
    let mut text = String::new();
    walk(value, &mut text);
    while text.ends_with('\n') {
        text.pop();
    }
    text
}

pub fn restore_backup(
    connection: &mut Connection,
    payload: &str,
    replace_project_id: Option<&str>,
) -> AppResult<Project> {
    if payload.len() > MAX_BACKUP_BYTES {
        return Err(invalid("Backup file exceeds the 50 MB limit."));
    }
    let backup: ProjectBackup = serde_json::from_str(payload)
        .map_err(|_| invalid("This backup is malformed or has an unsupported format."))?;
    validate_backup(&backup)?;

    let transaction = connection.transaction()?;
    if let Some(target_id) = replace_project_id {
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
            [target_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(AppError::NotFound(
                "The project selected for replacement no longer exists.".into(),
            ));
        }
        transaction.execute("DELETE FROM projects WHERE id = ?1", [target_id])?;
    }
    let now = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| AppError::Internal(error.to_string()))?;
    let project_id = replace_project_id
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    transaction.execute(
        "INSERT INTO projects (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![project_id, backup.project.title.trim(), now, now],
    )?;
    let mut id_map = HashMap::new();
    id_map.insert(backup.project.id.clone(), project_id.clone());
    for group in &backup.chapters {
        id_map.insert(group.chapter.id.clone(), Uuid::new_v4().to_string());
        for scene in &group.scenes {
            id_map.insert(scene.id.clone(), Uuid::new_v4().to_string());
        }
    }
    for entry in &backup.codex_entries {
        id_map.insert(entry.id.clone(), Uuid::new_v4().to_string());
    }
    insert_backup_records(&transaction, &backup, &project_id, &id_map, &now)?;
    transaction.commit()?;
    repository::get_project(connection, &project_id)?
        .ok_or_else(|| AppError::Internal("Restored project could not be reopened.".into()))
}

fn validate_backup(backup: &ProjectBackup) -> AppResult<()> {
    if backup.format != "noveler-project" || backup.version != BACKUP_VERSION {
        return Err(invalid("This backup format or version is not supported."));
    }
    if backup.project.id.trim().is_empty()
        || backup.project.title.trim().is_empty()
        || backup.project.title.chars().count() > 200
    {
        return Err(invalid("Backup project title is invalid."));
    }
    if backup.chapters.len() > MAX_CHAPTERS
        || backup
            .chapters
            .iter()
            .map(|chapter| chapter.scenes.len())
            .sum::<usize>()
            > MAX_SCENES
        || backup.codex_entries.len() > MAX_CODEX_ENTRIES
    {
        return Err(invalid(
            "Backup contains too many chapters, scenes, or Codex entries.",
        ));
    }
    let mut ids = std::collections::HashSet::new();
    ids.insert(backup.project.id.as_str());
    for group in &backup.chapters {
        if group.chapter.id.is_empty()
            || group.chapter.project_id != backup.project.id
            || group.chapter.title.trim().is_empty()
            || group.chapter.title.chars().count() > 200
            || !ids.insert(group.chapter.id.as_str())
        {
            return Err(invalid("Backup contains an invalid or duplicate chapter."));
        }
        for scene in &group.scenes {
            if scene.id.is_empty()
                || scene.chapter_id != group.chapter.id
                || scene.title.trim().is_empty()
                || scene.title.chars().count() > 200
                || scene.content.len() > MAX_BACKUP_BYTES
                || !ids.insert(scene.id.as_str())
            {
                return Err(invalid("Backup contains an invalid or duplicate scene."));
            }
        }
    }
    for entry in &backup.codex_entries {
        if entry.id.is_empty()
            || entry.project_id != backup.project.id
            || entry.title.trim().is_empty()
            || entry.title.chars().count() > 200
            || entry.kind.trim().is_empty()
            || entry.kind.chars().count() > 60
            || entry.tags.len() > 40
            || entry
                .tags
                .iter()
                .any(|tag| tag.trim().is_empty() || tag.chars().count() > 40)
            || !entry.fields.is_object()
            || !ids.insert(entry.id.as_str())
        {
            return Err(invalid(
                "Backup contains an invalid or duplicate Codex entry.",
            ));
        }
    }
    let entry_ids: std::collections::HashSet<&str> = backup
        .codex_entries
        .iter()
        .map(|entry| entry.id.as_str())
        .collect();
    let chapter_ids: std::collections::HashSet<&str> = backup
        .chapters
        .iter()
        .map(|group| group.chapter.id.as_str())
        .collect();
    let scene_ids: std::collections::HashSet<&str> = backup
        .chapters
        .iter()
        .flat_map(|group| group.scenes.iter().map(|scene| scene.id.as_str()))
        .collect();
    for link in &backup.codex_links {
        if !entry_ids.contains(link.source_id.as_str())
            || !entry_ids.contains(link.target_id.as_str())
            || link.source_id == link.target_id
            || link.label.chars().count() > 200
        {
            return Err(invalid("Backup contains an invalid Codex link."));
        }
    }
    let mut unique_links = std::collections::HashSet::new();
    for link in &backup.codex_links {
        let pair = if link.source_id < link.target_id {
            (link.source_id.as_str(), link.target_id.as_str())
        } else {
            (link.target_id.as_str(), link.source_id.as_str())
        };
        if !unique_links.insert(pair) {
            return Err(invalid("Backup contains duplicate Codex links."));
        }
    }
    for link in &backup.codex_manuscript_links {
        if !entry_ids.contains(link.entry_id.as_str()) {
            return Err(invalid(
                "Backup contains an invalid Codex-to-manuscript link.",
            ));
        }
        match (link.chapter_id.as_deref(), link.scene_id.as_deref()) {
            (Some(chapter_id), None) if chapter_ids.contains(chapter_id) => {}
            (None, Some(scene_id)) if scene_ids.contains(scene_id) => {}
            _ => {
                return Err(invalid(
                    "Backup contains an invalid Codex-to-manuscript link.",
                ))
            }
        }
    }
    let mut unique_locations = std::collections::HashSet::new();
    for link in &backup.codex_manuscript_links {
        let target_id = link
            .chapter_id
            .as_deref()
            .or(link.scene_id.as_deref())
            .unwrap_or_default();
        if !unique_locations.insert((link.entry_id.as_str(), target_id)) {
            return Err(invalid("Backup contains duplicate Codex manuscript links."));
        }
    }
    Ok(())
}

fn insert_backup_records(
    transaction: &Transaction<'_>,
    backup: &ProjectBackup,
    project_id: &str,
    ids: &HashMap<String, String>,
    now: &str,
) -> AppResult<()> {
    for (chapter_position, group) in backup.chapters.iter().enumerate() {
        let chapter_id = &ids[&group.chapter.id];
        transaction.execute("INSERT INTO chapters (id, project_id, title, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)", params![chapter_id, project_id, group.chapter.title.trim(), chapter_position as i64, now])?;
        for (scene_position, scene) in group.scenes.iter().enumerate() {
            transaction.execute("INSERT INTO scenes (id, chapter_id, title, content, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)", params![ids[&scene.id], chapter_id, scene.title.trim(), scene.content, scene_position as i64, now])?;
        }
    }
    for entry in &backup.codex_entries {
        transaction.execute("INSERT INTO codex_entries (id, project_id, kind, title, description, tags_json, fields_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)", params![ids[&entry.id], project_id, entry.kind, entry.title.trim(), entry.description, serde_json::to_string(&entry.tags)?, serde_json::to_string(&entry.fields)?, now])?;
    }
    for link in &backup.codex_links {
        transaction.execute("INSERT INTO codex_entry_links (source_id, target_id, label, created_at) VALUES (?1, ?2, ?3, ?4)", params![ids[&link.source_id], ids[&link.target_id], link.label, now])?;
    }
    for link in &backup.codex_manuscript_links {
        let chapter_id = link.chapter_id.as_ref().map(|id| &ids[id]);
        let scene_id = link.scene_id.as_ref().map(|id| &ids[id]);
        transaction.execute("INSERT INTO codex_manuscript_links (entry_id, chapter_id, scene_id, created_at) VALUES (?1, ?2, ?3, ?4)", params![ids[&link.entry_id], chapter_id, scene_id, now])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn search_finds_project_scene_content_and_codex() {
        let database = Database::in_memory().unwrap();
        database.with_connection(|connection| {
            let project = repository::create_project(connection, "The Silver Atlas")?;
            let mut connection = connection;
            let chapter = repository::create_chapter(&mut connection, &project.id, "Opening")?;
            let scene = repository::create_scene(&mut connection, &chapter.id, "Arrival")?;
            repository::update_scene_content(&mut connection, &scene.id, r#"{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Mira finds a silver compass."}]}]}"#)?;
            repository::create_codex_entry(&mut connection, &project.id, "item", "Compass", "Silver instrument", &[], &serde_json::json!({}))?;
            let results = search(&connection, "silver")?;
            assert_eq!(results.len(), 3);
            assert!(results.iter().any(|result| result.kind == "project"));
            assert!(results.iter().any(|result| result.kind == "scene" && result.scene_id.as_deref() == Some(scene.id.as_str())));
            assert!(results.iter().any(|result| result.kind == "codex" && result.codex_entry_id.is_some()));
            Ok(())
        }).unwrap();
    }

    #[test]
    fn search_finds_chapter_titles_even_when_the_chapter_has_no_scenes() {
        let database = Database::in_memory().unwrap();
        database
            .with_connection(|connection| {
                let project = repository::create_project(connection, "Chapter search")?;
                let mut connection = connection;
                let chapter = repository::create_chapter(
                    &mut connection,
                    &project.id,
                    "Unwritten Observatory",
                )?;
                let results = search(&connection, "observatory")?;
                assert!(results.iter().any(|result| result.kind == "chapter"
                    && result.chapter_id.as_deref() == Some(chapter.id.as_str())));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn backup_round_trip_preserves_order_and_links_and_replaces_only_on_request() {
        let database = Database::in_memory().unwrap();
        database.with_connection(|connection| {
            let project = repository::create_project(connection, "Original")?;
            let mut connection = connection;
            let first = repository::create_chapter(&mut connection, &project.id, "First")?;
            repository::create_chapter(&mut connection, &project.id, "Second")?;
            let scene = repository::create_scene(&mut connection, &first.id, "Scene")?;
            repository::update_scene_content(&mut connection, &scene.id, r#"{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Portable prose."}]}]}"#)?;
            let entry = repository::create_codex_entry(&mut connection, &project.id, "general", "Fact", "Local fact", &[], &serde_json::json!({"x": 1}))?;
            repository::add_codex_manuscript_link(&mut connection, &entry.id, None, Some(&scene.id))?;
            let backup = export_backup(&connection, &project.id)?;
            let restored = restore_backup(&mut connection, &backup, None)?;
            let restored_detail = repository::get_project_detail(&connection, &restored.id)?;
            assert_eq!(restored_detail.chapters[0].chapter.title, "First");
            assert_eq!(restored_detail.chapters[1].chapter.title, "Second");
            assert_eq!(restored_detail.chapters[0].scenes.len(), 2);
            assert!(restored_detail.chapters[0]
                .scenes
                .iter()
                .any(|scene| scene.content.contains("Portable prose.")));
            let restored_entries = repository::list_codex_entries(&connection, &restored.id, "", None)?;
            assert_eq!(restored_entries.len(), 1);
            assert_eq!(repository::get_codex_entry_detail(&connection, &restored_entries[0].id)?.manuscript_links.len(), 1);
            assert!(repository::set_codex_entry_link(&mut connection, &entry.id, &entry.id, "", true).is_err());
            let linked_entry = repository::create_codex_entry(&mut connection, &project.id, "general", "Second fact", "", &[], &serde_json::json!({}))?;
            repository::set_codex_entry_link(&mut connection, &entry.id, &linked_entry.id, "related", true)?;
            let linked_backup = export_backup(&connection, &project.id)?;
            let linked_restore = restore_backup(&mut connection, &linked_backup, None)?;
            let linked_entries = repository::list_codex_entries(&connection, &linked_restore.id, "", None)?;
            assert_eq!(linked_entries.len(), 2);
            let linked_detail = repository::get_codex_entry_detail(&connection, &linked_entries[0].id)?;
            assert_eq!(linked_detail.links.len(), 1);
            let replaced = restore_backup(&mut connection, &backup, Some(&restored.id))?;
            assert_eq!(replaced.id, restored.id);
            assert_eq!(repository::list_projects(&connection)?.len(), 3);
            Ok(())
        }).unwrap();
    }

    #[test]
    fn exports_markdown_and_text_in_order_without_application_metadata() {
        let database = Database::in_memory().unwrap();
        database.with_connection(|connection| {
            let project = repository::create_project(connection, "Export test")?;
            let mut connection = connection;
            let first = repository::create_chapter(&mut connection, &project.id, "First")?;
            let second = repository::create_chapter(&mut connection, &project.id, "Second")?;
            let scene_a = repository::create_scene(&mut connection, &first.id, "Dawn")?;
            let scene_b = repository::create_scene(&mut connection, &first.id, "Noon")?;
            repository::update_scene_content(&mut connection, &scene_a.id, r#"{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Morning prose."}]}]}"#)?;
            repository::update_scene_content(&mut connection, &scene_b.id, r#"{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Midday prose."}]}]}"#)?;
            repository::create_scene(&mut connection, &second.id, "Dusk")?;
            let markdown = export_manuscript(&connection, &project.id, "markdown")?;
            assert!(markdown.find("# First").unwrap() < markdown.find("## Dawn").unwrap());
            assert!(markdown.find("## Dawn").unwrap() < markdown.find("## Noon").unwrap());
            assert!(markdown.find("## Noon").unwrap() < markdown.find("# Second").unwrap());
            assert!(markdown.contains("Morning prose."));
            assert!(!markdown.contains("createdAt"));
            let text = export_manuscript(&connection, &project.id, "text")?;
            assert!(text.find("First\n=====").unwrap() < text.find("Dawn").unwrap());
            assert!(text.find("Dawn").unwrap() < text.find("Noon").unwrap());
            assert!(export_manuscript(&connection, &project.id, "html").is_err());
            Ok(())
        }).unwrap();
    }

    #[test]
    fn malformed_unsupported_or_invalid_backups_do_not_change_database() {
        let database = Database::in_memory().unwrap();
        database
            .with_connection(|connection| {
                let existing = repository::create_project(connection, "Keep me")?;
                let mut connection = connection;
                assert!(restore_backup(&mut connection, "{bad json", None).is_err());
                let unsupported = r#"{"format":"noveler-project","version":999}"#;
                assert!(restore_backup(&mut connection, unsupported, None).is_err());
                let oversized = " ".repeat(MAX_BACKUP_BYTES + 1);
                assert!(restore_backup(&mut connection, &oversized, None).is_err());
                assert_eq!(repository::list_projects(&connection)?.len(), 1);
                assert_eq!(
                    repository::get_project(&connection, &existing.id)?
                        .unwrap()
                        .title,
                    "Keep me"
                );
                Ok(())
            })
            .unwrap();
    }
}
