/**
 * Public X provider surface: metadata, session, selectors, reads, and actions.
 * Action functions retain their provider-specific safety and normalization rules.
 */
export { xProvider } from './metadata.mjs';
export { buildXSession } from './session.mjs';
export { xSelectors, X_SELECTORS_VERSION } from './selectors.mjs';
export { executeXRead, xReadPromotions } from './network.mjs';

import { analyzePosts } from './actions/analyze.mjs';
import {
  assertPostRef,
  assertThreadRef,
  assertUserRef,
  normalizePostRef,
  normalizeThreadRef,
  normalizeUserRef
} from './actions/ids.mjs';
import {
  getPost,
  getThread,
  getUser,
  getUserPosts,
  listDMThreads,
  readDMThread,
  searchPosts
} from './actions/reads.mjs';
import {
  blockedXAction,
  createPost,
  quotePost,
  replyToDM,
  replyToPost,
  setBookmarked,
  setFollowing,
  setLiked,
  setReposted
} from './actions/writes.mjs';

/**
 * Action registry for supported X reads, writes, analysis, and reference helpers.
 * The object is suitable for dispatch by action name.
 */
export const xActions = {
  getUser,
  getUserPosts,
  getPost,
  searchPosts,
  getThread,
  listDMThreads,
  readDMThread,
  analyzePosts,
  setLiked,
  setBookmarked,
  setFollowing,
  setReposted,
  createPost,
  replyToPost,
  quotePost,
  replyToDM,
  blockedXAction,
  normalizeUserRef,
  normalizePostRef,
  normalizeThreadRef
};

export {
  analyzePosts,
  assertPostRef,
  assertThreadRef,
  assertUserRef,
  blockedXAction,
  createPost,
  getPost,
  getThread,
  getUser,
  getUserPosts,
  listDMThreads,
  normalizePostRef,
  normalizeThreadRef,
  normalizeUserRef,
  quotePost,
  readDMThread,
  replyToDM,
  replyToPost,
  searchPosts,
  setBookmarked,
  setFollowing,
  setLiked,
  setReposted
};
