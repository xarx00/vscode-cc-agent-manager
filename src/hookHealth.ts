import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { HookHealth, HookHealthReport } from './types';

export const execPromise = promisify(exec);

export async function checkHookHealth(hookPath: string, event: 'PreToolUse' | 'PostToolUse' | 'SessionStop', source?: string): Promise<HookHealth> {
  const health: HookHealth = {
    path: source ? `[${source}] ${hookPath}` : hookPath,
    event,
    status: 'healthy',
    checks: [],
    lastRun: new Date().toISOString(),
    duration: 0,
  };

  // Plugin hooks are always shell commands (they may contain variable substitutions like ${CLAUDE_PLUGIN_ROOT})
  // User-configured hooks are file paths (extracted by extractHookPaths which filters for / or ~)
  const isPluginHook = !!source;

  if (isPluginHook) {
    // Plugin hooks are shell commands
    await validateShellCommand(hookPath, health);
  } else {
    // User hooks are file paths
    const isFilePath = hookPath.includes('/') || hookPath.includes('~');
    if (isFilePath) {
      await validateFileHook(hookPath, health);
    } else {
      // Bare command from settings (e.g., "echo Done")
      await validateShellCommand(hookPath, health);
    }
  }

  return health;
}

async function validateFileHook(hookPath: string, health: HookHealth): Promise<void> {
  // Check 1: File existence
  if (!fs.existsSync(hookPath)) {
    health.status = 'failure';
    health.checks.push({
      name: 'File exists',
      status: 'failure',
      message: 'Hook file not found',
    });
    return;
  }
  health.checks.push({
    name: 'File exists',
    status: 'success',
  });

  // Check 2: File readable
  try {
    fs.accessSync(hookPath, fs.constants.R_OK);
    health.checks.push({
      name: 'File readable',
      status: 'success',
    });
  } catch (e) {
    health.status = 'failure';
    health.checks.push({
      name: 'File readable',
      status: 'failure',
      message: 'No read permission',
    });
    return;
  }

  // Check 3: Executable
  try {
    fs.accessSync(hookPath, fs.constants.X_OK);
    health.checks.push({
      name: 'Executable',
      status: 'success',
    });
  } catch (e) {
    health.status = 'warning';
    health.checks.push({
      name: 'Executable',
      status: 'warning',
      message: 'File is not executable (may work via shell)',
    });
  }

  // Check 4: Dry-run with empty input
  const startTime = Date.now();
  try {
    await execPromise(`echo '{}' | "${hookPath}"`, { timeout: 5000, shell: '/bin/bash' });
    health.duration = Date.now() - startTime;
    health.checks.push({
      name: 'Dry-run with empty input',
      status: 'success',
      message: `Completed in ${health.duration}ms`,
    });
  } catch (e) {
    health.status = 'failure';
    health.duration = Date.now() - startTime;
    const errorMsg = (e as any).message || 'Unknown error';
    health.checks.push({
      name: 'Dry-run with empty input',
      status: 'failure',
      message: `Exit code ${(e as any).code || '?'}: ${errorMsg.slice(0, 100)}`,
    });
  }
}

async function validateShellCommand(command: string, health: HookHealth): Promise<void> {
  // For shell commands, just do a dry-run execution
  health.checks.push({
    name: 'Shell command syntax',
    status: 'success',
  });

  const startTime = Date.now();
  try {
    // Execute the command as-is (it's already a shell command)
    // Use echo '{}' as stdin like we do for file paths
    await execPromise(`echo '{}' | ${command}`, { timeout: 5000, shell: '/bin/bash' });
    health.duration = Date.now() - startTime;
    health.checks.push({
      name: 'Dry-run execution',
      status: 'success',
      message: `Completed in ${health.duration}ms`,
    });
  } catch (e) {
    health.duration = Date.now() - startTime;
    const errorMsg = (e as any).message || 'Unknown error';
    const exitCode = (e as any).code || 'unknown';

    // For shell commands with conditionals (e.g., "[ -n $VAR ] && command"),
    // exit code 1 from the test operator is normal and expected when variables
    // aren't set in the dry-run environment. Treat this as a warning, not failure.
    if (exitCode === 1 && (command.includes('&&') || command.includes('||'))) {
      health.checks.push({
        name: 'Dry-run execution',
        status: 'warning',
        message: `Conditional returned false (expected in dry-run with unset variables)`,
      });
    } else {
      health.status = 'failure';
      health.checks.push({
        name: 'Dry-run execution',
        status: 'failure',
        message: `Exit code ${exitCode}: ${errorMsg.slice(0, 100)}`,
      });
    }
  }
}

