/**
 * @module setup
 *
 * Read-only, session-less setup + status tools (Phase 1).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureWorkspace, workspacePaths } from '@mcp/engine';
import { defineTool } from '../runtime/error-signal.mjs';

/**
 * Reports whether the cloakbrowser package resolves in the current module graph.
 *
 * @returns {boolean} True when resolvable.
 */
function cloakbrowserResolvable() {
  try {
    import.meta.resolve('cloakbrowser');
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects a downloaded chromium build under the workspace cloakbrowser cache.
 *
 * @param {string} root Workspace root.
 * @returns {Promise<string | null>} Chromium build directory name, or null.
 */
async function detectChromium(root) {
  const cacheDir = path.join(root, 'cache', 'cloakbrowser');
  try {
    const entries = await fs.readdir(cacheDir);
    return entries.find((name) => name.startsWith('chromium-')) ?? null;
  } catch {
    return null;
  }
}

/**
 * Reports whether a guarded-action store already exists in the workspace state dir.
 *
 * @param {string} stateDir Workspace state directory.
 * @returns {Promise<boolean>} True when the store file exists.
 */
async function guardStorePresent(stateDir) {
  try {
    await fs.access(path.join(stateDir, 'guarded-actions-v1.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates the setup tool descriptor.
 *
 * @type {object}
 */
export const setupTool = defineTool({
  name: 'cloak_setup',
  description:
    'Create the hyper-cloaking runtime workspace (profiles/downloads/evidence/logs/state + cookie.yml) and report cloakbrowser/chromium availability. No browser launch.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { workspace: { type: 'string', description: 'Optional workspace override.' } }
  },
  async handler({ workspace }) {
    const paths = await ensureWorkspace(workspace);
    const cloakbrowser = cloakbrowserResolvable();
    const chromium = await detectChromium(paths.root);
    const ready = cloakbrowser && Boolean(chromium);
    return {
      status: ready ? 'ready' : 'needs-install',
      workspace: paths.root,
      paths,
      cloakbrowser,
      chromium: chromium || null,
      installHint: ready
        ? undefined
        : 'Install cloakbrowser into the workspace and let it download chromium before launching.'
    };
  }
});

/**
 * Builds the cloak_status tool bound to a session manager so it reports live
 * session + queue state.
 *
 * @param {ReturnType<import('../runtime/session-manager.mjs').createSessionManager>} manager Session manager.
 * @returns {object} Status tool descriptor.
 */
export function makeStatusTool(manager) {
  return defineTool({
    name: 'cloak_status',
    description: 'Summarize workspace + live session/queue + guardrail-store state.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { workspace: { type: 'string' } }
    },
    async handler({ workspace }) {
      const paths = workspacePaths(workspace);
      const snap = manager.snapshot();
      return {
        status: 'ok',
        workspace: paths.root,
        session: snap.active
          ? {
              account: snap.account,
              createdAt: snap.createdAt,
              lastUsedAt: snap.lastUsedAt,
              pendingClaims: snap.pendingClaims
            }
          : null,
        queue: { active: snap.active, depth: snap.queueDepth },
        guardrailStore: { present: await guardStorePresent(paths.stateDir) }
      };
    }
  });
}
