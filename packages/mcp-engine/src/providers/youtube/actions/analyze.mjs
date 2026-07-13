// Pure YouTube channel analysis — no browser or I/O.

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function toMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function videoTime(video) {
  return toMillis(video.publishedAt) ?? toMillis(video.uploadedAt) ?? toMillis(video.timestamp);
}

/**
 * Analyzes structured channel videos deterministically.
 *
 * @param {Array<{url?: string, publishedAt?: string|number, uploadedAt?: string|number, timestamp?: string|number, viewCount?: number, likeCount?: number, tags?: string[]}>} videos
 * @returns {{count: number, cadence: {uploadsPerWeek: number, avgGapHours: number|null}, engagement: {avgViews: number, avgLikes: number, medianViews: number, topVideoUrl: string|null}, topTags: Array<{tag: string, count: number}>}}
 */
export function analyzeChannel(videos = []) {
  const list = Array.isArray(videos)
    ? videos.filter((video) => video && typeof video === 'object')
    : [];
  const count = list.length;
  const views = list.map((video) => numberOrZero(video.viewCount));
  const likes = list.map((video) => numberOrZero(video.likeCount));

  let topVideoUrl = null;
  let topViews = -1;
  for (const video of list) {
    const videoViews = numberOrZero(video.viewCount);
    if (videoViews > topViews) {
      topViews = videoViews;
      topVideoUrl = typeof video.url === 'string' ? video.url : null;
    }
  }

  const times = list
    .map(videoTime)
    .filter((time) => time !== null)
    .sort((a, b) => a - b);
  let uploadsPerWeek = 0;
  let avgGapHours = null;
  if (times.length >= 2) {
    const span = times[times.length - 1] - times[0];
    if (span > 0) {
      uploadsPerWeek = round((times.length / span) * WEEK_MS);
      avgGapHours = round(span / (times.length - 1) / HOUR_MS);
    }
  }

  const tagCounts = new Map();
  for (const video of list) {
    for (const rawTag of Array.isArray(video.tags) ? video.tags : []) {
      if (typeof rawTag !== 'string') continue;
      const tag = String(rawTag).trim().toLowerCase().replace(/^#/, '');
      if (!tag) continue;
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  return {
    count,
    cadence: { uploadsPerWeek, avgGapHours },
    engagement: {
      avgViews: count === 0 ? 0 : round(views.reduce((total, value) => total + value, 0) / count),
      avgLikes: count === 0 ? 0 : round(likes.reduce((total, value) => total + value, 0) / count),
      medianViews: median(views),
      topVideoUrl
    },
    topTags: [...tagCounts.entries()]
      .map(([tag, tagCount]) => ({ tag, count: tagCount }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 10)
  };
}
