A good fit is **Tauri 2 + Rust + React/TypeScript**: Rust handles the local database, filesystem, secure credential access, and AI requests; the web frontend provides a flexible writing interface. It should run on Linux, Windows, and macOS without requiring a hosted account.

Use the prompts below **one at a time**, in order, with a coding agent that can read and modify your repository. They’re designed to build an original app with a similar writing-focused feature set—not to copy Novelium’s branding or proprietary interface.

## Recommended baseline

- **Desktop shell:** Tauri 2
- **Backend:** Rust
- **Frontend:** React + TypeScript + Vite
- **Editor:** TipTap or another maintained rich-text editor
- **Local data:** SQLite, with versioned migrations
- **AI:** BYOK providers; credentials stored in the operating system’s secure credential store
- **Initial scope:** single-user, local-first writing, editing, codex/worldbuilding, and configurable writing prompts
- **Not in scope:** collaboration, beta readers, accounts, or a hosted service

## Reusable instruction for your coding agent

Send this before the phase prompts:

```text
You are the senior engineer implementing a cross-platform, local-first desktop
writing application.

Work in the existing repository. Before changing files, inspect the project,
identify its current structure and tooling, and report any relevant constraints.
Do not replace working code or introduce a second architecture without a clear
reason.

Product principles:
- Target Linux, Windows, and macOS.
- Use Tauri 2, Rust, React, TypeScript, and SQLite unless the repository has a
  compelling existing alternative.
- Keep writing projects and application data local by default.
- No accounts, cloud sync, collaboration, or beta-reader features.
- Support BYOK AI connections. Never hard-code credentials, log secrets, or
  expose API keys to frontend code.
- AI actions must be explicit. Show what manuscript or codex context will be
  sent before sending it.
- Never silently overwrite a user’s manuscript. AI-generated changes must be
  previewed and accepted, inserted, or discarded by the user.
- Treat the supplied Novelium URL as a reference for feature discovery only.
  Do not copy its branding, text, assets, or exact interface.

Implementation discipline:
- Implement the requested phase, not just a plan or mockup.
- Keep modules understandable and avoid unnecessary abstraction.
- Add or update tests for the functionality you implement.
- Run relevant formatting, linting, type-checking, and tests. Fix failures
  caused by your changes.
- Do not claim a check passed unless you ran it.
- At the end, summarize files changed, features implemented, checks run, and
  remaining issues.
```

## Prompt 1 — Confirm the product scope

```text
Create a concise product and technical specification for this application.

Review https://novelium.com/how-it-works if browsing is available. Extract only
the high-level writing-related workflows relevant to:
1. Writing and editing a manuscript
2. Organizing a book into chapters and scenes
3. Maintaining a codex/world bible
4. Using AI for writing and editing tasks

Exclude collaboration, beta readers, public sharing, and hosted-account
features. Do not copy Novelium’s wording, branding, assets, or exact UI. If you
cannot access the webpage, say so and base the specification on the scope above
rather than inventing details.

Produce:
- A short product definition
- In-scope and out-of-scope features
- Primary user workflows
- An initial data model
- A list of key screens
- Acceptance criteria for an MVP
- Open questions that genuinely block implementation

Do not implement code yet. Keep this specification in a project document such
as docs/product-spec.md.
```

## Prompt 2 — Scaffold the cross-platform app

```text
Implement the initial desktop application scaffold according to the approved
product specification.

Use Tauri 2, Rust, React, TypeScript, and Vite unless the repository already
has a sound equivalent. Create a maintainable project structure with clear
boundaries between:
- Tauri/Rust application code
- Frontend UI
- Database and migrations
- Shared types or command contracts
- Tests and documentation

Requirements:
- The app launches into a usable, accessible desktop window.
- Add a basic app shell with navigation for Library, Codex, and Settings.
- Include an empty-project or first-run state.
- Configure Tauri capabilities conservatively; grant only the permissions
  needed by the app.
- Add development, formatting, linting, type-checking, and test instructions.
- Add a short README covering prerequisites and how to run the app locally.

Do not build placeholder controls that look functional but do nothing. Clearly
label any temporary UI. Run the available checks and report platform-specific
limitations.
```

## Prompt 3 — Local projects and persistence

```text
Implement local-first project and manuscript persistence.

A user should be able to:
- Create, rename, open, and delete a writing project.
- See their local projects in a library.
- Create and reorder chapters and scenes within a project.
- Rename and delete chapters and scenes, with confirmation before destructive
  actions.
- Close and reopen the application without losing saved work.

Use SQLite from the Rust backend, with versioned schema migrations. Keep database
access behind a repository/service layer rather than making UI components issue
SQL. Define stable IDs, timestamps, and ordering fields. Handle database errors
with useful user-facing messages.

Add tests for migrations and core CRUD operations. If deleting a project could
delete its manuscript data, make that consequence clear and require
confirmation. Do not add cloud sync or accounts.
```

## Prompt 4 — Manuscript editor

