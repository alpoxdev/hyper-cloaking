/**
 * Public Reddit provider API. Metadata remains separately importable so registry
 * discovery does not load action implementations or browser dependencies.
 */

export { redditProvider } from './metadata.mjs';
export { buildRedditSession, OffOriginError, ChallengeBlockedError, TargetSafetyError } from './session.mjs';
export { redditSelectors, SELECTORS_VERSION, resolveRedditSelector } from './selectors.mjs';
export { executeRedditRead, redditReadPromotions } from './network.mjs';

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
/** Named Reddit read and guarded-write actions exposed to workflow consumers. */
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
/**
 * Public Reddit action functions and reference helpers.
 * @see {@link redditActions}
 */
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
