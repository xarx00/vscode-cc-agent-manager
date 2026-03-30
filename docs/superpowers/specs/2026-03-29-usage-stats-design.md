# Usage Stats — Design Spec

**Date:** 2026-03-29
**Status:** Approved
**Superpower:** Usage Stats (quick win)

## Overview

Add a per-project usage stats view as the first "superpower" feature. This introduces a tab bar at the top of the main panel for switching between views (Sessions, Stats) and a synthetic "All sessions" entry at the top of the sidebar for global stats. Tool frequency, session activity, and duration metrics are computed client-side from data already available in the webview.

## Navigation: Tab Bar + Sidebar

### Layout

```
[Sidebar]                [Main Panel]
┌──────────────────┐ ┌──[Sessions] [Stats]──────────────┐
│ ▸ All sessions   │ │                                   │
│ ─────────────    │ │  Content determined by:            │
│ ▸ Project A      │ │    active tab × sidebar selection │
│     session 1    │ │                                   │
│     session 2    │ │                                   │
│ ▸ Project B      │ │                                   │
│     session 3    │ │                                   │
└──────────────────┘ └───────────────────────────────────┘
```

Two independent axes:
- **Sidebar (left)**: what scope — a specific project, a session, or "All sessions"
- **Tab bar (top of main panel)**: what view — Sessions (conversation) or Stats

### Tab bar

A horizontal bar above the main panel content area, below the existing conversation header. Two tabs for now, extensible for future superpowers (Tips, Health, etc.).

```html
<div id="tab-bar">
  <button class="tab-btn active" data-tab="sessions">Sessions</button>
  <button class="tab-btn" data-tab="stats">Stats</button>
</div>
```

State: `let activeTab = 'sessions'`

### "All sessions" sidebar entry

A synthetic entry at the top of the project list, always visible, not tied to any project directory. Styled distinctly (no status dot, no collapse chevron).

```html
<div class="tree-all-sessions" data-action="select-all">
  All sessions
</div>
```

### Interaction matrix

| Sidebar selection | Sessions tab | Stats tab |
|---|---|---|
| All sessions | placeholder: "Select a session" | Global stats (all projects) |
| Project header | placeholder: "Select a session" | Project stats |
| Session | Conversation (loads via extension host) | Conversation (auto-switches to Sessions tab) |

Key rule: **clicking a session always shows its conversation and activates the Sessions tab**. This preserves the existing click-to-read flow regardless of which tab is active.

### Tab bar CSS

```css
#tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
  padding: 0 12px;
  flex-shrink: 0;
}

.tab-btn {
  padding: 6px 14px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s;
}

.tab-btn:hover {
  color: var(--vscode-foreground);
}

.tab-btn.active {
  color: var(--vscode-foreground);
  border-bottom-color: var(--vscode-focusBorder, #007acc);
}
```

### Narrow mode

No change to narrow mode behavior. The tab bar is part of the main panel, which is always visible. The sidebar overlay works as before.

## Data: Tool Counts

To display top tools per project, the session parser counts `tool_use` content items.

### types.ts

Add to `ClaudeSession` and `SubAgent`:

```typescript
toolCounts: Record<string, number>;
```

### claudeReader.ts — parseSession()

Inside the existing message loop, count tool_use items:

```typescript
const toolCounts: Record<string, number> = {};

for (const msg of messages) {
  // ... existing logic ...

  // Count tool uses in assistant messages
  if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
    for (const item of msg.message.content) {
      if (item.type === 'tool_use' && item.name) {
        toolCounts[item.name] = (toolCounts[item.name] || 0) + 1;
      }
    }
  }
}
```

Return `toolCounts` as part of the `ClaudeSession` object.

### parseSubAgent()

Same addition — count tool uses in subagent messages and add `toolCounts` to `SubAgent`.

## Stats View — Main Panel

