import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeChannel } from '../../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/youtube/actions/analyze.mjs';
import { getChannel } from '../../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/youtube/actions/channel.mjs';
import { searchVideos } from '../../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/youtube/actions/search.mjs';
import { getVideo } from '../../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/youtube/actions/video.mjs';
import {
  youtubeSelectors,
  resolveYouTubeExtractionTier,
  resolveYouTubeSelector
} from '../../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/youtube/selectors.mjs';
import { NetworkReadError } from '../../../../../../plugins/hyper-cloaking/skills/hyper-cloaking/engine/providers/network.mjs';

const VIDEO_A = 'aBcDeFgHiJ1';
const VIDEO_B = 'zYxWvUtSrQ2';

function sessionFor(page) {
  const session = {
    page,
    requireOnOrigin() {},
    throwOnChallenge() {}
  };
  session.navigateGuardedForRead = async (url, gotoOpts) => {
    await page.goto(url, gotoOpts);
    session.requireOnOrigin();
    session.throwOnChallenge({ text: await page.evaluate(() => document.body?.innerText || '') });
  };
  return session;
}

function channelLinkNode({ href, title, publishedAt, viewCount, likeCount, tags }) {
  const metadataText = `${viewCount} ${publishedAt}`;
  const card = {
    textContent: `${metadataText} ${tags.map((tag) => `#${tag}`).join(' ')}`,
    getAttribute: (name) =>
      ({
        'data-view-count': viewCount,
        'data-like-count': likeCount
      })[name] || null,
    querySelector: (selector) => {
      if (selector === '#metadata-line') return { textContent: metadataText };
      if (selector === 'time[datetime]') return { getAttribute: () => publishedAt };
      return null;
    }
  };
  return {
    getAttribute: (name) => (name === 'href' ? href : null),
    textContent: title,
    closest: () => card
  };
}

function pageFor({
  links = [],
  channelNodes = null,
  text = {},
  metadata = { publishedAt: null, timestamp: null, tags: [] },
  selectorCounts = {},
  onExtraction = null,
  failBody = false,
  failLinks = false
} = {}) {
  let evaluateCount = 0;
  return {
    url: null,
    async goto(url) {
      this.url = url;
    },
    locator(selector) {
      return {
        async count() {
          return selectorCounts[selector] ?? 1;
        }
      };
    },
    async evaluate() {
      evaluateCount += 1;
      if (failBody && evaluateCount === 1) throw new Error('body inspection failed');
      return evaluateCount === 1 ? 'ordinary page text' : metadata;
    },
    async $eval(selector) {
      if (selector.includes('href^="/@"')) return { href: '/@fixture', name: 'Fixture channel' };
      if (selector.includes('views')) return text.views ?? null;
      if (selector.includes('like')) return text.likes ?? null;
      if (selector.includes('description')) return text.description ?? null;
      return text.default ?? 'Fixture title';
    },
    async $$eval(_selector, callback, arg) {
      onExtraction?.(arg);
      if (failLinks) throw new Error('extraction failed');
      if (channelNodes) return callback(channelNodes, arg);
      return callback(
        links.map((link) => ({
          getAttribute: (name) => (name === 'href' ? link.href : null),
          textContent: link.title,
          closest: () => ({
            querySelector: () => ({ textContent: link.channel || null })
          })
        })),
        arg
      );
    }
  };
}

