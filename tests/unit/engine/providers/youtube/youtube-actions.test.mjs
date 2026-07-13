import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { randomUUID } from 'node:crypto';
import {
  buildYouTubeSession,
  OffOriginError,
  normalizeVideoId,
  watchUrl,
  normalizeChannelRef,
  channelUrl,
  InvalidVideoRefError,
  InvalidChannelRefError,
  likeVideo,
  commentVideo,
  subscribeChannel,
  shareVideo,
  saveToPlaylist
} from '../../../../../mcp/engine/providers/youtube/index.mjs';
import { providers } from '../../../../../mcp/engine/providers/index.mjs';
import { validateProviderSchema } from '../../../../../mcp/engine/providers/schema.mjs';
import { youtubeSelectors } from '../../../../../mcp/engine/providers/youtube/selectors.mjs';
const TEST_STATE_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-actions-test-'));
test.after(async () => fs.rm(TEST_STATE_ROOT, { recursive: true, force: true }));

function mockPage(url) {
  return { url: () => url };
}
function writeSession({
  liked = false,
  subscribed = false,
  comments = [],
  stateDir = path.join(TEST_STATE_ROOT, randomUUID())
} = {}) {
  let url = 'https://www.youtube.com/';
  let clicks = 0;
  const page = {
    url: () => url,
    goto: async (target) => {
      url = target;
    },
    evaluate: async () => ({ title: '', labels: [] }),
    locator: () => ({ count: async () => 1 }),
    $eval: async (selector, callback) =>
      callback({
        getAttribute: (name) => {
          if (name === 'aria-pressed') return liked ? 'true' : 'false';
          if (name === 'aria-label')
            return selector.includes('Subscribe')
              ? subscribed
                ? 'Subscribed'
                : 'Subscribe'
              : liked
                ? 'Liked'
                : 'Like this video';
          return null;
        }
      }),
    $$eval: async (_selector, callback, needle) =>
      callback(
        comments.map((text) => ({ textContent: text })),
        needle
      ),
    waitForTimeout: async () => {}
  };
  const session = buildYouTubeSession(page, { interactive: true, stateDir });
  session.humanClick = async () => {
    clicks += 1;
    liked = true;
    subscribed = true;
  };
  session.targetSafety = { disposition: 'ok', reason: 'public-https-fqdn', risks: [] };
  session.clickCount = () => clicks;
  return session;
}

