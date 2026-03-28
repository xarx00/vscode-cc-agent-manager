# Templated Export Paths — Design Spec

**Date:** 2026-03-27
**Status:** Approved

---

## Overview

Replace the three hardcoded export destination options (Save As dialog, default folder, session working dir) with a single user-editable path template. The template supports tokens sourced from session metadata (date, slug, project, branch, etc.), enabling use cases such as organizing exports into an Obsidian vault by date, week, or project. Three preset buttons restore classic behaviors. A separate checkbox toggles Obsidian-native wiki link syntax.

---

## Architecture & Data Flow

1. User clicks **Export** — same trigger as before.
2. Webview posts `exportChat` with `{ projectKey, sessionId }` — unchanged.
3. `agentManagerPanel._handleExportChat` reads `settings.exportTemplate` from `globalState`.
   - If the template value is the sentinel `"dialog"`, fall through to `_showSaveDialog` as before.
   - Otherwise, call the new `expandTemplate()` to resolve the full output path, then handle collisions.
4. `exportConversation()` receives the resolved `rootPath` plus `settings.exportLinkStyle` and writes files — same as today.
5. Notification and `exportDone` flow are unchanged.

---

## Settings Changes

### Removed

`exportDestination: 'dialog' | 'default' | 'cwd'` is removed from `ManagerSettings`.

### Added

```typescript
exportTemplate: string;           // default: "~/Documents/claude-exports/{slug}.md"
exportLinkStyle: 'markdown' | 'wiki'; // default: 'markdown'
```

### Migration

On first load after upgrade, if `exportDestination` is present in stored settings but `exportTemplate` is absent, auto-convert:

| Old value | New `exportTemplate` value |
|-----------|---------------------------|
| `'dialog'` | `"dialog"` |
| `'default'` | `"~/Documents/claude-exports/{slug}.md"` |
| `'cwd'` | `"{cwd}/{slug}.md"` |

After migration the old `exportDestination` key is left in `globalState` (harmless) — no cleanup needed.

---

## Template Expansion

A new exported function `expandTemplate(template, session, project)` lives in `src/exporter.ts`. It is pure (no I/O) and returns the resolved absolute path string.

### Sentinel value

If `template === "dialog"`, `expandTemplate` is never called — the caller detects this and shows the save dialog directly.

### Tilde expansion

A leading `~` is replaced with `os.homedir()` before token substitution.

### Token table

All date tokens are sourced from `session.lastTimestamp`. If `lastTimestamp` is absent, date tokens fall back to `session.firstTimestamp`. If both are absent, date tokens resolve to `"unknown"`.

| Token | Resolves to | Example |
|-------|-------------|---------|
| `{date}` | `YYYY-MM-DD` | `2026-03-27` |
| `{yyyy}` | 4-digit year | `2026` |
| `{yy}` | 2-digit year | `26` |
| `{mm}` | 2-digit month (01–12) | `03` |
| `{dd}` | 2-digit day (01–31) | `27` |
| `{slug}` | First-prompt slug, up to 50 chars (same logic as current `_exportFilename`) | `fix-auth-bug-in-login` |
| `{short-slug}` | First-prompt slug, up to 20 chars | `fix-auth-bug-in` |
| `{project}` | Project display name, slugified | `my-api-service` |
| `{branch}` | Git branch, slugified; empty string if none | `feature-auth` |
| `{session-id}` | First 8 chars of session ID | `a1b2c3d4` |
| `{cwd}` | Session working directory (`session.cwd`); empty string if absent | `/Users/bean/work/api` |

**Slugification** for `{project}` and `{branch}`: lowercase, replace non-alphanumeric runs with `-`, strip leading/trailing `-`.

### Invalid path fallback

After expansion, if the resolved path is empty, relative, or contains a path segment that is only whitespace or `-` (e.g. `{branch}` resolved to empty and left a dangling `//.md`), normalize by collapsing repeated separators and stripping empty segments. If the result is still not a valid absolute path, fall back to `_showSaveDialog` and show a warning: `"Export template resolved to an invalid path. Please update your export template in settings."`

