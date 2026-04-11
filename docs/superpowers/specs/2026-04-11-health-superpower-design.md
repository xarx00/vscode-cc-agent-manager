# Health Superpower — Design Spec

**Date:** 2026-04-11
**Status:** Approved
**Superpower:** Health Dashboard (hook validation)

## Overview

Add a "Health" tab to monitor the health of Claude Code hooks and detect silent failures before they bite. Hooks are powerful but fragile — a renamed file, missing dependency, syntax error, or broken script can fail silently. This superpower provides continuous visibility into hook ecosystem health via dry-run execution, dependency validation, stale hook detection, and visual status reporting.

The feature integrates into the existing tab bar introduced by the Usage Stats superpower, adding a third "Health" tab alongside "Sessions" and "Stats".

## Decisions Made

Based on issue #24 with silence = agreement:

- **Health check method**: Dry-run execution with empty `{}` stdin (proven in claude-cockpit, catches real failures that static analysis misses)
- **Check frequency**: On panel open + manual refresh button
- **Display location**: Dedicated "Health" tab in the webview panel (integrates with tab bar)
- **Scope**: Hooks only (PreToolUse, PostToolUse, SessionStop events)
- **Failure alerting**: Passive — visible when panel is open; no VS Code notifications

## Data Collection: Hook Scanning

### Hook Sources

Hooks are defined in `~/.claude/settings.json` under the `hooks` key. Claude Code supports two hook formats:

**Simple format** (paths only):
```json
{
  "hooks": {
    "PreToolUse": ["~/.claude/hooks/pre.sh"],
    "PostToolUse": ["~/.claude/hooks/post.sh"]
  }
}
```

**Complex format** (matcher-based, Claude Code's current format):
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/script.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "echo Done"
          }
        ]
      }
    ]
  }
}
```

The Health Superpower scans both formats and extracts executable paths from both.

### New Extension Host Function: `getHooksHealth()`

Add a new exported async function to `src/extension.ts`:

```typescript
export async function getHooksHealth(): Promise<HookHealthReport> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  const hooks = settings.hooks || {};

  const report: HookHealthReport = {
    timestamp: new Date().toISOString(),
    hooks: [],
    summary: { healthy: 0, warnings: 0, failures: 0 }
  };

  for (const [event, hookPaths] of Object.entries(hooks)) {
    for (const hookPath of hookPaths as string[]) {
      const expandedPath = hookPath.replace('~', os.homedir());
      const health = await checkHookHealth(expandedPath, event);
      report.hooks.push(health);

      if (health.status === 'healthy') report.summary.healthy++;
      else if (health.status === 'warning') report.summary.warnings++;
      else if (health.status === 'failure') report.summary.failures++;
    }
  }

  return report;
}

async function checkHookHealth(
  hookPath: string,
  event: string
): Promise<HookHealth> {
  const health: HookHealth = {
    path: hookPath,
    event,
    status: 'healthy',
    checks: [],
    lastRun: new Date().toISOString(),
    duration: 0
  };

  // Check 1: File existence
  if (!fs.existsSync(hookPath)) {
    health.status = 'failure';
    health.checks.push({
      name: 'File exists',
      status: 'failure',
      message: 'Hook file not found'
    });
    return health;
  }
  health.checks.push({
    name: 'File exists',
    status: 'success'
  });

  // Check 2: File readable
  try {
    fs.accessSync(hookPath, fs.constants.R_OK);
    health.checks.push({
      name: 'File readable',
      status: 'success'
    });
  } catch (e) {
    health.status = 'failure';
    health.checks.push({
      name: 'File readable',
      status: 'failure',
      message: 'No read permission'
    });
    return health;
  }

  // Check 3: Executable
  try {
    fs.accessSync(hookPath, fs.constants.X_OK);
    health.checks.push({
      name: 'Executable',
      status: 'success'
    });
  } catch (e) {
    health.status = 'warning';
    health.checks.push({
      name: 'Executable',
      status: 'warning',
      message: 'File is not executable (may work via shell)'
    });
  }

  // Check 4: Dry-run with empty input
  const startTime = Date.now();
  try {
    const result = await execPromise(
      `echo '{}' | "${hookPath}"`,
      { timeout: 5000, shell: '/bin/bash' }
    );
    health.duration = Date.now() - startTime;
    health.checks.push({
      name: 'Dry-run with empty input',
      status: 'success',
      message: `Completed in ${health.duration}ms`
    });
  } catch (e) {
    health.status = 'failure';
    health.duration = Date.now() - startTime;
    const errorMsg = (e as any).message || 'Unknown error';
    health.checks.push({
      name: 'Dry-run with empty input',
      status: 'failure',
      message: `Exit code ${(e as any).code || '?'}: ${errorMsg.slice(0, 100)}`
    });
  }

  return health;
}
```

### types.ts

Add new types:

```typescript
interface HookCheck {
  name: string;
  status: 'success' | 'warning' | 'failure';
  message?: string;
}

