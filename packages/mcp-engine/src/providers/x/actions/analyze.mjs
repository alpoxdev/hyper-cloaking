/** Analyze up to 100 X posts and summarize engagement and posting cadence. */
function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function average(values) {
  const valid = values.map(finite).filter((value) => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

/**
 * @param {Array<object>} records Post-like records with numeric engagement fields.
 * @returns {{count: number, averageReplies: number|null, averageReposts: number|null, averageLikes: number|null, averageBookmarks: number|null, topPost: object|null, cadenceDays: number|null}}
 */
export function analyzePosts(records) {
  const posts = Array.isArray(records) ? records.slice(0, 100) : [];
  const timestamps = [];
  for (const post of posts) {
    if (Number.isFinite(post?.timestamp)) timestamps.push(post.timestamp);
  }
  const topPost =
    [...posts]
      .filter((post) => finite(post?.likeCount) !== null)
      .sort((left, right) => finite(right.likeCount) - finite(left.likeCount))[0] || null;
  timestamps.sort((left, right) => left - right);
  const cadenceDays =
    timestamps.length > 1
      ? (timestamps.at(-1) - timestamps[0]) / (timestamps.length - 1) / 86_400_000
      : null;
  return {
    count: posts.length,
    averageReplies: average(posts.map((post) => post?.replyCount)),
    averageReposts: average(posts.map((post) => post?.repostCount)),
    averageLikes: average(posts.map((post) => post?.likeCount)),
    averageBookmarks: average(posts.map((post) => post?.bookmarkCount)),
    topPost,
    cadenceDays
  };
}