---

## Collision Handling

After `expandTemplate` returns a valid absolute path, the root path is resolved by `resolveRootPath(basePath, content)` before writing:

1. If the file does **not** exist, use it as-is.
2. If it **does** exist and has **identical content** to what would be written, reuse the existing path (no duplicate produced).
3. If it exists with **different content**, try `basename-2.md`, `basename-3.md`, … up to `basename-99.md`, applying the same content-equality check at each candidate.
4. If all 99 suffixes are taken with different content, silently overwrite the base path.

Content-aware deduplication means that re-exporting an unchanged session produces the same file rather than a new numbered copy.

Agent files are always silently overwritten (same as today) — collision suffixing and content deduplication apply only to the root file.

---

## Agent File Naming

Unchanged from the original export spec. Agent files are derived from the resolved root path:

- Root: `/vault/claude/2026-03-27/my-session.md`
- Agents: `/vault/claude/2026-03-27/my-session-agent-{label}.md`

Agent filename deduplication (appending `-2`, `-3` for same-label agents) is unchanged.

---

## Link Style

`exportLinkStyle` controls how cross-links between root and agent files are rendered.

| Style | Root → Agent | Agent → Root |
|-------|-------------|--------------|
| `'markdown'` (default) | `- [label](./root-agent-label.md)` | `← [Back to session](./root.md)` |
| `'wiki'` | `- [[root-agent-label\|label]]` | `← [[root\|Back to session]]` |

Wiki links use the filename without extension (Obsidian resolves these vault-wide). Both `buildRootMarkdown` and `buildAgentMarkdown` accept `exportLinkStyle` and branch on it when constructing link strings.

---

## Settings UI

### Export destination section (replaces radio buttons)

```
Export path
[ ~/Documents/claude-exports/{slug}.md          ]   ← auto-resizing textarea

  [Ask each time]  [Default path]  [Session dir]    ← preset buttons

  ▸ Available tokens                                 ← collapsible hint
    {date}  {yyyy}  {yy}  {mm}  {dd}
    {slug}  {short-slug}  {project}
    {branch}  {session-id}  {cwd}
```

- The template input is an **auto-resizing `<textarea>`** (not `<input type="text">`). It grows to fit long paths and shrinks when text is removed. Enter key is suppressed to prevent inserting literal newlines into path strings.
- The input syncs to `settings.exportTemplate` on every `input` event (not `change`), so settings update on each keystroke.
- **Token chips are clickable.** Each `{token}` in the collapsible hint is a styled chip; clicking one inserts the token text at the last known cursor position. The cursor position is captured on `blur` so token clicks (which steal focus) still insert in the right place. If the cursor is inside an existing `{…}` token, the chip is inserted after the closing `}`. If the field has never been interacted with, the token is inserted before the `.md` extension.
- **Ask each time** sets the field to `dialog`.
- **Default path** sets the field to `~/Documents/claude-exports/{slug}.md`.
- **Session dir** sets the field to `{cwd}/{slug}.md`.
- The collapsible hint is a `<details>`/`<summary>` element inline in the settings panel.
- Settings are **not synced** from extension → webview during auto-refresh while the settings panel is open. This prevents the user's in-progress edits (cursor position, typed text) from being reset mid-edit.

### Obsidian links checkbox

```
☐ Use Obsidian wiki links ([[…]])
```

Appears below the template input, within the Export Settings section. Syncs to `settings.exportLinkStyle` (`checked` = `'wiki'`, unchecked = `'markdown'`).

---

## Error Handling

| Situation | Behaviour |
|-----------|-----------|
| Template is `"dialog"`, user cancels Save As | Silent abort; `exportDone` posted |
| Template expands to invalid path | Warning message shown; fall back to `_showSaveDialog`; `exportDone` posted |
| `{cwd}` resolves empty and path becomes invalid | Same invalid-path fallback |
| Root file collision, suffix `-2`–`-99` all taken | Silently overwrite the base path |
| Directory creation fails | `showErrorMessage`; `exportDone` posted |
| Any file write fails | `showErrorMessage`; `exportDone` posted |
| `exportDone` guarantee | Always posted — success, failure, or cancellation |

