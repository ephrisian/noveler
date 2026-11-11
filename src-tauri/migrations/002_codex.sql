CREATE TABLE codex_entries (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
    fields_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(fields_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE codex_entry_links (
    source_id TEXT NOT NULL REFERENCES codex_entries(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES codex_entries(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id),
    CHECK (source_id <> target_id)
);

CREATE TABLE codex_manuscript_links (
    entry_id TEXT NOT NULL REFERENCES codex_entries(id) ON DELETE CASCADE,
    chapter_id TEXT REFERENCES chapters(id) ON DELETE CASCADE,
    scene_id TEXT REFERENCES scenes(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    CHECK ((chapter_id IS NOT NULL AND scene_id IS NULL) OR (chapter_id IS NULL AND scene_id IS NOT NULL))
);

CREATE INDEX codex_entries_project_kind_title ON codex_entries(project_id, kind, title COLLATE NOCASE);
CREATE INDEX codex_entry_links_target ON codex_entry_links(target_id);
CREATE INDEX codex_manuscript_links_scene ON codex_manuscript_links(scene_id);
CREATE UNIQUE INDEX codex_manuscript_links_chapter_unique ON codex_manuscript_links(entry_id, chapter_id) WHERE chapter_id IS NOT NULL;
CREATE UNIQUE INDEX codex_manuscript_links_scene_unique ON codex_manuscript_links(entry_id, scene_id) WHERE scene_id IS NOT NULL;