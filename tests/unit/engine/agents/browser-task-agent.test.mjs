import test from 'node:test';
import assert from 'node:assert/strict';
import { runBrowserTask } from '../../../../packages/mcp-engine/src/agents/browser-task-agent.mjs';

const input = {
  schemaVersion: 1,
  taskMode: 'verification-only',
  targetUrl: 'https://example.com/',
  allowedOrigins: ['https://example.com'],
  headless: true,
  workspace: '/tmp/hyper',
  provider: null,
  cookieSite: null,
  account: null,
  agentStagingRoot: '/tmp/hyper-stage',
  maxRedirects: 2
};

function live(overrides = {}) {
  return {
    ok: false,
    finalUrl: 'https://example.com/',
    navigationTargetSafety: { disposition: 'ok' },
    publicNavigation: {
      finalUrl: 'https://example.com/',
      documentUrls: ['about:blank', 'https://example.com/'],
      violations: []
    },
    humanization: {
      ok: false,
      configured: true,
      evidence: 'humanize:true configured',
      blocker: 'runtime humanization telemetry unavailable'
    },
    cleanup: { ok: true, closed: true, timedOut: false, blocker: null },
    evidenceRefs: [],
    blockers: ['runtime humanization telemetry unavailable'],
    ...overrides
  };
}

test('truthfully blocks when humanization telemetry is unavailable', async () => {
  const result = await runBrowserTask(input, { runLiveVerification: async () => live() });
  assert.equal(result.status, 'blocked');
  assert.equal(result.failure.code, 'humanization-proof-unavailable');
  assert.equal(result.result.taskMode, 'verification-only');
});

test('cleanup failure is a hard blocker', async () => {
  const result = await runBrowserTask(input, {
    runLiveVerification: async () =>
      live({ cleanup: { ok: false, closed: false, timedOut: true, blocker: 'close timeout' } })
  });
  assert.equal(result.failure.code, 'browser-cleanup-unverified');
  assert.equal(result.result.cleanup.timedOut, true);
});

test('only explicit verified telemetry can produce success', async () => {
  const result = await runBrowserTask(input, {
    runLiveVerification: async () =>
      live({
        ok: true,
        humanization: {
          ok: true,
          configured: true,
          evidence: 'runtime telemetry id 1',
          blocker: null
        },
        blockers: []
      })
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.failure, null);
  assert.equal(result.result.outcome, 'verified');
});

test('rejects actions, duplicate origins, invalid redirects and non-http targets', async () => {
  for (const candidate of [
    { ...input, actions: [] },
    { ...input, allowedOrigins: ['https://example.com', 'https://example.com'] },
    { ...input, maxRedirects: 6 },
    { ...input, targetUrl: 'file:///tmp/x' }
  ]) {
    const result = await runBrowserTask(candidate, {
      runLiveVerification: async () => {
        throw new Error('must not run');
      }
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.failure.code, 'browser-input-invalid');
  }
});

test('maps staging evidence to relative refs', async () => {
  const result = await runBrowserTask(input, {
    runLiveVerification: async () =>
      live({
        evidenceRefs: [{ path: '/tmp/hyper-stage/live.png', kind: 'live-browser-screenshot' }]
      })
  });
  assert.deepEqual(result.result.evidenceRefs, [
    { type: 'screenshot', relPath: 'live.png', description: 'live-browser-screenshot' }
  ]);
});

test('normalizes allowed origins once for execution and the verified result', async () => {
  let received;
  const result = await runBrowserTask(
    { ...input, allowedOrigins: ['https://Example.com/path'] },
    {
      runLiveVerification: async (options) => {
        received = options.allowedOrigins;
        return live();
      }
    }
  );
  assert.deepEqual(received, ['https://example.com']);
  assert.deepEqual(result.result.contentBoundary.allowedOrigins, ['https://example.com']);
});
