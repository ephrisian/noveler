# Product Specification: Local-First Writing Studio

## Product definition

A cross-platform desktop application for individual writers to draft and organize
long-form fiction, maintain a searchable story reference, and optionally use
user-configured AI services for deliberate writing and editing tasks. Projects
remain local by default; writers control what text or reference material is sent
to an AI provider.

The reference workflow review informed the focus on a manuscript editor,
chapter/scene organization, story-reference tools, and optional writing
assistance. This specification uses those broad categories only and does not
reproduce the reference product's branding, copy, assets, or interface.

## Technical approach

- **Desktop:** Tauri 2, targeting Linux, Windows, and macOS.
- **Permissions and packaging:** Configure Tauri capabilities conservatively;
  package workflows and prerequisites should be documented per platform,
  including signing/notarization where applicable.
- **Backend:** Rust owns persistence, filesystem operations, secure credential
  access, and outbound AI requests. Keep database access behind repository and
  service boundaries; expose narrowly scoped commands to the frontend.
- **Frontend:** React, TypeScript, and Vite, with accessible UI and a maintained
  rich-text editor such as TipTap.
- **Persistence:** SQLite with versioned migrations. Keep project data local by
  default; use stable IDs, timestamps, explicit ordering, and appropriate
  referential integrity.
- **AI:** Provider abstraction with BYOK credentials in the OS secure credential
  store. Provider calls are backend-only and user-initiated. Do not add
  telemetry or background AI requests.
- **Quality:** Test persistence and migrations, core workflows, prompt/context
  assembly, and data interchange. Document platform prerequisites and report
  only builds and checks actually run.

## Scope

### In scope

- Local project library and project lifecycle management.
- Manuscripts organized into ordered chapters and scenes.
- Rich-text writing/editing with autosave, word counts, and focus mode.
- A project Codex for characters, places, objects, and other story notes;
  searchable and linkable to related entries and manuscript locations.
- User-initiated AI tasks such as continuing a passage, brainstorming,
  rewriting selected text, improving clarity, checking continuity against
  selected Codex entries, summarizing, and giving editorial feedback.
- Editable prompt templates with documented context variables; local,
  clearable interaction metadata, without retaining full responses by default.
- BYOK provider configuration, with credentials kept in the operating system's
  secure credential store and requests made by the Rust backend.
- Preview and explicit user action before AI output is inserted or replaces
  selected manuscript text.
- Local search, Markdown/plain-text export, and versioned project backup/restore
  as the project matures.
- Linux, Windows, and macOS support, subject to platform-specific packaging and
  credential-store constraints.

### Out of scope

- Accounts, hosted services, cloud sync, or automatic remote storage.
- Collaboration, public sharing, and beta-reader workflows.
- Automatic/background AI analysis or sending manuscript content without an
  explicit user action.
- Automated extraction or authoritative tracking of story facts. The Codex is
  user-maintained; AI may assist only when invoked and with selected context.
- Silent or automatic changes to manuscript text.

## Primary user workflows

1. **Start or resume a project:** open the local library, create or select a
   project, then navigate its chapters and scenes.
2. **Draft and revise:** create/reorder manuscript sections, write in the
   editor, see save status and word counts, and continue after restarting the
   app without losing saved content.
3. **Consult story reference:** create and search Codex entries, connect related
   entries, and associate reference material with relevant manuscript sections.
4. **Request AI assistance:** configure a provider and credential, choose an
   action and context, inspect what will be sent, submit the request, review the
   response, then explicitly insert, replace, copy, or discard it.
5. **Find and take work elsewhere:** search project content, export a manuscript,
   or create/restore a portable project backup.

## Initial data model

- **Project:** stable ID, title, optional description, created/updated timestamps.
- **Chapter:** stable ID, project ID, title, position, timestamps.
- **Scene:** stable ID, chapter ID, title, position, content in a documented,
  versionable editor format, timestamps.
- **CodexEntry:** stable ID, project ID, type (character, location, item, or
  general), title, body, optional structured fields, tags, timestamps.
- **CodexLink:** source entry ID, target entry ID, optional relationship label.
- **ManuscriptCodexLink:** Codex entry ID and associated chapter or scene ID.
- **ProviderSettings:** non-secret provider/model/endpoint preferences stored
  locally; secret credential stored only through the OS credential facility.
- **PromptTemplate:** stable ID, name, task/instructions, documented context
  variables, timestamps; supports editing, duplication, and deletion.
- **AIInteractionMetadata (optional):** timestamp, provider/model, action, and
  user-selected context references. Full prompts/responses are not retained by
  default; users can clear any locally retained history.
