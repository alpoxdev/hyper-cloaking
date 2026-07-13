import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ALLOWED_TYPES = new Set(['screenshot', 'log', 'json', 'report']);
const RESERVED_SEGMENTS = new Set([
  '.git',
  '.gjc',
  'node_modules',
  '.env',
  'cookies',
  'cookie',
  'credentials',
  'tokens'
]);
const SECRET_PATTERN =
  /(cookie|authorization|bearer|token|password|credential)\s*[:=]\s*([^\s,"'}]+)/gi;

/**
 * Publishes validated agent and parent-private artifacts into an invocation-scoped
 * evidence directory and returns its durable publication receipt.
 *
 * @param {object} options
 * @param {string} options.agentStagingRoot Absolute, non-symlink agent staging directory.
 * @param {string} options.parentPrivateStagingRoot Absolute, non-symlink parent-private staging directory.
 * @param {string} [options.evidenceId] UUID naming the evidence publication.
 * @param {string} [options.invocationToken] UUID binding publication and recovery.
 * @param {Array<{type:'screenshot'|'log'|'json'|'report',relPath:string,destination?:string,description?:string}>} [options.evidenceRefs=[]] Agent artifacts to publish.
 * @param {*} [options.diagnosticReport=null] Optional diagnostic value serialized as JSON.
 * @param {*} [options.failure=null] Optional failure value serialized as JSON.
 * @param {{ok?:boolean,closed?:boolean,timedOut?:boolean}|null} [options.cleanup=null] Verified browser-cleanup result required when publishing refs.
 * @param {string} options.homeDir Absolute parent-authorized output root.
 * @param {boolean} [options.redactSecrets=true] Whether generated JSON reports have secret-like values redacted.
 * @param {boolean} [options.cleanupStaging=true] Whether owned staging roots are removed after publication.
 * @returns {Promise<{evidenceId:string,invocationToken:string,persistedPaths:string[],sha256:string,timestamp:string}>} Publication receipt.
 * @throws {Error|AggregateError} If validation, secure publication, integrity checks, or cleanup fails.
 * @sideeffects Creates and fsyncs the evidence tree and removes owned staging contents when enabled.
 */
export async function persistEvidence({
  agentStagingRoot,
  parentPrivateStagingRoot,
  evidenceId = crypto.randomUUID(),
  invocationToken = crypto.randomUUID(),
  evidenceRefs = [],
  diagnosticReport = null,
  failure = null,
  cleanup = null,
  homeDir,
  redactSecrets = true,
  cleanupStaging = true
}) {
  validateUuid(evidenceId, 'evidenceId');
  validateUuid(invocationToken, 'invocationToken');
  if (!homeDir || !path.isAbsolute(homeDir))
    throw new Error('homeDir must be an absolute parent-authorized path');
  const homeRoot = await secureRealDirectory(homeDir, 'homeDir');
  if (evidenceRefs.length > 0 && !cleanupSucceeded(cleanup))
    throw new Error('browser cleanup is not verified; evidence publication is forbidden');

  const agentRoot = await secureRealDirectory(agentStagingRoot, 'agentStagingRoot');
  const privateRoot = await secureRealDirectory(
    parentPrivateStagingRoot,
    'parentPrivateStagingRoot'
  );
  if (
    agentRoot === privateRoot ||
    isInside(agentRoot, privateRoot) ||
    isInside(privateRoot, agentRoot)
  )
    throw new Error('agent and parent-private staging roots must be separate');

  const publish = [];
  const sources = new Set();
  const destinations = new Set();
  for (const ref of evidenceRefs) {
    if (!ref || !ALLOWED_TYPES.has(ref.type)) throw new Error('unsupported evidence type');
    const relPath = validateRelative(ref.relPath);
    const destination = validateRelative(ref.destination || relPath);
    if (sources.has(relPath)) throw new Error(`duplicate evidence source: ${relPath}`);
    if (destinations.has(destination))
      throw new Error(`duplicate evidence destination: ${destination}`);
    sources.add(relPath);
    destinations.add(destination);
    const source = await secureSource(agentRoot, relPath);
    const sourceStat = await fsp.stat(source);
    publish.push({
      source,
      relativePath: destination,
      sourceScope: 'agent',
      type: ref.type,
      description: String(ref.description || ''),
      sha256: await hashFile(source),
      size: sourceStat.size
    });
  }

  if (diagnosticReport !== null)
    publish.push(
      await generatedFile(
        privateRoot,
        'diagnostics-report.json',
        diagnosticReport,
        destinations,
        redactSecrets
      )
    );
  if (failure !== null)
    publish.push(
      await generatedFile(privateRoot, 'failure-report.json', failure, destinations, redactSecrets)
    );

  const evidenceRoot = path.join(homeRoot, 'evidence');
  await ensureSecureDirectory(evidenceRoot);
  const finalDir = path.join(evidenceRoot, evidenceId);
  let marker;
  let receipt;
  let publicationError = null;
  try {
    await fsp.mkdir(finalDir, { mode: 0o700 });
    await syncDirectory(evidenceRoot);
    marker = markerValue('reserved', evidenceId, invocationToken, publish);
    await exclusiveJson(path.join(finalDir, '.publication.json'), marker);
    await updateMarker(finalDir, marker, 'publishing');
    for (const item of publish) {
      await assertAncestorsStable(finalDir);
      const destination = path.join(finalDir, item.relativePath);
      if (!isInside(finalDir, destination))
        throw new Error('evidence destination escapes final directory');
      await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await rejectSymlinkChain(finalDir, path.relative(finalDir, path.dirname(destination)));
      await fsp.copyFile(item.source, destination, fs.constants.COPYFILE_EXCL);
      await fsp.chmod(destination, 0o600);
      await syncFile(destination);
      await syncDirectory(path.dirname(destination));
      const stat = await fsp.lstat(destination);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error('published evidence is not a regular file');
      const digest = await hashFile(destination);
      if (digest !== item.sha256)
        throw new Error(`published evidence hash mismatch: ${item.relativePath}`);
    }
    marker = await updateMarker(finalDir, marker, 'complete');
    receipt = {
      evidenceId,
      invocationToken,
      persistedPaths: publish.map((item) => path.join(finalDir, item.relativePath)),
      sha256: marker.manifestSha256,
      timestamp: marker.updatedAt
    };
  } catch (error) {
    publicationError = error instanceof Error ? error : new Error(String(error));
  }

  const cleanupErrors = cleanupStaging ? await cleanupOwnedStaging([agentRoot, privateRoot]) : [];
  if (publicationError) {
    if (cleanupErrors.length > 0) {
      publicationError.cleanupErrors = cleanupErrors.map((error) => error.message);
    }
    throw publicationError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'evidence staging cleanup failed');
  }
  return receipt;
}

/**
 * Validates and optionally removes an interrupted evidence publication.
 *
 * @param {object} options
 * @param {string} options.finalDir Evidence publication directory.
 * @param {string} options.invocationToken Token expected in the publication marker.
 * @param {boolean} [options.removeIncomplete=false] Remove an incomplete publication after validation.
 * @returns {Promise<{status:'complete',marker:object}|{status:'removed'}|{status:'incomplete',marker:object,present:string[]}>} Recovery status and marker details.
 * @throws {Error} If the marker, manifest, paths, file types, sizes, or hashes are invalid.
 * @sideeffects Reads publication files and, when requested, deletes the incomplete publication.
 */
export async function recoverEvidencePublication({
  finalDir,
  invocationToken,
  removeIncomplete = false
}) {
  validateUuid(invocationToken, 'invocationToken');
  const markerPath = path.join(finalDir, '.publication.json');
  const marker = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
  const expected = validatePublicationMarker(marker, finalDir, invocationToken);
  const actual = (await listFiles(finalDir)).filter((item) => item !== '.publication.json');
  const expectedPaths = [...expected.keys()].sort();
  for (const relPath of actual) {
    if (!expected.has(relPath)) throw new Error(`unexpected publication entry: ${relPath}`);
  }
  if (marker.state === 'complete' && stableStringify(actual) !== stableStringify(expectedPaths)) {
    throw new Error('complete publication file set does not match marker manifest');
  }
  for (const relPath of actual) {
    const file = path.join(finalDir, relPath);
    const stat = await fsp.lstat(file);
    const record = expected.get(relPath);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`publication entry is not a regular file: ${relPath}`);
    if (stat.size !== record.size || (await hashFile(file)) !== record.sha256) {
      throw new Error(`publication hash or size mismatch: ${relPath}`);
    }
  }
  if (marker.state === 'complete') return { status: 'complete', marker };
  if (removeIncomplete) {
    for (const relPath of actual) await fsp.rm(path.join(finalDir, relPath));
    await fsp.rm(markerPath);
    await fsp.rm(finalDir, { recursive: true });
    await syncDirectory(path.dirname(finalDir));
    return { status: 'removed' };
  }
  return { status: 'incomplete', marker, present: actual };
}

