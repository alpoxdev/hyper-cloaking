const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE_PATTERN = /^[A-Za-z0-9._-]{3,30}$/;

export class InvalidVideoRefError extends Error {
  constructor(ref) {
    super(`Invalid YouTube video reference: ${String(ref)}`);
    this.name = 'InvalidVideoRefError';
    this.code = 'invalid-video-ref';
    this.ref = ref;
  }
}

export class InvalidChannelRefError extends Error {
  constructor(ref) {
    super(`Invalid YouTube channel reference: ${String(ref)}`);
    this.name = 'InvalidChannelRefError';
    this.code = 'invalid-channel-ref';
    this.ref = ref;
  }
}

function parseUrl(ref) {
  try {
    return new URL(ref, 'https://www.youtube.com');
  } catch {
    return null;
  }
}

function isYouTubeHost(hostname) {
  return hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
}

/** Returns a canonical eleven-character YouTube video ID. */
export function normalizeVideoId(ref) {
  if (typeof ref !== 'string') return null;

  const value = ref.trim();
  if (VIDEO_ID_PATTERN.test(value)) return value;

  const url = parseUrl(value);
  let videoId = null;
  if (url && isYouTubeHost(url.hostname) && url.pathname === '/watch') {
    videoId = url.searchParams.get('v');
  } else if (url && (url.hostname === 'youtu.be' || url.hostname.endsWith('.youtu.be'))) {
    videoId = url.pathname.split('/').filter(Boolean)[0] || null;
  }

  return videoId && VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
}

/** Builds the canonical navigable YouTube watch URL. */
export function watchUrl(ref) {
  const videoId = normalizeVideoId(ref);
  if (!videoId) throw new InvalidVideoRefError(ref);
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Returns a canonical YouTube channel handle or channel ID. Handles never carry
 * their display `@` prefix; channel IDs retain their `UC` prefix.
 */
export function normalizeChannelRef(ref) {
  if (typeof ref !== 'string') return null;

  const value = ref.trim();
  if (CHANNEL_ID_PATTERN.test(value)) return value;

  const directHandle = value.startsWith('@') ? value.slice(1) : value;
  if (HANDLE_PATTERN.test(directHandle) && !directHandle.includes('/')) return directHandle;

  const url = parseUrl(value);
  const path =
    url && isYouTubeHost(url.hostname) ? url.pathname : value.startsWith('/') ? value : null;
  const match = path?.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/);
  if (match) return match[1];

  const handleMatch =
    url && isYouTubeHost(url.hostname)
      ? url.pathname.match(/^\/@([A-Za-z0-9._-]{3,30})\/?$/)
      : null;
  return handleMatch ? handleMatch[1] : null;
}

/** Builds the canonical navigable YouTube channel URL. */
export function channelUrl(ref) {
  const channel = normalizeChannelRef(ref);
  if (!channel) throw new InvalidChannelRefError(ref);
  return CHANNEL_ID_PATTERN.test(channel)
    ? `https://www.youtube.com/channel/${channel}`
    : `https://www.youtube.com/@${channel}`;
}
