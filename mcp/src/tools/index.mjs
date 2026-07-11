/**
 * Aggregated tool catalog. Each phase appends its implemented tools here; the
 * server registers exactly this set so `tools/list` reflects real capability.
 */
import { createSessionManager } from '../session-manager.mjs';
import { setupTool, makeStatusTool } from './setup.mjs';
import { cookiesListTool, cookiesStatusTool } from './cookies.mjs';
import { makeLifecycleTools } from './lifecycle.mjs';
import { makeNavigateTool } from './navigate.mjs';
import { makeInteractTools } from './interact.mjs';
import { makeProviderReadTool, makeProviderWriteTool } from './providers.mjs';
import { credentialsTool } from './credentials.mjs';

// One process-wide session shared across callers, serialized by its FIFO queue.
export const sessionManager = createSessionManager();

// Phase 1: read-only, session-less tools (cloak_status is bound to the manager).
const phase1 = [setupTool, makeStatusTool(sessionManager), cookiesListTool, cookiesStatusTool];

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

export const allTools = [...phase1, ...phase2, ...phase3, ...phase4];
