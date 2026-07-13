/**
 * @module providers
 *
 * Provider read tool (Phase 3): cloak_provider_read.
 *
 * Provider resolution goes through the fail-closed facade (resolveProviderForUrl
 * / getProvider). Dispatch is restricted to an explicit per-provider READ
 * allowlist, so write actions can never be reached through this tool. Output is
 * untrusted-marked + redacted. Resolution + allowlist checks run BEFORE the
 * session gate so unknown/ambiguous/unsupported requests fail closed without a
 * live browser.
 */
import { markUntrustedBrowserContent, workspacePaths } from '../../engine/browser-utils.mjs';
import { resolveProviderForUrl, getProvider } from '../../engine/providers/index.mjs';
import {
  instagramActions,
  buildInstagramSession
} from '../../engine/providers/instagram/index.mjs';
import { naverActions, buildNaverSession } from '../../engine/providers/naver/index.mjs';
import { youtubeActions, buildYouTubeSession } from '../../engine/providers/youtube/index.mjs';
import { coupangActions, buildCoupangSession } from '../../engine/providers/coupang/index.mjs';
import { tiktokActions, buildTikTokSession } from '../../engine/providers/tiktok/index.mjs';
import { xActions, buildXSession } from '../../engine/providers/x/index.mjs';
import { defineTool } from '../error-signal.mjs';
import { buildWriteOpts, classifyWriteResult } from '../guardrail-bridge.mjs';

// Per-provider READ allowlist + action namespace + session builder. Only these
// names are dispatchable through cloak_provider_read; every write/helper name is
// refused at the boundary.
/**
 * Provider dispatch catalog.
 *
 * @type {Record<string, {
 *   actions: Record<string, Function>,
 *   buildSession: Function,
 *   reads: Set<string>,
 *   writes: Set<string>
 * }>}
 */
const PROVIDERS = {
  instagram: {
    actions: instagramActions,
    buildSession: buildInstagramSession,
    reads: new Set(['getUser', 'getUserPosts', 'analyzePosts', 'listDMThreads', 'readDMThread']),
    writes: new Set([
      'likePost',
      'commentPost',
      'savePost',
      'sharePost',
      'repost',
      'replyToDM',
      'replyToMany'
    ])
  },
  naver: {
    actions: naverActions,
    buildSession: buildNaverSession,
    reads: new Set([
      'searchWeb',
      'searchBlog',
      'searchCafe',
      'getBlogPost',
      'getBlogList',
      'getCafePost',
      'getCafeList',
      'analyzePosts'
    ]),
    writes: new Set([
      'setBlogPostLiked',
      'setCafePostLiked',
      'commentBlogPost',
      'replyToBlogComment',
      'commentCafePost',
      'replyToCafeComment',
      'createBlogDraft',
      'publishBlogDraft',
      'createCafePost'
    ])
  },
  youtube: {
    actions: youtubeActions,
    buildSession: buildYouTubeSession,
    reads: new Set(['searchVideos', 'getVideo', 'getChannel', 'analyzeChannel']),
    writes: new Set([
      'likeVideo',
      'commentVideo',
      'subscribeChannel',
      'shareVideo',
      'saveToPlaylist'
    ])
  },
  coupang: {
    actions: coupangActions,
    buildSession: buildCoupangSession,
    reads: new Set(['searchProducts', 'getProduct', 'analyzeProducts']),
    writes: new Set([
      'addToCart',
      'setCartQuantity',
      'removeCartItem',
      'setSavedState',
      'submitOwnOrderReview'
    ])
  },
  tiktok: {
    actions: tiktokActions,
    buildSession: buildTikTokSession,
    reads: new Set([
      'getUser',
      'getUserVideos',
      'getVideo',
      'searchVideos',
      'listDMThreads',
      'readDMThread',
      'analyzeVideos'
    ]),
    writes: new Set([
      'setLiked',
      'setSaved',
      'setFollowing',
      'setReposted',
      'commentVideo',
      'replyToComment',
      'replyToDM',
      'createUploadDraft',
      'publishDraft'
    ])
  },
  x: {
    actions: xActions,
    buildSession: buildXSession,
    reads: new Set([
      'getUser',
      'getUserPosts',
      'getPost',
      'searchPosts',
      'getThread',
      'listDMThreads',
      'readDMThread',
      'analyzePosts'
    ]),
    writes: new Set([
      'setLiked',
      'setBookmarked',
      'setFollowing',
      'setReposted',
      'createPost',
      'replyToPost',
      'quotePost',
      'replyToDM'
    ])
  }
};
/**
 * Builds a fresh provider capability catalog from the provider dispatch
 * allowlists. Helpers and blocked actions are intentionally not included.
 *
 * @returns {{ status: 'ok', providers: Array<{ id: string, reads: string[], writes: string[] }> }} Capability catalog.
 */
export function buildProviderCapabilities() {
  return {
    status: 'ok',
    providers: Object.entries(PROVIDERS).map(([id, entry]) => ({
      id,
      reads: [...entry.reads],
      writes: [...entry.writes]
    }))
  };
}

/**
 * Session-less MCP tool exposing the provider capability catalog.
 *
 * @returns {object} Provider capability catalog tool descriptor.
 */
export const providerCapabilitiesTool = defineTool({
  name: 'cloak_provider_capabilities',
  description: 'List supported providers and their allowed read and write action names.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {}
  },
  handler() {
    return buildProviderCapabilities();
  }
});

