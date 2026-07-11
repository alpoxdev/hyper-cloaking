export { tiktokProvider } from './metadata.mjs';
export { buildTikTokSession } from './session.mjs';
export { tiktokSelectors, TIKTOK_SELECTORS_VERSION } from './selectors.mjs';
export { executeTikTokRead, tiktokReadPromotions } from './network.mjs';

import { analyzeVideos } from './actions/analyze.mjs';
import {
  assertCommentRef,
  assertDraftRef,
  assertThreadRef,
  assertUserRef,
  assertVideoRef,
  normalizeCommentRef,
  normalizeDraftRef,
  normalizeThreadRef,
  normalizeUserRef,
  normalizeVideoRef
} from './actions/ids.mjs';
import {
  getUser,
  getUserVideos,
  getVideo,
  listDMThreads,
  readDMThread,
  searchVideos
} from './actions/reads.mjs';
import {
  blockedTikTokAction,
  commentVideo,
  createUploadDraft,
  publishDraft,
  replyToComment,
  replyToDM,
  setFollowing,
  setLiked,
  setReposted,
  setSaved
} from './actions/writes.mjs';

export const tiktokActions = {
  getUser,
  getUserVideos,
  getVideo,
  searchVideos,
  listDMThreads,
  readDMThread,
  analyzeVideos,
  setLiked,
  setSaved,
  setFollowing,
  setReposted,
  commentVideo,
  replyToComment,
  replyToDM,
  createUploadDraft,
  publishDraft,
  blockedTikTokAction,
  normalizeUserRef,
  normalizeVideoRef,
  normalizeCommentRef,
  normalizeThreadRef,
  normalizeDraftRef
};

export {
  analyzeVideos,
  assertCommentRef,
  assertDraftRef,
  assertThreadRef,
  assertUserRef,
  assertVideoRef,
  blockedTikTokAction,
  commentVideo,
  createUploadDraft,
  getUser,
  getUserVideos,
  getVideo,
  listDMThreads,
  normalizeCommentRef,
  normalizeDraftRef,
  normalizeThreadRef,
  normalizeUserRef,
  normalizeVideoRef,
  publishDraft,
  readDMThread,
  replyToComment,
  replyToDM,
  searchVideos,
  setFollowing,
  setLiked,
  setReposted,
  setSaved
};
