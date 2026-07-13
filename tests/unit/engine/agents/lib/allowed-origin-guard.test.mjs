import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guardAllowedOrigin,
  normalizeAllowedOrigins
} from '../../../../../mcp/engine/agents/lib/allowed-origin-guard.mjs';

const classify = () => ({ disposition: 'ok', reason: 'public target' });

test('exact normalized origin passes', () => {
  const result = guardAllowedOrigin({
    url: 'https://Example.com/path',
    allowedOrigins: ['https://example.com'],
    classify
  });
  assert.equal(result.ok, true);
  assert.equal(result.origin, 'https://example.com');
});

test('different scheme, port, suffix and substring are refused', () => {
  for (const url of [
    'http://example.com',
    'https://example.com:8443',
    'https://sub.example.com',
    'https://example.com.evil.test'
  ]) {
    assert.equal(
      guardAllowedOrigin({ url, allowedOrigins: ['https://example.com'], classify }).ok,
      false
    );
  }
});

test('invalid and opaque origins fail closed', () => {
  assert.equal(
    guardAllowedOrigin({ url: 'not a url', allowedOrigins: ['https://example.com'], classify })
      .reason,
    'invalid-origin'
  );
  assert.equal(
    guardAllowedOrigin({ url: 'file:///tmp/x', allowedOrigins: ['https://example.com'], classify })
      .ok,
    false
  );
});

test('target safety must also approve', () => {
  const result = guardAllowedOrigin({
    url: 'https://example.com',
    allowedOrigins: ['https://example.com'],
    classify: () => ({ disposition: 'blocker', reason: 'private target' })
  });
  assert.equal(result.reason, 'target-safety-rejected');
});

test('duplicate and empty allowlists reject', () => {
  assert.throws(() => normalizeAllowedOrigins([]), /non-empty/);
  assert.throws(
    () => normalizeAllowedOrigins(['https://example.com', 'https://example.com']),
    /duplicates/
  );
});

test('about blank is setup-only', () => {
  assert.equal(
    guardAllowedOrigin({ url: 'about:blank', allowedOrigins: ['https://example.com'], classify })
      .ok,
    false
  );
  assert.equal(
    guardAllowedOrigin({
      url: 'about:blank',
      allowedOrigins: ['https://example.com'],
      classify,
      allowAboutBlank: true
    }).ok,
    true
  );
});