interface HookHealth {
  path: string;
  event: 'PreToolUse' | 'PostToolUse' | 'SessionStop';
  status: 'healthy' | 'warning' | 'failure';
  checks: HookCheck[];
  lastRun: string;   // ISO timestamp
  duration: number;  // milliseconds
}

interface HookHealthReport {
  timestamp: string;
  hooks: HookHealth[];
  summary: {
    healthy: number;
    warnings: number;
    failures: number;
  };
}
```

## Message Protocol

### New Panel Webview Messages

**Request: "getHooksHealth"**

Webview sends request to extension host to perform health checks.

```javascript
vscode.postMessage({
  command: 'getHooksHealth'
});
```

**Response: "hooksHealth"**

Extension replies with health report.

```javascript
{
  command: 'hooksHealth',
  payload: HookHealthReport
}
```

### Handler in agentManagerPanel.ts

```typescript
panel.webview.onDidReceiveMessage(async (msg) => {
  if (msg.command === 'getHooksHealth') {
    const health = await getHooksHealth();
    panel.webview.postMessage({
      command: 'hooksHealth',
      payload: health
    });
  }
});
```

## UI: Health Tab

### Tab Bar Integration

The existing tab bar gains a third button:

```html
<div id="tab-bar">
  <button class="tab-btn active" data-tab="sessions">Sessions</button>
  <button class="tab-btn" data-tab="stats">Stats</button>
  <button class="tab-btn" data-tab="health">Health</button>
</div>
```

### Health Dashboard Layout

When `activeTab === 'health'`:

```
┌─ Health ──────────────────────────────────────────┐
│ ┌─ Summary ─────────────────────────────────────┐ │
│ │  ● Healthy: 3   ⚠ Warnings: 1   ✕ Failures: 2 │ │
│ │                                    [Refresh]  │ │
│ └───────────────────────────────────────────────┘ │
│                                                   │
│ ┌─ Hooks ───────────────────────────────────────┐ │
│ │  ✓ PreToolUse: ~/.claude/hooks/pre.sh         │ │
│ │    ✓ File exists                              │ │
│ │    ✓ File readable                            │ │
│ │    ✓ Executable                               │ │
│ │    ✓ Dry-run: 43ms                            │ │
│ │                                               │ │
│ │  ⚠ PostToolUse: ~/.claude/hooks/post.sh       │ │
│ │    ✓ File exists                              │ │
│ │    ✓ File readable                            │ │
│ │    ⚠ Not executable (may work via shell)      │ │
│ │    ✓ Dry-run: 51ms                            │ │
│ │                                               │ │
│ │  ✕ SessionStop: ~/.claude/hooks/stop.sh       │ │
│ │    ✕ File not found                           │ │
│ │                                               │ │
│ └───────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

### Summary Section

```html
<div class="health-summary">
  <div class="health-stat healthy">
    <span class="health-icon">●</span>
    <span class="health-count">Healthy: 3</span>
  </div>
  <div class="health-stat warning">
    <span class="health-icon">⚠</span>
    <span class="health-count">Warnings: 1</span>
  </div>
  <div class="health-stat failure">
    <span class="health-icon">✕</span>
    <span class="health-count">Failures: 2</span>
  </div>
  <button id="health-refresh" class="health-refresh-btn">[Refresh]</button>
</div>
```

### Hook List

```html
<div class="health-hooks">
  <div class="health-hook" data-status="healthy">
    <div class="health-hook-header">
      <span class="health-hook-icon">✓</span>
      <span class="health-hook-title">PreToolUse</span>
      <span class="health-hook-path">~/.claude/hooks/pre.sh</span>
    </div>
    <div class="health-hook-details">
      <div class="health-check success">
        <span class="health-check-icon">✓</span>
        <span class="health-check-name">File exists</span>
      </div>
      <div class="health-check success">
        <span class="health-check-icon">✓</span>
        <span class="health-check-name">File readable</span>
      </div>
      <div class="health-check success">
        <span class="health-check-icon">✓</span>
        <span class="health-check-name">Executable</span>
      </div>
      <div class="health-check success">
        <span class="health-check-icon">✓</span>
        <span class="health-check-name">Dry-run: 43ms</span>
      </div>
    </div>
  </div>
</div>
```

### Styling

