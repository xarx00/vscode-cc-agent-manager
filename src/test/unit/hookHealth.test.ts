jest.mock('os', () => ({ homedir: () => '/home/test' }));
jest.mock('fs');

// Mock child_process.exec with a callback-based implementation
let mockExecFn: jest.Mock;
jest.mock('child_process', () => ({
  exec: (cmd: string, opts: any, cb: any) => {
    mockExecFn(cmd, opts, cb);
  },
}));

import * as fs from 'fs';
import { checkHookHealth, getHooksHealth } from '../../hookHealth';
import { HookHealth, HookHealthReport } from '../../types';

describe('checkHookHealth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecFn = jest.fn((cmd: string, opts: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });
  });

  test('returns failure when hook file does not exist', async () => {
    jest.mocked(fs.existsSync).mockReturnValue(false);

    const result = await checkHookHealth('/home/test/.claude/hooks/pre.sh', 'PreToolUse');

    expect(result.status).toBe('failure');
    expect(result.path).toBe('/home/test/.claude/hooks/pre.sh');
    expect(result.event).toBe('PreToolUse');
    expect(result.checks).toContainEqual({
      name: 'File exists',
      status: 'failure',
      message: 'Hook file not found',
    });
  });

  test('returns healthy when hook exists, readable, executable, and dry-run succeeds', async () => {
    jest.mocked(fs.existsSync).mockReturnValue(true);
    jest.mocked(fs.accessSync).mockImplementation(() => {
      // Both R_OK and X_OK pass
    });
    mockExecFn = jest.fn((cmd: string, opts: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const result = await checkHookHealth('/home/test/.claude/hooks/pre.sh', 'PreToolUse');

    expect(result.status).toBe('healthy');
    expect(result.path).toBe('/home/test/.claude/hooks/pre.sh');
    expect(result.event).toBe('PreToolUse');
    expect(result.checks.map((c: any) => c.status)).toEqual(['success', 'success', 'success', 'success']);
  });

  test('returns warning when file is not executable but exists and readable', async () => {
    jest.mocked(fs.existsSync).mockReturnValue(true);
    jest.mocked(fs.accessSync).mockImplementation((path: any, mode?: number) => {
      // R_OK (4) passes, X_OK (1) throws
      if (mode === 1) throw new Error('not executable');
    });
    mockExecFn = jest.fn((cmd: string, opts: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const result = await checkHookHealth('/home/test/.claude/hooks/pre.sh', 'PreToolUse');

    expect(result.status).toBe('warning');
    expect(result.checks).toContainEqual({
      name: 'Executable',
      status: 'warning',
      message: 'File is not executable (may work via shell)',
    });
  });

  test('returns failure when dry-run execution fails', async () => {
    jest.mocked(fs.existsSync).mockReturnValue(true);
    jest.mocked(fs.accessSync).mockImplementation(() => {
      // Both pass
    });
    mockExecFn = jest.fn((cmd: string, opts: any, cb: any) => {
      const err = new Error('exit code 1') as any;
      err.code = 1;
      cb(err);
    });

    const result = await checkHookHealth('/home/test/.claude/hooks/pre.sh', 'PreToolUse');

    expect(result.status).toBe('failure');
    expect(result.checks.find((c: any) => c.name === 'Dry-run with empty input')).toMatchObject({
      status: 'failure',
    });
  });

  test('records execution timing in duration field', async () => {
    jest.mocked(fs.existsSync).mockReturnValue(true);
    jest.mocked(fs.accessSync).mockImplementation(() => {});
    mockExecFn = jest.fn((cmd: string, opts: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const result = await checkHookHealth('/home/test/.claude/hooks/pre.sh', 'PreToolUse');

    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(typeof result.duration).toBe('number');
  });
});

describe('getHooksHealth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecFn = jest.fn((cmd: string, opts: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });
  });

  test('returns empty report when settings file does not exist', async () => {
    jest.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = await getHooksHealth();

    expect(result.hooks).toEqual([]);
    expect(result.summary).toEqual({ healthy: 0, warnings: 0, failures: 0 });
  });

  test('returns empty report when hooks object is missing from settings', async () => {
    jest.mocked(fs.readFileSync).mockReturnValue('{"someKey": "value"}');

    const result = await getHooksHealth();

    expect(result.hooks).toEqual([]);
    expect(result.summary).toEqual({ healthy: 0, warnings: 0, failures: 0 });
  });

  test('scans and checks all hooks from settings.json (simple format)', async () => {
    const settings = {
      hooks: {
        PreToolUse: ['/home/test/.claude/hooks/pre.sh'],
        PostToolUse: ['/home/test/.claude/hooks/post.sh'],
      },
    };
    jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(settings));
    jest.mocked(fs.existsSync).mockReturnValue(true);
    jest.mocked(fs.accessSync).mockImplementation(() => {});
    mockExecFn = jest.fn((cmd: string, opts: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const result = await getHooksHealth();

    expect(result.hooks).toHaveLength(2);
    expect(result.hooks[0].event).toBe('PreToolUse');
    expect(result.hooks[1].event).toBe('PostToolUse');
  });

  test('scans and checks hooks from settings.json (complex matcher format)', async () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: '/home/test/.claude/hooks/pre.sh',
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: 'Edit|Write',
            hooks: [
              {
                type: 'command',
                command: '/home/test/.claude/hooks/post.sh arg1 arg2',
              },
            ],
          },
        ],
      },
    };
    jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(settings));
    jest.mocked(fs.existsSync).mockReturnValue(true);
    jest.mocked(fs.accessSync).mockImplementation(() => {});
    mockExecFn = jest.fn((cmd: string, opts: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const result = await getHooksHealth();

    expect(result.hooks).toHaveLength(2);
    expect(result.hooks[0].event).toBe('PreToolUse');
    expect(result.hooks[0].path).toBe('/home/test/.claude/hooks/pre.sh');
    expect(result.hooks[1].event).toBe('PostToolUse');
    expect(result.hooks[1].path).toBe('/home/test/.claude/hooks/post.sh');
  });

  test('ignores non-path commands in complex format', async () => {
    const settings = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: 'echo Done',
              },
            ],
          },
        ],
      },
    };
    jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(settings));
    mockExecFn = jest.fn((cmd: string, opts: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const result = await getHooksHealth();

    // Echo command has no path, so it should be ignored
    expect(result.hooks).toHaveLength(0);
  });

  test('handles plugin hooks with source label', async () => {
    jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ hooks: {} }));
    jest.mocked(fs.existsSync).mockReturnValue(false); // No plugins dir

    // Call checkHookHealth directly with a plugin source
    const health = await checkHookHealth('echo test', 'PreToolUse', 'cmux-integration');

    // Should include plugin name in the path
    expect(health.path).toContain('cmux-integration');
    expect(health.path).toContain('echo test');
    expect(health.event).toBe('PreToolUse');
  });

  test('scans plugin hooks from sibling hooks/hooks.json (official plugin layout)', async () => {
    // Official Claude Code plugins store manifest at <plugin>/.claude-plugin/plugin.json
    // and hook definitions separately at <plugin>/hooks/hooks.json.
    const pluginRoot = '/home/test/.claude/plugins/cache/acme/superpowers/1.0.0';
    const manifestPath = `${pluginRoot}/.claude-plugin/plugin.json`;
    const hooksPath = `${pluginRoot}/hooks/hooks.json`;

    const manifest = { name: 'superpowers', version: '1.0.0' };
    const hooksFile = {
      hooks: {
        SessionStart: [
          {
            matcher: 'startup',
            hooks: [
              {
                type: 'command',
                command: '/bin/true',
              },
            ],
          },
        ],
      },
    };

    // Fake a plugins directory containing one plugin with the official layout.
    jest.mocked(fs.readdirSync).mockImplementation(((dir: any) => {
      const d = String(dir);
      const makeEntry = (name: string, isDir: boolean) => ({
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
      });
      if (d === '/home/test/.claude/plugins/cache') {
        return [makeEntry('acme', true)];
      }
      if (d === '/home/test/.claude/plugins/cache/acme') {
        return [makeEntry('superpowers', true)];
      }
      if (d === '/home/test/.claude/plugins/cache/acme/superpowers') {
        return [makeEntry('1.0.0', true)];
      }
      if (d === pluginRoot) {
        return [makeEntry('.claude-plugin', true), makeEntry('hooks', true)];
      }
      if (d === `${pluginRoot}/.claude-plugin`) {
        return [makeEntry('plugin.json', false)];
      }
      if (d === `${pluginRoot}/hooks`) {
        return [makeEntry('hooks.json', false)];
      }
      return [];
    }) as any);

    jest.mocked(fs.existsSync).mockImplementation((p: any) => {
      return p === '/home/test/.claude/plugins/cache' || p === hooksPath;
    });

    jest.mocked(fs.readFileSync).mockImplementation((p: any) => {
      const s = String(p);
      if (s === '/home/test/.claude/settings.json') {
        return JSON.stringify({ hooks: {} });
      }
      if (s === manifestPath) {
        return JSON.stringify(manifest);
      }
      if (s === hooksPath) {
        return JSON.stringify(hooksFile);
      }
      throw new Error(`Unexpected readFileSync: ${s}`);
    });

    mockExecFn = jest.fn((cmd: string, opts: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const result = await getHooksHealth();

    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0].event).toBe('SessionStart');
    expect(result.hooks[0].path).toContain('superpowers');
    expect(result.hooks[0].path).toContain('/bin/true');
  });

  test('ignores .cursor-plugin manifests when .claude-plugin exists alongside', async () => {
    // Some plugins ship both a Claude Code manifest (.claude-plugin/plugin.json)
    // and a Cursor manifest (.cursor-plugin/plugin.json) in the same directory.
    // Only the Claude Code one should be scanned, otherwise the same sibling
    // hooks/hooks.json gets counted twice.
    const pluginRoot = '/home/test/.claude/plugins/cache/acme/superpowers/1.0.0';
    const claudeManifest = `${pluginRoot}/.claude-plugin/plugin.json`;
    const cursorManifest = `${pluginRoot}/.cursor-plugin/plugin.json`;
    const hooksPath = `${pluginRoot}/hooks/hooks.json`;

    const hooksFile = {
      hooks: {
        SessionStart: [
          {
            matcher: 'startup',
            hooks: [
              {
                type: 'command',
                command: '/bin/true',
              },
            ],
          },
        ],
      },
    };

    jest.mocked(fs.readdirSync).mockImplementation(((dir: any) => {
      const d = String(dir);
      const makeEntry = (name: string, isDir: boolean) => ({
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
      });
      if (d === '/home/test/.claude/plugins/cache') {
        return [makeEntry('acme', true)];
      }
      if (d === '/home/test/.claude/plugins/cache/acme') {
        return [makeEntry('superpowers', true)];
      }
      if (d === '/home/test/.claude/plugins/cache/acme/superpowers') {
        return [makeEntry('1.0.0', true)];
      }
      if (d === pluginRoot) {
        return [
          makeEntry('.claude-plugin', true),
          makeEntry('.cursor-plugin', true),
          makeEntry('hooks', true),
        ];
      }
      if (d === `${pluginRoot}/.claude-plugin` || d === `${pluginRoot}/.cursor-plugin`) {
        return [makeEntry('plugin.json', false)];
      }
      if (d === `${pluginRoot}/hooks`) {
        return [makeEntry('hooks.json', false)];
      }
      return [];
    }) as any);

    jest.mocked(fs.existsSync).mockImplementation((p: any) => {
      return p === '/home/test/.claude/plugins/cache' || p === hooksPath;
    });

    jest.mocked(fs.readFileSync).mockImplementation((p: any) => {
      const s = String(p);
      if (s === '/home/test/.claude/settings.json') {
        return JSON.stringify({ hooks: {} });
      }
      if (s === claudeManifest) {
        return JSON.stringify({ name: 'superpowers' });
      }
      if (s === cursorManifest) {
        return JSON.stringify({ name: 'superpowers-cursor' });
      }
      if (s === hooksPath) {
        return JSON.stringify(hooksFile);
      }
      throw new Error(`Unexpected readFileSync: ${s}`);
    });

    mockExecFn = jest.fn((cmd: string, opts: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const result = await getHooksHealth();

    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0].path).toContain('[superpowers]');
    expect(result.hooks[0].path).not.toContain('superpowers-cursor');
  });

  test('degrades to warning when plugin hook command contains unresolved env vars', async () => {
    // Commands like "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" cannot be safely
    // dry-run from the extension because CLAUDE_PLUGIN_ROOT is only defined by
    // Claude Code at invocation time. We should not report them as failures.
    const health = await checkHookHealth(
      '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start',
      'SessionStart',
      'superpowers',
    );

    expect(health.status).toBe('warning');
    const dryRun = health.checks.find((c: any) => c.name === 'Dry-run execution');
    expect(dryRun).toBeDefined();
    expect(dryRun!.status).toBe('warning');
    expect(dryRun!.message).toMatch(/env/i);
  });

  test('aggregates health status counts in summary', async () => {
    const settings = {
      hooks: {
        PreToolUse: ['/home/test/.claude/hooks/pre.sh'],
        PostToolUse: ['/home/test/.claude/hooks/post.sh'],
      },
    };
    jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(settings));

    // First hook: healthy
    // Second hook: failure
    let callCount = 0;
    jest.mocked(fs.existsSync).mockImplementation(() => {
      callCount++;
      return callCount === 1; // First file exists, second doesn't
    });
    jest.mocked(fs.accessSync).mockImplementation(() => {});
    mockExecFn = jest.fn((cmd: string, opts: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const result = await getHooksHealth();

    expect(result.summary.healthy).toBe(1);
    expect(result.summary.failures).toBe(1);
    expect(result.summary.warnings).toBe(0);
  });

  test('includes timestamp in report', async () => {
    jest.mocked(fs.readFileSync).mockReturnValue('{"hooks":{}}');
    mockExecFn = jest.fn((cmd: string, opts: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const result = await getHooksHealth();

    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp)).toBeInstanceOf(Date);
  });
});
