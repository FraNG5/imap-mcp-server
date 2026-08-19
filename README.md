# IMAP MCP Server

A powerful Model Context Protocol (MCP) server that provides seamless IMAP email integration with secure account management and connection pooling.

## Features

- 🔐 **Secure Account Management**: Encrypted credential storage with AES-256 encryption
- 🚀 **Connection Pooling**: Efficient IMAP connection management
- 📧 **Comprehensive Email Operations**: Search, read, move, mark, delete, and bulk delete emails
- ✉️ **Email Sending**: Send, reply, and forward emails via SMTP
- 📁 **Folder Management**: List folders, check status, get unread counts
- 🔄 **Multiple Account Support**: Manage multiple IMAP accounts simultaneously
- 🛡️ **Type-Safe**: Built with TypeScript for reliability
- 🌐 **Web-Based Setup Wizard**: Easy account configuration with provider presets
- 📱 **15+ Email Providers**: Pre-configured settings for Gmail, Outlook, Yahoo, and more
- 🔗 **Auto SMTP Configuration**: Automatic SMTP settings based on IMAP provider

## Installation

> **Requires Node.js 22.12 or newer.** Node 18 and 20 have both reached
> end-of-life, and several of this package's dependencies no longer support
> them. Check yours with `node --version`.

### Run via npx (No Installation Required)

Once published to npm, you can run the server directly without cloning or building anything — `npx` downloads the prebuilt package and runs it:

```bash
npx -y imap-mcp-server
```