test('YouTube ID validators canonicalize valid references and reject invalid ones', () => {
  assert.equal(normalizeVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(normalizeVideoId('/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(normalizeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(
    watchUrl('https://youtu.be/dQw4w9WgXcQ'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
  assert.equal(normalizeVideoId('nope!'), null);
  assert.throws(() => watchUrl('nope!'), InvalidVideoRefError);

  assert.equal(normalizeChannelRef('@NASA'), 'NASA');
  assert.equal(channelUrl('@NASA'), 'https://www.youtube.com/@NASA');
  assert.equal(normalizeChannelRef('invalid channel ref'), null);
  assert.throws(() => channelUrl('invalid channel ref'), InvalidChannelRefError);
});

test('session.requireOnOrigin rejects off-origin URLs', () => {
  const onSession = buildYouTubeSession(mockPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  assert.equal(onSession.requireOnOrigin(), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  const offSession = buildYouTubeSession(mockPage('https://evil.example.com/youtube.com'));
  assert.throws(() => offSession.requireOnOrigin(), OffOriginError);
});

test('likeVideo validates a valid ref then dry-run blocks before navigation', async () => {
  // No goto exists: any navigation before the default dry-run gate would fail.
  const session = buildYouTubeSession(mockPage('https://www.youtube.com/'), { interactive: true });
  const result = await likeVideo(session, 'dQw4w9WgXcQ');
  assert.equal(result.blocked, true);
  assert.equal(result.performed, false);
  assert.match(result.reason, /dry-run/);
});

test('subscribeChannel remains policy-disabled without its explicit per-action opt-in', async () => {
  const session = buildYouTubeSession(mockPage('https://www.youtube.com/'), { interactive: true });
  const explicitWrite = await subscribeChannel(session, '@RickAstley', { dryRun: false });
  const defaultMode = await subscribeChannel(session, '@RickAstley');

  for (const result of [explicitWrite, defaultMode]) {
    assert.equal(result.blocked, true);
    assert.equal(result.performed, false);
    assert.match(result.reason, /disabled by default/);
    assert.equal(result.failure.stage, 'policy-disabled');
  }
  assert.equal(explicitWrite.dryRun, false);
  assert.equal(defaultMode.dryRun, true);
});
test('likeVideo returns a verified no-op without clicking or recording a rate event', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-action-'));
  try {
    const session = writeSession({ liked: true, stateDir });
    const result = await likeVideo(session, 'dQw4w9WgXcQ', { dryRun: false });

    assert.equal(session.clickCount(), 0);
    assert.equal(result.ok, true);
    assert.equal(result.performed, false);
    assert.equal(result.changed, false);
    assert.equal(result.alreadySatisfied, true);
    assert.equal(result.rateLimit, null);
    await assert.rejects(fs.access(path.join(stateDir, 'action-rate.json')));
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
test('real likeVideo blocks for missing persistent rate state before navigation', async () => {
  let gotos = 0;
  const session = buildYouTubeSession(
    {
      url: () => 'https://www.youtube.com/',
      goto: async () => {
        gotos += 1;
      }
    },
    { interactive: true }
  );

  const result = await likeVideo(session, 'dQw4w9WgXcQ', { dryRun: false });

  assert.equal(result.blocked, true);
  assert.equal(result.changed, false);
  assert.equal(result.performed, false);
  assert.equal(result.failure.stage, 'rate-state-required');
  assert.equal(gotos, 0);
});

test('enabled subscribe blocks for missing persistent rate state before navigation', async () => {
  let gotos = 0;
  const session = buildYouTubeSession(
    {
      url: () => 'https://www.youtube.com/',
      goto: async () => {
        gotos += 1;
      }
    },
    { interactive: true }
  );

  const result = await subscribeChannel(session, '@RickAstley', {
    enableSubscribe: true,
    dryRun: false
  });

  assert.equal(result.blocked, true);
  assert.equal(result.changed, false);
  assert.equal(result.performed, false);
  assert.equal(result.failure.stage, 'rate-state-required');
  assert.equal(gotos, 0);
});
test('likeVideo clicks once and records a changed result when state transitions false to true', async () => {
  const session = writeSession();

  const result = await likeVideo(session, 'dQw4w9WgXcQ', { dryRun: false });

  assert.equal(session.clickCount(), 1);
  assert.equal(result.ok, true);
  assert.equal(result.performed, true);
  assert.equal(result.changed, true);
  assert.equal(result.alreadySatisfied, false);
});
test('likeVideo verifies the same owned control after its label transitions to Unlike', async () => {
  let liked = false;
  const page = {
    url: () => 'https://www.youtube.com/',
    goto: async () => {},
    evaluate: async () => ({ title: '', labels: [] }),
    locator: () => ({ count: async () => 1 }),
    $eval: async (_selector, callback) =>
      callback({
        getAttribute: (name) =>
          name === 'aria-pressed' ? 'false' : liked ? 'Unlike this video' : 'Like this video'
      }),
    waitForTimeout: async () => {}
  };
  const session = buildYouTubeSession(page, {
    interactive: true,
    stateDir: path.join(TEST_STATE_ROOT, randomUUID())
  });
  session.targetSafety = { disposition: 'ok', reason: 'public-https-fqdn', risks: [] };
  session.humanClick = async () => {
    liked = true;
  };

  const result = await likeVideo(session, 'dQw4w9WgXcQ', { dryRun: false });

  assert.equal(result.performed, true);
  assert.equal(result.changed, true);
});

test('likeVideo refuses ambiguous like controls before reserving or clicking', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-like-'));
  try {
    const session = writeSession({ stateDir });
    session.page.locator = () => ({ count: async () => 2 });

    const result = await likeVideo(session, 'dQw4w9WgXcQ', { dryRun: false });

    assert.equal(result.blocked, true);
    assert.equal(result.failure.stage, 'selector-ownership');
    assert.equal(session.clickCount(), 0);
    await assert.rejects(fs.access(path.join(stateDir, 'action-rate.json')));
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('likeVideo returns structured uncertainty when post-click verification throws', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-like-'));
  try {
    const session = writeSession({ stateDir });
    const originalClick = session.humanClick;
    const originalEval = session.page.$eval;
    let clicked = false;
    session.humanClick = async (...args) => {
      await originalClick(...args);
      clicked = true;
    };
    session.page.$eval = async (...args) => {
      if (clicked) {
        const nested = Object.assign(new Error('browser detached'), { code: 'E_BROWSER_DETACHED' });
        throw Object.assign(new Error('verification evaluate failed'), {
          code: 'E_VERIFY',
          cause: nested
        });
      }
      return originalEval(...args);
    };

    const result = await likeVideo(session, 'dQw4w9WgXcQ', { dryRun: false });

    assert.equal(result.performed, false);
    assert.equal(result.changed, false);
    assert.equal(result.rateLimit.count, 1);
    assert.equal(result.failure.stage, 'post-interaction-uncertainty');
    assert.equal(result.failure.cause.name, 'Error');
    assert.equal(result.failure.cause.message, 'verification evaluate failed');
    assert.equal(result.failure.cause.code, 'E_VERIFY');
    assert.equal(result.failure.cause.cause.code, 'E_BROWSER_DETACHED');
    assert.match(result.failure.blocker, /verification evaluate failed/);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

function commentTierSwitchSession(initialTier, replacementTier) {
  const { primary, fallback } = youtubeSelectors.video.commentText;
  let clicked = false;
  const evaluatedCommentTiers = [];
  const page = {
    url: () => 'https://www.youtube.com/',
    goto: async () => {},
    evaluate: async () => ({ title: '', labels: [] }),
    locator: (selector) => ({
      count: async () => {
        if (selector === primary || selector === fallback) {
          if (!clicked) return selector === initialTier ? 1 : 0;
          return selector === replacementTier ? 2 : 0;
        }
        return 1;
      }
    }),
    $$eval: async (selector, callback, needle) => {
      evaluatedCommentTiers.push(selector);
      const texts =
        !clicked && selector === initialTier
          ? ['Switch comment']
          : clicked && selector === replacementTier
            ? ['Switch comment', 'Switch comment']
            : [];
      return callback(
        texts.map((text) => ({ textContent: text })),
        needle
      );
    },
    waitForTimeout: async () => {}
  };
  const session = buildYouTubeSession(page, {
    interactive: true,
    stateDir: path.join(TEST_STATE_ROOT, randomUUID())
  });
  session.targetSafety = { disposition: 'ok', reason: 'public-https-fqdn', risks: [] };
  session.humanType = async () => {};
  session.humanClick = async () => {
    clicked = true;
  };
  return { session, evaluatedCommentTiers };
}

test('commentVideo resists primary-to-fallback comment population switches', async () => {
  const { primary, fallback } = youtubeSelectors.video.commentText;
  const { session, evaluatedCommentTiers } = commentTierSwitchSession(primary, fallback);

  const result = await commentVideo(session, 'dQw4w9WgXcQ', 'Switch comment', { dryRun: false });

  assert.equal(result.performed, false);
  assert.equal(result.changed, false);
  assert.equal(result.rateLimit.count, 1);
  assert.deepEqual(evaluatedCommentTiers, [primary, primary, primary, primary, primary, primary]);
});

test('commentVideo resists fallback-to-primary comment population switches', async () => {
  const { primary, fallback } = youtubeSelectors.video.commentText;
  const { session, evaluatedCommentTiers } = commentTierSwitchSession(fallback, primary);

  const result = await commentVideo(session, 'dQw4w9WgXcQ', 'Switch comment', { dryRun: false });

  assert.equal(result.performed, false);
  assert.equal(result.changed, false);
  assert.equal(result.rateLimit.count, 1);
  assert.deepEqual(evaluatedCommentTiers, [
    fallback,
    fallback,
    fallback,
    fallback,
    fallback,
    fallback
  ]);
});

test('commentVideo binds a proven empty baseline to the first appearing tier for zero-to-one verification', async () => {
  const { primary, fallback } = youtubeSelectors.video.commentText;
  let phase = 'empty';
  const evaluatedCommentTiers = [];
  const page = {
    url: () => 'https://www.youtube.com/',
    goto: async () => {},
    evaluate: async () => ({ title: '', labels: [] }),
    locator: (selector) => ({
      count: async () => {
        if (phase === 'empty') {
          if (selector === primary || selector === fallback) return 0;
          if (selector.includes('#contents:empty')) return 1;
        }
        if (phase === 'fallback-first') {
          if (selector === primary) return 0;
          if (selector === fallback) return 1;
        }
        if (phase === 'both-visible') {
          if (selector === primary || selector === fallback) return 1;
        }
        return 1;
      }
    }),
    $$eval: async (selector, callback, needle) => {
      evaluatedCommentTiers.push(selector);
      const texts = phase === 'fallback-first' ? [] : ['First comment'];
      if (phase === 'fallback-first') phase = 'both-visible';
      return callback(
        texts.map((text) => ({ textContent: text })),
        needle
      );
    },
    waitForTimeout: async () => {}
  };
  const session = buildYouTubeSession(page, {
    interactive: true,
    stateDir: path.join(TEST_STATE_ROOT, randomUUID())
  });
  session.targetSafety = { disposition: 'ok', reason: 'public-https-fqdn', risks: [] };
  session.humanType = async () => {};
  session.humanClick = async () => {
    phase = 'fallback-first';
  };

  const result = await commentVideo(session, 'dQw4w9WgXcQ', 'First comment', { dryRun: false });

  assert.equal(result.performed, true);
  assert.equal(result.changed, true);
  assert.deepEqual(evaluatedCommentTiers, [fallback, fallback]);
});
test('commentVideo verifies a first comment from a proven zero-comment baseline', async () => {
  const comments = [];
  const page = {
    url: () => 'https://www.youtube.com/',
    goto: async () => {},
    evaluate: async () => ({ title: '', labels: [] }),
    locator: (selector) => ({
      count: async () => {
        if (selector.includes('#content-text')) return comments.length;
        if (selector.includes('#contents:empty')) return comments.length === 0 ? 1 : 0;
        return 1;
      }
    }),
    $$eval: async (_selector, callback, needle) =>
      callback(
        comments.map((text) => ({ textContent: text })),
        needle
      ),
    waitForTimeout: async () => {}
  };
  const session = buildYouTubeSession(page, {
    interactive: true,
    stateDir: path.join(TEST_STATE_ROOT, randomUUID())
  });
  session.targetSafety = { disposition: 'ok', reason: 'public-https-fqdn', risks: [] };
  session.humanType = async () => {};
  session.humanClick = async () => {
    comments.push('First comment');
  };

  const result = await commentVideo(session, 'dQw4w9WgXcQ', 'First comment', { dryRun: false });

  assert.equal(result.performed, true);
  assert.equal(result.changed, true);
});

test('likeVideo safety denial prevents guarded navigation', async () => {
  let gotos = 0;
  const page = {
    url: () => 'https://www.youtube.com/',
    goto: async () => {
      gotos += 1;
    }
  };
  const session = buildYouTubeSession(page, {
    interactive: true,
    stateDir: path.join(TEST_STATE_ROOT, randomUUID()),
    targetSafety: { disposition: 'deny', reason: 'deny-all-test', risks: ['test'] }
  });

  await assert.rejects(
    likeVideo(session, 'dQw4w9WgXcQ', { dryRun: false }),
    /target safety|deny-all-test|Refusing/i
  );
  assert.equal(gotos, 0);
});

test('commentVideo verification failure still consumes and returns the rate attempt', async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-comment-'));
  try {
    const session = writeSession({ comments: ['Exact comment', '"Exact comment"'], stateDir });
    session.humanType = async () => {};
    session.humanClick = async () => {};

    const result = await commentVideo(session, 'dQw4w9WgXcQ', ' Exact   comment ', {
      dryRun: false
    });

    assert.equal(result.ok, false);
    assert.equal(result.performed, false);
    assert.ok(result.failure);
    assert.equal(result.targetSafety.disposition, 'ok');
    assert.equal(result.rateLimit.count, 1);
    const stored = JSON.parse(await fs.readFile(path.join(stateDir, 'action-rate.json'), 'utf8'));
    assert.equal(stored['yt-comment'].length, 1);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test('subscribe opt-in preserves verified already-subscribed no-op semantics', async () => {
  const subscribeSession = writeSession({ subscribed: true });

  const subscribed = await subscribeChannel(subscribeSession, '@RickAstley', {
    enableSubscribe: true,
    dryRun: false
  });
  const share = await shareVideo(null, 'dQw4w9WgXcQ');
  const save = await saveToPlaylist(null, 'dQw4w9WgXcQ');

  assert.equal(subscribed.ok, true);
  assert.equal(subscribed.performed, false);
  assert.equal(subscribed.changed, false);
  assert.equal(subscribed.alreadySatisfied, true);
  assert.equal(subscribeSession.clickCount(), 0);
  for (const result of [share, save]) {
    assert.equal(result.blocked, true);
    assert.equal(result.performed, false);
    assert.equal(result.failure.stage, 'unsupported-native-action');
  }
});

test('registry metadata schema excludes action and automation internals', () => {
  for (const provider of providers) {
    const result = validateProviderSchema(provider);
    assert.equal(result.ok, true, `${provider?.id}: ${JSON.stringify(result.errors)}`);
  }

  const youtube = providers.find((provider) => provider.id === 'youtube');
  assert.ok(youtube);
  for (const forbidden of ['actions', 'selectors', 'session', 'automationRecipe']) {
    assert.equal(
      Object.hasOwn(youtube, forbidden),
      false,
      `provider metadata must not carry "${forbidden}"`
    );
  }
});