test('getChannel navigates to videos and emits analyzer-compatible records', async () => {
  const page = pageFor({
    channelNodes: [
      channelLinkNode({
        href: `/watch?v=${VIDEO_A}`,
        title: 'First',
        publishedAt: '2026-01-01T00:00:00Z',
        viewCount: '1.2K views',
        likeCount: '34 likes',
        tags: ['Build']
      }),
      channelLinkNode({
        href: `/watch?v=${VIDEO_B}`,
        title: 'Second',
        publishedAt: '2026-01-08T00:00:00Z',
        viewCount: '900 views',
        likeCount: '20 likes',
        tags: ['Build', 'Testing']
      })
    ]
  });
  const read = await getChannel(sessionFor(page), '@fixture');

  assert.equal(page.url, 'https://www.youtube.com/@fixture/videos');
  assert.deepEqual(read.content.videos[0], {
    videoId: VIDEO_A,
    url: `https://www.youtube.com/watch?v=${VIDEO_A}`,
    title: 'First',
    publishedAt: '2026-01-01T00:00:00Z',
    timestamp: Date.parse('2026-01-01T00:00:00Z'),
    viewCount: 1200,
    likeCount: 34,
    tags: ['Build']
  });
  const analysis = analyzeChannel(read.content.videos);
  assert.equal(analysis.count, 2);
  assert.equal(analysis.engagement.avgViews, 1050);
  assert.deepEqual(analysis.topTags[0], { tag: 'build', count: 2 });
});

test('getVideo parses visible counts and returns analyzer fields', async () => {
  const page = pageFor({
    text: { views: '1.5M views', likes: '2.4K likes', description: 'Notes #Build' },
    metadata: {
      publishedAt: '2026-01-02T00:00:00Z',
      timestamp: Date.parse('2026-01-02T00:00:00Z'),
      tags: ['Fixture']
    }
  });
  const read = await getVideo(sessionFor(page), VIDEO_A);

  assert.equal(read.content.viewCount, 1_500_000);
  assert.equal(read.content.likeCount, 2400);
  assert.equal(read.content.timestamp, Date.parse('2026-01-02T00:00:00Z'));
  assert.deepEqual(read.content.tags, ['Fixture', 'Build']);
});

test('searchVideos preserves visible channels while deduplicating results', async () => {
  const read = await searchVideos(
    sessionFor(
      pageFor({
        links: [
          { href: `/watch?v=${VIDEO_A}`, title: 'First', channel: 'Fixture channel' },
          { href: `/watch?v=${VIDEO_A}`, title: 'Duplicate', channel: 'Other channel' }
        ]
      })
    ),
    'fixture'
  );

  assert.deepEqual(read.content.videos, [
    {
      videoId: VIDEO_A,
      url: `https://www.youtube.com/watch?v=${VIDEO_A}`,
      title: 'First',
      channel: 'Fixture channel'
    }
  ]);
});
test('resolveYouTubeSelector distinguishes primary, fallback, and exhaustion', async () => {
  const countsFor = (counts) => ({
    locator(selector) {
      return {
        async count() {
          return counts[selector] ?? 0;
        }
      };
    }
  });
  const entry = { primary: '[data-primary]', fallback: '[data-fallback]' };

  assert.equal(
    await resolveYouTubeSelector(countsFor({ [entry.primary]: 1 }), entry),
    entry.primary
  );
  assert.equal(
    await resolveYouTubeSelector(countsFor({ [entry.fallback]: 1 }), entry),
    entry.fallback
  );
  await assert.rejects(
    resolveYouTubeSelector(countsFor({}), entry),
    /neither primary "\[data-primary\]" nor fallback "\[data-fallback\]" matched/
  );
});
test('searchVideos rejects selector exhaustion instead of returning an empty result', async () => {
  await assert.rejects(
    searchVideos(
      sessionFor(
        pageFor({
          selectorCounts: {
            [youtubeSelectors.search.resultLinks.primary]: 0,
            [youtubeSelectors.search.resultLinks.fallback]: 0,
            [youtubeSelectors.search.emptyState.primary]: 0,
            [youtubeSelectors.search.emptyState.fallback]: 0
          }
        })
      ),
      'fixture'
    ),
    /YouTube selector extraction failed/
  );
});

