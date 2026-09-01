# AGENTS.md

Cross-agent project guide for **imap-mcp-server** — a Model Context Protocol (MCP)
server that gives AI assistants (Claude, ChatGPT, Cursor, …) access to IMAP/SMTP
mailboxes. This file is the shared source of truth for any agent or contributor
working in this repository.

## Architecture

- **Entry point** — `src/index.ts` boots an `McpServer` (MCP SDK) over **stdio**
  and registers all tools via `src/tools/index.ts`.
- **Services** (`src/services/`):
  - `ImapService` — IMAP protocol via **`imapflow`**, with connection pooling,
    folder operations, search, fetch, move/delete, append (Sent/Drafts).
  - `SmtpService` — outbound mail via **`nodemailer`**; composes raw MIME and sends.
  - `AccountManager` — account CRUD with **AES-256-CBC** encrypted credential
    storage at `~/.imap-mcp/accounts.json` (key at `~/.imap-mcp/.key`).
    Credentials can be overridden at read time via environment variables keyed
    by the account's normalized name (uppercase, non-alphanumeric → `_`):
    `IMAP_MCP_ACCOUNT_<NAME>_IMAP_USERNAME` / `_IMAP_PASSWORD` and
    `IMAP_MCP_ACCOUNT_<NAME>_SMTP_USERNAME` / `_SMTP_PASSWORD`. Overrides are
    in-memory only (never persisted) and apply only to existing accounts. The
    variables are consumed at startup (constructor): captured into an
    AES-256-encrypted in-memory cache and deleted from `process.env` so the
    plaintext secret does not linger in the environment. An empty credential is
    the marker for "env-managed"; `assertCredentialsResolved`
    (`src/utils/env-credentials.ts`) is called from `ImapService.connect` and
    `SmtpService.createTransporter` and fails with the missing variable's name
    instead of dialing out blank. Keep `envVarName()` in sync with its copy in
    `public/js/app.js` (the wizard is a static asset and cannot import it) —
    `tests/env-credentials.test.ts` asserts the two agree.
  - `SpamService` — disposable/known-spam domain detection.
  - `CategoryService` — deterministic classification of messages into folder
    categories from sender domain + subject keywords + mailing-list headers.
    Rules are domain/keyword lists, never free-form regexes: an unanchored
    regex over a whole address matches far more than it looks like it does
    (`ing` hits `booking.com` and `marketing@`). A rule can also name full
    sender addresses (`addresses`, scored above a domain so the more specific
    rule wins — the only way to classify freemail senders) and recipient
    addresses (`recipients`, scored below every sender signal but enough alone,
    which separates a work address from a private one in a shared mailbox). Scoring and tie-breaking are
    explicit (`priority`, then id) so the outcome never depends on rule order.
    Sender-domain parsing is shared with `SpamService` via
    `src/utils/email-address.ts` — keep it that way, two copies drift.
    The service holds **no rules at all**; `CategoryService` takes them as a
    constructor argument. Rules live in `presets/*.json` and are layered by
    `category-rules-file.ts`: `core` (ids, priorities, global domains, English
    wording) → a locale preset such as `de-DE` (labels, folder names, keywords,
    that country's domains) → the user's `~/.imap-mcp/categories.json`. A later
    layer extends an id it already knows (lists union, scalars replace) or
    defines a new one. Selection via `IMAP_MCP_CATEGORY_PRESET`, default `core`; the directory
    they are read from via `IMAP_MCP_PRESETS_DIR`, which defaults to the one
    beside the running server — without it an installed copy silently serves its
    own stale files. Read once at startup, no reload. Rule files are BOM-tolerant, and a new
    category needs a name plus any one matching signal — not a keyword list,
    which a category of named people has no use for.
    Keep `core` free of any one language or country — `tests/category-rules-
    file.test.ts` fails on a `.de` domain or an umlaut in it. And a rule set is
    a profile of its owner: a specific shop, club, or hobby identifies a person,
    so those belong in the user's file, never in a shipped preset — the same
    applies to test fixtures.
- **Tools** (`src/tools/`), grouped by area:
  - `account-tools.ts` — add / update / list / remove / connect / disconnect / test.
  - `email-tools.ts` — search, get, latest, send, reply, forward, save draft,
    mark read/unread, delete, bulk delete, move, attachments, upload, threads.
  - `folder-tools.ts` — list, status, create, rename, delete, unread counts.
    Deleting a folder deletes its mail, so it is guarded: a non-empty or
    special-use folder needs `force`, INBOX is refused outright.
  - `spam-tools.ts` — spam analysis, domain stats, allow/deny lists.
  - `category-tools.ts` — list categories, classify a folder (read-only), and
    `imap_sort_inbox`, which files mail into per-category folders. The sort tool
    is `dryRun: true` by default and both tools share one classification helper,
    so the preview can never disagree with the move it previews. Both also take
    a `cursorKeyword`: with it the batch is "messages without that keyword"
    rather than the newest N, and the sort marks what stayed — which is what
    lets a folder be worked through instead of re-showing its newest messages;
    `untilDone` repeats that inside one call and refuses without a cursor or on
    a dry run, because either would make the loop unable to end.
    A custom keyword, never `\Seen`: read state is user-visible and means
    something else. `imap_categorize_emails` reads the cursor but never writes
    it, so it stays in `READ_ONLY_TOOLS`.
- **Web setup wizard** — `src/web/server.ts` (Express) serves `public/` for
  account onboarding (`npm run setup` / `imap-setup`).
- **Types** — `src/types/index.ts`.
- All tools return **JSON-formatted text** content; errors are returned as
  structured JSON where practical rather than thrown for caller-facing failures.

## Build / Test commands

```bash
npm install          # install dependencies
npm run build        # bundle to dist/ via esbuild (build.mjs)
npm test             # run the vitest suite (run mode)
npm run test:watch   # vitest in watch mode
npm run lint         # tsc --noEmit type-check
npm run dev          # run the server from source (tsx watch)
npm run setup        # launch the web setup wizard
```

Always run `npm run build` **and** `npm test` before committing changes that
touch `src/`. Keep the suite green (currently 547 tests).

> Note: `npm run lint` (`tsc --noEmit`) is memory-hungry on this project — the
> MCP SDK's `registerTool` generics are deep enough to surface a pre-existing
> `TS2589` and can OOM on low-RAM machines. Run it with a larger heap if needed
> (`node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit`).

## Security rules (must follow)

1. **Never log secrets.** Passwords, encryption keys, `accounts.json` contents,
   raw auth tokens, and full message bodies must not be written to stdout/stderr
   or to disk outside the user's mailbox/download directories. When adding logs,
   log identifiers (account id, folder, uid), not credentials.
2. **No destructive mail operations without explicit guard logic.** Deletes,
   bulk deletes, and moves must be driven by explicit caller input. Bulk/criteria
   deletion must keep its `dryRun` path and require concrete criteria — never
   delete a whole folder by default, and never widen a delete beyond what the
   caller specified.
3. **Tool schema changes require docs + tests.** Do not rename existing tools or
   change their input/output shape without (a) updating the tool `description`,
   (b) updating `README.md`, and (c) adding/adjusting tests. Prefer additive,
   backward-compatible changes (new optional fields) over breaking ones.
4. **Credentials stay local.** Do not add telemetry, analytics, crash reporting,
   or any third-party network calls. The only outbound connections are to the
   user's own IMAP/SMTP servers.
5. **Validate and sanitize file paths** for attachment upload/download (already
   done via `path.basename`); keep writes confined to the configured directories.

## Conventions

- TypeScript, ESM (`"type": "module"`), **Node ≥ 22.12** (declared in
  `package.json` `engines.node`; CI runs 22.x and 24.x).
  - npm checks a dependency's `engines` against the Node doing the *install*,
    not against the floor we declare — so a dependency needing a newer Node
    installs silently and only breaks on a user's older runtime. This is how
    #108 happened. `tests/node-engines.test.ts` walks the runtime dependency
    tree and fails if any package needs more than we advertise. When it fires,
    either raise the floor (CI matrix, AGENTS.md and README with it) or pin the
    package back via npm `overrides`.
- Tool names are stable public API: `imap_*`. Do not rename without a strong
  reason and a migration note.
- Zod schemas describe every tool input; every field gets a `.describe()` that
  tells an LLM **when and how** to use it.
- Match the surrounding code style; keep error handling and connection cleanup
  consistent with existing tools.
