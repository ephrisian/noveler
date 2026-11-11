use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub chapter_id: String,
    pub title: String,
    pub content: String,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: Project,
    pub chapters: Vec<ChapterWithScenes>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChapterWithScenes {
    pub chapter: Chapter,
    pub scenes: Vec<Scene>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexEntry {
    pub id: String,
    pub project_id: String,
    pub kind: String,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub fields: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexEntryLink {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexManuscriptLink {
    pub chapter_id: Option<String>,
    pub chapter_title: Option<String>,
    pub scene_id: Option<String>,
    pub scene_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexEntryDetail {
    pub entry: CodexEntry,
    pub links: Vec<CodexEntryLink>,
    pub manuscript_links: Vec<CodexManuscriptLink>,
}

fn now() -> AppResult<String> {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| AppError::Internal(error.to_string()))
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn validate_title(title: &str, label: &str) -> AppResult<()> {
    if title.trim().is_empty() {
        return Err(AppError::Validation(format!(
            "{label} title cannot be empty."
        )));
    }
    if title.trim().chars().count() > 200 {
        return Err(AppError::Validation(format!(
            "{label} title must be 200 characters or fewer."
        )));
    }
    Ok(())
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

fn chapter_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Chapter> {
    Ok(Chapter {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        position: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn scene_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Scene> {
    Ok(Scene {
        id: row.get(0)?,
        chapter_id: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        position: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

pub fn list_projects(connection: &Connection) -> AppResult<Vec<Project>> {
    let mut statement = connection.prepare(
        "SELECT id, title, created_at, updated_at FROM projects ORDER BY updated_at DESC, title COLLATE NOCASE",
    )?;
    let rows = statement.query_map([], project_from_row)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn validate_codex_input(kind: &str, title: &str, tags: &[String], fields: &Value) -> AppResult<()> {
    validate_title(title, "Codex entry")?;
    if kind.trim().is_empty() || kind.trim().chars().count() > 60 {
        return Err(AppError::Validation(
            "Choose a valid Codex entry type.".into(),
        ));
    }
    if tags.len() > 40
        || tags
            .iter()
            .any(|tag| tag.trim().is_empty() || tag.chars().count() > 40)
    {
        return Err(AppError::Validation(
            "Tags must be 1–40 characters, with no more than 40 tags.".into(),
        ));
    }
    if !fields.is_object() {
        return Err(AppError::Validation(
            "Structured fields must be a JSON object.".into(),
        ));
    }
    Ok(())
}

fn codex_entry_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CodexEntry> {
    let tags_json: String = row.get(5)?;
    let fields_json: String = row.get(6)?;
    Ok(CodexEntry {
        id: row.get(0)?,
        project_id: row.get(1)?,
        kind: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        fields: serde_json::from_str(&fields_json)
            .unwrap_or_else(|_| Value::Object(Default::default())),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

pub fn list_codex_entries(
    connection: &Connection,
    project_id: &str,
    query: &str,
    kind: Option<&str>,
) -> AppResult<Vec<CodexEntry>> {
    let needle = if query.trim().is_empty() {
        "%".to_owned()
    } else {
        format!("%{}%", query.trim())
    };
    let mut statement = connection.prepare(
        "SELECT id, project_id, kind, title, description, tags_json, fields_json, created_at, updated_at
         FROM codex_entries
         WHERE project_id = ?1 AND (?2 = '%' OR title LIKE ?2 COLLATE NOCASE OR description LIKE ?2 COLLATE NOCASE OR tags_json LIKE ?2 COLLATE NOCASE)
           AND (?3 IS NULL OR kind = ?3)
         ORDER BY kind COLLATE NOCASE, title COLLATE NOCASE",
    )?;
    let rows = statement.query_map(params![project_id, needle, kind], codex_entry_from_row)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn get_codex_entry(connection: &Connection, id: &str) -> AppResult<CodexEntry> {
    connection.query_row(
        "SELECT id, project_id, kind, title, description, tags_json, fields_json, created_at, updated_at FROM codex_entries WHERE id = ?1",
        [id],
        codex_entry_from_row,
    ).optional()?.ok_or_else(|| AppError::NotFound("Codex entry not found.".into()))
}

pub fn create_codex_entry(
    connection: &mut Connection,
    project_id: &str,
    kind: &str,
    title: &str,
    description: &str,
    tags: &[String],
    fields: &Value,
) -> AppResult<CodexEntry> {
    validate_codex_input(kind, title, tags, fields)?;
    let transaction = connection.transaction()?;
    let project_exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
        [project_id],
        |row| row.get(0),
    )?;
    if !project_exists {
        return Err(AppError::NotFound("Project not found.".into()));
    }
    let timestamp = now()?;
    let entry = CodexEntry {
        id: new_id(),
        project_id: project_id.to_owned(),
        kind: kind.trim().to_owned(),
        title: title.trim().to_owned(),
        description: description.to_owned(),
        tags: tags.iter().map(|tag| tag.trim().to_owned()).collect(),
        fields: fields.clone(),
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
    };
    transaction.execute(
        "INSERT INTO codex_entries (id, project_id, kind, title, description, tags_json, fields_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![entry.id, entry.project_id, entry.kind, entry.title, entry.description, serde_json::to_string(&entry.tags)?, serde_json::to_string(&entry.fields)?, timestamp, timestamp],
    )?;
    touch_project(&transaction, project_id, &timestamp)?;
    transaction.commit()?;
    Ok(entry)
}

pub fn update_codex_entry(
    connection: &mut Connection,
    id: &str,
    kind: &str,
    title: &str,
    description: &str,
    tags: &[String],
    fields: &Value,
) -> AppResult<CodexEntry> {
    validate_codex_input(kind, title, tags, fields)?;
    let timestamp = now()?;
    let transaction = connection.transaction()?;
    let project_id: String = transaction
        .query_row(
            "SELECT project_id FROM codex_entries WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("Codex entry not found.".into()))?;
    transaction.execute(
        "UPDATE codex_entries SET kind = ?2, title = ?3, description = ?4, tags_json = ?5, fields_json = ?6, updated_at = ?7 WHERE id = ?1",
        params![id, kind.trim(), title.trim(), description, serde_json::to_string(tags)?, serde_json::to_string(fields)?, timestamp],
    )?;
    touch_project(&transaction, &project_id, &timestamp)?;
    transaction.commit()?;
    get_codex_entry(connection, id)
}

pub fn delete_codex_entry(connection: &mut Connection, id: &str) -> AppResult<()> {
    let transaction = connection.transaction()?;
    let project_id: String = transaction
        .query_row(
            "SELECT project_id FROM codex_entries WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("Codex entry not found.".into()))?;
    transaction.execute("DELETE FROM codex_entries WHERE id = ?1", [id])?;
    touch_project(&transaction, &project_id, &now()?)?;
    transaction.commit()?;
    Ok(())
}

pub fn set_codex_entry_link(
    connection: &mut Connection,
    source_id: &str,
    target_id: &str,
    label: &str,
    linked: bool,
) -> AppResult<()> {
    if source_id == target_id {
        return Err(AppError::Validation(
            "A Codex entry cannot link to itself.".into(),
        ));
    }
    let transaction = connection.transaction()?;
    let source_project: String = transaction
        .query_row(
            "SELECT project_id FROM codex_entries WHERE id = ?1",
            [source_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("Codex entry not found.".into()))?;
    let target_project: String = transaction
        .query_row(
            "SELECT project_id FROM codex_entries WHERE id = ?1",
            [target_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("Linked Codex entry not found.".into()))?;
    if source_project != target_project {
        return Err(AppError::Validation(
            "Codex entries can only link within the same project.".into(),
        ));
    }
    if linked {
        transaction.execute("INSERT INTO codex_entry_links (source_id, target_id, label, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(source_id, target_id) DO UPDATE SET label = excluded.label", params![source_id, target_id, label.trim(), now()?])?;
    } else {
        transaction.execute(
            "DELETE FROM codex_entry_links WHERE source_id = ?1 AND target_id = ?2",
            params![source_id, target_id],
        )?;
        transaction.execute(
            "DELETE FROM codex_entry_links WHERE source_id = ?1 AND target_id = ?2",
            params![target_id, source_id],
        )?;
    }
    touch_project(&transaction, &source_project, &now()?)?;
    transaction.commit()?;
    Ok(())
}

pub fn add_codex_manuscript_link(
    connection: &mut Connection,
    entry_id: &str,
    chapter_id: Option<&str>,
    scene_id: Option<&str>,
) -> AppResult<()> {
    if chapter_id.is_some() == scene_id.is_some() {
        return Err(AppError::Validation(
            "Choose exactly one chapter or scene to link.".into(),
        ));
    }
    let transaction = connection.transaction()?;
    let project_id: String = transaction
        .query_row(
            "SELECT project_id FROM codex_entries WHERE id = ?1",
            [entry_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("Codex entry not found.".into()))?;
    let target_project: String = if let Some(chapter_id) = chapter_id {
        transaction
            .query_row(
                "SELECT project_id FROM chapters WHERE id = ?1",
                [chapter_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("Chapter not found.".into()))?
    } else {
        transaction.query_row("SELECT project_id FROM chapters WHERE id = (SELECT chapter_id FROM scenes WHERE id = ?1)", [scene_id.unwrap()], |row| row.get(0)).optional()?.ok_or_else(|| AppError::NotFound("Scene not found.".into()))?
    };
    if project_id != target_project {
        return Err(AppError::Validation(
            "Codex entries can only link to manuscript locations in the same project.".into(),
        ));
    }
    transaction.execute("INSERT OR IGNORE INTO codex_manuscript_links (entry_id, chapter_id, scene_id, created_at) VALUES (?1, ?2, ?3, ?4)", params![entry_id, chapter_id, scene_id, now()?])?;
    touch_project(&transaction, &project_id, &now()?)?;
    transaction.commit()?;
    Ok(())
}

pub fn remove_codex_manuscript_link(
    connection: &mut Connection,
    entry_id: &str,
    chapter_id: Option<&str>,
    scene_id: Option<&str>,
) -> AppResult<()> {
    if chapter_id.is_some() == scene_id.is_some() {
        return Err(AppError::Validation(
            "Choose exactly one chapter or scene to unlink.".into(),
        ));
    }
    let project_id: String = connection
        .query_row(
            "SELECT project_id FROM codex_entries WHERE id = ?1",
            [entry_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("Codex entry not found.".into()))?;
    let changed = if let Some(chapter_id) = chapter_id {
        connection.execute("DELETE FROM codex_manuscript_links WHERE entry_id = ?1 AND chapter_id = ?2 AND scene_id IS NULL", params![entry_id, chapter_id])?
    } else {
        connection.execute("DELETE FROM codex_manuscript_links WHERE entry_id = ?1 AND scene_id = ?2 AND chapter_id IS NULL", params![entry_id, scene_id])?
    };
    if changed == 0 {
        return Err(AppError::NotFound("Codex location link not found.".into()));
    }
    connection.execute(
        "UPDATE projects SET updated_at = ?2 WHERE id = ?1",
        params![project_id, now()?],
    )?;
    Ok(())
}

pub fn get_codex_entry_detail(connection: &Connection, id: &str) -> AppResult<CodexEntryDetail> {
    let entry = get_codex_entry(connection, id)?;
    let mut links_statement = connection.prepare(
        "SELECT e.id, e.kind, e.title, l.label FROM codex_entry_links l JOIN codex_entries e ON e.id = l.target_id WHERE l.source_id = ?1
         UNION SELECT e.id, e.kind, e.title, l.label FROM codex_entry_links l JOIN codex_entries e ON e.id = l.source_id WHERE l.target_id = ?1
         ORDER BY 3 COLLATE NOCASE",
    )?;
    let mut links = links_statement
        .query_map([id], |row| {
            Ok(CodexEntryLink {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                label: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for link in &mut links {
        let outgoing_label: Option<String> = connection
            .query_row(
                "SELECT label FROM codex_entry_links WHERE source_id = ?1 AND target_id = ?2",
                params![id, link.id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(label) = outgoing_label {
            link.label = label;
        }
    }
    let mut locations_statement = connection.prepare(
        "SELECT c.id, c.title, s.id, s.title FROM codex_manuscript_links l LEFT JOIN chapters c ON c.id = l.chapter_id LEFT JOIN scenes s ON s.id = l.scene_id WHERE l.entry_id = ?1 ORDER BY c.position, s.position",
    )?;
    let manuscript_links = locations_statement
        .query_map([id], |row| {
            Ok(CodexManuscriptLink {
                chapter_id: row.get(0)?,
                chapter_title: row.get(1)?,
                scene_id: row.get(2)?,
                scene_title: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(CodexEntryDetail {
        entry,
        links,
        manuscript_links,
    })
}

pub fn create_project(connection: &Connection, title: &str) -> AppResult<Project> {
    validate_title(title, "Project")?;
    let timestamp = now()?;
    let project = Project {
        id: new_id(),
        title: title.trim().to_owned(),
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };
    connection.execute(
        "INSERT INTO projects (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![
            project.id,
            project.title,
            project.created_at,
            project.updated_at
        ],
    )?;
    Ok(project)
}

pub fn rename_project(connection: &Connection, id: &str, title: &str) -> AppResult<Project> {
    validate_title(title, "Project")?;
    let timestamp = now()?;
    let changed = connection.execute(
        "UPDATE projects SET title = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, title.trim(), timestamp],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("Project not found.".into()));
    }
    get_project(connection, id)?.ok_or_else(|| AppError::NotFound("Project not found.".into()))
}

pub fn delete_project(connection: &Connection, id: &str) -> AppResult<()> {
    let changed = connection.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    if changed == 0 {
        return Err(AppError::NotFound("Project not found.".into()));
    }
    Ok(())
}

pub fn get_project(connection: &Connection, id: &str) -> AppResult<Option<Project>> {
    connection
        .query_row(
            "SELECT id, title, created_at, updated_at FROM projects WHERE id = ?1",
            [id],
            project_from_row,
        )
        .optional()
        .map_err(Into::into)
}

pub fn get_project_detail(connection: &Connection, id: &str) -> AppResult<ProjectDetail> {
    let project = get_project(connection, id)?
        .ok_or_else(|| AppError::NotFound("Project not found.".into()))?;
    let mut chapters_statement = connection.prepare(
        "SELECT id, project_id, title, position, created_at, updated_at FROM chapters WHERE project_id = ?1 ORDER BY position",
    )?;
    let chapters = chapters_statement
        .query_map([id], chapter_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let chapters = chapters
        .into_iter()
        .map(|chapter| {
            let mut scenes_statement = connection.prepare(
                "SELECT id, chapter_id, title, content, position, created_at, updated_at FROM scenes WHERE chapter_id = ?1 ORDER BY position",
            )?;
            let scenes = scenes_statement
                .query_map([&chapter.id], scene_from_row)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(ChapterWithScenes { chapter, scenes })
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok(ProjectDetail { project, chapters })
}

fn touch_project(
    transaction: &Transaction<'_>,
    project_id: &str,
    timestamp: &str,
) -> AppResult<()> {
    let changed = transaction.execute(
        "UPDATE projects SET updated_at = ?2 WHERE id = ?1",
        params![project_id, timestamp],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("Project not found.".into()));
    }
    Ok(())
}

pub fn create_chapter(
    connection: &mut Connection,
    project_id: &str,
    title: &str,
) -> AppResult<Chapter> {
    validate_title(title, "Chapter")?;
    let timestamp = now()?;
    let transaction = connection.transaction()?;
    let exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
        [project_id],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(AppError::NotFound("Project not found.".into()));
    }
    let position: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM chapters WHERE project_id = ?1",
        [project_id],
        |row| row.get(0),
    )?;
    let chapter = Chapter {
        id: new_id(),
        project_id: project_id.to_owned(),
        title: title.trim().into(),
        position,
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
    };
    let default_scene = Scene {
        id: new_id(),
        chapter_id: chapter.id.clone(),
        title: "Scene".into(),
        content: String::new(),
        position: 0,
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
    };
    transaction.execute(
        "INSERT INTO chapters (id, project_id, title, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![chapter.id, chapter.project_id, chapter.title, chapter.position, chapter.created_at, chapter.updated_at],
    )?;
    transaction.execute(
        "INSERT INTO scenes (id, chapter_id, title, content, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![default_scene.id, default_scene.chapter_id, default_scene.title, default_scene.content, default_scene.position, default_scene.created_at, default_scene.updated_at],
    )?;
    touch_project(&transaction, project_id, &timestamp)?;
    transaction.commit()?;
    Ok(chapter)
}

pub fn rename_chapter(connection: &mut Connection, id: &str, title: &str) -> AppResult<Chapter> {
    validate_title(title, "Chapter")?;
    let timestamp = now()?;
    let transaction = connection.transaction()?;
    let chapter = transaction.query_row(
        "SELECT id, project_id, title, position, created_at, updated_at FROM chapters WHERE id = ?1",
        [id], chapter_from_row,
    ).optional()?.ok_or_else(|| AppError::NotFound("Chapter not found.".into()))?;
    transaction.execute(
        "UPDATE chapters SET title = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, title.trim(), timestamp],
    )?;
    touch_project(&transaction, &chapter.project_id, &timestamp)?;
    transaction.commit()?;
    let mut updated = chapter;
    updated.title = title.trim().into();
    updated.updated_at = timestamp;
    Ok(updated)
}

pub fn delete_chapter(connection: &mut Connection, id: &str) -> AppResult<()> {
    let transaction = connection.transaction()?;
    let project_id = transaction
        .query_row(
            "SELECT project_id FROM chapters WHERE id = ?1",
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("Chapter not found.".into()))?;
    transaction.execute("DELETE FROM chapters WHERE id = ?1", [id])?;
    normalize_chapter_positions(&transaction, &project_id)?;
    touch_project(&transaction, &project_id, &now()?)?;
    transaction.commit()?;
    Ok(())
}

pub fn reorder_chapters(
    connection: &mut Connection,
    project_id: &str,
    ordered_ids: &[String],
) -> AppResult<()> {
    let transaction = connection.transaction()?;
    let current: Vec<String> = {
        let mut statement = transaction
            .prepare("SELECT id FROM chapters WHERE project_id = ?1 ORDER BY position")?;
        let rows = statement.query_map([project_id], |row| row.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    validate_order(&current, ordered_ids, "chapter")?;
    if current.is_empty() {
        return Err(AppError::NotFound("Project not found.".into()));
    }
    let offset: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM chapters WHERE project_id = ?1",
        [project_id],
        |row| row.get(0),
    )?;
    transaction.execute(
        "UPDATE chapters SET position = position + ?2 WHERE project_id = ?1",
        params![project_id, offset],
    )?;
    for (position, id) in ordered_ids.iter().enumerate() {
        transaction.execute(
            "UPDATE chapters SET position = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, position as i64, now()?],
        )?;
    }
    touch_project(&transaction, project_id, &now()?)?;
    transaction.commit()?;
    Ok(())
}

fn normalize_chapter_positions(transaction: &Transaction<'_>, project_id: &str) -> AppResult<()> {
    let ids: Vec<String> = {
        let mut statement = transaction
            .prepare("SELECT id FROM chapters WHERE project_id = ?1 ORDER BY position")?;
        let rows = statement.query_map([project_id], |row| row.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    normalize_positions(transaction, "chapters", &ids)
}

fn normalize_scene_positions(transaction: &Transaction<'_>, chapter_id: &str) -> AppResult<()> {
    let ids: Vec<String> = {
        let mut statement =
            transaction.prepare("SELECT id FROM scenes WHERE chapter_id = ?1 ORDER BY position")?;
        let rows = statement.query_map([chapter_id], |row| row.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    normalize_positions(transaction, "scenes", &ids)
}

fn normalize_positions(
    transaction: &Transaction<'_>,
    table: &str,
    ids: &[String],
) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let offset: i64 = transaction.query_row(
        &format!("SELECT COALESCE(MAX(position), -1) + 1 FROM {table}"),
        [],
        |row| row.get(0),
    )?;
    for id in ids {
        transaction.execute(
            &format!("UPDATE {table} SET position = position + ?2 WHERE id = ?1"),
            params![id, offset],
        )?;
    }
    for (position, id) in ids.iter().enumerate() {
        transaction.execute(
            &format!("UPDATE {table} SET position = ?2 WHERE id = ?1"),
            params![id, position as i64],
        )?;
    }
    Ok(())
}

fn validate_order(current: &[String], requested: &[String], label: &str) -> AppResult<()> {
    if current.len() != requested.len() || current.iter().any(|id| !requested.contains(id)) {
        return Err(AppError::Validation(format!(
            "Reordered {label}s must contain each existing {label} exactly once."
        )));
    }
    Ok(())
}

pub fn create_scene(
    connection: &mut Connection,
    chapter_id: &str,
    title: &str,
) -> AppResult<Scene> {
    validate_title(title, "Scene")?;
    let timestamp = now()?;
    let transaction = connection.transaction()?;
    let project_id: String = transaction
        .query_row(
            "SELECT project_id FROM chapters WHERE id = ?1",
            [chapter_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("Chapter not found.".into()))?;
    let position: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM scenes WHERE chapter_id = ?1",
        [chapter_id],
        |row| row.get(0),
    )?;
    let scene = Scene {
        id: new_id(),
        chapter_id: chapter_id.into(),
        title: title.trim().into(),
        content: String::new(),
        position,
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
    };
    transaction.execute("INSERT INTO scenes (id, chapter_id, title, content, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)", params![scene.id, scene.chapter_id, scene.title, scene.content, scene.position, scene.created_at, scene.updated_at])?;
    touch_project(&transaction, &project_id, &timestamp)?;
    transaction.commit()?;
    Ok(scene)
}

pub fn rename_scene(connection: &mut Connection, id: &str, title: &str) -> AppResult<Scene> {
    validate_title(title, "Scene")?;
    let timestamp = now()?;
    let transaction = connection.transaction()?;
    let mut scene = transaction.query_row("SELECT id, chapter_id, title, content, position, created_at, updated_at FROM scenes WHERE id = ?1", [id], scene_from_row).optional()?.ok_or_else(|| AppError::NotFound("Scene not found.".into()))?;
    let project_id: String = transaction.query_row(
        "SELECT project_id FROM chapters WHERE id = ?1",
        [&scene.chapter_id],
        |row| row.get(0),
    )?;
    transaction.execute(
        "UPDATE scenes SET title = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, title.trim(), timestamp],
    )?;
    touch_project(&transaction, &project_id, &timestamp)?;
    transaction.commit()?;
    scene.title = title.trim().into();
    scene.updated_at = timestamp;
    Ok(scene)
}

pub fn update_scene_content(
    connection: &mut Connection,
    id: &str,
    content: &str,
) -> AppResult<Scene> {
    let content = normalize_editor_content(content)?;
    let timestamp = now()?;
    let transaction = connection.transaction()?;
    let mut scene = transaction.query_row("SELECT id, chapter_id, title, content, position, created_at, updated_at FROM scenes WHERE id = ?1", [id], scene_from_row).optional()?.ok_or_else(|| AppError::NotFound("Scene not found.".into()))?;
    let project_id: String = transaction.query_row(
        "SELECT project_id FROM chapters WHERE id = ?1",
        [&scene.chapter_id],
        |row| row.get(0),
    )?;
    transaction.execute(
        "UPDATE scenes SET content = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, content, timestamp],
    )?;
    touch_project(&transaction, &project_id, &timestamp)?;
    transaction.commit()?;
    scene.content = content;
    scene.updated_at = timestamp;
    Ok(scene)
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneContentUpdate {
    pub scene_id: String,
    pub content: String,
}

/// Replace the contents of every scene in a chapter as one validated transaction.
pub fn update_chapter_scene_contents(
    connection: &mut Connection,
    chapter_id: &str,
    updates: &[SceneContentUpdate],
) -> AppResult<Vec<Scene>> {
    let chapter_exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM chapters WHERE id = ?1)",
        [chapter_id],
        |row| row.get(0),
    )?;
    if !chapter_exists {
        return Err(AppError::NotFound("Chapter not found.".into()));
    }

    let existing_ids: Vec<String> = {
        let mut statement = connection.prepare(
            "SELECT id FROM scenes WHERE chapter_id = ?1 ORDER BY position",
        )?;
        let rows = statement.query_map([chapter_id], |row| row.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    let mut requested_ids = updates
        .iter()
        .map(|update| update.scene_id.clone())
        .collect::<Vec<_>>();
    requested_ids.sort();
    requested_ids.dedup();
    let mut expected_ids = existing_ids;
    expected_ids.sort();
    if requested_ids != expected_ids || requested_ids.len() != updates.len() {
        return Err(AppError::Validation(
            "Chapter updates must include each existing scene exactly once.".into(),
        ));
    }

    let normalized = updates
        .iter()
        .map(|update| {
            normalize_editor_content(&update.content)
                .map(|content| (update.scene_id.as_str(), content))
        })
        .collect::<AppResult<Vec<_>>>()?;
    let transaction = connection.transaction()?;
    let timestamp = now()?;
    for (scene_id, content) in normalized {
        transaction.execute(
            "UPDATE scenes SET content = ?2, updated_at = ?3 WHERE id = ?1 AND chapter_id = ?4",
            params![scene_id, content, timestamp, chapter_id],
        )?;
    }
    let project_id: String = transaction.query_row(
        "SELECT project_id FROM chapters WHERE id = ?1",
        [chapter_id],
        |row| row.get(0),
    )?;
    touch_project(&transaction, &project_id, &timestamp)?;
    transaction.commit()?;
    let updated = get_project_detail(connection, &project_id)?;
    updated
        .chapters
        .into_iter()
        .find(|chapter| chapter.chapter.id == chapter_id)
        .map(|chapter| chapter.scenes)
        .ok_or_else(|| AppError::NotFound("Chapter not found.".into()))
}

fn normalize_editor_content(content: &str) -> AppResult<String> {
    if content.trim().is_empty() {
        return Ok(content.to_owned());
    }
    let parsed: Value = serde_json::from_str(content).map_err(|_| {
        AppError::Validation("Scene content must be a valid editor document.".into())
    })?;
    if parsed.get("version").and_then(Value::as_u64) != Some(1)
        || parsed.get("type").and_then(Value::as_str) != Some("doc")
        || !parsed.get("content").is_some_and(Value::is_array)
    {
        return Err(AppError::Validation(
            "Scene content uses an unsupported editor document format.".into(),
        ));
    }
    Ok(content.to_owned())
}

pub fn delete_scene(connection: &mut Connection, id: &str) -> AppResult<()> {
    let transaction = connection.transaction()?;
    let chapter_id: String = transaction
        .query_row("SELECT chapter_id FROM scenes WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()?
        .ok_or_else(|| AppError::NotFound("Scene not found.".into()))?;
    let project_id: String = transaction.query_row(
        "SELECT project_id FROM chapters WHERE id = ?1",
        [&chapter_id],
        |row| row.get(0),
    )?;
    transaction.execute("DELETE FROM scenes WHERE id = ?1", [id])?;
    normalize_scene_positions(&transaction, &chapter_id)?;
    touch_project(&transaction, &project_id, &now()?)?;
    transaction.commit()?;
    Ok(())
}

pub fn reorder_scenes(
    connection: &mut Connection,
    chapter_id: &str,
    ordered_ids: &[String],
) -> AppResult<()> {
    let transaction = connection.transaction()?;
    let project_id: String = transaction
        .query_row(
            "SELECT project_id FROM chapters WHERE id = ?1",
            [chapter_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("Chapter not found.".into()))?;
    let current: Vec<String> = {
        let mut statement =
            transaction.prepare("SELECT id FROM scenes WHERE chapter_id = ?1 ORDER BY position")?;
        let rows = statement.query_map([chapter_id], |row| row.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    validate_order(&current, ordered_ids, "scene")?;
    if current.is_empty() {
        return Err(AppError::NotFound("Chapter not found.".into()));
    }
    let offset: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM scenes WHERE chapter_id = ?1",
        [chapter_id],
        |row| row.get(0),
    )?;
    transaction.execute(
        "UPDATE scenes SET position = position + ?2 WHERE chapter_id = ?1",
        params![chapter_id, offset],
    )?;
    for (position, id) in ordered_ids.iter().enumerate() {
        transaction.execute(
            "UPDATE scenes SET position = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, position as i64, now()?],
        )?;
    }
    touch_project(&transaction, &project_id, &now()?)?;
    transaction.commit()?;
    Ok(())
}
