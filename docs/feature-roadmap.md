# Feature Roadmap

This plan compares Noveler's current capabilities with the writing, Codex, and publishing features reviewed from Novelium's feature page. It preserves Noveler's local-first, single-writer approach and excludes collaboration, beta readers, sharing, hosted accounts, and background analysis.

**Current priority:** Codex creation and quality. Scrivener/PDF import and PDF/EPUB publishing are explicitly deferred and are not release blockers.

## Current baseline

- Local projects organized into chapters and scenes, with autosave, word counts, and focus mode.
- A manually maintained Codex for characters, locations, items, and general notes, with search, tags, structured fields, entry relationships, and links to manuscript locations.
- User-initiated AI writing and editing actions, with review before applying generated output.
- Ollama and other provider configuration, local Markdown/plain-text manuscript export, and project backup/restore.
- Light/dark app appearance, text scaling, and custom writing themes with offline, licensed fonts.

## Product principles

1. AI analysis only runs after an explicit user action. The user chooses the text scope and provider.
2. AI-generated Codex entries remain suggestions until the writer reviews and accepts them.
3. Existing Codex data and manuscript text are never silently overwritten.
4. Projects remain local by default. No accounts, cloud sync, group features, or background AI analysis are planned.
5. Custom themes are validated data, not arbitrary CSS. Open-source fonts are bundled only after verifying redistribution rights.
6. Project backups contain creative project data, not AI credentials or global appearance preferences. Decide separately if themes need an explicit import/export format.

## Phase 1: Automatic Codex suggestions

**Status:** Implemented for scene, chapter, and project scopes. Exact text is
reviewed before submission; responses are size-limited and validated; evidence
must occur in the source; each suggestion is editable and explicitly accepted or
skipped. Duplicate titles prompt for confirmation. Accepted entry and source-scene
links are committed atomically. Cross-entry conflict/merge assistance remains
future work. This is the active product priority; extraction stays explicit,
evidence-backed, reviewable, and acceptance-only.

### Workflow

1. Add **Generate Codex suggestions** to the writing workspace and/or Codex page.
2. Allow the writer to select a scene, chapter, or project as the analysis scope and review exactly which text will be sent.
3. Ask the configured AI provider to return structured suggestions: entry type, title, description, tags, structured fields, evidence excerpt, and source scene(s).
4. Validate and normalize the response as untrusted data. Reject malformed or oversized responses; do not execute model output or persist it automatically.
5. Present a review queue where each suggestion can be edited, accepted, skipped, or canceled.
6. Compare suggestions with existing entries for possible duplicates or conflicts. Let the writer merge, keep both, or skip.
7. Save only accepted entries through existing Codex CRUD operations and link them to their source locations.

### Implementation steps

- Define a versioned suggestion schema and deterministic parsing/validation tests.
- Add a backend command using the existing provider abstraction, with bounded input/output and clear errors.
- Build a review UI that reuses Codex entry editing where practical.
- Add duplicate/conflict assistance and evidence/source display.
- Test malformed output, duplicate handling, cancellation, edits, acceptance, and source links.

### Initial exclusions

No automatic updates to existing entries, continuous manuscript monitoring, authoritative fact tracking, automatic timeline conflict alerts, or silent/background extraction.

## Phase 2: Custom theme system

**Status:** Implemented with Rust app-data persistence, migration from legacy
local preferences, built-in presets, user create/edit/duplicate/delete, colors,
body/heading fonts, size, line height, content width, divider styles, live
preview, contrast warning, and bounded versioned JSON import/export. Bundled
fonts are licensed and work offline. Broader contrast/accessibility evaluation
remains future work. Arbitrary user font-file installation remains deferred;
the current picker is limited to bundled, licensed font families.

### Theme model and persistence

- Extract the current hard-coded light/dark colors into CSS design tokens without changing the existing appearance.
- Define a versioned theme format containing a name, UI color tokens, editor colors, typography, paragraph spacing, line width, and optional heading/scene-divider styles.
- Separate application chrome tokens from manuscript/editor tokens so writers can customize the writing surface without reducing the usability of navigation, dialogs, or error states.
- Store themes and the selected theme in local application settings managed by Rust. Keep theme selection global rather than project-specific; do not place themes or secrets in project backups.
- Preserve the current light/dark and text-scale preferences during migration and provide safe defaults if old or invalid settings are found.

### Theme editor workflow

