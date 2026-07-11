// YouTube video lookup (read).

import { youtubeSelectors, resolveYouTubeSelector } from '../selectors.mjs';
import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { normalizeVideoId, watchUrl } from './ids.mjs';

function parseCount(value) {
  const match = String(value ?? '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return 0;
  const multiplier = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[match[2]?.toLowerCase()] || 1;
  return Math.round(Number(match[1]) * multiplier);
}

function tagsFromText(value) {
  return [...new Set((String(value ?? '').match(/#[\p{L}\p{N}_-]+/gu) || []).map((tag) => tag.slice(1)))];
}

async function textFor(session, entry) {
  const selector = await resolveYouTubeSelector(session.page, entry);
  return session.page.$eval(selector, (node) => (node.textContent || '').trim() || null);
}

async function channelFor(session) {
  const selector = await resolveYouTubeSelector(session.page, youtubeSelectors.video.channelLink);
  return session.page.$eval(selector, (node) => ({
    href: node.getAttribute('href'),
    name: (node.textContent || '').trim() || null
  }));
}

async function metadataFor(session) {
  const tagSelector = await resolveYouTubeSelector(
    session.page,
    youtubeSelectors.video.extraction.tags,
    { allowAbsent: true }
  );
  return session.page.evaluate((extraction) => {
    const publishedAt = document.querySelector(extraction.publishedAt)?.getAttribute('content') || null;
    const timestamp = publishedAt === null ? null : Date.parse(publishedAt);
    return {
      publishedAt,
      timestamp: Number.isNaN(timestamp) ? null : timestamp,
      tags: extraction.tags === null ? [] : [...new Set([...document.querySelectorAll(extraction.tags)]
        .map((node) => node.getAttribute('content'))
        .flatMap((value) => String(value ?? '').split(','))
        .map((tag) => tag.trim().replace(/^#/, ''))
        .filter(Boolean))]
    };
  }, { ...youtubeSelectors.video.extraction, tags: tagSelector });
}

/**
 * Looks up a public YouTube video and, when requested, visible comment text.
 *
 * @param {object} session
 * @param {string} videoRef
 * @param {{comments?: boolean}} [opts]
 * @returns {Promise<object>} Untrusted-wrapped video payload.
 */
export async function getVideo(session, videoRef, opts = {}) {
  const videoId = normalizeVideoId(videoRef);
  const url = watchUrl(videoId);

  await session.navigateGuarded(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const [title, channelHref, description, viewCountText, likeCountText, metadata] = await Promise.all([
    textFor(session, youtubeSelectors.video.title),
    channelFor(session),
    textFor(session, youtubeSelectors.video.description),
    textFor(session, youtubeSelectors.video.viewCount),
    textFor(session, youtubeSelectors.video.likeButton),
    metadataFor(session)
  ]);
  const viewCount = parseCount(viewCountText);
  const likeCount = parseCount(likeCountText);
  const tags = [...new Set([...metadata.tags, ...tagsFromText(description)])];

  let comments = [];
  if (opts.comments === true) {
    const selector = await resolveYouTubeSelector(session.page, youtubeSelectors.video.commentThreads);
    if (await session.page.locator(selector).count() > 0) {
      const rawComments = await session.page.$$eval(selector, (nodes) => nodes
        .map((node) => (node.textContent || '').trim())
        .filter(Boolean));
      comments = [...new Set(rawComments)];
    }
  }

  return wrapReadPayload({
    url,
    content: {
      videoId,
      url,
      title,
      channel: channelHref,
      description,
      publishedAt: metadata.publishedAt,
      timestamp: metadata.timestamp,
      tags,
      viewCount,
      likeCount,
      comments
    },
    kind: 'youtube-video'
  });
}
