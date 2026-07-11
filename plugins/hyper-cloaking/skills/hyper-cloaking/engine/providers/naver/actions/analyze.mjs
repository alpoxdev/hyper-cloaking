/**
 * Derives bounded engagement and posting-cadence metrics from Naver posts.
 * @module naver/actions/analyze
 */
 
function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function average(values) {
  const valid = values.map(finite).filter((value) => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function parseTimestamp(value) {
  if (Number.isFinite(value)) return Number(value);
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Summarize up to 100 posts with count, average comments, top post, and cadence.
 * @param {Array} records
 * @returns {{count: number, averageCommentCount: number|null, topPost: object|null, cadenceDays: number|null}}
 */
 
export function analyzePosts(records) {
  const posts = Array.isArray(records) ? records.slice(0, 100) : [];
  const timestamps = [];
  for (const post of posts) {
    const parsed = parseTimestamp(post?.timestamp);
    if (parsed !== null) timestamps.push(parsed);
  }
  const topPost = [...posts]
    .filter((post) => finite(post?.commentCount) !== null)
    .sort((left, right) => finite(right.commentCount) - finite(left.commentCount))[0] || null;
  timestamps.sort((left, right) => left - right);
  const cadenceDays = timestamps.length > 1
    ? (timestamps.at(-1) - timestamps[0]) / (timestamps.length - 1) / 86_400_000
    : null;
  return {
    count: posts.length,
    averageCommentCount: average(posts.map((post) => post?.commentCount)),
    topPost,
    cadenceDays
  };
}