```text
Implement the writing and editing workspace for chapters and scenes.

Requirements:
- Provide a distraction-minimized editor with a clear way to navigate between
  project, chapter, and scene.
- Support reliable text editing, undo/redo, and keyboard-friendly operation.
- Autosave changes locally, with a visible saving/saved/error state.
- Preserve text formatting supported by the chosen editor.
- Show word count for the current scene and, where practical, the chapter and
  project.
- Support moving between scenes without losing unsaved changes.
- Provide a useful empty state when a project has no chapters or scenes.
- Add a focus mode that reduces surrounding UI without hiding essential save
  status or navigation.

Persist editor content in a stable format that can be migrated later. Test
autosave, reopening saved content, scene switching, and error handling. Do not
add AI features in this phase.
```

## Prompt 5 — Codex and story reference

```text
Implement a project Codex for organizing story facts and reference material.

Support at least:
- Character, location, and item entries
- A flexible general entry type for other worldbuilding notes
- Title, description/content, tags, and optional structured fields
- Search and filtering
- Linking codex entries to one another
- Editing, deleting with confirmation, and browsing an entry’s links
- Linking an entry to relevant chapters or scenes when practical

Keep all codex data local and associated with its project. Choose a data model
that can accommodate additional entry types without a schema redesign. Add
validation, empty states, and tests for CRUD, search, and links.

Make it possible to view codex information while writing, but do not make the
editor change manuscript text automatically.
```

## Prompt 6 — BYOK AI connections

```text
Implement the application’s secure BYOK AI provider foundation.

Requirements:
- Create a provider abstraction so additional providers can be added without
  rewriting writing workflows.
- Start with one reliable provider integration and an OpenAI-compatible
  endpoint option. Add other native providers only if they can be implemented
  and tested cleanly.
- Let the user configure provider, model, and endpoint where applicable.
- Store API credentials using the operating system’s secure credential store
  through an appropriate maintained Rust library. Store non-secret settings
  locally, but never store API keys in SQLite, frontend storage, logs, crash
  reports, or source code.
- Send provider requests from the Rust backend, not directly from the frontend.
- Support streamed responses if feasible; otherwise show clear progress and
  cancellation behavior.
- Provide a connection test and useful handling for invalid keys, rate limits,
  network failures, and provider errors.
- Make it clear that AI requests send selected content to the configured
  provider. Do not send manuscript or Codex data until the user initiates an
  action.
- Do not include telemetry or automatic background AI requests.

Add tests using mocked provider responses. Document credential handling,
supported providers, and any platform-specific keychain limitations.
```

## Prompt 7 — Writing and editing workflows

```text
Implement user-triggered AI writing and editing actions using the provider
foundation.

Provide configurable prompt templates and practical actions such as:
- Continue a passage
- Brainstorm ideas
- Rewrite selected text according to an instruction
- Improve clarity or prose
- Check continuity against selected Codex entries
- Summarize a scene or chapter
- Give editorial feedback without changing the manuscript

Requirements:
- Let the user edit, create, duplicate, and delete prompt templates.
- Allow templates to use documented variables, such as selected text,
  surrounding passage, scene, chapter, or chosen Codex entries.
- Before sending, show the exact assembled prompt or a clear representation of
  all included manuscript and Codex context. Let the user remove context.
- Provide a response preview. The user chooses whether to insert, replace
  selected text, copy, or discard the result.
- Never replace manuscript text automatically.
- Handle empty selections, long context, cancellations, and provider errors.
- Keep prompt templates and interaction history local. Let users clear history.
  Do not save full provider responses unless the user chooses to keep them.

Add tests for prompt variable expansion, context selection, and safe handling of
AI output.
```

## Prompt 8 — Search, backup, and export

```text
Complete the essential local-project management features.

Implement:
- Search across project titles, manuscript text, and Codex entries.
- A clear way to jump from search results to the relevant scene or entry.
- Export of a project or manuscript to practical portable formats, at minimum
  Markdown and plain text.
- Project backup and restore using a documented, versioned format.
- Validation during restore, including a safe response to malformed or
  unsupported backup files.
- Clear confirmation before overwriting or replacing existing project data.

Keep exports predictable: preserve chapter and scene order and avoid adding
application-only metadata to manuscript text. Add round-trip tests for backup
and restore, plus tests for export ordering and search results.
```

## Prompt 9 — Accessibility, packaging, and release checks

```text
Prepare the application for a usable cross-platform MVP release.

Review and improve:
- Keyboard navigation and shortcuts
- Screen-reader labels and accessible focus states
- Window resizing, font scaling, and narrow layouts
- Empty, loading, saving, and error states
- Light and dark themes if they can be added without destabilizing the app
- Safe handling of unsaved changes and destructive actions

Configure Tauri build/package workflows for Linux, Windows, and macOS. Document
the required build environments, signing/notarization requirements, and any
platform limitations. Do not claim that a platform build was tested unless it
was actually run.

Run formatting, linting, type-checking, backend tests, frontend tests, and
available desktop builds. Fix failures caused by this work. Finish with:
- A feature checklist against the product specification
- Commands used and their results
- Any untested platform-specific areas
- Known bugs and suggested next steps
```

## Suggested workflow

Use a coding agent with repository access, give it the reusable instruction, then submit each phase prompt separately. Review the implementation and test results after every phase before moving on—especially the database model, editor persistence, and credential storage, since changes there can affect the rest of the app.