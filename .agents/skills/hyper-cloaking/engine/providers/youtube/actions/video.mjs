// YouTube video lookup (read).

import { youtubeSelectors, resolveYouTubeSelector } from '../selectors.mjs';
import { wrapReadPayload } from '../../../action-runtime/action-result.mjs';
import { channelUrl, normalizeChannelRef, normalizeVideoId, watchUrl } from './ids.mjs';
import { executeYouTubeRead } from '../network.mjs';

function boundedText(value, field, maxLength) {
  if (value == null) return null;
  const text = String(value);
  if (text.length > maxLength) throw new TypeError(`YouTube ${field} exceeds ${maxLength} characters`);
  return text;
}

function boundedRequiredText(value, field, maxLength) {
  const text = String(value);
  if (text.length > maxLength) throw new TypeError(`YouTube ${field} exceeds ${maxLength} characters`);
  return text;
}

function normalizeVideoChannel(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('YouTube video channel must be an object');
  }
  const channelId = normalizeChannelRef(value.href);
  if (!channelId) throw new TypeError('YouTube video channel identity is invalid');
  return {
    href: channelUrl(channelId),
    name: boundedText(value.name, 'video channel name', 1_000)
  };
}

function normalizeVideoContent(value, { videoId, url, includeComments }) {
  if (!value || typeof value !== 'object') throw new TypeError('YouTube video content must be an object');
  if (!Array.isArray(value.tags) || value.tags.length > 100) {
    throw new TypeError('YouTube video tags must be a bounded array');
  }
  if (!Array.isArray(value.comments) || value.comments.length > 100) {
    throw new TypeError('YouTube video comments must be a bounded array');
  }
  const channel = normalizeVideoChannel(value.channel);
  return {
    videoId,
    url,
    title: boundedText(value.title, 'video title', 1_000),
    channel,
    description: boundedText(value.description, 'video description', 100_000),
    publishedAt: boundedText(value.publishedAt, 'video publishedAt', 100),
    timestamp: Number.isFinite(value.timestamp) ? value.timestamp : null,
    tags: [...new Set(value.tags.map((tag) => boundedRequiredText(tag, 'video tag', 100)))],
    viewCount: Number.isFinite(value.viewCount) ? value.viewCount : 0,
    likeCount: Number.isFinite(value.likeCount) ? value.likeCount : 0,
    comments: includeComments
      ? value.comments.map((comment) => boundedRequiredText(comment, 'video comment', 10_000)).filter(Boolean)
      : []
  };
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
  const includeComments = opts.comments === true;
  const dom = async () => {
    await session.navigateGuardedForRead(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const [title, channelHref, description, viewCountText, likeCountText, metadata] = await Promise.all([
      textFor(session, youtubeSelectors.video.title),
      channelFor(session),
      textFor(session, youtubeSelectors.video.description),
      textFor(session, youtubeSelectors.video.viewCount),
      textFor(session, youtubeSelectors.video.likeButton),
      metadataFor(session)
    ]);
    const tags = [...new Set([...metadata.tags, ...tagsFromText(description)])];
    let comments = [];
    if (includeComments) {
      const selector = await resolveYouTubeSelector(session.page, youtubeSelectors.video.commentThreads);
      if (await session.page.locator(selector).count() > 0) {
        comments = await session.page.$$eval(
          selector,
          (nodes) => nodes.slice(0, 100).map((node) => (node.textContent || '').trim()).filter(Boolean)
        );
      }
    }
    return {
      videoId,
      url,
      title,
      channel: channelHref,
      description,
      publishedAt: metadata.publishedAt,
      timestamp: metadata.timestamp,
      tags,
      viewCount: parseCount(viewCountText),
      likeCount: parseCount(likeCountText),
      comments
    };
  };
  const { value } = await executeYouTubeRead({
    action: 'getVideo',
    requested: opts.readStrategy,
    promotion: opts.readPromotion,
    handlers: opts.readHandlers,
    observer: opts.readObserver,
    dom,
    normalize: (content) => normalizeVideoContent(content, {
      videoId,
      url,
      includeComments
    })
  });
  return wrapReadPayload({
    url,
    content: value,
    kind: 'youtube-video'
  });
}
