# Noveler

Noveler is a cross-platform, local-first desktop writing studio. It provides an
accessible Tauri desktop window with Library, Codex, and Settings navigation.
Projects and chapter/scene outlines are stored in a local SQLite database;
Codex entries are stored per project and can link to related entries and
manuscript locations. AI support currently provides an explicit BYOK connection
foundation for OpenAI-compatible chat-completion endpoints.

## Stack and boundaries

- `src-tauri/` — Tauri 2 and Rust desktop entry point, command boundary, SQLite
  repository, and versioned migrations.
- `src-tauri/migrations/` — versioned SQL schema migrations.
- `src-tauri/src/ai/` — provider abstraction, OpenAI-compatible HTTP client,
  OS credential-store wrapper, and local non-secret settings.
- `src/` — React, TypeScript, and Vite frontend.
- `src/ui/` — accessible application shell, pages, styles, and component tests.
- `src/shared/` — frontend/backend contract types.
- `docs/product-spec.md` — approved product scope and acceptance criteria.

Keep persistence and platform operations in Rust; expose them to the UI through
narrow Tauri commands. No plugin permissions are currently required.

## AI credentials and requests

Supported providers are OpenAI-compatible Chat Completions, OpenRouter, and
local Ollama. OpenRouter defaults to `https://openrouter.ai/api/v1` and requires
an OpenRouter key. Ollama defaults to `http://127.0.0.1:11434/v1`, requires a
locally running server and pulled model, and is restricted to loopback addresses
so content cannot be sent to a remote Ollama endpoint. Ollama runs inference on
the user's machine. OpenAI-compatible defaults to `https://api.openai.com/v1`;
other non-local endpoints must use HTTPS. OpenRouter and OpenAI-compatible
requests are sent to the selected cloud service. API keys are stored through the
`keyring` Rust library using the operating system credential service. Non-secret
provider/model/endpoint settings are
stored in `ai-settings.json` under Tauri's application data directory. Keys are
not written to SQLite, settings files, frontend storage, or logs. Adding or
testing a key makes a transient frontend-to-Rust IPC call; provider HTTP calls
always originate in Rust. No request, manuscript context, or Codex context is
sent until an explicit command/action is invoked. Full provider responses are
returned for the caller to preview and are not saved automatically.
The writing workspace provides configurable prompt templates, explicit context
review, a user-triggered provider request, and a response preview that is only
inserted/replaced after an explicit choice. Local interaction history contains
only template/model/time/context labels; prompt and response bodies are not
retained. Full request cancellation and streamed output are future improvements;
closing the dialog stops waiting and discards any eventual UI result.

Prompt templates support `{{selectedText}}`, `{{surroundingPassage}}`,
`{{scene}}`, `{{chapter}}`, `{{codex}}`, and `{{instruction}}`. Missing variables
expand to empty text, and unknown placeholders remain literal. Before sending,
the assembled prompt is editable and the included context is identified; users
may remove context and must click the send action. Results stay in a preview
until the user copies, inserts, replaces a selection, or discards them.

## Search, export, and backups

Global search covers project titles, scene/chapter titles and text, and Codex
titles, descriptions, tags, and structured fields. Results identify their source
and open the matching scene or Codex entry. Manuscript export is available as
Markdown or plain text; chapter and scene order is retained and application IDs
and timestamps are omitted. Project backup and restore use the documented,
versioned format in [`docs/backup-format.md`](docs/backup-format.md). Restore to
a new project by default in the backend; replacing the open project requires an
explicit confirmation in the UI and is transactional.

Credential availability depends on the platform's configured credential
service (for example, Secret Service/libsecret on Linux, Credential Manager on
Windows, and Keychain on macOS). Linux desktop sessions without a usable secret
service may reject credential operations; the app intentionally does not fall
back to plaintext storage. Check/cancel actions or streaming can be added in a
later phase; current requests use a bounded timeout and display progress/error.

## Prerequisites

- Node.js 20.19+ or 22.12+ and npm
- Rust stable toolchain (install with [rustup](https://rustup.rs/))
- Tauri platform dependencies: WebKitGTK/GTK development packages on Linux,
  Microsoft C++ Build Tools and WebView2 on Windows, or Xcode Command Line
  Tools on macOS. Consult the official
  [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for current
  package names. macOS distribution requires signing and notarization.

On Fedora/Nobara or Debian/Ubuntu-family Linux, install the native build
packages, Rust stable, and locked npm dependencies with
`npm run setup:linux`. Review `scripts/install-linux-deps.sh` first; it invokes
`sudo` for system packages and downloads the official rustup installer when Rust
is missing. Windows and macOS prerequisites remain manual; see `docs/release.md`.
On Fedora/Nobara, build native RPM and AppImage packages with
`npm run tauri:build:fedora`. Linux Wayland launches automatically disable the
WebKitGTK DMA-BUF renderer to avoid a buffer allocation failure observed on
Nobara; set `WEBKIT_DISABLE_DMABUF_RENDERER=0` only if you need to override it.

## Run and check

Install frontend dependencies with `npm install`, then run the desktop app with
`npm run tauri dev`. For frontend-only development, use `npm run dev`; browser
mode does not provide native persistence. Package for the current platform with
`npm run tauri build`.

- `npm run format` / `npm run format:check` — format / verify formatting
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript
- `npm test` — frontend tests
- `npm run build` — type-check and production frontend build
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` — Rust formatting
- `cargo test --manifest-path src-tauri/Cargo.toml` — Rust tests

Build and test Tauri on each target platform or a compatible environment. A
successful frontend check does not verify native packaging. Platform builds are
not claimed as tested by this scaffold.
