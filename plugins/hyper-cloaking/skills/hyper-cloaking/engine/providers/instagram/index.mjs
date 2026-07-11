// Instagram provider public surface.
//
// Exports the schema-validated metadata object (unchanged shape, consumed by the
// provider registry) PLUS an importable actions namespace. The registry only
// ever sees `instagramProvider`; the action/selector/session modules are sibling
// exports and are never added to the providers[] array, so the metadata schema's
// forbidden automation fields never apply to those sibling module exports.

export { instagramProvider } from './metadata.mjs';
export { buildInstagramSession, OffOriginError, ChallengeBlockedError, TargetSafetyError } from './session.mjs';
export { instagramSelectors, SELECTORS_VERSION } from './selectors.mjs';
export { executeInstagramRead, instagramReadPromotions } from './network.mjs';

import { getUser } from './actions/user.mjs';
import { getUserPosts } from './actions/posts.mjs';
import { analyzePosts } from './actions/analyze.mjs';
import { likePost, commentPost, savePost, sharePost, repost } from './actions/reactions.mjs';
import { listDMThreads, readDMThread, replyToDM, replyToMany, isValidThreadRef, normalizeThreadRef } from './actions/dm.mjs';

export const instagramActions = {
  // reads
  getUser,
  getUserPosts,
  analyzePosts,
  listDMThreads,
  readDMThread,
  // writes (dryRun-default, guarded)
  likePost,
  commentPost,
  savePost,
  sharePost,
  repost,
  replyToDM,
  replyToMany,
  // helpers
  isValidThreadRef,
  normalizeThreadRef
};

export {
  getUser,
  getUserPosts,
  analyzePosts,
  likePost,
  commentPost,
  savePost,
  sharePost,
  repost,
  listDMThreads,
  readDMThread,
  replyToDM,
  replyToMany,
  isValidThreadRef,
  normalizeThreadRef
};
