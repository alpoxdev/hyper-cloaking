/**
 * @module credentials
 *
 * Owner-managed credential tools (Phase 4): cloak_credentials.
 *
 * Reads delegate to credentials.mjs, which returns ONLY redacted profile
 * metadata — there is no cleartext-reveal API, so secrets can never be returned.
 * A reveal request is refused with needs-confirmation (host-only, never served
 * by the MCP server).
 */
import { listCredentialProfiles, inspectCredentialProfile } from '../../engine/credentials.mjs';
import { defineTool } from '../error-signal.mjs';

/**
 * Exposes owner-managed credential metadata operations; cleartext reveal is
 * fail-closed as a host-only confirmation result.
 *
 * @type {object}
 */
export const credentialsTool = defineTool({
  name: 'cloak_credentials',
  description:
    'Owner-managed credential metadata. op=list/inspect return redacted profiles (secrets never returned in cleartext). op=reveal returns needs-confirmation (host-only).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['op'],
    properties: {
      op: { type: 'string', enum: ['list', 'inspect', 'reveal'] },
      provider: { type: 'string' },
      profileId: { type: 'string' },
      workspace: {
        type: 'string',
        description: 'Credential home (defaults to the runtime workspace).'
      }
    }
  },
  async handler(input) {
    const home = input.workspace;
    if (input.op === 'list') {
      const profiles = await listCredentialProfiles({ home, provider: input.provider });
      return { status: 'ok', op: 'list', profiles };
    }
    if (input.op === 'inspect') {
      if (!input.profileId)
        return { status: 'invalid-args', message: 'inspect requires profileId.' };
      const profile = await inspectCredentialProfile({ home, profileId: input.profileId });
      return profile
        ? { status: 'ok', op: 'inspect', profile }
        : { status: 'not-found', op: 'inspect', profileId: input.profileId };
    }
    // reveal: the server never returns cleartext secrets; the host owns any reveal.
    return {
      status: 'needs-confirmation',
      code: 'reveal-host-only',
      message: 'Credential reveal is host-only; the MCP server never returns secret values.'
    };
  }
});
