// YouTube video search (read).

import {
  youtubeSelectors,
  resolveYouTubeExtractionTier,
  resolveYouTubeSelector
} from '../selectors.mjs';
import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { normalizeVideoId, watchUrl } from './ids.mjs';
import { executeYouTubeRead } from '../network.mjs';

function boundedText(value, field, maxLength) {
  if (value == null) return null;
  const text = String(value);
  if (text.length > maxLength) throw new TypeError(`YouTube ${field} exceeds ${maxLength} characters`);
  return text;
}

function normalizeSearchContent(value, { query, limit }) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.videos) || value.videos.length > 400) {
    throw new TypeError('YouTube search content must contain at most 400 videos');
  }
  if (value.videos.length === 0 && value.emptyState !== true) {
    throw new TypeError('YouTube empty search content requires explicit empty-state evidence');
  }
  const seen = new Set();
  const videos = [];
  for (const entry of value.videos) {
    if (!entry || typeof entry !== 'object') throw new TypeError('YouTube search entries must be objects');
    const videoId = videoIdFromHref(entry.videoId || entry.url);
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    videos.push({
      videoId,
      url: watchUrl(videoId),
      title: boundedText(entry.title, 'search title', 1_000),
      channel: boundedText(entry.channel, 'search channel', 1_000)
    });
    if (videos.length >= limit) break;
  }
  if (videos.length === 0 && value.emptyState !== true) {
    throw new TypeError('YouTube normalized empty search content requires explicit empty-state evidence');
  }
  return { query, count: videos.length, videos };
}

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

/**
 * Searches public YouTube videos.
 *
 * @param {object} session
 * @param {string} query
 * @param {{limit?: number}} [opts]
 * @returns {Promise<object>} Untrusted-wrapped search results.
 */
export async function searchVideos(session, query, opts = {}) {
  const limit = Math.min(positiveLimit(opts.limit), 100);
  const searchQuery = String(query ?? '').trim();
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
  const dom = async () => {
    await session.navigateGuardedForRead(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const selector = await resolveYouTubeSelector(
      session.page,
      youtubeSelectors.search.resultLinks,
      { emptyState: youtubeSelectors.search.emptyState }
    );
    const extraction = selector === null
      ? null
      : await resolveYouTubeExtractionTier(session.page, youtubeSelectors.search.extraction);
    const links = selector === null ? [] : await session.page.$$eval(selector, (nodes, selectedExtraction) => nodes.slice(0, 400).map((node) => ({
      href: node.getAttribute('href'),
      title: (node.textContent || '').trim() || null,
      channel: node.closest(selectedExtraction.resultCard)
        ?.querySelector(selectedExtraction.channelLink)?.textContent?.trim() || null
    })), extraction);
    return {
      query: searchQuery,
      emptyState: selector === null,
      videos: links.map((link) => ({
        videoId: videoIdFromHref(link.href),
        url: link.href,
        title: link.title,
        channel: link.channel
      }))
    };
  };
  const { value } = await executeYouTubeRead({
    action: 'searchVideos',
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize: (content) => normalizeSearchContent(content, {
      query: searchQuery,
      limit
    })
  });
  return wrapReadPayload({
    url,
    content: value,
    kind: 'youtube-search'
  });
}