---

## Components Changed

| File | Change |
|------|--------|
| `src/types.ts` | Remove `exportDestination`; add `exportTemplate: string` and `exportLinkStyle: 'markdown' \| 'wiki'` to `ManagerSettings` |
| `src/exporter.ts` | Add `expandTemplate(template, session, project)` (pure, exported); pass `exportLinkStyle` through to `buildRootMarkdown` / `buildAgentMarkdown`; update link rendering |
| `src/agentManagerPanel.ts` | Replace destination switch with `expandTemplate` + `resolveRootPath` (content-aware) in `_resolveExportPath`; remove `_exportFilename` (logic moves into `expandTemplate` via `{slug}` token); update `DEFAULT_SETTINGS` to use `exportTemplate: "~/Documents/claude-exports/{slug}.md"` and `exportLinkStyle: 'markdown'`; add settings migration on load |
| `media/main.js` | Replace destination radios with auto-resizing template textarea + 3 preset buttons + collapsible token hint with clickable chips; add wiki links checkbox; wire all to `pushSettings` on `input`/`change`; skip settings sync from extension during auto-refresh while settings panel is open |
| `media/style.css` | Style template input, preset buttons, collapsible hint, checkbox row |
| `README.md` | Document all available template tokens, the three preset values, the wiki links option, and example templates (Obsidian vault by date, by week using `{yyyy}/W{…}` workaround, session dir) |

---

## Acceptance Criteria

- [ ] `exportDestination` radio buttons are replaced by a template text input with 3 preset buttons
- [ ] Default template is `~/Documents/claude-exports/{slug}.md`; behavior matches previous `default` mode exactly
- [ ] **Ask each time** preset sets template to `"dialog"` and triggers save dialog on export
- [ ] **Default path** preset restores `~/Documents/claude-exports/{slug}.md`
- [ ] **Session dir** preset sets template to `{cwd}/{slug}.md`; falls back to dialog if `{cwd}` is empty
- [ ] All tokens in the token table resolve correctly for a session with full metadata
- [ ] Date tokens fall back gracefully when `lastTimestamp` and `firstTimestamp` are both absent
- [ ] `{branch}` and `{cwd}` resolve to empty string (not `"undefined"` or `"null"`) when absent
- [ ] Root file collision: `-2` through `-99` suffix tried; silently overwrite base path if all taken
- [ ] Re-exporting an unchanged session reuses the existing file (content-aware dedup, no numbered copy)
- [ ] Invalid expanded path shows warning and falls back to dialog
- [ ] `exportLinkStyle: 'wiki'` produces `[[filename|label]]` links in both root and agent files
- [ ] `exportLinkStyle: 'markdown'` (default) produces `[label](./filename.md)` links — unchanged from before
- [ ] Wiki links checkbox syncs correctly to `exportLinkStyle` setting
- [ ] Collapsible token hint lists all available tokens
- [ ] Settings migration converts old `exportDestination` to equivalent `exportTemplate` on first load
- [ ] Agent file naming and deduplication are unchanged
- [ ] `exportDone` is always posted on success, failure, and cancellation
- [ ] README documents all tokens with examples

---

## Future State

The following improvements are out of scope for this spec but should be addressed in a follow-on:

- **VS Code `settings.json` support for all export settings** — move `exportTemplate`, `exportLinkStyle`, `exportToolFormat`, `soundEnabled`, and `soundRepeatSec` from `globalState` to `vscode.workspace.getConfiguration('claudeAgentManager')`. This enables VS Code Settings Sync across machines, workspace-level overrides, and discoverability in the VS Code settings editor.
- **Week token** — a `{week}` token (ISO week number, e.g. `13`) requires slightly more date math; deferred to keep this spec focused.
- **Per-session template override** — allow a one-off path choice at export time without changing the persistent setting.

---

## Out of Scope

- Exporting multiple sessions at once
- HTML or PDF output formats
- Batch rename / reorganize of previously exported files
