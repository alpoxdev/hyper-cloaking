/**
 * Verification primitives for the versioned agent-envelope protocol.
 * This module is the trust boundary: callers must verify role output before
 * consuming result data or publishing evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const SCHEMA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schemas', 'hyper-cloaking-agent-output.schema.json');

/** Load the canonical JSON Schema from this plugin tree. */
export function loadAgentEnvelopeSchema(schemaPath = SCHEMA_PATH) {
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

/** Compile strict schema validation; the returned Ajv function exposes `.errors`. */
export function compileAgentEnvelopeValidator(schema = loadAgentEnvelopeSchema()) {
  const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
  return ajv.compile(schema);
}

let defaultValidator;

function validator() {
  defaultValidator ||= compileAgentEnvelopeValidator();
  return defaultValidator;
}

/**
 * Verify one complete agent envelope without mutating it.
 * @returns {{ok: true, value: object}|{ok: false, route: string, verifierCode: string, errors: object[], failure: object}}
 */
export function verifyAgentEnvelope(envelope, { validate = validator() } = {}) {
  if (validate(envelope)) return { ok: true, value: envelope };
  const errors = (validate.errors || []).map(normalizeError);
  return {
    ok: false,
    route: 'contract_failure',
    verifierCode: classifyErrors(errors),
    errors,
    failure: {
      code: 'contract_failure',
      phase: 'parent-verify',
      retryable: false,
      observedSignal: errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ') || 'schema validation failed'
    }
  };
}

function normalizeError(error) {
  return {
    instancePath: error.instancePath || '',
    schemaPath: error.schemaPath || '',
    keyword: error.keyword || 'unknown',
    message: error.message || 'invalid value',
    params: error.params || {}
  };
}

function classifyErrors(errors) {
  if (errors.some((error) => error.keyword === 'required')) return 'missing-required';
  if (errors.some((error) => error.keyword === 'unevaluatedProperties' || error.keyword === 'additionalProperties')) return 'unknown-field';
  if (errors.some((error) => error.schemaPath.includes('/oneOf') || error.schemaPath.includes('/agent') || error.schemaPath.includes('/result'))) return 'agent-result-mismatch';
  return 'schema-invalid';
}

/** Read exactly one object-shaped JSON document; empty, malformed, or non-object input throws. */
export async function readSingleJson(stream) {
  let text = '';
  for await (const chunk of stream) text += chunk;
  if (!text.trim()) throw new Error('stdin must contain one JSON object');
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('stdin JSON must be an object');
  return value;
}

export async function runParentVerifyCli(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const stdin = io.stdin || process.stdin;
  if (argv.length !== 2 || argv[0] !== '--input-stdin' || argv[1] !== '--json') {
    stderr.write('Usage: parent-verify --input-stdin --json\n');
    return 2;
  }
  try {
    const result = verifyAgentEnvelope(await readSingleJson(stdin));
    stdout.write(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runParentVerifyCli();
}