When `activeTab === 'stats'` and a project (or "All") is selected, the main panel renders a stats dashboard.

### Header

Breadcrumb area shows:
```
project-name / Stats
```
or:
```
All sessions / Stats
```

### Sections

#### 1. Overview Cards (top row)

Four metric cards in a flex row:

| Card | Value | Subtitle |
|------|-------|----------|
| Sessions | `sessions.length` | "in last 30 days" |
| Messages | sum of all `session.messageCount` | "total" |
| Agents | sum of all `session.subAgents.length` | "spawned" |
| Avg Duration | mean of `(lastTimestamp - firstTimestamp)` | "per session" |

```css
.stats-cards {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  padding: 16px;
}

.stats-card {
  flex: 1;
  min-width: 120px;
  padding: 12px 16px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
  border-radius: 6px;
  text-align: center;
}

.stats-card-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.stats-card-label {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 4px;
}
```

#### 2. Top Tools (horizontal bar chart)

CSS-only bar chart — no charting library. Top 10 tools by total usage across all sessions in scope (including subagents).

Each bar:
```html
<div class="stats-bar-row">
  <span class="stats-bar-label">Bash</span>
  <div class="stats-bar-track">
    <div class="stats-bar-fill" style="width: 78%"></div>
  </div>
  <span class="stats-bar-count">342</span>
</div>
```

Bar width is `(count / maxCount) * 100%`. Bar color: `var(--vscode-progressBar-background)`.

```css
.stats-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}

.stats-bar-label {
  width: 80px;
  font-size: 12px;
  text-align: right;
  color: var(--vscode-foreground);
  flex-shrink: 0;
}

.stats-bar-track {
  flex: 1;
  height: 14px;
  background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.1));
  border-radius: 3px;
  overflow: hidden;
}

.stats-bar-fill {
  height: 100%;
  background: var(--vscode-progressBar-background, #007acc);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.stats-bar-count {
  width: 40px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  text-align: right;
  flex-shrink: 0;
}
```

#### 3. Sessions per Day (activity grid)

A GitHub-style contribution grid showing the last 30 days. Each cell is a day, colored by session count (0 = empty, 1 = light, 2-3 = medium, 4+ = dark).

```css
.stats-activity-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 14px);
  gap: 3px;
  padding: 16px;
}

.stats-activity-cell {
  width: 14px;
  height: 14px;
  border-radius: 2px;
  background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.1));
}

.stats-activity-cell[data-level="1"] { background: var(--vscode-progressBar-background); opacity: 0.3; }
.stats-activity-cell[data-level="2"] { background: var(--vscode-progressBar-background); opacity: 0.6; }
.stats-activity-cell[data-level="3"] { background: var(--vscode-progressBar-background); opacity: 0.85; }
.stats-activity-cell[data-level="4"] { background: var(--vscode-progressBar-background); opacity: 1; }
```

### Computation

All stats are computed in `media/main.js` from the `allProjects` array. A `computeStats(sessions)` function takes a flat array of sessions and returns:

```javascript
{
  sessionCount,
  totalMessages,
  totalAgents,
  avgDurationMin,
  toolCounts,       // Record<string, number> — merged from all sessions + subagents
  sessionsPerDay,   // Map<string, number> — "YYYY-MM-DD" → count
}
```

Callers pass either `project.sessions` (single project) or `allProjects.flatMap(p => p.sessions)` (global).

No new message types. No extension host changes beyond the `toolCounts` field.

## Resizable Sidebar

The sidebar width (currently fixed at 280px) becomes user-adjustable via a drag handle.

### Drag handle

A 4px-wide invisible hit zone on the right edge of the sidebar. On hover, a 1px visual divider appears. Dragging resizes the sidebar between 180px (min) and 500px (max).

```html
<div id="sidebar-resize-handle"></div>
```

Placed in `#app` between `#sidebar` and `#main-panel`.

### State

```javascript
let sidebarWidth = 280; // default
```