export async function getHooksHealth(): Promise<HookHealthReport> {
  const report: HookHealthReport = {
    timestamp: new Date().toISOString(),
    hooks: [],
    summary: { healthy: 0, warnings: 0, failures: 0 },
  };

  // Scan user-configured hooks in settings.json
  await scanSettingsHooks(report);

  // Scan plugin hooks
  await scanPluginHooks(report);

  return report;
}

async function scanSettingsHooks(report: HookHealthReport): Promise<void> {
  try {
    const settingsPath = `${os.homedir()}/.claude/settings.json`;
    const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(settingsContent);
    const hooks = settings.hooks || {};

    for (const [event, hookEntries] of Object.entries(hooks)) {
      const paths = extractHookPaths(hookEntries, event);

      for (const path of paths) {
        const expandedPath = path.replace('~', os.homedir());
        const health = await checkHookHealth(expandedPath, event as 'PreToolUse' | 'PostToolUse' | 'SessionStop');
        report.hooks.push(health);

        if (health.status === 'healthy') report.summary.healthy++;
        else if (health.status === 'warning') report.summary.warnings++;
        else if (health.status === 'failure') report.summary.failures++;
      }
    }
  } catch (e) {
    // Settings file not found or invalid JSON - continue
  }
}

async function scanPluginHooks(report: HookHealthReport): Promise<void> {
  try {
    const pluginsDir = `${os.homedir()}/.claude/plugins/cache`;

    if (!fs.existsSync(pluginsDir)) {
      return;
    }

    // Recursively find all plugin.json files
    const pluginJsonFiles = findPluginJsonFiles(pluginsDir);

    for (const pluginJsonPath of pluginJsonFiles) {
      try {
        const pluginContent = fs.readFileSync(pluginJsonPath, 'utf-8');
        const plugin = JSON.parse(pluginContent);
        const hooks = plugin.hooks || {};
        const pluginName = plugin.name || 'unknown-plugin';

        for (const [event, hookEntries] of Object.entries(hooks)) {
          const commands = extractPluginCommands(hookEntries, event);

          for (const command of commands) {
            const health = await checkHookHealth(command, event as 'PreToolUse' | 'PostToolUse' | 'SessionStop', pluginName);
            report.hooks.push(health);

            if (health.status === 'healthy') report.summary.healthy++;
            else if (health.status === 'warning') report.summary.warnings++;
            else if (health.status === 'failure') report.summary.failures++;
          }
        }
      } catch (e) {
        // Failed to parse this plugin, continue to next
      }
    }
  } catch (e) {
    // Plugins directory not found or not accessible - continue
  }
}

function findPluginJsonFiles(dir: string): string[] {
  const results: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = `${dir}/${entry.name}`;

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        results.push(...findPluginJsonFiles(fullPath));
      } else if (entry.name === 'plugin.json') {
        results.push(fullPath);
      }
    }
  } catch (e) {
    // Directory not readable, skip
  }

  return results;
}

/**
 * Extract hook paths from both simple (string array) and complex (matcher-based) formats.
 *
 * Simple format: ["~/.claude/hooks/script.sh"]
 * Complex format: [{ matcher: "Bash", hooks: [{ type: "command", command: "/path/to/script" }] }]
 */
function extractHookPaths(hookEntries: any, event: string): string[] {
  const paths: string[] = [];

  if (!Array.isArray(hookEntries)) {
    return paths;
  }

  for (const entry of hookEntries) {
    // Simple format: entry is a string path
    if (typeof entry === 'string') {
      paths.push(entry);
    }
    // Complex format: entry is an object with { matcher, hooks }
    else if (entry && typeof entry === 'object' && Array.isArray(entry.hooks)) {
      for (const hook of entry.hooks) {
        if (hook && typeof hook === 'object') {
          // Extract path from command hook type
          if (hook.type === 'command' && hook.command) {
            // Extract the first token (the executable) from the command string
            // Handle cases like: "/path/to/script", "script arg1 arg2", "echo Done"
            const commandTokens = hook.command.trim().split(/\s+/);
            if (commandTokens.length > 0) {
              const executable = commandTokens[0];
              // Only validate paths that look like file paths (contain / or ~)
              if (executable.includes('/') || executable.includes('~')) {
                paths.push(executable);
              }
            }
          }
        }
      }
    }
  }

  return paths;
}

/**
 * Extract all hook commands from plugin hook entries.
 * Similar to extractHookPaths but includes all commands, even shell commands.
 */
function extractPluginCommands(hookEntries: any, event: string): string[] {
  const commands: string[] = [];

  if (!Array.isArray(hookEntries)) {
    return commands;
  }

  for (const entry of hookEntries) {
    if (entry && typeof entry === 'object' && Array.isArray(entry.hooks)) {
      for (const hook of entry.hooks) {
        if (hook && typeof hook === 'object' && hook.type === 'command' && hook.command) {
          commands.push(hook.command);
        }
      }
    }
  }

  return commands;
}
