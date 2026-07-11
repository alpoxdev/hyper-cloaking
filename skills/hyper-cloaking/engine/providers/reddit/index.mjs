// Reddit provider public surface. Registry consumers import metadata only.

export { redditProvider } from './metadata.mjs';
export { buildRedditSession, OffOriginError, ChallengeBlockedError, TargetSafetyError } from './session.mjs';
export { redditSelectors, SELECTORS_VERSION, resolveRedditSelector } from './selectors.mjs';

import { getSubreddit } from './actions/listing.mjs';
import { getPost } from './actions/post.mjs';
import { getUserProfile } from './actions/user.mjs';
import { analyzeActivity } from './actions/analyze.mjs';
import { upvotePost, commentPost, replyToComment, savePost } from './actions/reactions.mjs';
import {
  normalizeSubreddit,
  subredditUrl,
  normalizePostRef,
  assertPostRef,
  InvalidPostRefError,
  normalizeCommentRef,
  assertExistingCommentRef,
  InvalidCommentRefError,
  normalizeRedditUser,
  userUrl
} from './actions/ids.mjs';

export const redditActions = {
  getSubreddit,
  getPost,
  getUserProfile,
  analyzeActivity,
  upvotePost,
  commentPost,
  replyToComment,
  savePost
};

export {
  getSubreddit,
  getPost,
  getUserProfile,
  analyzeActivity,
  upvotePost,
  commentPost,
  replyToComment,
  savePost,
  normalizeSubreddit,
  subredditUrl,
  normalizePostRef,
  assertPostRef,
  InvalidPostRefError,
  normalizeCommentRef,
  assertExistingCommentRef,
  InvalidCommentRefError,
  normalizeRedditUser,
  userUrl
};