function cleanupSucceeded(cleanup) {
  return cleanup?.ok === true && cleanup?.closed === true && cleanup?.timedOut === false;
}

function validatePublicationMarker(marker, finalDir, invocationToken) {
  if (!marker || marker.version !== 1) throw new Error('invalid publication marker version');
  validateUuid(marker.evidenceId, 'marker evidenceId');
  validateUuid(marker.invocationToken, 'marker invocationToken');
  if (marker.invocationToken !== invocationToken) throw new Error('publication token mismatch');
  if (path.basename(path.resolve(finalDir)) !== marker.evidenceId)
    throw new Error('publication namespace does not match evidenceId');
  if (!['reserved', 'publishing', 'complete'].includes(marker.state))
    throw new Error('invalid publication marker state');
  if (!Array.isArray(marker.files)) throw new Error('publication marker files must be an array');
  const expected = new Map();
  for (const file of marker.files) {
    if (!file || typeof file !== 'object') throw new Error('invalid publication marker file');
    const relativePath = validateRelative(file.relativePath);
    if (relativePath !== file.relativePath)
      throw new Error(`publication marker path is not canonical: ${file.relativePath}`);
    if (expected.has(relativePath))
      throw new Error(`duplicate publication marker path: ${relativePath}`);
    if (!['agent', 'parent'].includes(file.sourceScope))
      throw new Error(`invalid publication source scope: ${relativePath}`);
    if (!/^[0-9a-f]{64}$/i.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error(`invalid publication hash or size: ${relativePath}`);
    }
    expected.set(relativePath, file);
  }
  const manifestSha256 = sha256(Buffer.from(stableStringify(marker.files)));
  if (marker.manifestSha256 !== manifestSha256)
    throw new Error('publication marker manifest digest mismatch');
  return expected;
}

