import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { HookHealth, HookHealthReport } from './types';

export const execPromise = promisify(exec);

export async function checkHookHealth(hookPath: string, event: 'PreToolUse' | 'PostToolUse' | 'SessionStop'): Promise<HookHealth> {
  const health: HookHealth = {
    path: hookPath,
    event,
    status: 'healthy',
    checks: [],
    lastRun: new Date().toISOString(),
    duration: 0,
  };

  // Check 1: File existence
  if (!fs.existsSync(hookPath)) {
    health.status = 'failure';
    health.checks.push({
      name: 'File exists',
      status: 'failure',
      message: 'Hook file not found',
    });
    return health;
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
    return health;
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

  return health;
}

export async function getHooksHealth(): Promise<HookHealthReport> {
  const report: HookHealthReport = {
    timestamp: new Date().toISOString(),
    hooks: [],
    summary: { healthy: 0, warnings: 0, failures: 0 },
  };

  try {
    const settingsPath = `${os.homedir()}/.claude/settings.json`;
    const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(settingsContent);
    const hooks = settings.hooks || {};

    for (const [event, hookPaths] of Object.entries(hooks)) {
      for (const hookPath of hookPaths as string[]) {
        const expandedPath = hookPath.replace('~', os.homedir());
        const health = await checkHookHealth(expandedPath, event as 'PreToolUse' | 'PostToolUse' | 'SessionStop');
        report.hooks.push(health);

        if (health.status === 'healthy') report.summary.healthy++;
        else if (health.status === 'warning') report.summary.warnings++;
        else if (health.status === 'failure') report.summary.failures++;
      }
    }
  } catch (e) {
    // Settings file not found or invalid JSON - return empty report
  }

  return report;
}
