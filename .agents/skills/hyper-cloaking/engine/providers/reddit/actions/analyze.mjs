// Pure, deterministic Reddit activity analysis — no browser and no I/O.

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function scoreOf(item) {
  return typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 0;
}

function nearestRank(sorted, percentile) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
  return sorted[index];
}

function subredditOf(item) {
  if (typeof item.subreddit !== 'string') return null;
  const name = item.subreddit.trim().replace(/^r\//i, '').toLowerCase();
  return name || null;
}

/**
 * Analyzes post and comment activity records.
 *
 * @param {Array<{score?: number, timestamp?: string|number, url?: string, subreddit?: string}>} items
 * @returns {object} Stable aggregate activity metrics.
 */
export function analyzeActivity(items = []) {
  const list = Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : [];
  const count = list.length;
  if (count === 0) {
    return {
      count: 0,
      cadence: { postsPerWeek: 0, avgGapHours: null },
      score: { avgScore: 0, medianScore: 0, topPostUrl: null, scoreDistribution: { p25: 0, p50: 0, p75: 0 } },
      topSubreddits: []
    };
  }

  const scores = list.map(scoreOf);
  const sortedScores = [...scores].sort((a, b) => a - b);
  const avgScore = round(scores.reduce((total, value) => total + value, 0) / count);
  let topPostUrl = null;
  let topScore = -Infinity;
  for (const item of list) {
    const score = scoreOf(item);
    if (score > topScore) {
      topScore = score;
      topPostUrl = typeof item.url === 'string' && item.url ? item.url : null;
    }
  }

  const times = list.map((item) => toMillis(item.timestamp)).filter((time) => time !== null).sort((a, b) => a - b);
  let postsPerWeek = 0;
  let avgGapHours = null;
  if (times.length >= 2) {
    const span = times.at(-1) - times[0];
    if (span > 0) {
      postsPerWeek = round((times.length / span) * WEEK_MS);
      avgGapHours = round(span / (times.length - 1) / HOUR_MS);
    }
  }

  const subredditCounts = new Map();
  for (const item of list) {
    const subreddit = subredditOf(item);
    if (subreddit) subredditCounts.set(subreddit, (subredditCounts.get(subreddit) || 0) + 1);
  }
  const topSubreddits = [...subredditCounts.entries()]
    .map(([subreddit, itemCount]) => ({ subreddit, count: itemCount }))
    .sort((a, b) => b.count - a.count || a.subreddit.localeCompare(b.subreddit));

  return {
    count,
    cadence: { postsPerWeek, avgGapHours },
    score: {
      avgScore,
      medianScore: nearestRank(sortedScores, 50),
      topPostUrl,
      scoreDistribution: { p25: nearestRank(sortedScores, 25), p50: nearestRank(sortedScores, 50), p75: nearestRank(sortedScores, 75) }
    },
    topSubreddits
  };
}