```css
.health-summary {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 12px 16px;
  background: var(--vscode-editor-background);
  border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
}

.health-stat {
  display: flex;
  gap: 6px;
  font-size: 12px;
  align-items: center;
}

.health-stat.healthy .health-icon { color: var(--vscode-testing-iconPassed, #6ca965); }
.health-stat.warning .health-icon { color: var(--vscode-testing-iconSkipped, #c9a747); }
.health-stat.failure .health-icon { color: var(--vscode-testing-iconFailed, #c33e1a); }

.health-refresh-btn {
  margin-left: auto;
  padding: 4px 8px;
  font-size: 11px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 3px;
  cursor: pointer;
}

.health-refresh-btn:hover {
  background: var(--vscode-button-hoverBackground);
}

.health-hooks {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.health-hook {
  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
  border-radius: 6px;
  overflow: hidden;
}

.health-hook[data-status="healthy"] { border-left: 3px solid var(--vscode-testing-iconPassed, #6ca965); }
.health-hook[data-status="warning"] { border-left: 3px solid var(--vscode-testing-iconSkipped, #c9a747); }
.health-hook[data-status="failure"] { border-left: 3px solid var(--vscode-testing-iconFailed, #c33e1a); }

.health-hook-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.1));
  cursor: pointer;
  user-select: none;
}

.health-hook-header:hover {
  background: var(--vscode-editor-selectionBackground, rgba(128,128,128,0.2));
}

.health-hook-icon {
  font-weight: bold;
  font-size: 13px;
}

.health-hook[data-status="healthy"] .health-hook-icon { color: var(--vscode-testing-iconPassed, #6ca965); }
.health-hook[data-status="warning"] .health-hook-icon { color: var(--vscode-testing-iconSkipped, #c9a747); }
.health-hook[data-status="failure"] .health-hook-icon { color: var(--vscode-testing-iconFailed, #c33e1a); }

.health-hook-title {
  font-weight: 500;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.health-hook-path {
  margin-left: auto;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  font-family: monospace;
}

.health-hook-details {
  display: none;
  padding: 8px 12px 10px;
  background: var(--vscode-editor-background);
  border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
}

.health-hook.expanded .health-hook-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.health-check {
  display: flex;
  gap: 6px;
  font-size: 11px;
  align-items: center;
  color: var(--vscode-foreground);
}

.health-check-icon {
  font-weight: bold;
  width: 16px;
  text-align: center;
}

.health-check.success .health-check-icon { color: var(--vscode-testing-iconPassed, #6ca965); }
.health-check.warning .health-check-icon { color: var(--vscode-testing-iconSkipped, #c9a747); }
.health-check.failure .health-check-icon { color: var(--vscode-testing-iconFailed, #c33e1a); }

.health-check-name {
  flex: 1;
}
```

## Behavior

### On Panel Open

When the panel opens or is refreshed:

1. Automatically call `getHooksHealth()` via webview message
2. Store result in `currentHealthReport` JavaScript variable
3. Display the cached report without blocking the UI
4. Set loading state if refresh is in progress

### On Refresh Button Click

Clicking `[Refresh]` button:

1. Disable the button and show "Refreshing..." state
2. Send `getHooksHealth` message to extension
3. Update UI with new results
4. Re-enable button when complete

### Hook Expansion

Clicking a `.health-hook-header` toggles `.expanded` class to show/hide `.health-hook-details`.

### Auto-Refresh

On the existing 30s auto-refresh timer, if the Health tab is currently active:

1. Call `getHooksHealth()` silently (no UI blocking)
2. Compare new report with cached report
3. If changed, update the UI

## Implementation Scope

### Files Changed

- **`src/types.ts`** — add `HookHealth`, `HookCheck`, `HookHealthReport` types
- **`src/extension.ts`** — add `getHooksHealth()`, `checkHookHealth()`, and `execPromise()` helper; register `getHooksHealth` message handler in `panel.webview.onDidReceiveMessage()`
- **`src/agentManagerPanel.ts`** — add third tab button in `_getHtml()` for Health tab
- **`media/main.js`** — add Health tab logic, `renderHealth()`, hook header click handlers, refresh button handler, message listeners for `hooksHealth` response
- **`media/style.css`** — add `.health-*` CSS rules for tab, summary, hooks, checks, colors

### Files NOT Changed

- **`src/exporter.ts`** — no export of health reports
- **`src/claudeReader.ts`** — no changes

## Acceptance Criteria

- [ ] A "Health" tab appears in the tab bar alongside "Sessions" and "Stats"
- [ ] Clicking the "Health" tab displays the health dashboard
- [ ] The Health tab auto-executes on first open (no manual refresh needed)
- [ ] A summary section displays counts of healthy, warning, and failure hooks
- [ ] A list of all hooks from `~/.claude/settings.json` is displayed
- [ ] Each hook shows its event type (PreToolUse, PostToolUse, SessionStop) and file path
- [ ] Each hook shows an icon indicating its overall status (✓ healthy, ⚠ warning, ✕ failure)
- [ ] Clicking a hook header expands/collapses its detailed checks
- [ ] Each check shows a status icon and message (success/warning/failure)
- [ ] File existence, readability, and executability are checked
- [ ] A dry-run with empty `{}` stdin is executed and the exit code/timing reported
- [ ] A [Refresh] button re-runs all checks
- [ ] Health checks use color coding consistent with VS Code testing icons
- [ ] The Health tab is responsive and uses VS Code theme variables
- [ ] Auto-refresh (30s) silently updates the Health tab if it's currently active
- [ ] Health data does not break existing test suites for other features