test('searchVideos accepts an empty result only with an explicit empty-state anchor', async () => {
  const read = await searchVideos(
    sessionFor(
      pageFor({
        selectorCounts: {
          [youtubeSelectors.search.resultLinks.primary]: 0,
          [youtubeSelectors.search.resultLinks.fallback]: 0,
          [youtubeSelectors.search.emptyState.primary]: 1
        }
      })
    ),
    'fixture'
  );

  assert.deepEqual(read.content.videos, []);
});
test('getChannel accepts an empty video list only with an explicit empty-state anchor', async () => {
  const read = await getChannel(
    sessionFor(
      pageFor({
        selectorCounts: {
          [youtubeSelectors.channel.videoLinks.primary]: 0,
          [youtubeSelectors.channel.videoLinks.fallback]: 0,
          [youtubeSelectors.channel.emptyState.primary]: 1
        }
      })
    ),
    '@fixture'
  );

  assert.deepEqual(read.content.videos, []);
});

test('searchVideos preserves its extraction callback argument', async () => {
  let extraction = null;
  await searchVideos(
    sessionFor(
      pageFor({
        onExtraction(value) {
          extraction = value;
        },
        links: [{ href: `/watch?v=${VIDEO_A}`, title: 'First', channel: 'Fixture channel' }]
      })
    ),
    'fixture'
  );

  assert.equal(extraction, youtubeSelectors.search.extraction.primary);
  assert.deepEqual(
    JSON.parse(JSON.stringify(extraction)),
    youtubeSelectors.search.extraction.primary
  );
});
test('searchVideos freezes the selected tier when nested fallback wrappers are present', async () => {
  let extraction = null;
  const read = await searchVideos(
    sessionFor(
      pageFor({
        selectorCounts: {
          [youtubeSelectors.search.extraction.primary.resultCard]: 1,
          [youtubeSelectors.search.extraction.fallback.resultCard]: 1
        },
        onExtraction(value) {
          extraction = value;
        },
        links: [
          { href: `/watch?v=${VIDEO_A}`, title: 'Outer card', channel: 'Fixture channel' },
          { href: `/watch?v=${VIDEO_A}`, title: 'Nested card', channel: 'Fixture channel' }
        ]
      })
    ),
    'fixture'
  );

  assert.equal(extraction, youtubeSelectors.search.extraction.primary);
  assert.equal(read.content.count, 1);
  assert.equal(read.content.videos[0].title, 'Outer card');
});

test('getChannel freezes its fallback tier instead of aggregating nested wrappers', async () => {
  let extraction = null;
  const node = channelLinkNode({
    href: `/watch?v=${VIDEO_A}`,
    title: 'Fixture',
    publishedAt: '2026-01-01T00:00:00Z',
    viewCount: '100 views',
    likeCount: '10 likes',
    tags: []
  });
  const read = await getChannel(
    sessionFor(
      pageFor({
        channelNodes: [node, node],
        selectorCounts: {
          [youtubeSelectors.channel.extraction.primary.videoCard]: 0,
          [youtubeSelectors.channel.extraction.fallback.videoCard]: 1
        },
        onExtraction(value) {
          extraction = value;
        }
      })
    ),
    '@fixture'
  );

  assert.equal(extraction, youtubeSelectors.channel.extraction.fallback);
  assert.equal(read.content.count, 1);
});

test('resolveYouTubeExtractionTier prefers primary and rejects exhaustion', async () => {
  const countsFor = (counts) => ({
    locator(selector) {
      return {
        async count() {
          return counts[selector] ?? 0;
        }
      };
    }
  });
  const entry = {
    primary: { resultCard: '[data-primary]' },
    fallback: { resultCard: '[data-fallback]' }
  };

  assert.equal(
    await resolveYouTubeExtractionTier(
      countsFor({
        [entry.primary.resultCard]: 1,
        [entry.fallback.resultCard]: 1
      }),
      entry
    ),
    entry.primary
  );
  assert.equal(
    await resolveYouTubeExtractionTier(
      countsFor({
        [entry.fallback.resultCard]: 1
      }),
      entry
    ),
    entry.fallback
  );
  await assert.rejects(
    resolveYouTubeExtractionTier(countsFor({}), entry),
    /YouTube extraction tier failed/
  );
});
test('body and extraction failures reject rather than return empty success', async () => {
  await assert.rejects(
    getChannel(sessionFor(pageFor({ failBody: true })), '@fixture'),
    /body inspection failed/
  );
  await assert.rejects(
    searchVideos(sessionFor(pageFor({ failLinks: true })), 'fixture'),
    /extraction failed/
  );
});