async function generatedFile(privateRoot, name, value, destinations, redactSecrets) {
  if (destinations.has(name)) throw new Error(`duplicate evidence destination: ${name}`);
  destinations.add(name);
  const file = path.join(privateRoot, name);
  const flags =
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    fs.constants.O_WRONLY |
    (fs.constants.O_NOFOLLOW || 0);
  let handle;
  const serialized = `${stableStringify(redactSecrets ? redact(value) : value)}\n`;
  try {
    handle = await fsp.open(file, flags, 0o600);
    await handle.writeFile(serialized);
    await handle.sync();
  } finally {
    if (handle) await handle.close();
  }
  await syncDirectory(path.dirname(file));
  return {
    source: file,
    relativePath: name,
    sourceScope: 'parent',
    type: 'json',
    description: name,
    sha256: await hashFile(file),
    size: Buffer.byteLength(serialized)
  };
}

async function secureSource(root, relPath) {
  await rejectSymlinkChain(root, relPath);
  const source = path.resolve(root, relPath);
  if (!isInside(root, source)) throw new Error('evidence source escapes staging root');
  const real = await fsp.realpath(source);
  if (!isInside(root, real)) throw new Error('evidence source realpath escapes staging root');
  const stat = await fsp.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('evidence source must be a regular non-symlink file');
  return source;
}

