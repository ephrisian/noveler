CREATE TABLE timeline_events (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    date_label TEXT NOT NULL DEFAULT '',
    sort_order REAL NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    confidence TEXT NOT NULL DEFAULT 'confirmed' CHECK (confidence IN ('confirmed', 'inferred', 'uncertain')),
    source_scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL,
    dismissed INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX timeline_events_project_order ON timeline_events(project_id, sort_order, created_at);
