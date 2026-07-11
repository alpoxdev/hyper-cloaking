// YouTube video search (read).

import {
  youtubeSelectors,
  resolveYouTubeExtractionTier,
  resolveYouTubeSelector
} from '../selectors.mjs';
import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { normalizeVideoId, watchUrl } from './ids.mjs';

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
  const limit = positiveLimit(opts.limit);
  const searchQuery = String(query ?? '').trim();
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;

  await session.navigateGuarded(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const selector = await resolveYouTubeSelector(
    session.page,
    youtubeSelectors.search.resultLinks,
    { emptyState: youtubeSelectors.search.emptyState }
  );
  const extraction = selector === null
    ? null
    : await resolveYouTubeExtractionTier(session.page, youtubeSelectors.search.extraction);
  const links = selector === null ? [] : await session.page.$$eval(selector, (nodes, selectedExtraction) => nodes.map((node) => ({
    href: node.getAttribute('href'),
    title: (node.textContent || '').trim() || null,
    channel: node.closest(selectedExtraction.resultCard)
      ?.querySelector(selectedExtraction.channelLink)?.textContent?.trim() || null
  })), extraction);

  const seen = new Set();
  const videos = [];
  for (const link of links) {
    const videoId = videoIdFromHref(link.href);
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    videos.push({ videoId, url: watchUrl(videoId), title: link.title, channel: link.channel });
    if (videos.length >= limit) break;
  }

  return wrapReadPayload({
    url,
    content: { query: searchQuery, count: videos.length, videos },
    kind: 'youtube-search'
  });
}
