import test from 'node:test';
import assert from 'node:assert/strict';
import { runSetup } from '../../../../mcp/engine/agents/setup-agent.mjs';

function fakeRunCli({ validate = { ok: true }, config } = {}) {
  const calls = [];
  const runCli = async (argv, io) => {
    calls.push(argv);
    const value =
      argv[0] === 'validate'
        ? validate
        : config || {
            ok: true,
            client: argv[argv.indexOf('--client') + 1],
            home: argv[argv.indexOf('--home') + 1],
            executablePath: '/tmp/chromium',
            config: {
              command: 'npx',
              args: [
                '@playwright/mcp@latest',
                ...(argv.includes('--headless') ? ['--headless'] : []),
                '--sandbox',
                '--executable-path',
                '/tmp/chromium'
              ]
            }
          };
    io.stdout.write(`${JSON.stringify(value)}\n`);
    return value.ok ? 0 : 1;
  };
  return { runCli, calls };
}
async function malformedRunCli(_argv, io) {
  io.stdout.write('{bad');
  return 0;
}

async function extraRunCli(_argv, io) {
  io.stdout.write('{}\n{}\n');
  return 0;
}

const input = {
  schemaVersion: 1,
  client: 'direct',
  workspace: '/tmp/hyper',
  headless: true,
  sandbox: true
};

test('maps headless setup and verifies sandbox', async () => {
  const fake = fakeRunCli();
  const result = await runSetup(input, { runCli: fake.runCli });
  assert.equal(result.status, 'succeeded');
  assert.ok(fake.calls[1].includes('--headless'));
  assert.equal(result.result.setupStatus, 'ready');
});

test('maps headed setup without generated headless', async () => {
  const fake = fakeRunCli();
  const result = await runSetup({ ...input, headless: false }, { runCli: fake.runCli });
  assert.equal(result.status, 'succeeded');
  assert.ok(fake.calls[1].includes('--headed'));
});

test('rejects sandbox false before invoking CLI', async () => {
  const fake = fakeRunCli();
  const result = await runSetup({ ...input, sandbox: false }, { runCli: fake.runCli });
  assert.equal(result.status, 'blocked');
  assert.equal(fake.calls.length, 0);
});

test('validation failure short-circuits config', async () => {
  const fake = fakeRunCli({ validate: { ok: false, blockers: ['bad environment'] } });
  const result = await runSetup(input, { runCli: fake.runCli });
  assert.equal(result.status, 'blocked');
  assert.equal(fake.calls.length, 1);
});

test('maps valid nonzero MCP config JSON to a truthful needs-install blocker', async () => {
  const fake = fakeRunCli({
    config: {
      ok: false,
      executablePath: null,
      blockers: ['CloakBrowser executable is unavailable']
    }
  });
  const result = await runSetup(input, { runCli: fake.runCli });
  assert.equal(result.status, 'blocked');
  assert.equal(result.result.setupStatus, 'needs_install');
  assert.equal(result.failure.code, 'missing-binary');
  assert.match(result.failure.observedSignal, /unavailable/);
});

test('rejects missing sandbox, no-sandbox and headless contradictions', async () => {
  for (const args of [
    ['@playwright/mcp@latest', '--headless', '--executable-path', '/tmp/chromium'],
    [
      '@playwright/mcp@latest',
      '--headless',
      '--sandbox',
      '--no-sandbox',
      '--executable-path',
      '/tmp/chromium'
    ],
    [
      '@playwright/mcp@latest',
      '--headless',
      '--sandbox',
      '--sandbox',
      '--executable-path',
      '/tmp/chromium'
    ],
    ['@playwright/mcp@latest', '--sandbox', '--executable-path', '/tmp/chromium']
  ]) {
    const fake = fakeRunCli({
      config: {
        ok: true,
        client: 'direct',
        home: '/tmp/hyper',
        executablePath: '/tmp/chromium',
        config: { command: 'npx', args }
      }
    });
    const result = await runSetup(input, { runCli: fake.runCli });
    assert.equal(result.status, 'failed');
    assert.equal(result.failure.code, 'setup-config-mismatch');
  }
});

test('rejects malformed and extra stdout', async () => {
  assert.equal((await runSetup(input, { runCli: malformedRunCli })).status, 'blocked');
  assert.equal((await runSetup(input, { runCli: extraRunCli })).status, 'blocked');
});
