/**
 * Pure Instagram post/reel analysis.
 *
 * Performs no browser, network, filesystem, or account-state I/O. It accepts a
 * possibly imperfect Post[] value, ignores non-object entries, treats missing
 * numeric engagement as zero, and tolerates invalid timestamps. The
 * deterministic result reports count, post/reel mix, cadence, engagement, and
 * at most ten normalized hashtag counts; empty/invalid input returns the
 * zero-valued result shape.
 */

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;

function toMillis(ts) {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function median(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round(n, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * Analyzes an array of posts/reels.
 *
 * @param {Array<{type?: string, timestamp?: string|number, likeCount?: number, commentCount?: number, url?: string, hashtags?: string[]}>} posts
 * @returns {object} Aggregate analysis.
 */
export function analyzePosts(posts = []) {
  const list = Array.isArray(posts) ? posts.filter((p) => p && typeof p === 'object') : [];
  const count = list.length;

  if (count === 0) {
    return {
      count: 0,
      mediaMix: { post: 0, reel: 0 },
      cadence: { postsPerWeek: 0, avgGapHours: null },
      engagement: { avgLikes: 0, avgComments: 0, medianLikes: 0, topPostUrl: null },
      topHashtags: []
    };
  }

  const mediaMix = { post: 0, reel: 0 };
  for (const p of list) {
    if (p.type === 'reel') mediaMix.reel += 1;
    else mediaMix.post += 1;
  }

  const likes = list.map((p) => (Number.isFinite(p.likeCount) ? p.likeCount : 0));
  const comments = list.map((p) => (Number.isFinite(p.commentCount) ? p.commentCount : 0));
  const avgLikes = round(likes.reduce((a, b) => a + b, 0) / count);
  const avgComments = round(comments.reduce((a, b) => a + b, 0) / count);

  let topPostUrl = null;
  let topLikes = -1;
  for (const p of list) {
    const l = Number.isFinite(p.likeCount) ? p.likeCount : 0;
    if (l > topLikes) {
      topLikes = l;
      topPostUrl = p.url ?? null;
    }
  }

  // Cadence from available timestamps.
  const times = list.map((p) => toMillis(p.timestamp)).filter((t) => t !== null).sort((a, b) => a - b);
  let postsPerWeek = 0;
  let avgGapHours = null;
  if (times.length >= 2) {
    const span = times[times.length - 1] - times[0];
    if (span > 0) {
      postsPerWeek = round((times.length / span) * WEEK_MS);
      avgGapHours = round(span / (times.length - 1) / HOUR_MS);
    }
  }

  // Top hashtags.
  const tagCounts = new Map();
  for (const p of list) {
    const tags = Array.isArray(p.hashtags) ? p.hashtags : [];
    for (const raw of tags) {
      const tag = String(raw).trim().toLowerCase().replace(/^#/, '');
      if (!tag) continue;
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }
  const topHashtags = [...tagCounts.entries()]
    .map(([tag, c]) => ({ tag, count: c }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 10);

  return {
    count,
    mediaMix,
    cadence: { postsPerWeek, avgGapHours },
    engagement: {
      avgLikes,
      avgComments,
      medianLikes: median(likes),
      topPostUrl
    },
    topHashtags
  };
}
