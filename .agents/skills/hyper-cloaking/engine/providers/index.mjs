// Assembles the provider registry from templates and re-exports the public
// registry API (getProvider, resolveProviderForUrl, validateProviderRegistry).

import { genericProvider } from './generic.mjs';
import { instagramProvider } from './instagram.mjs';
import { naverProvider } from './naver.mjs';
import { redditProvider } from './reddit.mjs';
import {
  GENERIC_PROVIDER_ID,
  buildProviderRegistry,
  getProvider as getProviderFromRegistry,
  hostMatchesDomain,
  resolveProviderForUrl as resolveProviderForUrlFromRegistry,
  validateProviderRegistry as validateProviderRegistryFromRegistry
} from './registry.mjs';
import { xProvider } from './x.mjs';
import { youtubeProvider } from './youtube.mjs';

export const providers = [
  genericProvider,
  naverProvider,
  redditProvider,
  instagramProvider,
  youtubeProvider,
  xProvider
];

const registry = buildProviderRegistry(providers);

export function getProvider(id) {
  return getProviderFromRegistry(registry, id);
}

export function resolveProviderForUrl(url) {
  return resolveProviderForUrlFromRegistry(registry, url);
}

export function validateProviderRegistry() {
  return validateProviderRegistryFromRegistry(providers);
}

export { GENERIC_PROVIDER_ID, hostMatchesDomain };
