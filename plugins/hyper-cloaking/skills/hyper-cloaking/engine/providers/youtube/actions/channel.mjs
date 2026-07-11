// YouTube channel lookup (read).

import {
  youtubeSelectors,
  resolveYouTubeExtractionTier,
  resolveYouTubeSelector
} from '../selectors.mjs';
import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { normalizeChannelRef, channelUrl, normalizeVideoId, watchUrl } from './ids.mjs';

const DEFAULT_LIMIT = 12;

function positiveLimit(value, fallback = DEFAULT_LIMIT) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function videoIdFromHref(href) {
  try {
    return normalizeVideoId(href);
  } catch {
    return null;
  }
}

function parseCount(value) {
  const match = String(value ?? '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return 0;
  const multiplier = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[match[2]?.toLowerCase()] || 1;
  return Math.round(Number(match[1]) * multiplier);
}

function tagsFromText(value) {
  return [...new Set((String(value ?? '').match(/#[\p{L}\p{N}_-]+/gu) || []).map((tag) => tag.slice(1)))];
}

function timestampFor(value) {
  const timestamp = Date.parse(value ?? '');
  return Number.isNaN(timestamp) ? null : timestamp;
}

function videoRecord(link) {
  const videoId = videoIdFromHref(link.href);
  if (!videoId) return null;
  const publishedAt = link.publishedAt || null;
  return {
    videoId,
    url: watchUrl(videoId),
    title: link.title,
    publishedAt,
    timestamp: timestampFor(publishedAt),
    viewCount: parseCount(link.viewCount || link.metadataText),
    likeCount: parseCount(link.likeCount),
    tags: Array.isArray(link.tags) ? link.tags : tagsFromText(link.metadataText)
  };
}

async function textFor(session, entry) {
  const selector = await resolveYouTubeSelector(session.page, entry);
  return session.page.$eval(selector, (node) => (node.textContent || '').trim() || null);
}

/**
 * Looks up a public YouTube channel and its visible recent video links.
 *
 * @param {object} session
 * @param {string} channelRef
 * @param {{limit?: number}} [opts]
 * @returns {Promise<object>} Untrusted-wrapped channel payload.
 */
export async function getChannel(session, channelRef, opts = {}) {
  const channelId = normalizeChannelRef(channelRef);
  const url = `${channelUrl(channelId)}/videos`;
  const limit = positiveLimit(opts.limit);

  await session.navigateGuarded(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const [name, handle, subscriberCount, description, videoSelector] = await Promise.all([
    textFor(session, youtubeSelectors.channel.name),
    textFor(session, youtubeSelectors.channel.handle),
    textFor(session, youtubeSelectors.channel.subscriberCount),
    textFor(session, youtubeSelectors.channel.description),
    resolveYouTubeSelector(
      session.page,
      youtubeSelectors.channel.videoLinks,
      { emptyState: youtubeSelectors.channel.emptyState }
    )
  ]);
  const extraction = videoSelector === null
    ? null
    : await resolveYouTubeExtractionTier(session.page, youtubeSelectors.channel.extraction);
  const links = videoSelector === null ? [] : await session.page.$$eval(videoSelector, (nodes, selectedExtraction) => nodes.map((node) => {
    const card = node.closest(selectedExtraction.videoCard);
    const metadataText = card?.querySelector(selectedExtraction.metadataLine)?.textContent?.trim() || '';
    const publishedAt = card?.querySelector(selectedExtraction.publishedAt)?.getAttribute('datetime') || null;
    return {
      href: node.getAttribute('href'),
      title: (node.textContent || '').trim() || null,
      publishedAt,
      viewCount: card?.getAttribute('data-view-count') || null,
      likeCount: card?.getAttribute('data-like-count') || null,
      metadataText,
      tags: [...new Set((card?.textContent?.match(/#[\p{L}\p{N}_-]+/gu) || []).map((tag) => tag.slice(1)))]
    };
  }), extraction);

  const seen = new Set();
  const videos = [];
  for (const link of links) {
    const video = videoRecord(link);
    if (!video || seen.has(video.videoId)) continue;
    seen.add(video.videoId);
    videos.push(video);
    if (videos.length >= limit) break;
  }

  return wrapReadPayload({
    url,
    content: {
      channelId,
      url,
      name,
      handle,
      subscriberCount,
      description,
      count: videos.length,
      videos
    },
    kind: 'youtube-channel'
  });
}
