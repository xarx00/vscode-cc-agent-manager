# Session ID Copy — Design Spec

**Date:** 2026-03-26
**Status:** Approved

## Overview

Add a clickable hash button to the conversation header breadcrumb so users can copy session IDs (and agent IDs) to the clipboard — either as a raw ID or as a ready-to-run `claude -c <id>` command.

## Breadcrumb Structure

The breadcrumb currently sets `textContent` as a plain string. This changes to structured HTML with individually rendered segments.

**Session view:**
```
vscode-agent-manager / [7ed5b864…]
```

**Agent view:**
```
vscode-agent-manager / [7ed5b864…] / [a3f2c1d8…]
```

Each `[hash…]` segment is a `<button class="hash-btn">` element containing:
- Visible text: `sessionId.slice(0, 8) + '…'` (or `agentId.slice(0, 8) + '…'`)
- `data-id` attribute: the full ID

The agent segment shows the agent's short hash instead of the word "agent", making it clearly interactive and identifying what will be copied.

Slash separators and the project name remain plain `<span>` elements. The breadcrumb element changes from a `<span>` to a `<div>` with `display: flex; align-items: center; gap: 4px` so segments sit inline.

## Dropdown

A single shared `<div id="hash-dropdown">` lives in the document (created once, reused). Clicking any `hash-btn` repositions and reveals it below the button.

**Contents:**
```
┌─────────────────────────┐
│ Copy ID                 │
│ Copy claude -c <hash>   │
└─────────────────────────┘
```

**Behavior:**
- Only one dropdown open at a time — opening a new one closes any existing one
- Dismissed by: clicking outside, pressing `Escape`, or clicking an item
- On item click: write to clipboard via `navigator.clipboard.writeText()`, show "Copied!" on the button for 1.5s, then dismiss
- Positioned via `getBoundingClientRect()` relative to the button; `position: fixed` so it clears any overflow constraints

## Styling

### `hash-btn`
- Inherits breadcrumb font/color: monospace, 12px, `var(--vscode-descriptionForeground)`
- No button chrome: `background: none; border: none; padding: 0; cursor: pointer`
- Hover: `text-decoration: underline` + slightly brighter color (`var(--vscode-foreground)`)
- "Copied!" state: text temporarily changes to "Copied!" at same size; no extra layout shift

### `hash-dropdown`
- `position: fixed; z-index: 1000`
- Background: `var(--vscode-menu-background)`
- Foreground: `var(--vscode-menu-foreground)`
- Border: `1px solid var(--vscode-menu-border)`
- `box-shadow` for depth
- `border-radius: 4px`
- `min-width: 180px`

### `hash-dropdown-item`
- `padding: 5px 10px; cursor: pointer; font-size: 12px`
- Hover: `background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground)`

## Implementation Scope

All changes are confined to two files:

- **`media/main.js`** — `selectConversation()` builds breadcrumb HTML instead of setting `textContent`; dropdown creation, positioning, and clipboard logic added
- **`media/style.css`** — Three new rule blocks: `.hash-btn`, `#hash-dropdown`, `.hash-dropdown-item`

No changes to `agentManagerPanel.ts`, `claudeReader.ts`, or `types.ts`. No new extension-host message types.

## Acceptance Criteria

- [ ] Clicking the session hash in the breadcrumb opens a dropdown with "Copy ID" and "Copy `claude -c <id>`"
- [ ] Clicking the agent hash in an agent-view breadcrumb opens the same dropdown for the agent ID
- [ ] Selecting an option copies the correct string to the clipboard
- [ ] The button shows "Copied!" for ~1.5s after a successful copy
- [ ] Only one dropdown is open at a time
- [ ] Clicking outside or pressing Escape dismisses the dropdown
- [ ] The hash button is visually unstyled (no button chrome) and signals interactivity only on hover
- [ ] Styling uses VS Code theme variables throughout
