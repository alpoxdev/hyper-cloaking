import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertNavigationAllowed,
  classifyRedirect,
  classifyTargetUrl,
  hasEmbeddedCredentials,
  isInternalHostname,
  isPrivateIpLiteral,
  isUnsafeScheme,
  normalizeOrigin
} from '../../../mcp/engine/target-safety.mjs';

test('classifies public https FQDN as ok', () => {
  const result = classifyTargetUrl('https://example.com/path?q=1');
  assert.equal(result.disposition, 'ok');
  assert.equal(result.reason, 'public-https-fqdn');
  assert.equal(result.origin, 'https://example.com');
  assert.equal(normalizeOrigin('https://Example.com:443/path'), 'https://example.com');
  assert.doesNotThrow(() => assertNavigationAllowed('https://example.com'));
});

test('classifies public http FQDN as approval required', () => {
  const result = classifyTargetUrl('http://example.com');
  assert.equal(result.disposition, 'approvalRequired');
  assert.equal(result.reason, 'insecure-http');
});

test('allows about:blank only for setup/blank context', () => {
  assert.equal(classifyTargetUrl('about:blank').disposition, 'blocker');
  const result = classifyTargetUrl('about:blank', { context: 'setup' });
  assert.equal(result.disposition, 'ok');
  assert.equal(result.reason, 'about-blank-setup');
  assert.equal(result.origin, 'about:blank');
});

test('blocks unsafe and custom schemes', () => {
  for (const target of [
    'file:///tmp/a',
    'data:text/plain,hi',
    'javascript:alert(1)',
    'chrome://version',
    'devtools://x',
    'custom://x'
  ]) {
    const result = classifyTargetUrl(target);
    assert.equal(result.disposition, 'blocker', target);
    assert.equal(result.reason, 'unsafe-scheme', target);
  }
  assert.equal(isUnsafeScheme('file:'), true);
  assert.equal(isUnsafeScheme('https:'), false);
});

test('blocks embedded URL credentials', () => {
  const result = classifyTargetUrl('https://user:pass@example.com');
  assert.equal(result.disposition, 'blocker');
  assert.equal(result.reason, 'embedded-credentials');
  assert.equal(hasEmbeddedCredentials('https://user@example.com'), true);
});

test('requires approval for localhost, loopback, RFC1918, .local, and single-label names', () => {
  for (const target of [
    'http://localhost',
    'https://app.localhost',
    'https://127.0.0.1',
    'https://[::ffff:127.0.0.1]',
    'https://10.0.0.1',
    'https://172.16.1.1',
    'https://192.168.1.1',
    'https://printer.local',
    'https://intranet'
  ]) {
    assert.equal(classifyTargetUrl(target).disposition, 'approvalRequired', target);
  }
  assert.equal(isPrivateIpLiteral('10.1.2.3'), true);
  assert.equal(isInternalHostname('service.local'), true);
});

test('blocks metadata, link-local, unspecified, reserved, and multicast IPs', () => {
  for (const target of [
    'http://169.254.169.254/latest/meta-data',
    'https://169.254.1.2',
    'https://[::ffff:169.254.169.254]',
    'https://0.0.0.0',
    'https://224.0.0.1',
    'https://192.0.2.1',
    'https://[::]',
    'https://[fe80::1]',
    'https://[ff02::1]',
    'https://[2001:db8::1]'
  ]) {
    assert.equal(classifyTargetUrl(target).disposition, 'blocker', target);
  }
});

test('redirect classification follows final target and includes source/final origins', () => {
  const result = classifyRedirect('https://example.com/start', 'http://target.example/final');
  assert.equal(result.type, 'redirect');
  assert.equal(result.disposition, 'approvalRequired');
  assert.equal(result.sourceOrigin, 'https://example.com');
  assert.equal(result.finalOrigin, 'http://target.example');
});

test('assertNavigationAllowed throws with classification for non-ok targets', () => {
  assert.throws(
    () => assertNavigationAllowed('http://example.com'),
    (error) =>
      error.code === 'HYPER_CLOAKING_TARGET_SAFETY' &&
      error.classification.disposition === 'approvalRequired'
  );
});
