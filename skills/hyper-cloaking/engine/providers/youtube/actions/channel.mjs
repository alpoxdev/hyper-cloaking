// YouTube channel lookup (read).

import {
  youtubeSelectors,
  resolveYouTubeExtractionTier,
  resolveYouTubeSelector
} from '../selectors.mjs';
import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { normalizeChannelRef, channelUrl, normalizeVideoId, watchUrl } from './ids.mjs';
import { executeYouTubeRead } from '../network.mjs';

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

function boundedText(value, field, maxLength) {
  if (value == null) return null;
  const text = String(value);
  if (text.length > maxLength) throw new TypeError(`YouTube ${field} exceeds ${maxLength} characters`);
  return text;
}

function videoRecord(link) {
  const videoId = videoIdFromHref(link.href);
  if (!videoId) return null;
  if (Array.isArray(link.tags) && link.tags.length > 100) {
    throw new TypeError('YouTube channel video tags must contain at most 100 entries');
  }
  const publishedAt = boundedText(link.publishedAt, 'publishedAt', 100);
  const tags = (Array.isArray(link.tags) ? link.tags : tagsFromText(link.metadataText)).map((tag) => {
    const text = String(tag);
    if (text.length > 100) throw new TypeError('YouTube channel video tag exceeds 100 characters');
    return text;
  });
  return {
    videoId,
    url: watchUrl(videoId),
    title: boundedText(link.title, 'video title', 1_000),
    publishedAt,
    timestamp: timestampFor(publishedAt),
    viewCount: parseCount(link.viewCount || link.metadataText),
    likeCount: parseCount(link.likeCount),
    tags
  };
}

async function textFor(session, entry) {
  const selector = await resolveYouTubeSelector(session.page, entry);
  return session.page.$eval(selector, (node) => (node.textContent || '').trim() || null);
}

function normalizeChannelContent(value, { channelId, url, limit }) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.videos) || value.videos.length > 400) {
    throw new TypeError('YouTube channel content must contain at most 400 videos');
  }
  if (value.videos.length === 0 && value.emptyState !== true) {
    throw new TypeError('YouTube empty channel content requires explicit empty-state evidence');
  }
  const seen = new Set();
  const videos = [];
  for (const entry of value.videos) {
    if (!entry || typeof entry !== 'object') throw new TypeError('YouTube channel video entries must be objects');
    const video = videoRecord({
      ...entry,
      href: entry.href || entry.url || entry.videoId
    });
    if (!video || seen.has(video.videoId)) continue;
    seen.add(video.videoId);
    videos.push(video);
    if (videos.length >= limit) break;
  }
  if (videos.length === 0 && value.emptyState !== true) {
    throw new TypeError('YouTube normalized empty channel content requires explicit empty-state evidence');
  }
  return {
    channelId,
    url,
    name: boundedText(value.name, 'channel name', 1_000),
    handle: boundedText(value.handle, 'channel handle', 100),
    subscriberCount: boundedText(value.subscriberCount, 'subscriber count', 100),
    description: boundedText(value.description, 'channel description', 10_000),
    count: videos.length,
    videos
  };
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
  const limit = Math.min(positiveLimit(opts.limit), 100);
  const dom = async () => {
    await session.navigateGuardedForRead(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
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
    const links = videoSelector === null ? [] : await session.page.$$eval(videoSelector, (nodes, selectedExtraction) => nodes.slice(0, 400).map((node) => {
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
    return {
      channelId,
      url,
      name,
      handle,
      subscriberCount,
      description,
      emptyState: videoSelector === null,
      videos: links
    };
  };
  const { value } = await executeYouTubeRead({
    action: 'getChannel',
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize: (content) => normalizeChannelContent(content, {
      channelId,
      url,
      limit
    })
  });
  return wrapReadPayload({
    url,
    content: value,
    kind: 'youtube-channel'
  });
}
