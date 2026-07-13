/**
 * @module interact
 *
 * Generic browser interaction tools (Phase 2):
 * cloak_snapshot / cloak_click / cloak_type / cloak_scroll / cloak_screenshot.
 *
 * Reads use native ariaSnapshot; writes resolve ref/selector -> locator and route
 * through the ENGINE's humanized input layer (humanClick/humanType/humanScroll) so
 * humanization is structural. Snapshot output is untrusted-marked + redacted.
 */
import path from 'node:path';
import { humanClick, humanType, humanScroll } from '@mcp/engine/browser-utils';
import { markUntrustedBrowserContent, summarizeEvidenceRef, workspacePaths } from '@mcp/engine';
import { defineTool } from '../runtime/error-signal.mjs';
import { takeAriaSnapshot, resolveTarget } from '../runtime/snapshot-resolver.mjs';

/**
 * Shared ref/selector target schema for interaction tools.
 *
 * @type {object}
 * @private
 */
const TARGET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', description: 'Bare aria-ref id (eXX) from cloak_snapshot.' },
    selector: { type: 'string', description: 'CSS or XPath selector alternative to ref.' }
  },
  anyOf: [{ required: ['ref'] }, { required: ['selector'] }]
};

/**
 * Builds the interaction tool descriptors bound to a session manager.
 *
 * @param {ReturnType<import('../runtime/session-manager.mjs').createSessionManager>} manager Session manager.
 * @returns {Array<object>} Interaction tool descriptors, in stable snapshot/click/type/scroll/screenshot order.
 * @sideeffects Registers no global state; each descriptor uses the supplied manager's serialized session.
 */
export function makeInteractTools(manager) {
  const snapshotTool = defineTool({
    name: 'cloak_snapshot',
    description:
      'Capture a native accessibility snapshot with stable aria-ref handles. Output is untrusted-marked and redacted; large snapshots are truncated.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { maxChars: { type: 'integer', minimum: 500 } }
    },
    handler(input) {
      return manager.withSession(async (session) => {
        const { snapshot, truncated, totalChars } = await takeAriaSnapshot(session.page, {
          maxChars: input.maxChars
        });
        const marked = markUntrustedBrowserContent({
          url: session.page.url(),
          content: snapshot,
          kind: 'aria-snapshot'
        });
        return { status: 'ok', truncated, totalChars, ...marked };
      });
    }
  });

  const clickTool = defineTool({
    name: 'cloak_click',
    description: 'Click a ref/selector target through the engine humanized pointer path.',
    inputSchema: TARGET_SCHEMA,
    handler(input) {
      return manager.withSession(async (session) => {
        await humanClick(session.page, resolveTarget(session.page, input));
        return { status: 'ok', action: 'click' };
      });
    }
  });

  const typeTool = defineTool({
    name: 'cloak_type',
    description:
      'Type text into a ref/selector target through the engine humanized keystroke path.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        ref: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' },
        clear: { type: 'boolean' },
        submit: { type: 'boolean' }
      },
      anyOf: [{ required: ['ref'] }, { required: ['selector'] }]
    },
    handler(input) {
      return manager.withSession(async (session) => {
        await humanType(session.page, resolveTarget(session.page, input), input.text, {
          clear: input.clear,
          submit: input.submit
        });
        return { status: 'ok', action: 'type' };
      });
    }
  });

  const scrollTool = defineTool({
    name: 'cloak_scroll',
    description: 'Scroll the page through the engine humanized wheel path.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        distance: { type: 'number' },
        steps: { type: 'integer', minimum: 1 }
      }
    },
    handler(input) {
      return manager.withSession(async (session) => {
        await humanScroll(session.page, { distance: input.distance, steps: input.steps });
        return { status: 'ok', action: 'scroll' };
      });
    }
  });

  const screenshotTool = defineTool({
    name: 'cloak_screenshot',
    description:
      'Capture a screenshot into the workspace evidence dir. Returns a redacted evidence ref (path only).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        fullPage: { type: 'boolean' },
        workspace: { type: 'string' }
      }
    },
    handler(input) {
      return manager.withSession(async (session) => {
        const paths = workspacePaths(input.workspace);
        const file = path.join(paths.evidenceDir, `shot-${Date.now()}.png`);
        await session.page.screenshot({ path: file, fullPage: input.fullPage ?? false });
        return {
          status: 'ok',
          evidence: summarizeEvidenceRef({ path: file, kind: 'screenshot', trusted: true })
        };
      });
    }
  });

  return [snapshotTool, clickTool, typeTool, scrollTool, screenshotTool];
}