async function secureRealDirectory(value, label) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${label} must be absolute`);
  const stat = await fsp.lstat(value);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`${label} must be a non-symlink directory`);
  return fsp.realpath(value);
}

async function ensureSecureDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  await assertAncestorsStable(directory);
  const stat = await fsp.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('evidence root is not a secure directory');
}

async function assertAncestorsStable(target) {
  let current = path.resolve(target);
  while (current !== path.dirname(current)) {
    try {
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`symlink ancestor is forbidden: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    current = path.dirname(current);
  }
}

async function rejectSymlinkChain(root, relativePath) {
  let current = root;
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`symlink path is forbidden: ${relativePath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function validateRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value))
    throw new Error('evidence path must be relative');
  const normalized = path.normalize(value);
  const segments = normalized.split(path.sep);
  if (
    normalized === '..' ||
    normalized.startsWith(`..${path.sep}`) ||
    segments.some((segment) => RESERVED_SEGMENTS.has(segment.toLowerCase()))
  )
    throw new Error(`unsafe evidence path: ${value}`);
  return normalized;
}

function validateUuid(value, label) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    throw new Error(`${label} must be a canonical UUID`);
}

function markerValue(state, evidenceId, invocationToken, publish) {
  const files = publish.map((item) => ({
    relativePath: item.relativePath,
    sourceScope: item.sourceScope,
    sha256: item.sha256,
    size: item.size ?? fs.statSync(item.source).size
  }));
  return {
    version: 1,
    evidenceId,
    invocationToken,
    state,
    manifestSha256: sha256(Buffer.from(stableStringify(files))),
    files,
    updatedAt: new Date().toISOString()
  };
}

async function updateMarker(finalDir, marker, state) {
  const next = { ...marker, state, updatedAt: new Date().toISOString() };
  const temp = path.join(finalDir, `.publication.${crypto.randomUUID()}.tmp`);
  await exclusiveJson(temp, next);
  await fsp.rename(temp, path.join(finalDir, '.publication.json'));
  await syncDirectory(finalDir);
  return next;
}

async function exclusiveJson(file, value) {
  let handle;
  try {
    handle = await fsp.open(file, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    if (handle) await handle.close();
  }
  await syncDirectory(path.dirname(file));
}

function redact(value) {
  if (typeof value === 'string') return value.replace(SECRET_PATTERN, '$1=[REDACTED]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /(cookie|token|password|credential|authorization)/i.test(key) ? '[REDACTED]' : redact(item)
      ])
    );
  }
  return value;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function hashFile(file) {
  return sha256(await fsp.readFile(file));
}
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function listFiles(root) {
  const out = [];
  async function walk(directory, prefix = '') {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? path.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else if (entry.isFile()) out.push(relative);
      else throw new Error(`unsupported publication entry: ${relative}`);
    }
  }
  await walk(root);
  return out.sort();
}

async function ownedCleanup(root) {
  const stat = await fsp.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`owned staging root is not a non-symlink directory: ${root}`);
  }
  await fsp.rm(root, { recursive: true });
  await syncDirectory(path.dirname(root));
}

async function cleanupOwnedStaging(roots) {
  const settled = await Promise.allSettled(roots.map((root) => ownedCleanup(root)));
  return settled
    .filter((result) => result.status === 'rejected')
    .map((result) =>
      result.reason instanceof Error ? result.reason : new Error(String(result.reason))
    );
}

async function syncFile(file) {
  const handle = await fsp.open(file, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory) {
  const handle = await fsp.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