/**
 * Resolves a provider id fail-closed from an explicit id or a URL.
 *
 * @param {{ provider?: string, url?: string }} input Resolution input.
 * @returns {{ ok: true, id: string } | { ok: false, code: string, message: string }} Result.
 */
function resolveProviderId(input) {
  if (input.provider) {
    const resolved = getProvider(input.provider);
    if (!resolved.ok)
      return { ok: false, code: resolved.error.code, message: resolved.error.message };
    return { ok: true, id: resolved.provider.id };
  }
  if (!input.url)
    return { ok: false, code: 'missing-target', message: 'Provide a provider id or a url.' };
  const resolved = resolveProviderForUrl(input.url);
  if (!resolved.ok)
    return { ok: false, code: resolved.error.code, message: resolved.error.message };
  return { ok: true, id: resolved.provider.id };
}

/**
 * Builds the provider read tool bound to a session manager.
 *
 * @param {ReturnType<import('../session-manager.mjs').createSessionManager>} manager Session manager.
 * @returns {object} Provider read tool descriptor.
 */
export function makeProviderReadTool(manager) {
  return defineTool({
    name: 'cloak_provider_read',
    description:
      'Run a provider-specific READ action (fail-closed provider resolution + read allowlist). Write actions are refused. Output is untrusted-marked.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        provider: { type: 'string', description: 'Explicit provider id (else resolved from url).' },
        url: { type: 'string', description: 'Target URL used to resolve the provider.' },
        action: {
          type: 'string',
          description: 'Read action name (must be on the provider read allowlist).'
        },
        args: { type: 'array', description: 'Positional args passed after the session.' }
      }
    },
    handler(input) {
      // Fail-closed resolution + allowlist BEFORE touching the session.
      const resolved = resolveProviderId(input);
      if (!resolved.ok) {
        return { status: 'refused', code: resolved.code, message: resolved.message };
      }
      const entry = PROVIDERS[resolved.id];
      if (!entry) {
        return {
          status: 'refused',
          code: 'no-read-actions',
          provider: resolved.id,
          message: `Provider "${resolved.id}" exposes no read actions.`
        };
      }
      if (!entry.reads.has(input.action)) {
        return {
          status: 'refused',
          code: 'unsupported-read-action',
          provider: resolved.id,
          action: input.action,
          message: `"${input.action}" is not an allowed read action for ${resolved.id}.`
        };
      }
      return manager.withSession(async (session) => {
        const providerSession = entry.buildSession(session.page);
        const result = await entry.actions[input.action](providerSession, ...(input.args ?? []));
        const marked = markUntrustedBrowserContent({
          url: session.page.url(),
          content: JSON.stringify(result),
          kind: 'provider-read'
        });
        return { status: 'ok', provider: resolved.id, action: input.action, ...marked };
      });
    }
  });
}

/**
 * Builds the provider write tool bound to a session manager.
 *
 * @param {ReturnType<import('../session-manager.mjs').createSessionManager>} manager Session manager.
 * @returns {object} Provider write tool descriptor.
 */
export function makeProviderWriteTool(manager) {
  return defineTool({
    name: 'cloak_provider_write',
    description:
      'Run a provider-specific WRITE action. dryRun defaults TRUE; guardrails (rate/idempotency/confirmation/bulk-cap) are enforced by the engine. The MCP server is non-interactive, so bulk writes return needs-confirmation until the host re-drives them. Output is untrusted-marked.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        provider: { type: 'string' },
        url: { type: 'string' },
        action: {
          type: 'string',
          description: 'Write action name (must be on the provider write allowlist).'
        },
        args: {
          type: 'array',
          description: 'Positional args passed after the session, before opts.'
        },
        dryRun: { type: 'boolean', description: 'Defaults true; pass false to actually write.' },
        runId: { type: 'string' },
        confirmed: { type: 'boolean' },
        cap: { type: 'integer', minimum: 1 },
        opts: {
          type: 'object',
          additionalProperties: true,
          description: 'Extra action opts (e.g. per-action enable flag).'
        }
      }
    },
    handler(input) {
      const resolved = resolveProviderId(input);
      if (!resolved.ok) {
        return { status: 'refused', code: resolved.code, message: resolved.message };
      }
      const entry = PROVIDERS[resolved.id];
      if (!entry) {
        return {
          status: 'refused',
          code: 'no-write-actions',
          provider: resolved.id,
          message: `Provider "${resolved.id}" exposes no write actions.`
        };
      }
      if (!entry.writes.has(input.action)) {
        return {
          status: 'refused',
          code: 'unsupported-write-action',
          provider: resolved.id,
          action: input.action,
          message: `"${input.action}" is not an allowed write action for ${resolved.id}.`
        };
      }
      return manager.withSession(async (session) => {
        const stateDir = workspacePaths(input.opts?.workspace).stateDir;
        // MCP context is non-interactive: bulk confirmation cannot be auto-satisfied.
        const providerSession = entry.buildSession(session.page, { stateDir, interactive: false });
        const opts = buildWriteOpts(input);
        const result = await entry.actions[input.action](
          providerSession,
          ...(input.args ?? []),
          opts
        );
        const classification = classifyWriteResult(result);
        const marked = markUntrustedBrowserContent({
          url: session.page.url(),
          content: JSON.stringify(result),
          kind: 'provider-write'
        });
        return { ...classification, provider: resolved.id, action: input.action, ...marked };
      });
    }
  });
}