- Provide built-in Light and Dark themes and a few writing presets.
- Allow users to create, rename, duplicate, edit, preview, select, and delete custom themes.
- Include a live manuscript preview with body text, headings, scene breaks, selection, and save/error states.
- Validate required tokens and color contrast; warn about low contrast and offer safer values.
- Support theme JSON import/export with schema versioning, strict validation, and size limits. Never accept arbitrary CSS or script content.

### Open-source fonts

- Prefer locally bundled fonts over downloads at runtime, preserving offline use and avoiding unexpected network requests.
- Curate fonts from reputable open-source families. Verify that each license permits bundling/redistribution and include font license texts and attribution in the repository.
- Use system-font fallbacks. Consider user-installed fonts later through an explicit file picker, supported-format and size validation, and copying into application data.
- Do not treat a font merely being available online as permission to redistribute it.

### Implementation steps

1. Convert current light/dark styling to CSS variables and verify no visual regression.
2. Add the versioned settings model, migration/fallback behavior, and persistence tests.
3. Add theme presets and user theme editor with accessible previews.
4. Add licensed font files, license notices, and editor-only font controls.
5. Add validated theme import/export and tests for invalid versions, colors, and payload sizes.

## Phase 3: Manuscript import and expanded export

**Status:** Markdown, plain-text, and DOCX import/export are implemented with a
preview before import. Project backup/restore remains a separate format. Scrivener
and PDF import are not implemented; PDF extraction remains deferred because of
its lossy nature. DOCX conversion preserves headings and paragraphs, with more
advanced Word formatting not guaranteed.

1. Start with Markdown and plain-text import, previewing the outline and mapping headings to chapters/scenes.
2. Add DOCX import with a maintained parser and tests for headings, paragraphs, and supported formatting.
3. Evaluate Scrivener `.scrivx` and PDF as later, explicitly scoped formats. PDF extraction may be lossy; show a preview and explain limitations.
4. Add DOCX export, then decide whether print-ready PDF/EPUB publishing is in scope.
5. Require confirmation before creating or replacing project content; validate file type, size, and structure.

## Phase 4: Timeline and consistency tools

**Status:** Manual timeline event CRUD and ordering are implemented, including
date labels, notes, confidence, scene source, and dismiss/restore. The timeline
storage model is in the SQLite v3 migration. AI candidate event extraction and
consistency reports are not implemented yet.

These additional features depend on a reviewed Codex and timeline data model.

1. Define timeline events with date/time expression, ordering, evidence/source location, and confidence where relevant.
2. Build a manually editable timeline view first.
3. Add explicit, on-demand AI extraction of candidate events from selected manuscript text, with review before saving.
4. Add consistency reports only after the underlying event/fact model is stable. Cite evidence, make uncertainty clear, and allow findings to be dismissed or marked for later.
5. Defer live/background checking; it raises privacy, cost, latency, and correctness concerns and is not required for the first versions.

## Phase 5: Advanced publishing and interchange

After import and core editor behavior are reliable:

- Evaluate formatted DOCX export, then PDF/EPUB generation if writers need publishing output.
- Add document themes/layouts separately from application themes. Keep print typography and page layout controls distinct from editor appearance.
- Consider multiple editions only after a clear use case and data model are established.
- Test exported documents against representative manuscripts and document unsupported formatting.

## Suggested delivery order

1. Update the product specification and settle persistence/backup boundaries.
2. Complete Codex creation polish: duplicate review, transaction/error handling,
   evidence validation, and writer feedback from real model output.
3. Complete validation of custom theme and native preference migration across OS targets.
4. Add on-demand timeline event extraction and evidence-backed consistency reports only after Codex quality is established.
5. Keep Scrivener/PDF import and PDF/EPUB publishing deferred until explicitly reprioritized.

## Acceptance criteria

- Automatic Codex generation sends only the user-selected scope after an explicit action, previews the suggestions, and persists only entries the user accepts.
- Accepted entries can be traced to source scenes; duplicates and malformed model responses are handled safely.
- Writers can create, edit, preview, select, duplicate, and delete custom themes, and their preferences persist across restarts.
- Theme data is versioned and validated; imported themes cannot inject CSS or scripts.
- Bundled fonts have verified redistribution-compatible licenses and repository attribution.
- Existing light/dark preferences remain usable, and contrast/readability is checked for custom themes.
- Import/export operations validate input, preview structural changes, and never silently replace a project.
- No group collaboration, beta reader, account, cloud sync, or background analysis features are introduced.
