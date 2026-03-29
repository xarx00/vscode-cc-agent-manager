# Prior Art & Superpowers Vision

## Origin story

Two earlier projects explored the space of augmenting Claude Code sessions with real-time tooling. Both are candidates for integration into vscode-cc-agent-manager as "superpowers" — features that go beyond session monitoring and turn the extension into a full Claude Code companion.

> I love it, and would love to work on it with you, to add some features I got lost into.

---

## Prior art

### Bashback (`~/code/bashback/`)

**Stack**: React + Node.js + Express + WebSocket + Tailwind CSS
**Concept**: real-time viewer of Bash commands executed by Claude Code, with pedagogical flag decomposition. "Get your bash reflexes back."

**Architecture**:
```
Claude Code → bashback-hook.sh → /tmp/bashback.log → Node.js (fs.watch) → WebSocket → React UI
```

**Implemented features (v1, production-ready, Docker + GHCR CI/CD)**:
- Hook interception via Claude Code's hook system (bash script + jq)
- Syntax-highlighted commands with operator tooltips (`&&`, `||`, `|`, `>`, `>>`)
- Flag decomposition via `--help` parsing
- Editable, saveable descriptions per command
- Privacy mode (masks IPs, credentials, tokens, home paths, hostnames)
- SSH transparency (shows remote commands inside SSH sessions)
- Heredoc collapse for readability
- Inline code detection (`node -e '...'`)
- Workspace detection by git root (non-git dirs shown in italics)
- Auto-scroll (toggleable), Clear button
- Docker deployment with multi-stage build

**Planned but not built**:
- Quiz mode — hide the command, show what it does, guess the syntax
- Stats — most frequent commands, never-seen flags
- Filters — by base command (grep, git, docker...)
- Session export — generate a markdown of the session's commands
- Local LLM — enriched explanations via Ollama

### Claude-Cockpit (`~/code/claude-cockpit/` — repo deleted, memory preserved)

**Stack**: Rust (axum) + React frontend
**Concept**: full dashboard of the Claude Code ecosystem — inventory, health, usage, tips, live commands.

**Architecture**:
```
cockpit-core (Rust lib) → cockpit-server (axum, REST + WS) → React frontend (5 tabs)
```

**Implemented features (Phase 1-3 complete)**:
- **Inventory** — auto-scan: skills (58), commands (35), agents (14), hooks (17), plugins, permissions
- **Health** — hook health checks (execute with `{}` stdin, verify exit code)
- **Usage** — stats grid, tool frequency bars, sessions list (parses `.tmp` markdown files)
- **Tips** — contextual advice system (TOML rules with AND conditions, error/warn/info levels)
- **Live** — real-time tail of `/tmp/cockpit.log` via WebSocket
- **API**: `GET /api/inventory`, `/api/health`, `/api/usage`, `/api/tips`, `/api/live`, `POST /api/refresh`
- **Frontend**: 5 tabbed panels (Inventory, Health, Usage, Tips, Live) with polling + WebSocket

**Planned but not built**:
- cockpit-tui — Ratatui terminal UI with 6 tabs
- `/cockpit` slash command in everything-claude-code
- Accurate unused-skills counting (was placeholder)
- Skill-name enrichment in observations data

---

## Vision: superpowers for vscode-cc-agent-manager

The extension already handles session monitoring. The superpowers below turn it into the single companion tool for anyone using Claude Code seriously. Each superpower is a self-contained feature module.

### 1. Bashback — "Get your bash reflexes back"

Study the bash commands Claude uses. Learn by osmosis during pair coding sessions.

- **Augmented bash history** — every command Claude runs, captured, timestamped, grouped by session/workspace
- **Man pages parsing** — automatic flag decomposition from `--help` / man pages, not a hardcoded map
- **Quiz mode** — hide the command, show the effect, guess the syntax. Spaced repetition optional.
- **Exercises** — generated drills based on commands you've never used or flags you've never seen

### 2. Yolobash — "Customizable intelligent permissions"

Replace the binary approve/deny with a smarter permission layer.

- **Rule-based auto-approve** — define patterns (e.g., "allow all `git status`", "allow `npm test` in this project")
- **Risk scoring** — flag destructive commands (`rm -rf`, `git push --force`) with visual warnings
- **Audit trail** — log of every approved/denied command with context
- **Learning mode** — suggest rules based on your approval patterns over time

### 3. Health — "Hooks health dashboard"

Continuous monitoring of the Claude Code hook ecosystem.

- **Hook health checks** — execute each hook with empty input, verify exit code and timing
- **Dependency validation** — check that hook dependencies (jq, python, etc.) are installed
- **Stale hook detection** — flag hooks that reference deleted files or deprecated config
- **Visual status** — green/yellow/red dots per hook, filterable

### 4. Usage stats

Analytics on how you and Claude Code work together.

- **Tool frequency** — which tools Claude uses most (Bash, Edit, Read, Grep...)
- **Session patterns** — duration, message count, tool diversity per session
- **Agent/subagent tracking** — which agents get spawned, how often, success rate
- **Trend visualization** — charts over time, spot changes in your workflow

### 5. Tips — "Curated Claude Code tips"

A contextual tip engine that nudges you toward better Claude Code usage.

- **TOML rule engine** — tips defined as declarative rules with conditions (AND logic)
- **Debug-inspired levels** — `error` / `warn` / `info` / `debug`, filterable
- **Custom asset awareness** — tips that reference YOUR agents, skills, commands, and hooks
- **Unused asset detection** — "You have a `tdd-guide` agent but haven't used it in 2 weeks"
- **Progressive disclosure** — tips adapt to your experience level over time

### 6. Grammar Nazi — "Get your grammar back"

Feedback on the quality of your prompts to Claude Code.

- **Prompt analysis** — clarity, specificity, ambiguity detection
- **Suggestion engine** — rewrite suggestions for vague or overly broad prompts
- **Pattern tracking** — recurring prompt anti-patterns (e.g., "fix it" without context)
- **Language quality** — grammar, spelling, and structure feedback (especially useful for non-native English speakers writing technical prompts)

---

## Shared infrastructure

All superpowers share:
- The existing webview panel system (new tabs or sub-panels)
- The JSONL session reader from `claudeReader.ts`
- The Claude Code hook system for real-time data capture
- The extension's CSP-secured webview and theme-aware styling
- The spec-driven development process (`docs/superpowers/specs/`)

## Strategy

Two-phase approach:

1. **Quick win: Usage Stats** — aggregate data already parsed by `claudeReader.ts` into a new webview section (top tools, sessions/day, average duration). No external deps, no hooks. Learns the webview/postMessage pattern.
2. **Fork proposal: Tips** — contextual tip engine with TOML rules, debug-inspired levels, and awareness of the user's custom agents/skills/hooks. Useful to all users, pure addition, proven in claude-cockpit. Target: upstream PR to KyleJamesWalker.
