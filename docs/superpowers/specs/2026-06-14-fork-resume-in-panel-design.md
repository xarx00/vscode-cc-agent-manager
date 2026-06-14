# Fork-Resume in the Native Panel — Design Spec

**Date:** 2026-06-14
**Status:** Approved

## Overview

The "Open in Claude Code" action (the breadcrumb hash dropdown's "Resume session" item) was
meant to resume a past session in the native Claude Code editor panel. It does not work: clicking
it opens a fresh, empty conversation instead of resuming the requested session.

This spec replaces the broken true-resume attempt with a **fork-resume**: open a fresh Claude Code
panel whose chat input is **pre-filled** with a prompt instructing Claude to read the prior
session's transcript from disk and continue. Not a true resume — a fork/reconstruction — but it
lives in the native panel, which is the desired UX.

## Root Cause (confirmed)

Verified from CC's bundled extension code, official GitHub issues, and a live test (2026-06-14):

- `claude-vscode.editor.open(sessionId, initialPrompt, viewColumn)` hands `sessionId` to the
  webview as `data-initial-session`. On boot the webview calls
  `activateSessionFromServer(sessionId, initialPrompt)`, which only finds sessions the CC
  server/UI currently knows (recent/live). For a **historical** session it returns `false`, so the
  webview falls back to `createSession()` — a brand-new conversation.
- Resuming an arbitrary historical session in the panel is **not implemented**
  ([#40169](https://github.com/anthropics/claude-code/issues/40169), closed as duplicate). Only
  `claude --resume <id>` in a terminal truly resumes historical sessions.
- Live test: opening a historical session produced a blank tab, no writes to its transcript, no
  new project session file.

**Key opening:** the webview **does use `initialPrompt`** — in every boot branch it ends up calling
`createSession()` then `setInputText(initialPrompt)`, pre-filling the chat input of the fresh
conversation. It does **not** auto-send (no `.submit()`), so the user presses Enter once.

## Approach

Pass both arguments to `editor.open`:

- `sessionId` — so the *rare* case where the session is still live/recent →
  `activateSessionFromServer` succeeds → genuine resume.
- `initialPrompt` — a fork-resume prompt built by a pure `buildForkResumePrompt(sessionId)`. For
  the common historical case the webview pre-fills this prompt; Claude reads the
  `<sessionId>.jsonl` transcript itself (it locates the file under `~/.claude/projects` from the
  id — no path resolution needed on our side) and continues.

A non-modal info toast tells the user to press Enter, since CC does not auto-send.

### Injected prompt (draft)

> This is a continuation of an earlier Claude Code session (id `<SESSION_ID>`). If that
> conversation is not already loaded in this tab, first locate and read its transcript — the
> `<SESSION_ID>.jsonl` file under your `~/.claude/projects` directory (JSONL: one message/tool
> record per line) — briefly summarize where we left off, then continue from there. Treat it as our
> prior conversation and pick up the work.

The wording is a near no-op when the session genuinely resumes ("if that conversation is not
already loaded").

## Implementation Scope

- **`src/claudeCodeLauncher.ts`** — add a pure `buildForkResumePrompt(sessionId: string): string`.
  No transcript-path resolution.
- **`src/test/unit/claudeCodeLauncher.test.ts`** — new failing-first tests for the prompt builder.
- **`src/agentManagerPanel.ts`** — `_openInClaudeCode` passes `(sessionId, prompt)` to
  `CLAUDE_CODE_OPEN_COMMAND` and shows the press-Enter info toast. The `no-extension` clipboard
  fallback and the `catch` clipboard fallback stay. The `wrong-project` cwd check is no longer
  needed for this path (only the session id matters); `_findSessionCwd` may stay for other callers.
- **`media/main.js`** — relabel the dropdown action so it reads as a fork-resume.

## Acceptance Criteria

- [ ] Clicking the action opens a CC editor panel whose chat input is pre-filled with a prompt
      that contains the session id and instructs Claude to locate/read the prior session transcript.
- [ ] A non-modal info toast tells the user to press Enter to continue (CC does not auto-send).
- [ ] If the CC extension command is unavailable, `claude -r <id>` is copied to the clipboard with
      a non-modal warning.
- [ ] `buildForkResumePrompt(sessionId)` is a pure function: returns a string containing the
      session id, instructs locating/reading the prior session transcript, and is safe-to-continue
      ("if not already loaded") when the session genuinely resumes.
- [ ] The prompt does **not** embed a resolved filesystem path — only the session id.
