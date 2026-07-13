/**
 * @module lifecycle
 *
 * Session lifecycle tools (Phase 2): cloak_launch / cloak_teardown.
 *
 * humanize:true is enforced structurally — the server owns launchCloakBrowser /
 * launchPersistentCloakContext, both of which hard-force humanize; no tool param
 * can disable it.
 */
import { launchCloakBrowser, launchPersistentCloakContext } from '../../engine/browser-utils.mjs';
import { defineTool } from '../error-signal.mjs';

/**
 * Builds the lifecycle tool descriptors bound to a session manager.
 *
 * The launch and teardown handlers use the manager's FIFO serialization and
 * preserve its single-session state. Launch always uses the engine's forced
 * humanization; teardown remains guarded unless force is explicitly supplied.
 *
 * @param {ReturnType<import('../session-manager.mjs').createSessionManager>} manager Session manager providing FIFO state transitions.
 * @returns {Array<object>} Lifecycle tool descriptors.
 * @sideEffects Launches or tears down browser resources through the manager.
 * @state Reads and updates the manager's active-session and pending-claim state.
 */
export function makeLifecycleTools(manager) {
  const launchTool = defineTool({
    name: 'cloak_launch',
    description:
      'Launch the single humanized CloakBrowser session (humanize:true is forced; no param disables it). Returns already-active if a session is live.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        headless: { type: 'boolean', default: true },
        account: { type: 'string' },
        persistent: { type: 'boolean', default: false },
        workspace: { type: 'string' }
      }
    },
    handler(input) {
      return manager.launch(async () => {
        if (input.persistent) {
          const { context } = await launchPersistentCloakContext({
            headless: input.headless ?? true,
            workspace: input.workspace
          });
          const page = context.pages()[0] ?? (await context.newPage());
          return { context, page, account: input.account ?? null };
        }
        const { browser } = await launchCloakBrowser({
          headless: input.headless ?? true,
          workspace: input.workspace
        });
        const context = await browser.newContext();
        const page = await context.newPage();
        return { browser, context, page, account: input.account ?? null };
      });
    }
  });

  const teardownTool = defineTool({
    name: 'cloak_teardown',
    description:
      'Tear down the session. Refuses with needs-confirmation while pending guarded claims exist unless force:true.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { force: { type: 'boolean', default: false } }
    },
    handler(input) {
      return manager.teardown({ force: input.force ?? false });
    }
  });

  return [launchTool, teardownTool];
}
