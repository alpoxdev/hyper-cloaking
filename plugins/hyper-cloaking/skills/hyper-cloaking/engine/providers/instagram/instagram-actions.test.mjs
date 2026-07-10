import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInstagramSession, OffOriginError } from './session.mjs';
import { normalizeThreadRef, isValidThreadRef, assertExistingThreadRef, replyToDM, replyToMany } from './actions/dm.mjs';
import { normalizePostRef } from './actions/reactions.mjs';
import { normalizeUsername, profileUrl, InvalidUsernameError } from './actions/user.mjs';
import { providers } from '../index.mjs';
import { validateProviderSchema } from '../schema.mjs';

function mockPage(url) {
  return { url: () => url };
}

// --- threadRef invariant: existing-thread handles only, no cold outreach ---

test('normalizeThreadRef accepts /direct/t/<id> url and handle object', () => {
  assert.deepEqual(normalizeThreadRef('https://www.instagram.com/direct/t/123/'), { threadId: '123', url: 'https://www.instagram.com/direct/t/123/' });
  assert.equal(normalizeThreadRef({ threadId: '999' }).threadId, '999');
  assert.equal(isValidThreadRef('https://www.instagram.com/direct/t/42'), true);
});

test('threadRef rejects usernames and /direct/new/ (no cold outreach)', () => {
  assert.equal(normalizeThreadRef('someuser'), null);
  assert.equal(normalizeThreadRef('@someuser'), null);
  assert.equal(normalizeThreadRef('https://www.instagram.com/direct/new/'), null);
  assert.equal(normalizeThreadRef('https://www.instagram.com/someuser/'), null);
  assert.throws(() => assertExistingThreadRef('someuser'), (e) => e.code === 'invalid-thread-ref');
});

// --- session origin guard ---

test('session.requireInstagramOrigin rejects off-origin urls', () => {
  const onSession = buildInstagramSession(mockPage('https://www.instagram.com/foo/'));
  assert.equal(onSession.requireInstagramOrigin(), 'https://www.instagram.com/foo/');

  const offSession = buildInstagramSession(mockPage('https://evil.example.com/instagram.com'));
  assert.throws(() => offSession.requireInstagramOrigin(), OffOriginError);
});

// --- write gating: no navigation happens when a gate blocks ---

test('replyToDM is dry-run by default and blocks before navigation', async () => {
  // page has no goto; if the code navigated this would throw. It must not.
  const session = buildInstagramSession(mockPage('https://www.instagram.com/direct/t/5/'), { interactive: true });
  const r = await replyToDM(session, { threadId: '5' }, 'hi');
  assert.equal(r.blocked, true);
  assert.equal(r.performed, false);
  assert.match(r.reason, /dry-run/);
});

test('replyToDM rejects an invalid (cold-outreach) thread ref', async () => {
  const session = buildInstagramSession(mockPage('https://www.instagram.com/'), { interactive: true });
  const r = await replyToDM(session, 'someuser', 'hi', { dryRun: false });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /existing threads/);
});

test('replyToMany bulk confirmation cannot be satisfied non-interactively', async () => {
  const session = buildInstagramSession(mockPage('https://www.instagram.com/'), { interactive: false });
  const items = [{ threadRef: { threadId: '1' }, message: 'a' }, { threadRef: { threadId: '2' }, message: 'b' }];
  const r = await replyToMany(session, items, { dryRun: false });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /non-interactively/);
});

test('replyToMany rejects a batch containing a cold-outreach ref', async () => {
  const session = buildInstagramSession(mockPage('https://www.instagram.com/'), { interactive: true });
  const items = [{ threadRef: { threadId: '1' }, message: 'a' }, { threadRef: 'someuser', message: 'b' }];
  const r = await replyToMany(session, items, { dryRun: false, confirmed: true });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /invalid thread ref/);
});

test('replyToMany enforces the bulk cap', async () => {
  const session = buildInstagramSession(mockPage('https://www.instagram.com/'), { interactive: true });
  const items = Array.from({ length: 5 }, (_, i) => ({ threadRef: { threadId: String(i) }, message: 'x' }));
  const r = await replyToMany(session, items, { dryRun: false, confirmed: true, cap: 3 });
  assert.equal(r.blocked, true);
  assert.match(r.reason, /exceeds cap/);
});

// --- input normalizers ---

test('normalizeUsername and profileUrl validate handles', () => {
  assert.equal(normalizeUsername('@Some.User_1'), 'Some.User_1');
  assert.equal(normalizeUsername('bad user!'), null);
  assert.equal(profileUrl('nasa'), 'https://www.instagram.com/nasa/');
  assert.throws(() => profileUrl('bad user!'), InvalidUsernameError);
});

test('normalizePostRef accepts /p/ and /reel/ only', () => {
  assert.ok(normalizePostRef('https://www.instagram.com/p/ABC123/'));
  assert.ok(normalizePostRef('https://www.instagram.com/reel/XYZ/'));
  assert.equal(normalizePostRef('https://www.instagram.com/nasa/'), null);
});

// --- boundary regression: action modules never leak into the registry ---

test('every registry provider passes metadata schema (no selectors/automation leaked in)', () => {
  for (const provider of providers) {
    const result = validateProviderSchema(provider);
    assert.equal(result.ok, true, `${provider?.id}: ${JSON.stringify(result.errors)}`);
  }
});

test('instagram registry entry exposes no action/selector fields', () => {
  const ig = providers.find((p) => p.id === 'instagram');
  assert.ok(ig);
  for (const forbidden of ['actions', 'selectors', 'session', 'automationRecipe']) {
    assert.equal(Object.hasOwn(ig, forbidden), false, `provider metadata must not carry "${forbidden}"`);
  }
});
