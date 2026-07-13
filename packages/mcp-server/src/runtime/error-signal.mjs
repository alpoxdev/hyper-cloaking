/**
 * @module error-signal
 *
 * Tool result + error->signal plumbing shared by every hyper-cloaking-mcp tool.
 *
 * Principle 7: no engine throw crosses the MCP boundary as a raw exception.
 * Handlers return plain structured payloads; `defineTool` validates input with
 * ajv, serializes the payload into MCP CallTool content, and converts any thrown
 * engine error into a typed, redacted signal.
 */
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Wraps a structured payload in the MCP CallTool result shape.
 *
 * @param {{ status?: string }} payload Structured tool payload.
 * @returns {{ content: Array<{ type: 'text', text: string }>, isError: boolean }} MCP result.
 */
export function jsonResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: payload?.status === 'error'
  };
}

// Ordered engine-throw -> typed-signal rules. Later phases append rules for
// target-safety, guardrails, and provider resolution. The default rule below
// guarantees an unexpected throw still becomes a redacted structured error.
const ERROR_RULES = [
  {
    match: /Ambiguous cookie site selection/i,
    signal: (m) => ({ status: 'needs-account', code: 'ambiguous-site', message: m })
  },
  {
    match: /Unknown cookie site/i,
    signal: (m) => ({ status: 'refused', code: 'unknown-site', message: m })
  },
  {
    match: /Multiple cookie accounts are available/i,
    signal: (m) => ({ status: 'needs-account', code: 'needs-account', message: m })
  },
  {
    match: /Navigation blocked by target safety/i,
    signal: (m) => ({ status: 'needs-preflight', code: 'navigation-blocked', message: m })
  },
  {
    match: /has no bounding box/i,
    signal: (m) => ({ status: 'refused', code: 'target-not-actionable', message: m })
  }
];
const SECRET_PATTERN = /(authorization|cookie|token|secret|password|api[-_ ]?key)\s*[:=]\s*\S+/gi;

/**
 * Redacts obvious secret-bearing substrings from an error message.
 *
 * @param {string} message Raw message.
 * @returns {string} Redacted message.
 */
export function redactMessage(message) {
  return String(message || '').replace(SECRET_PATTERN, '$1: [redacted]');
}

/**
 * Maps a thrown engine error to a typed, redacted tool signal.
 *
 * @param {unknown} error Thrown value.
 * @returns {{ status: string, code: string, message: string }} Typed signal.
 */
export function mapErrorToSignal(error) {
  const message = redactMessage(error?.message ?? error);
  for (const rule of ERROR_RULES) {
    if (rule.match.test(message)) return rule.signal(message);
  }
  return { status: 'error', code: 'engine-error', message };
}

/**
 * Defines a typed MCP tool with ajv input validation and error->signal mapping.
 *
 * @param {{ name: string, description: string, inputSchema: object, handler: (args: object) => Promise<object> | object }} spec Tool spec.
 * @returns {{ name: string, description: string, inputSchema: object, handler: (args: object) => Promise<object> }} Registered descriptor.
 */
export function defineTool({ name, description, inputSchema, handler }) {
  const validate = ajv.compile(inputSchema);
  return {
    name,
    description,
    inputSchema,
    async handler(args) {
      const input = args ?? {};
      if (!validate(input)) {
        return jsonResult({
          status: 'invalid-args',
          code: 'schema-validation',
          errors: (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`)
        });
      }
      try {
        return jsonResult(await handler(input));
      } catch (error) {
        return jsonResult(mapErrorToSignal(error));
      }
    }
  };
}
