/**
 * @module index
 *
 * Aggregated tool catalog. Each phase appends its implemented tools here; the
 * server registers exactly this set so `tools/list` reflects real capability.
 */
import { createSessionManager } from '../session-manager.mjs';
import { setupTool, makeStatusTool } from './setup.mjs';
import { cookiesListTool, cookiesStatusTool } from './cookies.mjs';
import { makeLifecycleTools } from './lifecycle.mjs';
import { makeNavigateTool } from './navigate.mjs';
import { makeInteractTools } from './interact.mjs';
import {
  makeProviderReadTool,
  makeProviderWriteTool,
  providerCapabilitiesTool
} from './providers.mjs';
import { credentialsTool } from './credentials.mjs';

/**
 * Process-wide session manager shared by every session-bound tool.
 *
 * @type {ReturnType<typeof createSessionManager>}
 * @sideeffects Creates the singleton manager at module initialization.
 */
export const sessionManager = createSessionManager();

// Phase 1: read-only, session-less tools (cloak_status is bound to the manager).
const phase1 = [
  setupTool,
  makeStatusTool(sessionManager),
  cookiesListTool,
  cookiesStatusTool,
  providerCapabilitiesTool
];

// Phase 2: lifecycle + generic browser tools (session-bound).
const phase2 = [
  ...makeLifecycleTools(sessionManager),
  makeNavigateTool(sessionManager),
  ...makeInteractTools(sessionManager)
];

// Phase 3: provider read tools (session-bound, fail-closed).
const phase3 = [makeProviderReadTool(sessionManager)];

// Phase 4: provider write tools + guardrail bridge + credentials.
const phase4 = [makeProviderWriteTool(sessionManager), credentialsTool];

/**
 * Ordered catalog registered with the MCP server.
 *
 * @type {Array<object>}
 * @sideeffects Exposes the phase-ordered tool descriptors to registration.
 */
export const allTools = [...phase1, ...phase2, ...phase3, ...phase4];