On drag end, the width is persisted via `vscode.setState()` / `vscode.getState()` so it survives panel reloads. The sidebar's CSS `width` is set inline via `style.width`.

### Behavior

- `mousedown` on handle → start tracking `mousemove` on `document`
- `mousemove` → set `sidebar.style.width` to clamped value (180–500px)
- `mouseup` → stop tracking, persist width
- During drag, add `user-select: none` on `body` and `pointer-events: none` on `#main-panel` to prevent text selection and iframe interference
- Double-click on handle → reset to 280px default

### CSS

```css
#sidebar-resize-handle {
  width: 4px;
  cursor: col-resize;
  flex-shrink: 0;
  background: transparent;
  transition: background 0.15s;
}

#sidebar-resize-handle:hover,
#sidebar-resize-handle.dragging {
  background: var(--vscode-focusBorder, #007acc);
}
```

The sidebar changes from `width: 280px` to `width: var(--sidebar-width, 280px)` (set inline via JS) and loses the fixed width rule.

### Narrow mode

When the panel width drops below 600px, the sidebar is hidden and the resize handle is not rendered. The overlay mechanism is unaffected.

## Icon Rail Removal

The existing icon rail (`#icon-rail`, visible only in narrow mode with per-project status dots) is removed. In narrow mode, the sidebar opens as an overlay triggered by a hamburger button or tap on the main panel header — existing behavior minus the dot rail.

## Implementation Scope

### Files changed

- **`src/types.ts`** — add `toolCounts: Record<string, number>` to `ClaudeSession` and `SubAgent`
- **`src/claudeReader.ts`** — count `tool_use` items in `parseSession()` and `parseSubAgent()`
- **`src/agentManagerPanel.ts`** — add `<div id="tab-bar">` and `<div id="sidebar-resize-handle">` in `_getHtml()`, remove `<div id="icon-rail">`
- **`media/main.js`** — tab bar logic, `activeTab` state, "All sessions" entry, `computeStats()`, `renderStats()`, project header click handler for stats, sidebar resize drag logic
- **`media/style.css`** — remove `.icon-rail*` rules, add `#tab-bar`, `.tab-btn`, `.stats-*`, `.tree-all-sessions`, `#sidebar-resize-handle` rules; change `#sidebar` width from fixed to variable

### Files NOT changed

- **`src/exporter.ts`** — no export of stats
- **`src/extension.ts`** — no new commands

## Acceptance Criteria

- [ ] A tab bar with "Sessions" and "Stats" tabs is visible at the top of the main panel
- [ ] "Sessions" tab is active by default and shows the existing conversation behavior
- [ ] Clicking the "Stats" tab highlights it and switches the main panel to stats view
- [ ] An "All sessions" entry appears at the top of the sidebar project list
- [ ] Clicking "All sessions" with Stats tab active shows global stats (all projects aggregated)
- [ ] Clicking a project header with Stats tab active shows that project's stats
- [ ] Overview cards show session count, total messages, total agents spawned, and average duration
- [ ] Top tools section shows a CSS bar chart of up to 10 most-used tools (including subagent tool usage)
- [ ] Activity grid shows session count per day for the last 30 days
- [ ] Clicking a session always opens its conversation and activates the Sessions tab
- [ ] Stats update on auto-refresh (30s timer) if the stats view is currently displayed
- [ ] The tab bar and stats view use VS Code theme variables throughout
- [ ] `toolCounts` is populated in `ClaudeSession` and `SubAgent` without breaking existing tests
- [ ] The icon rail is removed; narrow mode still works via the existing sidebar overlay mechanism
- [ ] The sidebar is resizable by dragging its right edge (180px–500px range)
- [ ] The resize handle shows a visual indicator on hover
- [ ] Double-clicking the resize handle resets the sidebar to 280px
- [ ] The sidebar width persists across panel refreshes via `vscode.getState()`