- **Backup envelope:** documented format version and project data, validated
  before restore. Never include credentials; clarify whether non-secret app
  preferences and prompt templates are included.

All persisted entities should have stable identifiers and explicit ordering
where relevant. Database changes must use versioned migrations.

## Key screens

- **Library:** local projects, create/open/rename/delete actions, and first-run
  guidance.
- **Writing workspace:** project outline, chapter/scene editor, save state,
  word counts, Codex access, and focus mode.
- **Codex:** entry list, search/filter, entry editor, and linked-reference view.
- **AI request/review:** action and context selection, pre-send context review,
  progress/error state, and response preview with explicit disposition actions.
- **Settings:** provider/model/endpoint configuration, secure credential setup
  and connection test, prompt templates, and appearance/accessibility options.
- **Prompt-template management:** create, edit, duplicate, and delete templates;
  manage locally retained interaction metadata and clear it.
- **Search and export/backup flows:** results that navigate to their source and
  clearly confirmed import/restore operations.

## MVP acceptance criteria

1. The app launches as a desktop application on supported development platforms
  into a usable, accessible shell with Library, Codex, and Settings navigation,
  a useful first-run/empty-project state, and clear local-first data behavior.
2. A user can create, open, rename, and delete projects; deletion explains its
   effect and requires confirmation.
3. A user can create, rename, reorder, and delete chapters/scenes, with
  confirmation for destructive actions. Changes persist across application
  restarts, and database failures produce useful user-facing errors.
4. Manuscript editing preserves supported formatting, supports undo/redo and
  keyboard use, autosaves with visible saving/saved/error states, and does not
  lose unsaved work when changing scenes.
5. The editor reports current-scene word count (and chapter/project counts
  where practical) and provides a focus mode that retains essential
  navigation and save/error status. Projects with no chapters/scenes have a
  useful empty state.
6. Users can create, edit, search/filter, and delete character, location, item,
  and general Codex entries with title, content, tags, and optional structured
  fields. They can link entries to each other and, where practical, manuscript
  locations. Destructive actions require confirmation and Codex data remains
  associated with the local project.
7. Search covers project titles, manuscript text, and Codex entries and links
  results to their source locations. Markdown and plain-text exports preserve
  chapter/scene order; versioned backups are validated on restore, malformed
  or unsupported backups are handled safely, and replacing existing data
  requires clear confirmation.
8. At least one provider and an OpenAI-compatible endpoint option are
  configurable. Credentials never enter frontend storage, SQLite, logs,
  crash reports, or source code. Requests are sent only after an explicit user
  action to the configured provider; invalid credentials, rate limits, network
  and provider errors, and cancellation/progress have clear handling.
9. Users can configure provider/model/endpoint, test the connection, and manage
  prompt templates. Before sending, they can inspect and adjust the assembled
  prompt and included context. Results are previewed and may be inserted,
  replace selected text, copied, or discarded only by explicit user choice.
10. Full provider responses are not saved by default; any retained interaction
   metadata is local and clearable. The app makes external data transmission
   clear and does not issue automatic/background AI requests.
11. Automated tests cover migrations and CRUD, editor persistence, Codex search
   and links, prompt/context assembly, safe AI output handling, export order,
   and backup/restore validation.
12. Setup and development instructions document prerequisites, formatting,
    linting, type-checking, tests, and platform-specific limitations. Claims of
    successful checks/builds match checks actually run. Keyboard navigation,
    screen-reader labels/focus states, resizing/font scaling, and safe handling
    of unsaved changes are reviewed; light/dark themes are optional. Packaging
    requirements and untested platforms are stated accurately.

## Delivery boundary

The MVP includes the end-to-end local writing and Codex workflows, optional
user-triggered AI with safe context and output review, and essential search,
export, and backup/restore. Collaboration, hosted features, and automatic
story-fact extraction remain excluded. Streaming is desirable but not required
if the interface otherwise communicates progress and supports cancellation.

## Implementation-blocking decisions

These are phase-gated decisions: the scaffold and local writing foundation can
proceed, but the relevant implementation phase should not begin until its
decision is recorded.

- Which editor content format should be the durable storage format? Choose and
  document it before implementing editor persistence and backup/export.
- Which single provider should be the first native integration, and which
  OpenAI-compatible endpoint behaviors (request format, authentication,
  streaming, cancellation) must be supported? Decide before the provider phase.
- Which exact secure credential-store library and fallback behavior are
  reliable across the three target operating systems? Decide and document
  platform limitations before implementing credential management.
- Should backup files include provider preferences and prompt templates, or
  only creative project data? Credentials must be excluded in all cases; decide
  the non-secret contents before implementing backup/restore.
- Which additional export formats, if any, are required after Markdown and
  plain text?
