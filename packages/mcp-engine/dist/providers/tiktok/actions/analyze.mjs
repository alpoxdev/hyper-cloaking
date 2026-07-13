function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function average(values) {
  const valid = values.map(finite).filter((value) => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

/**
 * Summarizes up to 100 TikTok video records into engagement averages, cadence,
 * the highest-viewed video, and normalized hashtag frequencies.
 * @param {Array<object>} records Video records containing counts, timestamps, and hashtags.
 * @returns {{count: number, averageViews: number|null, averageLikes: number|null, averageComments: number|null, topVideo: object|null, cadenceDays: number|null, hashtags: Array<{tag: string, count: number}>}}
 */
export function analyzeVideos(records) {
  const videos = Array.isArray(records) ? records.slice(0, 100) : [];
  const hashtags = new Map();
  const timestamps = [];
  for (const video of videos) {
    for (const tag of Array.isArray(video?.hashtags) ? video.hashtags.slice(0, 100) : []) {
      const key = String(tag).toLowerCase();
      if (key) hashtags.set(key, (hashtags.get(key) || 0) + 1);
    }
    if (Number.isFinite(video?.timestamp)) timestamps.push(video.timestamp);
  }
  const topVideo =
    [...videos]
      .filter((video) => finite(video?.viewCount) !== null)
      .sort((left, right) => finite(right.viewCount) - finite(left.viewCount))[0] || null;
  timestamps.sort((left, right) => left - right);
  const cadenceDays =
    timestamps.length > 1
      ? (timestamps.at(-1) - timestamps[0]) / (timestamps.length - 1) / 86_400_000
      : null;
  return {
    count: videos.length,
    averageViews: average(videos.map((video) => video?.viewCount)),
    averageLikes: average(videos.map((video) => video?.likeCount)),
    averageComments: average(videos.map((video) => video?.commentCount)),
    topVideo,
    cadenceDays,
    hashtags: [...hashtags.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
  };
}
