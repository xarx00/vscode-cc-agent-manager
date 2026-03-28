# Testing Guide

## Overview

The extension uses **test-driven development**: write a failing test first, watch it fail, then write the minimal code to make it pass. Never write production code without a failing test — this applies to new features, bug fixes, and behaviour changes alike.

The extension has two test layers: **Jest** for unit tests (no VS Code required) and **Mocha + @vscode/test-electron** for integration tests (runs in the Extension Development Host).

## Running Tests

```bash
npm test                # unit + integration
npm run test:unit       # Jest only
npm run test:integration  # Mocha inside Extension Host
```

## Test Structure

```
src/test/
  unit/
    claudeReader.test.ts   ← Jest — parses JSONL, filters sessions
    exporter.test.ts       ← Jest — Markdown rendering, tool block formats
    webviewKeyboard.test.ts ← Jest — keyboard navigation logic
  integration/
    suite/
      extension.test.ts    ← Mocha — command registration, webview opens
      index.ts             ← Mocha suite entry
    runTest.ts             ← @vscode/test-electron launcher
```

## Unit Tests (Jest)

Tests mock the `fs` module — no filesystem access required. Each test file covers one source module.

### What to test

| Module | Test targets |
|---|---|
| `claudeReader.ts` | `readClaudeProjects`, `readConversation`, `decodeDirName` |
| `exporter.ts` | `exportConversation`, `renderToolBlock`, `formatToolInput`, `generateToolPreview`, `deduplicateLabels` |
| `media/main.js` | Keyboard navigation, panel focus logic |

### Key scenarios

- `readConversation`: string vs array `content`, tool_use/tool_result pairing, `isMeta` filtering, malformed JSONL skipped
- `readClaudeProjects`: sessions older than 30 days excluded, projects sorted by `lastActivity`, `decodeDirName` fallback
- `exportConversation`: `omit` / `compact` / `expanded` formats, agent sub-files with back-links, zero-message agents counted in `skippedAgents`

## Integration Tests (Mocha)

Run inside a live Extension Development Host. Cover only what requires the VS Code API.

- **Command registered** — `claudeAgentManager.openPanel` appears in `vscode.commands.getCommands()`
- **Panel opens** — executing the command confirms a webview tab in `vscode.window.tabGroups`

## TDD Workflow

1. **Write a failing test** that describes the expected behaviour. Run it and confirm it fails for the right reason (feature missing, not a syntax error).
2. **Write the minimal production code** to make the test pass — nothing more.
3. **Verify** the test passes and no existing tests regress.
4. **Refactor** if needed, keeping tests green.

For bug fixes specifically: reproduce the bug as a failing test *before* touching production code. The test proves the fix is correct and prevents regression.

## When Adding New Features

- Add or update unit tests for any new logic in `claudeReader.ts`, `exporter.ts`, or `media/main.js`
- Add integration tests only for new VS Code API interactions (commands, webview lifecycle)
- Keep unit tests free of VS Code imports — if a function needs `vscode`, it belongs in integration
- Exported helpers (e.g. `decodeDirName`, `renderToolBlock`) enable direct unit testing without mocking internals; export new helpers the same way
