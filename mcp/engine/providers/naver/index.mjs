/**
 * Public Naver provider surface: metadata, guarded reads, selectors, sessions,
 * and supported action handlers for registry and runtime consumers.
 */

export { naverProvider } from './metadata.mjs';
export { buildNaverSession, ChallengeBlockedError, OffOriginError, TargetSafetyError } from './session.mjs';
export { naverSelectors, NAVER_SELECTORS_VERSION } from './selectors.mjs';
export { executeNaverRead, naverReadPromotions } from './network.mjs';

import { analyzePosts } from './actions/analyze.mjs';
import {
  assertBlogCommentRef,
  assertBlogPostRef,
  assertBlogRef,
  assertCafeCommentRef,
  assertCafePostRef,
  assertCafeRef,
  assertDraftRef,
  normalizeBlogCommentRef,
  normalizeBlogPostRef,
  normalizeBlogRef,
  normalizeCafeCommentRef,
  normalizeCafePostRef,
  normalizeCafeRef,
  normalizeDraftRef
} from './actions/ids.mjs';
import {
  getBlogList,
  getBlogPost,
  getCafeList,
  getCafePost,
  searchBlog,
  searchCafe,
  searchWeb
} from './actions/reads.mjs';
import {
  blockedNaverAction,
  commentBlogPost,
  commentCafePost,
  createBlogDraft,
  createCafePost,
  publishBlogDraft,
  replyToBlogComment,
  replyToCafeComment,
  setBlogPostLiked,
  setCafePostLiked
} from './actions/writes.mjs';

/**
 * Action handlers exposed by the Naver provider.
 *
 * The map is intentionally limited to supported read, engagement, publishing,
 * normalization, and explicitly blocked operations.
 */
export const naverActions = {
  searchWeb,
  searchBlog,
  searchCafe,
  getBlogPost,
  getBlogList,
  getCafePost,
  getCafeList,
  analyzePosts,
  setBlogPostLiked,
  setCafePostLiked,
  commentBlogPost,
  replyToBlogComment,
  commentCafePost,
  replyToCafeComment,
  createBlogDraft,
  publishBlogDraft,
  createCafePost,
  blockedNaverAction,
  normalizeBlogRef,
  normalizeBlogPostRef,
  normalizeBlogCommentRef,
  normalizeCafeRef,
  normalizeCafePostRef,
  normalizeCafeCommentRef,
  normalizeDraftRef
};

export {
  analyzePosts,
  assertBlogCommentRef,
  assertBlogPostRef,
  assertBlogRef,
  assertCafeCommentRef,
  assertCafePostRef,
  assertCafeRef,
  assertDraftRef,
  blockedNaverAction,
  commentBlogPost,
  commentCafePost,
  createBlogDraft,
  createCafePost,
  getBlogList,
  getBlogPost,
  getCafeList,
  getCafePost,
  normalizeBlogCommentRef,
  normalizeBlogPostRef,
  normalizeBlogRef,
  normalizeCafeCommentRef,
  normalizeCafePostRef,
  normalizeCafeRef,
  normalizeDraftRef,
  publishBlogDraft,
  replyToBlogComment,
  replyToCafeComment,
  searchBlog,
  searchCafe,
  searchWeb,
  setBlogPostLiked,
  setCafePostLiked
};
