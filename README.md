# Claude Code Agent Manager

[![Version](https://img.shields.io/visual-studio-marketplace/v/KyleJamesWalker.vscode-cc-agent-manager?label=version&color=blue)](https://marketplace.visualstudio.com/items?itemName=KyleJamesWalker.vscode-cc-agent-manager)
[![License](https://img.shields.io/badge/license-MIT-green)](https://github.com/KyleJamesWalker/vscode-cc-agent-manager/blob/main/LICENSE)
[![VSCode Marketplace](https://img.shields.io/visual-studio-marketplace/i/KyleJamesWalker.vscode-cc-agent-manager?label=installs)](https://marketplace.visualstudio.com/items?itemName=KyleJamesWalker.vscode-cc-agent-manager)

> A live dashboard for your Claude Code sessions — monitor agents, send messages, and export conversations without leaving VSCode.

![screenshot](screenshot.png)

## Features

### 🔍 Monitor

- Browse all projects, sessions, and subagents across workspaces
- Live status indicators: active (green), waiting for input (orange pulse), recent (yellow), idle (gray)
- Filter chips: All / Active / Waiting / Pinned — with live counts
- Sound notifications when a session needs attention, with configurable repeat intervals (30s / 1m / 2m / 5m)

### 💬 Interact

- Send messages directly to any Claude session from the panel
- Automatically resumes a session in a new terminal if Claude is not already running
- Full conversation view with Markdown rendering and collapsible tool badges (Bash shows command, Read/Edit shows filename, Grep shows pattern + match count)
- Live-tailing — new messages appear automatically via file watcher

### 📤 Export

- Save any conversation to Markdown with one click
- **Templated export paths** — write a path template with tokens sourced from session metadata; the file is created automatically with no dialog
- **Clickable token chips** — click any token in the Available tokens hint to insert it at the cursor position in the template
- Three quick-access presets: **Ask each time** (save dialog), **Default path**, **Session dir**
- **Obsidian wiki links** — toggle `[[filename|label]]` syntax for cross-links between session and agent files
- Configurable tool output format: compact, expanded, or omit
- Re-exporting an unchanged session reuses the existing file rather than creating a numbered copy

#### Export path tokens

| Token | Resolves to | Example |
|-------|-------------|---------|
| `{date}` | `YYYY-MM-DD` | `2026-03-27` |
| `{yyyy}` | 4-digit year | `2026` |
| `{yy}` | 2-digit year | `26` |
| `{mm}` | 2-digit month | `03` |
| `{dd}` | 2-digit day | `27` |
| `{slug}` | First-prompt slug, up to 50 chars | `fix-auth-bug-in-login` |
| `{short-slug}` | First-prompt slug, up to 20 chars | `fix-auth-bug-in` |
| `{project}` | Project display name, slugified | `my-api-service` |
| `{branch}` | Git branch, slugified; empty if none | `feature-auth` |
| `{session-id}` | First 8 chars of session ID | `a1b2c3d4` |
| `{cwd}` | Session working directory; empty if absent | `/Users/you/work/api` |

Date tokens fall back to `session.firstTimestamp` if `lastTimestamp` is absent, and to `unknown` if both are absent. `{branch}` and `{cwd}` resolve to an empty string (never `"undefined"`) when not set.

#### Example templates

| Goal | Template |
|------|----------|
| Default (Documents folder) | `~/Documents/claude-exports/{slug}.md` |
| Obsidian vault organized by date | `~/vault/claude/{date}/{slug}.md` |
| Obsidian vault organized by year/month | `~/vault/claude/{yyyy}/{mm}/{slug}.md` |
| Session working directory | `{cwd}/{slug}.md` |
| Include project name | `~/exports/{project}/{date}-{slug}.md` |

## Installation

**Via Extensions panel** (recommended): Search `Claude Code Agent Manager` in the VSCode Extensions sidebar and click Install.

**Via command line:**

```
ext install KyleJamesWalker.vscode-cc-agent-manager
```

## Usage

Open the Agent Manager with `Cmd+Shift+A` (macOS) / `Ctrl+Shift+A` (Windows/Linux), or run `Claude: Open Agent Manager` from the Command Palette.

**Sidebar keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate up / down |
| `/` | Search |
| `p` | Pin / unpin |
| `?` | Help overlay |

---

<details><summary>For Developers</summary>

## Build

```bash
# Install dev dependencies
npm install

# Compile TypeScript to out/
npm run compile
```

There are no runtime dependencies — only devDependencies for TypeScript and type definitions.

## Run / Debug

1. Open this project in VSCode
2. Press **F5** to launch the Extension Development Host
3. In the new VSCode window, run **Claude: Open Agent Manager** from the Command Palette (`Cmd+Shift+A` / `Ctrl+Shift+A`)

The default build task (`npm run watch`) starts automatically on F5, recompiling on every save. Reload the Extension Development Host window to pick up changes.

## Package & Install Locally

```bash
# Build a .vsix file
npx @vscode/vsce package

# Install it
code --install-extension vscode-cc-agent-manager-0.1.0.vsix
```

Or in VSCode: **Extensions** sidebar > `...` menu > **Install from VSIX...**.

## Project Structure

```
src/
  extension.ts          # Entry point — registers the openPanel command
  agentManagerPanel.ts  # Singleton webview panel, 30s auto-refresh, CSP-secured
  claudeReader.ts       # Parses JSONL session/subagent files from disk
  exporter.ts           # Renders conversations to Markdown
  types.ts              # ClaudeProject, ClaudeSession, SubAgent interfaces
media/
  main.js               # Webview client UI (vanilla JS, no framework)
  style.css             # Styles using VSCode theme variables
  marked.min.js         # Vendored Markdown parser (marked v17, GFM)
docs/
  architecture.md       # Data flow, lifecycle, design decisions
  data-model.md         # Types, JSONL format, filtering/status logic
  webview-ui.md         # Message protocol, UI components, sound system
  development.md        # Setup, build, packaging details
```

## How It Works

1. On activation, the extension registers the `claudeAgentManager.openPanel` command
2. Opening the panel creates a CSP-secured webview that reads `~/.claude/projects/`
3. Each project directory contains JSONL session files (and optional `subagents/` directories)
4. The reader parses messages, extracts metadata (git branch, first prompt, timestamps, tool usage), and derives session status
5. The webview refreshes every 30 seconds, updating status indicators and triggering sound notifications for newly waiting sessions

</details>

## License

MIT
