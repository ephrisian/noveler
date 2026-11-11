# Noveler project backup format

Project backups are UTF-8 JSON documents with this envelope:

```json
{
  "format": "noveler-project",
  "version": 1,
  "project": { "id": "…", "title": "…", "createdAt": "…", "updatedAt": "…" },
  "chapters": [],
  "codexEntries": [],
  "codexLinks": [],
  "codexManuscriptLinks": []
}
```

Chapter and scene arrays are in manuscript order. IDs in the file are stable only
within that backup; restore assigns fresh IDs to project content and remaps all
Codex and manuscript links. The project title, chapter/scene titles and contents,
Codex facts, and their links are included. Provider credentials and settings,
AI request history, and prompt templates are not included.

Version 1 restore rejects malformed JSON, unknown format/version, invalid or
duplicate IDs, broken links, unreasonable record counts, and files larger than
50 MiB before making changes. Restore into a new project by default. Replacing a
project is an explicit UI action requiring confirmation. Database replacement is
transactional: a failed import rolls back and preserves the previous project.

The Markdown export uses `#` for chapters and `##` for scenes. Plain text uses
underlined chapter headings followed by scene titles. Both preserve stored order
and contain no application IDs or timestamps.