This is the easiest way to use the server in an MCP client (see [Configuration](#configuration) for ready-to-paste `npx` configs).

### Quick Install (Recommended)

#### macOS/Linux:
```bash
curl -fsSL https://raw.githubusercontent.com/nikolausm/imap-mcp-server/main/install.sh | bash
```

#### Windows (PowerShell as Administrator):
```powershell
iwr -useb https://raw.githubusercontent.com/nikolausm/imap-mcp-server/main/install.ps1 | iex
```

### Manual Installation

1. Clone the repository:
```bash
git clone https://github.com/nikolausm/imap-mcp-server.git
cd imap-mcp-server
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Account Setup

Accounts are stored encrypted in `~/.imap-mcp/accounts.json`. This file is **shared by all run modes** — whether you start the server via `npx`, a global install, or a local clone, they all read the same accounts. So you only need to set up your accounts once.

### Setting Up Accounts in npx Mode

If you run the server via `npx` (no clone), you have two ways to add accounts:

**Option A — Run the setup wizard directly via npx (no install needed):**

```bash
npx -p imap-mcp-server imap-setup
```

This launches the same web-based wizard described below and writes to `~/.imap-mcp/accounts.json`, which your `npx`-configured MCP server then picks up automatically.

**Option B — Add accounts straight from your AI client:**

Once the MCP server is configured, just ask your assistant to add an account — it uses the `imap_add_account` tool. For example:

> "Add my IMAP account: host imap.gmail.com, port 993, user me@gmail.com, password …"

No separate setup step required.

### Web-Based Setup Wizard (Recommended)

After installation, run the setup wizard:

```bash
npm run setup
```

Or if installed globally:

```bash
imap-setup
```

Or directly via npx without installing:

```bash
npx -p imap-mcp-server imap-setup
```

This will:
1. Start a local web server
2. Open your browser to the setup wizard
3. Guide you through adding email accounts with pre-configured settings

### Overriding Credentials via Environment Variables

You can override the username and password of an already-configured account at
runtime with environment variables — useful when you inject secrets from a
password manager or CI system instead of storing them in `accounts.json`.

The variables are keyed by the account **name**, uppercased with every
non-alphanumeric character replaced by `_`. For an account named `Work Gmail`
(key `WORK_GMAIL`):

| Variable | Overrides |
| --- | --- |
| `IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_USERNAME` | IMAP username (`user`) |
| `IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD` | IMAP password |
| `IMAP_MCP_ACCOUNT_WORK_GMAIL_SMTP_USERNAME` | SMTP username (`smtp.user`) |
| `IMAP_MCP_ACCOUNT_WORK_GMAIL_SMTP_PASSWORD` | SMTP password |

Notes:
- Overrides apply **only to existing accounts**; if no account's normalized name
  matches, the variable is ignored.
- They are applied **in memory only** — nothing is written back to
  `accounts.json`, and the values are used as-is (not re-encrypted).
- Variables are **consumed at startup**: on server start they are captured into
  an AES-256-encrypted in-memory cache and removed from `process.env`, so the
  plaintext secret does not linger in the environment (where it could leak to
  child processes or diagnostics). Set them before launching the server.

The setup wizard integrates with this: each credential field (IMAP password,
IMAP username, SMTP username, SMTP password) has a **"Do not save to config; set
later using an environment variable"** checkbox. When ticked, the value you enter
is still used to test the connection, but it is not written to `accounts.json` —
the wizard shows the exact variable name to export, and the account picks the
credential up from that variable at runtime.
- SMTP variables take effect only when the account already has an SMTP config.
- Each variable takes effect independently; set only the ones you need.

**If the variable is missing**, the account still holds the empty placeholder the
wizard wrote. Rather than dialing out with a blank credential — which providers
answer with a generic authentication failure that looks exactly like a wrong
password — the server refuses the connection and names what to set:

```
Account "Work Gmail" has IMAP credentials marked as environment-managed, but
this variable was not set when the server started:
IMAP_MCP_ACCOUNT_WORK_GMAIL_IMAP_PASSWORD. Set it and restart the server, or
store the credentials on the account via imap_update_account.
```

Because the variables are read once at startup, setting one in an already-running
shell has no effect until the server is restarted.

### Supported Email Providers

The setup wizard includes pre-configured settings for:
- Gmail / Google Workspace
- Microsoft Outlook / Hotmail / Live
- Yahoo Mail
- Apple iCloud Mail
- GMX
- WEB.DE
- IONOS (1&1)
- ProtonMail (with Bridge)
- Fastmail
- Zoho Mail
- AOL Mail
- mailbox.org
- Posteo
- Custom IMAP servers

## Configuration

### Claude Code (CLI)

#### Option A — via npx (no clone/build needed)

```bash
claude mcp add imap -- npx -y imap-mcp-server
```

This always runs the latest published version and requires no local build.

#### Option B — from a local clone

If you use [Claude Code](https://docs.anthropic.com/en/docs/claude-code) in the terminal, add the MCP server with a single command:

**Step 1:** Make sure you have built the project first (see [Manual Installation](#manual-installation)).

**Step 2:** Run this command in your terminal:

```bash
claude mcp add imap -- node /absolute/path/to/imap-mcp-server/dist/index.js
```

> **Important:** Replace `/absolute/path/to/imap-mcp-server` with the actual path where you cloned the repository. For example:
> ```bash
> # macOS/Linux example:
> claude mcp add imap -- node /Users/yourname/imap-mcp-server/dist/index.js
>
> # Windows example:
> claude mcp add imap -- node C:\Users\yourname\imap-mcp-server\dist\index.js
> ```

**Step 3:** Verify it was added:

```bash
claude mcp list
```

You should see `imap` in the list of configured MCP servers. That's it — the IMAP tools are now available in your Claude Code sessions.

> **Tip:** If you want to remove the server later, run:
> ```bash
> claude mcp remove imap
> ```

### Claude Desktop (GUI App)

Add the IMAP MCP server to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

**Option A — via npx (recommended, no clone/build needed):**

```json
{
  "mcpServers": {
    "imap": {
      "command": "npx",
      "args": ["-y", "imap-mcp-server"],
      "env": {}
    }
  }
}
```

**Option B — from a local clone:**

```json
{
  "mcpServers": {
    "imap": {
      "command": "node",
      "args": ["/path/to/imap-mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

### Restricting tool access (read-only mode / allowlist)

By default all tools are exposed. You can restrict which tools the agent sees
using two environment variables (set them under the `env` key of your MCP
config). This is useful when you want to give an assistant **read-only** access
to a mailbox, or expose only a hand-picked subset of tools.

| Variable | Effect |
| --- | --- |
| `IMAP_MCP_READ_ONLY` | When truthy (`1`, `true`, `yes`, `on`), only the safe, read-only tools are registered — searching, reading, listing folders, unread counts, spam analysis. No tool that sends mail, deletes/moves messages, changes flags, or edits accounts is exposed. |
| `IMAP_MCP_ENABLED_TOOLS` | Comma-separated allowlist of tool names — only these are registered. Names are case-insensitive and the `imap_` prefix is optional (`search_emails` ≡ `imap_search_emails`). When set, it takes precedence over `IMAP_MCP_READ_ONLY`. |

**Example — read-only access:**

```json
{
  "mcpServers": {
    "imap": {
      "command": "npx",
      "args": ["-y", "imap-mcp-server"],
      "env": { "IMAP_MCP_READ_ONLY": "true" }
    }
  }
}
```

**Example — explicit allowlist:**

```json
{
  "mcpServers": {
    "imap": {
      "command": "npx",
      "args": ["-y", "imap-mcp-server"],
      "env": { "IMAP_MCP_ENABLED_TOOLS": "imap_search_emails,imap_get_email,imap_get_latest_emails" }
    }
  }
}
```

The read-only subset is: `imap_list_accounts`, `imap_connect`, `imap_disconnect`,
`imap_test_account`, `imap_search_emails`, `imap_get_email`,
`imap_get_latest_emails`, `imap_download_attachment`, `imap_find_thread_messages`,
`imap_find_email_by_message_id`, `imap_list_folders`, `imap_folder_status`,
`imap_get_unread_count`, `imap_check_spam`, `imap_domain_stats`,
`imap_list_spam_domains`, `imap_list_categories`, `imap_categorize_emails`.

## Usage

Once configured, the IMAP MCP server provides the following tools in Claude:

> **Choosing an account.** For the email and folder tools, `accountId` is
> **optional** and backward-compatible. You may instead pass `accountName`, and
> if you only have a **single** account configured you can omit both — that
> account is used by default. With multiple accounts and no selector, the tool
> returns a clear error listing your options (`imap_list_accounts`).

### Account Management

- **imap_add_account**: Add a new IMAP account
  ```
  Parameters:
  - name: Friendly name for the account
  - host: IMAP server hostname
  - port: Server port (default: 993)
  - user: Username
  - password: Password
  - tls: Use TLS/SSL (default: true)
  - sentFolder: Explicit Sent-folder name for sent-mail copies, e.g. "Gesendet"
      (optional — only needed when the server has no \Sent SPECIAL-USE folder
      and auto-detection fails)
  - defaultBcc: Optional BCC address(es) applied automatically to every
      outbound send, reply, forward, and draft for this account. Merged with
      any per-call `bcc` (duplicates removed case-insensitively)
  ```

- **imap_update_account**: Update an existing account (fix SMTP settings, rename, etc.)
  ```
  Parameters:
  - accountId: ID of the account to update
  - name, host, port, user, password, tls, email: IMAP fields (all optional)
  - smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword: SMTP fields (optional)
  - saveToSent: Save sent emails to the Sent folder (optional)
  - sentFolder: Explicit Sent-folder override (optional). Pass an empty string
      to clear the override and re-enable auto-detection
  - defaultBcc: Optional default BCC address(es) (optional). Pass an empty
      string to clear
  ```

- **imap_list_accounts**: List all configured accounts

- **imap_remove_account**: Remove an account
  ```
  Parameters:
  - accountId: ID of the account to remove
  ```

- **imap_connect**: Connect to an account
  ```
  Parameters:
  - accountId OR accountName: Account identifier
  ```

- **imap_disconnect**: Disconnect from an account
  ```
  Parameters:
  - accountId: Account to disconnect
  ```

### Email Operations

- **imap_search_emails**: Search for emails
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name (default: INBOX; ignored when searchAllFolders is true)
  - searchAllFolders: Search across ALL folders at once (default: false).
      Skips Trash/Spam/Drafts and non-selectable folders by default. Use when a
      message may have been filed/moved/archived and you don't know its folder.
  - includeTrash, includeSpam, includeDrafts: Opt those noisy folders back into
      a searchAllFolders run (default: false each)
  - from, to, subject, body: Search criteria
  - since, before: Date filters
  - seen, flagged: Status filters
  - keywords: Match messages with ANY of these custom keywords (server-side OR).
      Read a mailbox's available custom keywords from `imap_folder_status`'s
      `customKeywords` field first.
  - unKeywords: Exclude messages with ANY of these custom keywords (result has
      NONE of them). Same keyword source as `keywords`.
  - limit: Max results (default: 50)
  - includeBody: Include parsed message body in the response (default: false).
      Fetches the RFC822 source once and parses it with mailparser, so you get
      uid + body in a single tool call instead of paying the N+1 cost of one
      `imap_get_email` per match. Body is rendered per `bodyFormat` and capped
      at `bodyMaxLength` per field.
  - bodyFormat: How to render the body when `includeBody` is true — `markdown`
      (default, clean Markdown via Turndown), `text`, `html`, or `auto`.
  - bodyMaxLength: Per-field cap when `includeBody` is true (default: 10000).
  ```
  > With `searchAllFolders`, results include a `folder` field per message plus
  > `foldersSearched`, and any folder that failed to open is reported in
  > `foldersErrored` (so a 0-result answer is never silently incomplete).
  >
  > `includeBody` is honored in the single-folder path only. For a
  > cross-folder sweep the lightweight header shape is preserved by design —
  > pulling RFC822 source for every match across many folders would multiply
  > bandwidth and parse cost. Follow up with `imap_get_email` for the specific
  > uids whose bodies you need.
  >
  > On some servers a "flagged"/starred message carries a custom keyword (e.g.
  > an Open-Xchange color label or Apple's `$MailFlagBit*`) instead of, or in
  > addition to, the `\Flagged` system flag — after any flagged search, check
  > each result's `customKeywords` field before concluding a message is or
  > isn't flagged.

- **imap_get_email**: Get full email content
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  - uid: Email UID
  - maxContentLength: Max characters for text/html body (default: 10000)
  - includeAttachmentText: Include text attachment previews (default: true)
  - maxAttachmentTextChars: Max characters per text attachment (default: 100000)
  ```

- **imap_get_latest_emails**: Get recent emails
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name (default: INBOX)
  - count: Number of emails (default: 10)
  - includeBody: Include parsed message body (default: false). Same semantics
      as the `includeBody` option on `imap_search_emails` — one round-trip
      instead of N×`imap_get_email`.
  - bodyFormat: `markdown` (default), `text`, `html`, or `auto`.
  - bodyMaxLength: Per-field cap (default: 10000).
  ```

- **imap_mark_as_read/unread**: Change email read status
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  - uid: Email UID, OR an array of UIDs to flag in one call. Batch uses a
      single IMAP STORE so the operation is atomic at the server level — all
      UIDs are flagged, or none. Useful when triaging many messages at once.
  ```

- **imap_flag_email/unflag_email**: Star/unstar an email (sets or clears the IMAP \Flagged system flag — shows as a "star" in Gmail and Apple Mail). Some servers/clients (Open-Xchange, Apple Mail) also set a separate custom keyword (e.g. `$cl_N`, `$MailFlagBit*`) when flagging; unflag only clears `\Flagged`, so if a message still shows as flagged, check `customKeywords` via `imap_get_email` and clear it with `imap_remove_keyword`.
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  - uid: Email UID
  ```

- **imap_add_keyword/remove_keyword**: Set or clear an arbitrary *custom* (non-system) IMAP keyword/label on an email, passed through verbatim (e.g. provider color labels like Open-Xchange's `$cl_1`..`$cl_10` or Apple Mail's `$MailFlagBit0`..`$MailFlagBit2`, or any other custom keyword). Backslash-prefixed system flags (e.g. `\Flagged`, `\Seen`, `\Deleted`) are rejected — use the dedicated flag/read tools for those. Not every server permits custom-keyword changes (see the mailbox's PERMANENTFLAGS); if the server rejects or silently ignores the change, the call fails instead of reporting success.
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  - uid: Email UID
  - keyword: IMAP keyword to set/remove (e.g. "$cl_3")
  ```

- **imap_delete_email**: Delete an email
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name
  - uid: Email UID
  ```

- **imap_move_email**: Move an email from one folder to another
  ```
  Parameters:
  - accountId: Account ID
  - folder: Source folder name (default: INBOX)
  - uid: Email UID, OR an array of UIDs to move in one call. Batch moves are
      attributed per-uid in the response (`results[]` with per-uid `uidMap`
      and any errors). Single-uid calls return the legacy response shape.
  - targetFolder: Destination folder name
  - createDestinationIfMissing: Create the destination folder if it does not exist (default: false)
  ```

- **imap_find_thread_messages**: Find inbox messages that belong to the same conversation threads as messages already sorted into another folder. Uses RFC 3501 HEADER search on In-Reply-To and References — works on any IMAP server.
  ```
  Parameters:
  - accountId: Account ID
  - sourceFolder: Folder containing the already-sorted thread messages
  - searchFolder: Folder to search for related messages (default: INBOX)
  - searchReferences: Also match the References header for multi-level threads (default: true)
  - includeBody: Include parsed message body for each found thread message
      (default: false). Same semantics as the `includeBody` option on
      `imap_search_emails` — one round-trip instead of N×`imap_get_email`.
  - bodyFormat: `markdown` (default), `text`, `html`, or `auto`.
  - bodyMaxLength: Per-field cap (default: 10000).
  ```

- **imap_download_attachment**: Download an email attachment (returns images inline, extracts text from PDFs, or saves to downloads directory)
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name (default: INBOX)
  - uid: Email UID
  - filename: Attachment filename or contentId
  - savePath: Optional file path to save the attachment to
  - extractText: For PDFs, extract and return text content inline (default: true)
  ```

- **imap_bulk_delete**: Delete multiple emails at once with chunking and auto-reconnection
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name (default: INBOX)
  - uids: Array of email UIDs to delete
  - chunkSize: Emails to delete per batch (default: 50)
  ```

- **imap_bulk_delete_by_search**: Search for emails matching criteria and delete them all
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name (default: INBOX)
  - from, to, subject: Search criteria (optional)
  - before, since: Date filters (optional)
  - chunkSize: Emails to delete per batch (default: 50)
  - dryRun: Preview what would be deleted without deleting (default: false)
  ```
  At least one concrete criterion (`from`, `to`, `subject`, `before`, or `since`)
  is required — a call with no criteria is refused, so it can never match and
  delete an entire folder.

- **imap_send_email**: Send a new email
  ```
  Parameters:
  - accountId: Account ID to send from
  - to: Recipient email address(es) — an array, or a single comma-separated string
  - subject: Email subject
  - text: Plain text content (optional)
  - html: HTML content (optional)
  - cc: CC recipients (optional)
  - bcc: BCC recipients (optional)
  - replyTo: Reply-to address (optional)
  - attachments: Array of attachments (optional)
    - filename: Attachment filename
    - content: Base64 encoded content
    - path: File path to attach
    - contentType: MIME type
    - contentDisposition: "attachment" (default) or "inline" — use "inline" for images shown in the HTML body via cid:
    - cid: Content-ID for inline attachments; must match the `cid:` value used in an `<img src="cid:...">` tag in `html`
  ```
  After sending, a copy is saved to the account's Sent folder (unless
  `saveToSent` is disabled on the account). The folder is resolved via the
  account's `sentFolder` override → the server's `\Sent` SPECIAL-USE flag →
  a list of known localized names ("Sent", "Gesendet", "Éléments envoyés", …).
  The response reports the outcome: `savedToSent` (boolean), `sentFolder`
  (the folder used), and — when the save fails — `sentSaveError` explaining
  why, instead of failing silently. The same applies to `imap_reply_to_email`
  and `imap_forward_email`.

  When the account has `defaultBcc` configured, those address(es) are always
  BCC'd on send, reply, forward, and draft (merged with any per-call `bcc`;
  duplicates removed case-insensitively).

- **imap_save_draft**: Save an email as a draft (no send). Takes the same fields as `imap_send_email`, plus `inReplyTo`, `references`, and an optional `folder` override for the Drafts folder.

- **imap_reply_to_email**: Reply to an existing email
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder containing the original email
  - uid: UID of the email to reply to
  - text: Plain text reply content (optional)
  - html: HTML reply content (optional)
  - replyAll: Reply to all recipients (default: false)
  - bcc: BCC recipients (optional; merged with account defaultBcc)
  - attachments: Array of attachments (optional, same shape as imap_send_email, including contentDisposition/cid for inline images)
  ```

- **imap_forward_email**: Forward an existing email
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder containing the original email
  - uid: UID of the email to forward
  - to: Forward to email address(es)
  - text: Additional text to include (optional)
  - bcc: BCC recipients (optional; merged with account defaultBcc)
  - includeAttachments: Include original attachments (default: true)
  ```

### Folder Operations

- **imap_list_folders**: List all folders
  ```
  Parameters:
  - accountId: Account ID
  ```
  Each folder includes its `attributes` (raw IMAP LIST flags) and, when the
  server advertises it, `specialUse` — the RFC 6154 role (`\Sent`, `\Drafts`,
  `\Trash`, `\Junk`, `\Archive`) that identifies a folder independent of its
  localized display name (e.g. "Gesendet" carries `specialUse: "\Sent"`).

- **imap_folder_status**: Get folder information
  ```
  Parameters:
  - accountId: Account ID
  - folder: Folder name

  Returns:
  - messages: { total, new, unseen } — from IMAP STATUS
  - uidvalidity, uidnext
  - flags, permanentFlags: string arrays
  - customKeywords: the mailbox's non-system keywords, usable as the
      `keywords` / `unKeywords` input of imap_search_emails
  ```

- **imap_create_folder**: Create a new IMAP folder/mailbox. Most servers also create any missing parent folders. Returns success even if the folder already exists.
  ```
  Parameters:
  - accountId: Account ID
  - folder: Full folder path to create (e.g. "Archives/2026/2026-05" or "INBOX.Archive")
  ```

- **imap_get_unread_count**: Count unread emails
  ```
  Parameters:
  - accountId: Account ID
  - folders: Specific folders (optional)
  ```

### Categorization and Auto-Filing

Classifies messages into categories (Finanzen, Shopping, Newsletter, Konto &
Sicherheit, Gesundheit, Dev/IT, Reisen, …) and optionally files them into
per-category folders.

Classification is **deterministic** — sender domain, sender mailbox name, subject
keywords, and mailing-list headers, no model call and no network lookup — so the
same mailbox always produces the same result, and a dry run is a trustworthy
preview of what the move will do. The rules themselves are data, not code: see
"Where the rules come from" below.

Scoring, against a default threshold of 6:

| Signal | Score |
|---|---|
| Sender domain, or a `List-Unsubscribe`/`List-Id` header | 10 |
| Strong subject keyword — wording that names the message type (`Rechnung`, `Sicherheitswarnung`, `Bestellbestätigung`) | 6 |
| Sender mailbox name (`rechnung@`, `versand@`) | 5 |
| Subject keyword | 3 |

So a domain hit classifies, as does a strong keyword; a mailbox name needs one
keyword alongside it, and a weak keyword needs a second signal. The two keyword
tiers exist because strength is a property of the word, not the category: a
subject saying "Ihre Rechnung" is an invoice, while "Whisky Seminar" merely
mentions a seminar and must not be filed as education.

Ties break by score, then category priority, then category id — never by rule
order. Domains match on host boundaries (`amazon.de` also matches
`mail.amazon.de`, never `notamazon.de`) and keywords at word starts, allowing
German compounds ("rechnung" matches "Rechnungsnummer", but "post" does not match
"Kompost").

Every decision is reported with its reasons (`domain:amazon.de`,
`subject!:rechnung` for a strong keyword, `sender:rechnung`, `subject:zahlung`,
`header:list-unsubscribe`), so a dry run can be reviewed rather than trusted.

**Where the rules come from.** The classifier ships no rules of its own; they
are layered from JSON at startup, so language, region and personal taste stay
separable:

| Layer | File | Holds |
|---|---|---|
| 1 | `presets/core.json` | Category ids, priorities, globally used sender domains (PayPal, GitHub, Netflix …), English labels, folder names and keywords |
| 2 | `presets/<locale>.json` | One language and country: labels, folder names, subject keywords, that country's providers |
| 3 | `~/.imap-mcp/categories.json` | Your own — the shop you buy from, the club you support, the hobby you collect |

A later layer **extends** an id it already knows: list fields merge, scalar
fields replace. So a locale preset restates only what differs from `core`, and
your file adds domains to `shopping` without repeating the category.

Pick the locale with `IMAP_MCP_CATEGORY_PRESET`; several can be combined,
comma-separated, applied left to right. Without it only `core` loads, which
gives English folder names and the globally valid domains:

```json
{
  "mcpServers": {
    "imap": {
      "command": "npx",
      "args": ["-y", "imap-mcp-server"],
      "env": { "IMAP_MCP_CATEGORY_PRESET": "de-DE" }
    }
  }
}
```

`imap_list_categories` shows the effective result after all layers.

**Contributing a locale.** Copy `presets/de-DE.json`, translate the labels,
folder names and keywords, and replace the domains with the providers of your
country — banks, carriers, utilities, authorities. Only override what differs;
everything else comes from `core`. Two rules the test suite enforces: `core`
must stay free of any single language or country (no `.de` domains, no
umlauts), and a locale preset may only extend categories `core` defines.

**Your own categories.** Everything past a service anyone might use is personal,
and a rule set that encodes it is a profile of its owner. Those belong in
`~/.imap-mcp/categories.json`, which is merged last and never travels with the
source:

```json
{
  "rules": [
    {
      "id": "shopping",
      "domains": ["my-favourite-shop.de"]
    },
    {
      "id": "club",
      "label": "⚽ Club",
      "folder": "Club",
      "priority": 47,
      "domains": ["my-club.de"],
      "strongSubjectKeywords": ["membership fee"],
      "subjectKeywords": ["matchday"]
    }
  ]
}
```

An entry whose `id` matches a known category extends it; any other `id` defines
a new one and needs `label`, `folder`, `priority`, `domains` and
`subjectKeywords`. A missing file is the normal case; a malformed one, or an
unknown preset name, is reported on stderr and skipped, so a broken
configuration never takes the server down.

- **imap_list_categories**: List the built-in categories — id, label, destination
  folder, matched domains and subject keywords, plus the scoring model. Call this
  to learn the ids before restricting the other two tools.
  ```
  Parameters: none
  ```

- **imap_categorize_emails**: Classify the newest messages in a folder. Read-only —
  nothing is moved, flagged, or deleted.
  ```
  Parameters:
  - accountId: Account ID (or accountName)
  - folder: Folder to examine (default: INBOX)
  - limit: Newest messages to examine, 1-500 (default: 100)
  - categories: Restrict to these category ids (optional)
  - minScore: Minimum score to assign a category (default: 6)
  - useHeaders: Fetch headers to detect mailing-list mail (default: true)
  - cursorKeyword: Progress marker; selects messages without this keyword
      instead of the newest ones (optional, read-only here)
  - sampleLimit: Examples per sample list, 1-200 (default: 20). Raise it when
      auditing the rule set — the uncategorized samples are what reveal
      missing domains and keywords.

  Returns per-category counts and percentages, sample messages with the
  reasons each category fired, and — for uncategorized mail — the best
  candidate that stayed below the threshold.
  ```

- **imap_sort_inbox**: File messages into per-category folders. **Dry run by
  default**: it reports the planned moves and changes nothing until `dryRun` is
  set to `false`. Messages below the threshold are never moved unless
  `moveUncategorizedTo` says where to put them. Moves are batched per destination
  folder, one call per category rather than one per message.
  ```
  Parameters:
  - accountId: Account ID (or accountName)
  - folder: Source folder (default: INBOX)
  - limit: Newest messages to examine, 1-500 (default: 100)
  - categories: Restrict to these category ids (optional)
  - minScore: Minimum score to assign a category (default: 6)
  - useHeaders: Fetch headers to detect mailing-list mail (default: true)
  - dryRun: Report only, move nothing (default: true)
  - createFolders: Create a destination folder when missing (default: true)
  - folderPrefix: Prefix incl. delimiter for every category destination,
      e.g. "Archiv/" or "INBOX." (optional)
  - moveUncategorizedTo: Folder for messages that reach no category, as a full
      path — folderPrefix is not applied (optional; omit to leave them in place)
  - cursorKeyword: Progress marker; selects unmarked messages and marks what
      stays, so repeated calls work through the folder (optional)
  ```

  Preview first, then execute:

  ```
  imap_sort_inbox { "folder": "INBOX", "limit": 100 }                  → plan only
  imap_sort_inbox { "folder": "INBOX", "limit": 100, "dryRun": false } → moves
  ```

  **Re-sorting mail that was filed wrongly.** `folder` is any folder, not just
  INBOX — point it at a category folder to re-classify what is already in there.
  Messages whose category still matches the folder they are in are reported under
  `skippedAlreadyInTargetFolder` and left untouched; only the misfiled ones move.
  Add `moveUncategorizedTo` so mail that no longer belongs to any category goes
  back to the inbox instead of staying stuck in the wrong folder:

  ```
  imap_sort_inbox { "folder": "Finanzen", "limit": 500, "moveUncategorizedTo": "INBOX" }
  imap_sort_inbox { "folder": "Finanzen", "limit": 500, "moveUncategorizedTo": "INBOX", "dryRun": false }
  ```

  **Working a folder through to the end.** Both tools take the *newest* `limit`
  messages by default. That is the right window for an inbox, but it cannot
  drain a folder: messages the rules do not match stay put, fill the newest-N
  window again on the next call, and the older ones are never reached.

  Pass `cursorKeyword` to select "messages not carrying this keyword" instead.
  `imap_sort_inbox` marks whatever stayed in the folder, so the next call gets
  the next batch and the folder eventually reports `totalExamined: 0`:

  ```
  imap_sort_inbox { "folder": "Unsortiert", "limit": 500,
                    "cursorKeyword": "$imapmcpChecked", "dryRun": false }
  ```

  ```
  run 1: examined 500, moved 11, marked 489
  run 2: examined 500, moved  4, marked 496
  run 3: examined 131, moved  0, marked 131
  run 4: examined   0   ← done
  ```

  Only messages that stay are marked; moved ones have left the folder, and a
  *failed* move is deliberately left unmarked so a transient error does not
  exclude a message forever. `imap_categorize_emails` reads the cursor to pick
  its batch but never writes it, so it stays read-only.

  A custom keyword is used rather than the `\Seen` flag on purpose: read state
  is user-visible and means something else, and marking a folder unread to track
  progress would both destroy genuine unread status and light up an unread badge
  in every mail client. Keywords are the IMAP mechanism for application
  bookkeeping and are invisible in most clients. Your server must accept them —
  `imap_folder_status` shows `\*` in `permanentFlags` when it does.

  On Windows PowerShell the keyword needs single quotes — unquoted, the
  leading `$` is read as a variable and expands to nothing, which would
  silently fall back to the newest-N window. An empty value is rejected so
  that mistake fails loudly:

  ```powershell
  imap imap_sort_inbox folder=Unsortiert limit=500 'cursorKeyword=$imapmcpChecked'
  ```

  After changing rules, clear the marker to re-examine everything:

  ```
  imap_search_emails  { "folder": "Unsortiert", "keywords": ["$imapmcpChecked"] }
  imap_remove_keyword { "folder": "Unsortiert", "uid": [...], "keyword": "$imapmcpChecked" }
  ```

## Security

- Credentials are encrypted using AES-256-CBC encryption
- Encryption keys are stored separately in `~/.imap-mcp/.key`
- Account configurations are stored in `~/.imap-mcp/accounts.json`
- The store directory, `.key`, and `accounts.json` are written owner-only
  (`0700`/`0600`) so other local users cannot read the key or the credentials
- The web setup wizard's HTTP API never returns stored passwords to the browser
- Downloaded attachments are confined to the downloads directory; sender-supplied
  filenames cannot write outside it
- Never commit or share your encryption key or account configurations

## Development

### Running in Development Mode

```bash
npm run dev
```

### Building

```bash
npm run build
```

### Project Structure

```
src/
├── index.ts           # MCP server entry point
├── services/
│   ├── imap-service.ts    # IMAP connection management
│   ├── smtp-service.ts    # SMTP service for sending emails
│   └── account-manager.ts # Account configuration
├── tools/
│   ├── index.ts          # Tool registration
│   ├── account-tools.ts  # Account management tools
│   ├── email-tools.ts    # Email operation tools (including send/reply/forward)
│   └── folder-tools.ts   # Folder operation tools
└── types/
    └── index.ts          # TypeScript type definitions
```

## Example Usage in Claude

1. **Add an account:**
   "Add my Gmail account with username john@gmail.com"

2. **Check new emails:**
   "Show me the latest 5 emails from my Gmail account"

3. **Search emails:**
   "Search for emails from boss@company.com in the last week"

4. **Send an email:**
   "Send an email to client@example.com with subject 'Project Update'"

5. **Reply to emails:**
   "Reply to the latest email from my boss"

6. **Forward emails:**
   "Forward the email with subject 'Meeting Notes' to team@company.com"

7. **Move an email:**
   "Move the invoice email from INBOX to my Taxes folder"

8. **Manage folders:**
   "List all folders in my email account and show unread counts"

## Troubleshooting

### Connection Issues

- Ensure your IMAP server settings are correct
- Check if your email provider requires app-specific passwords
- Verify that IMAP is enabled in your email account settings
- For sending emails, ensure your account has SMTP access enabled

### Recipients arriving as `["a@x.com","b@y.com"]`

`to`, `cc`, `bcc`, `references` and `uid` accept either a single value or an
array. In JSON Schema that is an `anyOf`, and some MCP clients drop the `anyOf`
before showing the schema to the model — the field then looks untyped or
string-typed, and the client serializes the model's array into a string. The
server used to pass that string straight to nodemailer, which folded the
literal `[` and `]` into the first and last address, so every recipient was
rejected by the receiving mail server (issue #127).

The server now detects a stringified array and restores it, both when
validating tool input and again before composing the message, and logs a
warning to stderr naming the field. Nothing needs to change on your side. If
you want to bypass the client behavior entirely, pass recipients as one
comma-separated string: `"Alice <alice@example.com>, Bob <bob@example.org>"`.

### SMTP Configuration

The server automatically configures SMTP settings based on your IMAP provider. If you need custom SMTP settings, you can specify them when adding an account:

```json
{
  "smtp": {
    "host": "smtp.example.com",
    "port": 587,
    "secure": false
  }
}
```

### Common IMAP Settings

- **Gmail**: 
  - Host: imap.gmail.com
  - Port: 993
  - Requires app-specific password

- **Outlook/Hotmail**:
  - Host: outlook.office365.com
  - Port: 993

- **Yahoo**:
  - Host: imap.mail.yahoo.com
  - Port: 993
  - Requires app-specific password

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
