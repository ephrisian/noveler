# Database migrations

Migrations are applied in order by `src/db::migrate` and tracked using SQLite's
`PRAGMA user_version`. Migration `001_initial.sql` creates local projects,
ordered chapters and scenes, stable text IDs, UTC timestamps, and cascading
foreign keys. Never edit a migration that may already have shipped; add a new
numbered migration and increment the schema version instead.

Migration `002_codex.sql` adds project-scoped flexible Codex entries, JSON tags
and structured fields, links between entries, and links to chapters or scenes.
Deleting an entry cascades to its links; deleting a project cascades to all its
Codex content.

Supported starter kinds are `character`, `location`, `item`, and `general`.
The stored kind is an extensible string; adding a kind does not require a schema
migration. `fields_json` is an object for optional kind-specific attributes,
while `tags_json` is a string array.

Project removal cascades to its chapters and scenes. The UI requires explicit
confirmation and states this consequence before issuing the delete command.
