// YouTube provider public surface. The registry imports metadata directly so
// actions and live-session helpers are never eagerly loaded during discovery.

export { youtubeProvider } from './metadata.mjs';
export { buildYouTubeSession, OffOriginError, ChallengeBlockedError, TargetSafetyError } from './session.mjs';
export { youtubeSelectors, SELECTORS_VERSION, resolveYouTubeSelector } from './selectors.mjs';
export { executeYouTubeRead, youtubeReadPromotions } from './network.mjs';
export {
  normalizeVideoId,
  InvalidVideoRefError,
  watchUrl,
  normalizeChannelRef,
  InvalidChannelRefError,
  channelUrl
} from './actions/ids.mjs';

import { searchVideos } from './actions/search.mjs';
import { getVideo } from './actions/video.mjs';
import { getChannel } from './actions/channel.mjs';
import { analyzeChannel } from './actions/analyze.mjs';
import {
  likeVideo,
  commentVideo,
  subscribeChannel,
  shareVideo,
  saveToPlaylist
} from './actions/reactions.mjs';

export const youtubeActions = {
  searchVideos,
  getVideo,
  getChannel,
  analyzeChannel,
  likeVideo,
  commentVideo,
  subscribeChannel,
  shareVideo,
  saveToPlaylist
};

export {
  searchVideos,
  getVideo,
  getChannel,
  analyzeChannel,
  likeVideo,
  commentVideo,
  subscribeChannel,
  shareVideo,
  saveToPlaylist
};