test('YouTube reads remain DOM-default until complete promotion evidence exists', async () => {
  let directCalls = 0;
  const read = await searchVideos(
    sessionFor(
      pageFor({
        links: [{ href: `/watch?v=${VIDEO_A}`, title: 'DOM', channel: 'Fixture' }]
      })
    ),
    'fixture',
    {
      readHandlers: {
        direct: async () => {
          directCalls += 1;
          return { videos: [{ videoId: VIDEO_B, title: 'Direct', channel: 'Other' }] };
        }
      }
    }
  );
  assert.equal(directCalls, 0);
  assert.equal(read.content.videos[0].title, 'DOM');
});

test('forced YouTube network reads preserve whole-result parity and fail without DOM fallback', async () => {
  const domRead = await searchVideos(
    sessionFor(
      pageFor({
        links: [{ href: `/watch?v=${VIDEO_A}`, title: 'Fixture', channel: 'Channel' }]
      })
    ),
    'fixture'
  );
  const networkRead = await searchVideos({}, 'fixture', {
    readStrategy: 'direct',
    readHandlers: { direct: async () => structuredClone(domRead.content) }
  });
  assert.deepEqual(networkRead, domRead);

  await assert.rejects(
    searchVideos(
      {
        async navigateGuardedForRead() {
          throw new Error('DOM must not run');
        }
      },
      'fixture',
      {
        readStrategy: 'direct',
        readHandlers: {
          direct: async () => {
            throw new NetworkReadError('youtube-direct-failed', 'failed', { dispatched: true });
          }
        }
      }
    ),
    (error) => error.code === 'youtube-direct-failed'
  );
});

test('YouTube network normalization and strict navigation reject malformed reads', async () => {
  await assert.rejects(
    searchVideos({}, 'fixture', {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => ({ videos: Array.from({ length: 401 }, () => ({ videoId: VIDEO_A })) })
      }
    }),
    /at most 400/
  );
  await assert.rejects(
    getVideo(
      {
        async navigateGuardedForRead() {
          throw new Error('strict read blocked');
        }
      },
      VIDEO_A
    ),
    /strict read blocked/
  );
});

test('YouTube normalized-empty and nested-boundary contracts fail closed', async () => {
  await assert.rejects(
    searchVideos({}, 'fixture', {
      readStrategy: 'direct',
      readHandlers: { direct: async () => ({ videos: [{ videoId: 'invalid' }] }) }
    }),
    /normalized empty search/
  );
  await assert.rejects(
    getChannel({}, '@fixture', {
      readStrategy: 'direct',
      readHandlers: { direct: async () => ({ videos: [{ videoId: 'invalid' }] }) }
    }),
    /normalized empty channel/
  );
  await assert.rejects(
    getChannel({}, '@fixture', {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => ({
          videos: [
            {
              videoId: VIDEO_A,
              tags: Array.from({ length: 101 }, () => 'tag')
            }
          ]
        })
      }
    }),
    /at most 100/
  );
});

test('YouTube video network reads canonicalize channel identity and reject malformed channels', async () => {
  const read = await getVideo({}, VIDEO_A, {
    readStrategy: 'direct',
    readHandlers: {
      direct: async () => ({
        title: 'Video',
        channel: { href: '/@fixture', name: 'Fixture channel' },
        description: null,
        publishedAt: null,
        timestamp: null,
        tags: [],
        viewCount: 1,
        likeCount: 2,
        comments: []
      })
    }
  });
  assert.deepEqual(read.content.channel, {
    href: 'https://www.youtube.com/@fixture',
    name: 'Fixture channel'
  });

  await assert.rejects(
    getVideo({}, VIDEO_A, {
      readStrategy: 'direct',
      readHandlers: {
        direct: async () => ({
          channel: { href: 'https://evil.example/@fixture', name: 'Fixture channel' },
          tags: [],
          comments: []
        })
      }
    }),
    /channel identity is invalid/
  );
});
