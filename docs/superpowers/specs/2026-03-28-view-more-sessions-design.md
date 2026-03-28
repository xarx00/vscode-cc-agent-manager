# View More Sessions — Design Spec

**Date:** 2026-03-28
**Status:** Approved
**Issue:** [KyleJamesWalker/vscode-cc-agent-manager#12](https://github.com/KyleJamesWalker/vscode-cc-agent-manager/issues/12)

## Overview

Projects with many sessions currently show the 8 most recent and a non-interactive "+N older" label. This spec makes that label a clickable button that reveals sessions in batches of 8, with the batch count surviving panel auto-refreshes.

## State

Two module-level variables in `media/main.js`:

```js
/** @type {Map<string, number>} projectKey → number of extra batches loaded (0 = default 8) */
const expandedBatchCounts = new Map();

/** @type {Array} cached project list for targeted re-renders */
let allProjects = [];
```

`allProjects` is populated on each incoming data message (hoisted from the render function). `expandedBatchCounts` is never reset by data refreshes — only by panel close/reopen, which is acceptable since sessions with new activity naturally move to the top 8.

## renderProject() Changes

Replace the existing 2-line slice + static overflow div:

```js
const batchCount = expandedBatchCounts.get(project.key) || 0;
const visibleCount = 8 + batchCount * 8;
const visibleSessions = project.sessions.slice(0, visibleCount);
const remaining = project.sessions.length - visibleSessions.length;
```

The overflow element changes from a non-interactive `<div>` to a `<button>`:

```html
${remaining > 0
  ? `<button class="btn-load-more" data-action="load-more" data-key="${esc(project.key)}">Load 8 more (${remaining} remaining)</button>`
  : ''}
```

## Click Handler

Added to the existing `data-action` event delegation block:

```js
if (action === 'load-more') {
  const key = elTyped.dataset.key;
  expandedBatchCounts.set(key, (expandedBatchCounts.get(key) || 0) + 1);
  const projData = allProjects.find(p => p.key === key);
  if (projData) {
    const el = projectList.querySelector(`.tree-project[data-key="${CSS.escape(key)}"]`);
    if (el) el.outerHTML = renderProject(projData);
  }
}
```

No message to the extension host. The targeted `outerHTML` swap re-renders only the affected project, keeping the interaction snappy and avoiding any full-list flicker.

## Styling

In `media/style.css`, remove the `.tree-overflow` rule and add:

```css
.btn-load-more {
  display: block;
  margin: 2px 0 3px 28px;
  padding: 1px 7px;
  font-size: 10px;
  cursor: pointer;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: 1px solid var(--vscode-widget-border);
  border-radius: 3px;
}
.btn-load-more:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}
```

## Implementation Scope

All changes confined to two files:

- **`media/main.js`** — `allProjects` hoist, `expandedBatchCounts` state, `renderProject()` slice logic, `load-more` click handler case
- **`media/style.css`** — remove `.tree-overflow`, add `.btn-load-more`

No changes to `agentManagerPanel.ts`, `claudeReader.ts`, or `types.ts`.

## Acceptance Criteria

- [ ] Projects with more than 8 sessions show a "Load 8 more (N remaining)" button below the last visible session
- [ ] Clicking the button reveals the next 8 sessions and updates the remaining count
- [ ] When all sessions are visible, the button is not rendered
- [ ] The expanded batch count survives the 30s auto-refresh and file-watcher refreshes
- [ ] Sessions with new activity continue to appear in their sorted position (no special handling needed — `project.sessions` is already sorted by recency)
- [ ] The button uses VS Code theme variables for colors and border
- [ ] No changes required to the extension host
