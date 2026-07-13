import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CANONICAL_ROOT = 'mcp/src';
export const CANONICAL_TARGETS = [
  { key: 'mcp-src', root: 'mcp/src', policy: 'strict' },
  { key: 'mcp-engine', root: 'mcp/engine', policy: 'bounded' }
];
export function canonicalTarget(key) {
  return CANONICAL_TARGETS.find((target) => target.key === key);
}
export function selectCanonicalTargets(selection = 'all') {
  const keys =
    selection === 'all' || selection == null
      ? CANONICAL_TARGETS.map((target) => target.key)
      : Array.isArray(selection)
        ? selection
        : [selection];
  if (keys.some((key) => !canonicalTarget(key))) throw new Error('unknown-audit-target');
  return keys.map((key) => canonicalTarget(key));
}
export function buildTargetManifest(target) {
  const canonical = target && canonicalTarget(target.key);
  if (!target || !target.root || !target.key || !canonical) throw new Error('unknown-audit-target');
  if (!fs.existsSync(target.root) || !fs.statSync(target.root).isDirectory())
    throw new Error('target-root-missing');
  const paths = enumerateMjsFiles(target.root);
  if (!paths.length) throw new Error('target-empty');
  return {
    key: canonical.key,
    policy: canonical.policy,
    canonicalRoot: target.root,
    paths,
    discoveredCount: paths.length,
    pathTextSha256: sha256(`${paths.join('\n')}\n`)
  };
}
export function generateTargetManifests(selection = 'all') {
  return selectCanonicalTargets(selection).map(buildTargetManifest);
}
export const selectAuditTargets = selectCanonicalTargets;
export const resolveCanonicalTargets = selectCanonicalTargets;
export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
export function serializeCanonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}
export const serializeCanonical = serializeCanonicalJson;
export function validateRelativeModulePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].every((ch) => ch.charCodeAt(0) <= 0x7f) &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    value.endsWith('.mjs') &&
    value.split('/').every((part) => part && part !== '.' && part !== '..') &&
    value.split('/').join('/') === value
  );
}
export function normalizeRelativePath(value) {
  if (!validateRelativeModulePath(value)) throw new Error('path-invalid');
  return value;
}
export function enumerateMjsFiles(root) {
  const output = [];
  function walk(dir, relative = '') {
    for (const name of fs.readdirSync(dir).toSorted()) {
      const rel = relative ? `${relative}/${name}` : name;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else if (name.endsWith('.mjs')) output.push(normalizeRelativePath(rel));
    }
  }
  walk(root);
  return output.toSorted();
}
export function buildInventory(root) {
  const paths = enumerateMjsFiles(root);
  return {
    version: 1,
    canonicalRoot: root,
    paths,
    discoveredCount: paths.length,
    pathTextSha256: sha256(`${paths.join('\n')}\n`)
  };
}
export async function generateInventory({ canonicalRoot }) {
  return buildInventory(canonicalRoot);
}
function validateDigest(inv) {
  return inv?.pathTextSha256 === sha256(`${(inv?.paths || []).join('\n')}\n`);
}
export function validateInventoryArtifact(inv, { canonicalRoot } = {}) {
  const errors = [];
  if (!inv || inv.version !== 1) errors.push('schema-version');
  if (canonicalRoot && inv?.canonicalRoot !== canonicalRoot) errors.push('root-mismatch');
  const paths = inv?.paths || [];
  if (paths.some((item) => !validateRelativeModulePath(item))) errors.push('path-invalid');
  if (paths.some((item, i) => i && item <= paths[i - 1])) errors.push('path-unsorted');
  if (new Set(paths).size !== paths.length) errors.push('path-duplicate');
  if (inv?.discoveredCount !== paths.length) errors.push('count-mismatch');
  if (!validateDigest(inv)) errors.push('digest-mismatch');
  if (errors.length) throw new Error(errors.join(','));
  return true;
}
export const validateInventory = validateInventoryArtifact;
export function partitionInventory(inventory, size) {
  if (!Number.isInteger(size) || size < 1) throw new Error('slice-size-invalid');
  validateInventoryArtifact(inventory);
  const slices = [];
  for (let i = 0; i < inventory.paths.length; i += size) {
    const paths = inventory.paths.slice(i, i + size);
    slices.push({
      version: 1,
      index: slices.length,
      paths,
      discoveredCount: paths.length,
      pathTextSha256: sha256(`${paths.join('\n')}\n`)
    });
  }
  return slices;
}
export function validateSliceArtifact(slices, inventory) {
  validateInventoryArtifact(inventory);
  if (!Array.isArray(slices)) throw new Error('slices-invalid');
  const actual = [];
  for (const [index, slice] of slices.entries()) {
    if (
      !slice ||
      slice.version !== 1 ||
      slice.index !== index ||
      !Array.isArray(slice.paths) ||
      slice.discoveredCount !== slice.paths.length ||
      slice.pathTextSha256 !== sha256(`${slice.paths.join('\n')}\n`)
    )
      throw new Error('slice-schema-or-digest-invalid');
    if (slice.paths.some((item) => !validateRelativeModulePath(item)))
      throw new Error('path-invalid');
    actual.push(...slice.paths);
  }
  if (
    JSON.stringify(actual) !== JSON.stringify(inventory.paths) ||
    new Set(actual).size !== actual.length
  )
    throw new Error('slice-partition-invalid');
  return true;
}
function lineEnding(value) {
  return value.includes('\r\n') ? 'crlf' : value.includes('\r') ? 'cr' : 'lf';
}
export function buildBaseline(root, inventory, details = {}) {
  validateInventoryArtifact(inventory, { canonicalRoot: root });
  const files = inventory.paths.map((item) => {
    const bytes = fs.readFileSync(path.join(root, item));
    const source = bytes.toString();
    return {
      path: item,
      contentSha256: sha256(bytes),
      sourceBasis: {
        sourceSha256: sha256(bytes),
        lineEnding: lineEnding(source),
        byteLength: bytes.length,
        astSha256: details[item]?.astSha256 || sha256(source)
      },
      exportSignatures: details[item]?.exportSignatures || [],
      nonCommentTokenBasis: details[item]?.nonCommentTokenBasis || []
    };
  });
  return {
    schemaVersion: 1,
    inventoryArtifact: details.inventoryArtifact || '.gjc/jsdoc/generated-inventory.json',
    inventoryArtifactSha256: details.inventoryArtifactSha256 || '',
    pathTextSha256: inventory.pathTextSha256,
    canonicalRoot: root,
    paths: inventory.paths,
    discoveredCount: files.length,
    files
  };
}
export function validatePreDispatchFreshness(root, baseline) {
  const errors = [];
  for (const file of baseline?.files || []) {
    try {
      if (sha256(fs.readFileSync(path.join(root, file.path))) !== file.contentSha256)
        errors.push({ code: 'baseline-content-mismatch', path: file.path });
    } catch {
      errors.push({ code: 'path-invalid', path: file.path });
    }
  }
  return errors;
}
export function validatePostEditBaselineIntegrity(root, baseline) {
  return validatePreDispatchFreshness(root, baseline);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  try {
    if (command === 'inventory')
      console.log(serializeCanonicalJson(buildInventory(process.argv[3] || CANONICAL_ROOT)));
    else if (command === 'verify')
      validateInventoryArtifact(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), {
        canonicalRoot: process.argv[4]
      });
    else throw new Error('usage: inventory <root> | verify <artifact> [root]');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
