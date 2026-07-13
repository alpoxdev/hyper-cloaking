/**
 * Owner-controlled, filesystem-backed credential profile store.
 * Profiles are schema-validated and mutated through revisioned operations with
 * locking, secure permissions, and recovery markers.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveHome } from './config.mjs';

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 20_000;
const MAX_STRING_LENGTH = 128 * 1024;
const LOCK_TIMEOUT_MS = 2_000;
const LOCK_RETRY_MS = 10;
const PROFILE_MARKERS = new Set(['refresh-ambiguous', 'token-invalid', 'scope-unverified']);
const LOCK_PHASES = new Set([
  'reserved',
  'refresh-dispatched',
  'official-dispatched',
  'denial-invalid-token',
  'denial-insufficient-scope'
]);
const RETAIN_PROFILE_LOCK = Symbol('retainProfileLock');
const DANGEROUS_KEYS = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  ...Object.getOwnPropertyNames(Function.prototype)
]);

export const PROFILE_KINDS = Object.freeze({
  instagram: Object.freeze({
    'graph-oauth': ['accessToken']
  }),
  youtube: Object.freeze({
    'api-key': ['apiKey'],
    oauth2: ['accessToken']
  }),
  coupang: Object.freeze({
    hmac: ['accessKey', 'secretKey']
  }),
  tiktok: Object.freeze({
    oauth2: ['accessToken']
  }),
  naver: Object.freeze({
    'client-credentials': ['clientId', 'clientSecret']
  }),
  x: Object.freeze({
    bearer: ['bearerToken'],
    oauth2: ['accessToken'],
    oauth1: ['consumerKey', 'consumerSecret', 'accessToken', 'accessTokenSecret']
  })
});
const OFFICIAL_ORIGINS = Object.freeze({
  instagram: Object.freeze(['https://graph.instagram.com', 'https://graph.facebook.com']),
  youtube: Object.freeze(['https://www.googleapis.com', 'https://youtube.googleapis.com']),
  coupang: Object.freeze(['https://api-gateway.coupang.com']),
  tiktok: Object.freeze(['https://open.tiktokapis.com']),
  naver: Object.freeze(['https://openapi.naver.com']),
  x: Object.freeze(['https://api.x.com', 'https://api.twitter.com'])
});

export class CredentialStoreError extends Error {
  constructor(
    code,
    message,
    { operationId = null, beforeRevision = null, afterRevision = null, result = null, cause } = {}
  ) {
    super(message, { cause });
    this.name = 'CredentialStoreError';
    this.code = code;
    this.operationId = operationId;
    this.beforeRevision = beforeRevision;
    this.afterRevision = afterRevision;
    this.result = result;
  }
}

function nullRecord() {
  return Object.create(null);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])])
  );
}

function stableJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function requireSafeKey(value, label) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) ||
    DANGEROUS_KEYS.has(value)
  ) {
    throw new TypeError(`${label} must be a safe identifier`);
  }
  return value;
}

function requireString(value, label, { optional = false, maximum = MAX_STRING_LENGTH } = {}) {
  if (optional && (value == null || value === '')) return null;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    value.includes('\0')
  ) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function stringList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const result = value.map((item, index) =>
    requireString(item, `${label}[${index}]`, { maximum: 512 })
  );
  if (new Set(result).size !== result.length)
    throw new TypeError(`${label} must not contain duplicates`);
  return result.sort();
}

class StrictJsonParser {
  constructor(text) {
    if (typeof text !== 'string') throw new TypeError('credential JSON must be text');
    if (Buffer.byteLength(text) > MAX_STORE_BYTES)
      throw new TypeError('credential JSON exceeds size limit');
    this.text = text;
    this.index = 0;
    this.nodes = 0;
  }

  parse() {
    const value = this.value(0);
    this.space();
    if (this.index !== this.text.length) this.error('unexpected trailing data');
    return value;
  }

  error(message) {
    throw new SyntaxError(`Invalid credential JSON at ${this.index}: ${message}`);
  }

  space() {
    while (/\s/.test(this.text[this.index] || '')) this.index += 1;
  }

  value(depth) {
    if (depth > MAX_JSON_DEPTH) this.error('maximum depth exceeded');
    this.nodes += 1;
    if (this.nodes > MAX_JSON_NODES) this.error('maximum node count exceeded');
    this.space();
    const token = this.text[this.index];
    if (token === '{') return this.object(depth + 1);
    if (token === '[') return this.array(depth + 1);
    if (token === '"') return this.string();
    if (this.text.startsWith('true', this.index)) {
      this.index += 4;
      return true;
    }
    if (this.text.startsWith('false', this.index)) {
      this.index += 5;
      return false;
    }
    if (this.text.startsWith('null', this.index)) {
      this.index += 4;
      return null;
    }
    const match = this.text.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (match) {
      this.index += match[0].length;
      const value = Number(match[0]);
      if (!Number.isFinite(value)) this.error('number must be finite');
      return value;
    }
    this.error('unexpected token');
  }

  object(depth) {
    this.index += 1;
    const output = nullRecord();
    const keys = new Set();
    this.space();
    if (this.text[this.index] === '}') {
      this.index += 1;
      return output;
    }
    while (true) {
      this.space();
      if (this.text[this.index] !== '"') this.error('object key must be a string');
      const key = this.string();
      requireSafeKey(key, 'JSON key');
      if (keys.has(key)) this.error(`duplicate key "${key}"`);
      keys.add(key);
      this.space();
      if (this.text[this.index] !== ':') this.error('expected colon');
      this.index += 1;
      output[key] = this.value(depth);
      this.space();
      if (this.text[this.index] === '}') {
        this.index += 1;
        return output;
      }
      if (this.text[this.index] !== ',') this.error('expected comma');
      this.index += 1;
    }
  }

  array(depth) {
    this.index += 1;
    const output = [];
    this.space();
    if (this.text[this.index] === ']') {
      this.index += 1;
      return output;
    }
    while (true) {
      output.push(this.value(depth));
      this.space();
      if (this.text[this.index] === ']') {
        this.index += 1;
        return output;
      }
      if (this.text[this.index] !== ',') this.error('expected comma');
      this.index += 1;
    }
  }

  string() {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (!escaped && character === '"') {
        this.index += 1;
        const raw = this.text.slice(start, this.index);
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          this.error('invalid string escape');
        }
        if (parsed.length > MAX_STRING_LENGTH || parsed.includes('\0'))
          this.error('string exceeds policy');
        return parsed;
      }
      if (!escaped && character.charCodeAt(0) < 0x20) this.error('unescaped control character');
      escaped = !escaped && character === '\\';
      if (character !== '\\') escaped = false;
      this.index += 1;
    }
    this.error('unterminated string');
  }
}

/** Parses strict JSON credential descriptors and rejects trailing input. */
export function parseCredentialJson(text) {
  return new StrictJsonParser(text).parse();
}

/** Returns secure filesystem paths for the credential store under `home`. */
export function credentialPaths(home) {
  const root = path.join(resolveHome(home), 'secrets');
  return Object.freeze({
    root,
    store: path.join(root, 'providers.json'),
    lock: path.join(root, 'providers.lock'),
    refreshLocks: path.join(root, 'refresh-locks'),
    journals: path.join(root, 'operation-journal'),
    profileState: path.join(root, 'profile-state')
  });
}

function emptyStore() {
  return {
    version: STORE_VERSION,
    revision: 0,
    defaults: nullRecord(),
    profiles: nullRecord()
  };
}

function profileRequirements(provider, kind) {
  const kinds = PROFILE_KINDS[provider];
  if (!kinds || !Object.hasOwn(kinds, kind))
    throw new TypeError(`unsupported provider profile kind: ${provider}/${kind}`);
  return kinds[kind];
}

function validateCredentials(credentials, required, label) {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials))
    throw new TypeError(`${label}.credentials must be an object`);
  const result = nullRecord();
  const allowed = new Set(required);
  for (const [key, value] of Object.entries(credentials)) {
    requireSafeKey(key, `${label}.credentials key`);
    if (!allowed.has(key))
      throw new TypeError(`${label}.credentials.${key} is not allowed for this profile kind`);
    result[key] = requireString(value, `${label}.credentials.${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(result, key)) throw new TypeError(`${label}.credentials.${key} is required`);
  }
  return result;
}

function validateScopeEvidence(input, verifiedScopes, label) {
  if (verifiedScopes.length === 0) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`${label}.scopeEvidence is required for verified scopes`);
  }
  const source = input.source;
  if (!['remote-introspection', 'remote-refresh', 'provider-response'].includes(source)) {
    throw new TypeError(`${label}.scopeEvidence.source is invalid`);
  }
  const evidenceHash = requireString(input.evidenceHash, `${label}.scopeEvidence.evidenceHash`, {
    maximum: 64
  });
  if (!/^[a-f0-9]{64}$/.test(evidenceHash))
    throw new TypeError(`${label}.scopeEvidence.evidenceHash must be SHA-256 hex`);
  const verifiedAt = Number(input.verifiedAt);
  if (!Number.isFinite(verifiedAt) || verifiedAt <= 0)
    throw new TypeError(`${label}.scopeEvidence.verifiedAt must be positive and finite`);
  return { source, evidenceHash, verifiedAt };
}

function validateProfile(profileId, input) {
  requireSafeKey(profileId, 'profile id');
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError(`profile ${profileId} must be an object`);
  const allowedFields = new Set([
    'provider',
    'kind',
    'credentials',
    'declaredScopes',
    'verifiedScopes',
    'scopeEvidence',
    'verifiedAt',
    'expiresAt',
    'updatedAt'
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedFields.has(key)) throw new TypeError(`profile ${profileId}.${key} is not allowed`);
  }
  const provider = requireSafeKey(input.provider, `profile ${profileId}.provider`);
  const kind = requireSafeKey(input.kind, `profile ${profileId}.kind`);
  const required = profileRequirements(provider, kind);
  const credentials = validateCredentials(input.credentials, required, `profile ${profileId}`);
  const declaredScopes = stringList(input.declaredScopes, `profile ${profileId}.declaredScopes`);
  const verifiedScopes = stringList(input.verifiedScopes, `profile ${profileId}.verifiedScopes`);
  const scopeEvidence = validateScopeEvidence(
    input.scopeEvidence,
    verifiedScopes,
    `profile ${profileId}`
  );
  const verifiedAt = scopeEvidence?.verifiedAt ?? null;
  if (input.verifiedAt != null && Number(input.verifiedAt) !== verifiedAt) {
    throw new TypeError(`profile ${profileId}.verifiedAt must match scope evidence`);
  }
  const expiresAt = input.expiresAt == null ? null : Number(input.expiresAt);
  if (expiresAt != null && !Number.isFinite(expiresAt))
    throw new TypeError(`profile ${profileId}.expiresAt must be finite`);
  return {
    provider,
    kind,
    credentials,
    declaredScopes,
    verifiedScopes,
    scopeEvidence,
    verifiedAt,
    expiresAt,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now()
  };
}

/** Validates the persisted store schema and returns the normalized value. */
export function validateCredentialStore(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('credential store must be an object');
  if (input.version !== STORE_VERSION)
    throw new TypeError(`credential store version must be ${STORE_VERSION}`);
  if (!Number.isInteger(input.revision) || input.revision < 0)
    throw new TypeError('credential store revision must be a non-negative integer');
  if (!input.defaults || typeof input.defaults !== 'object' || Array.isArray(input.defaults))
    throw new TypeError('credential defaults must be an object');
  if (!input.profiles || typeof input.profiles !== 'object' || Array.isArray(input.profiles))
    throw new TypeError('credential profiles must be an object');
  const profiles = nullRecord();
  for (const [profileId, profile] of Object.entries(input.profiles))
    profiles[profileId] = validateProfile(profileId, profile);
  const defaults = nullRecord();
  for (const [provider, profileId] of Object.entries(input.defaults)) {
    requireSafeKey(provider, 'default provider');
    requireSafeKey(profileId, `default profile for ${provider}`);
    if (!Object.hasOwn(profiles, profileId))
      throw new TypeError(`default profile does not exist: ${provider}/${profileId}`);
    if (profiles[profileId].provider !== provider)
      throw new TypeError(`default profile provider mismatch: ${provider}/${profileId}`);
    defaults[provider] = profileId;
  }
  return { version: STORE_VERSION, revision: input.revision, defaults, profiles };
}

function modeBits(stat) {
  return stat.mode & 0o777;
}

async function assertSecureDirectory(fsImpl, directory, { create = false } = {}) {
  if (create) await fsImpl.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fsImpl.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new CredentialStoreError('unsafe-path', `Credential directory is unsafe: ${directory}`);
  if (typeof process.getuid !== 'function')
    throw new CredentialStoreError(
      'posix-required',
      'Credential storage requires POSIX ownership checks'
    );
  if (stat.uid !== process.getuid() || (modeBits(stat) & 0o077) !== 0)
    throw new CredentialStoreError(
      'unsafe-permissions',
      `Credential directory must be owner-only: ${directory}`
    );
}

async function assertSecureFile(fsImpl, file, { optional = false } = {}) {
  let stat;
  try {
    stat = await fsImpl.lstat(file);
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw new CredentialStoreError(
      'unsafe-file',
      `Credential file must be a regular single-link file: ${file}`
    );
  if (stat.uid !== process.getuid() || (modeBits(stat) & 0o177) !== 0)
    throw new CredentialStoreError(
      'unsafe-permissions',
      `Credential file must be mode 0600: ${file}`
    );
  return true;
}

async function readSecureDescriptorText(
  fsImpl,
  file,
  { optional = false, label = 'Credential file', maxBytes = MAX_STORE_BYTES } = {}
) {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
    throw new CredentialStoreError('no-follow-unavailable', `${label} reads require O_NOFOLLOW`);
  }
  if (typeof process.getuid !== 'function') {
    throw new CredentialStoreError(
      'posix-required',
      `${label} reads require POSIX ownership checks`
    );
  }

  let handle;
  try {
    handle = await fsImpl.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return null;
    throw new CredentialStoreError('unsafe-source', `${label} could not be opened securely`, {
      cause: error
    });
  }

  let value;
  let primaryError = null;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new CredentialStoreError('unsafe-file', `${label} must be a regular single-link file`);
    }
    if (stat.uid !== process.getuid() || (modeBits(stat) & 0o177) !== 0) {
      throw new CredentialStoreError('unsafe-permissions', `${label} must be owner-only mode 0600`);
    }
    if (stat.size > maxBytes) {
      throw new CredentialStoreError('source-too-large', `${label} exceeds the size limit`);
    }

    const chunks = [];
    let total = 0;
    while (true) {
      const remaining = maxBytes + 1 - total;
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw new CredentialStoreError(
          'source-too-large',
          `${label} grew beyond the size limit while reading`
        );
      }
      chunks.push(buffer.subarray(0, bytesRead));
    }
    value = Buffer.concat(chunks, total).toString('utf8');
  } catch (error) {
    primaryError = error;
  }

  try {
    await handle.close();
  } catch (closeError) {
    if (primaryError)
      throw new AggregateError([primaryError, closeError], `${label} read and close failed`);
    throw new CredentialStoreError(
      'source-close-uncertain',
      `${label} read succeeded but close failed`,
      { cause: closeError }
    );
  }
  if (primaryError) throw primaryError;
  return value;
}

async function fsyncPath(fsImpl, target) {
  const handle = await fsImpl.open(target, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writePrivateFile(fsImpl, file, content, { exclusive = false } = {}) {
  const handle = await fsImpl.open(file, exclusive ? 'wx' : 'w', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function prepareDirectories(paths, fsImpl = fs) {
  await assertSecureDirectory(fsImpl, paths.root, { create: true });
  for (const directory of [paths.refreshLocks, paths.journals, paths.profileState]) {
    await assertSecureDirectory(fsImpl, directory, { create: true });
  }
}

async function readStore(paths, fsImpl = fs) {
  await prepareDirectories(paths, fsImpl);
  const exists = await assertSecureFile(fsImpl, paths.store, { optional: true });
  if (!exists) return emptyStore();
  return validateCredentialStore(parseCredentialJson(await fsImpl.readFile(paths.store, 'utf8')));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultProcessStatus(pid) {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'dead';
    if (error?.code === 'EPERM') return 'permission-denied';
    return 'unknown';
  }
}

async function acquireOwnedLock(
  lockPath,
  {
    fsImpl = fs,
    host = os.hostname(),
    processStatus = defaultProcessStatus,
    phase = 'reserved',
    timeoutMs = LOCK_TIMEOUT_MS
  } = {}
) {
  if (!LOCK_PHASES.has(phase)) throw new TypeError(`unsupported credential lock phase: ${phase}`);
  const directory = path.dirname(lockPath);
  await assertSecureDirectory(fsImpl, directory, { create: true });
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const nonce = crypto.randomUUID();
    const candidate = `${lockPath}.candidate-${nonce}`;
    await fsImpl.mkdir(candidate, { mode: 0o700 });
    const owner = {
      version: 1,
      pid: process.pid,
      host,
      nonce,
      phase,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await writePrivateFile(fsImpl, path.join(candidate, 'owner.json'), stableJson(owner), {
      exclusive: true
    });
    try {
      await fsImpl.rename(candidate, lockPath);
    } catch (error) {
      await fsImpl.rm(candidate, { recursive: true, force: true });
      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error;
      let current;
      try {
        await assertSecureDirectory(fsImpl, lockPath);
        await assertSecureFile(fsImpl, path.join(lockPath, 'owner.json'));
        current = parseCredentialJson(
          await fsImpl.readFile(path.join(lockPath, 'owner.json'), 'utf8')
        );
      } catch (inspectionError) {
        if (inspectionError?.code === 'ENOENT') continue;
        throw new CredentialStoreError(
          'lock-corrupt',
          'Credential lock is corrupt and cannot be reclaimed',
          { cause: inspectionError }
        );
      }
      if (current.host !== host)
        throw new CredentialStoreError(
          'lock-foreign-host',
          'Credential lock belongs to another host'
        );
      const status = processStatus(current.pid);
      if (status !== 'dead') {
        if (Date.now() >= deadline)
          throw new CredentialStoreError(
            status === 'permission-denied' ? 'lock-permission-denied' : 'lock-busy',
            'Credential lock is active or unverifiable'
          );
        await sleep(LOCK_RETRY_MS);
        continue;
      }
      const reap = path.join(lockPath, '.reap');
      try {
        await fsImpl.mkdir(reap);
      } catch (reapError) {
        if (reapError?.code === 'EEXIST' || reapError?.code === 'ENOENT') continue;
        throw reapError;
      }
      const verify = parseCredentialJson(
        await fsImpl.readFile(path.join(lockPath, 'owner.json'), 'utf8')
      );
      if (
        verify.host !== current.host ||
        verify.pid !== current.pid ||
        verify.nonce !== current.nonce ||
        processStatus(verify.pid) !== 'dead'
      ) {
        throw new CredentialStoreError(
          'lock-owner-changed',
          'Credential lock owner changed before recovery'
        );
      }
      const quarantine = `${lockPath}.stale-${verify.nonce}`;
      await fsImpl.rename(lockPath, quarantine);
      await fsImpl.rm(quarantine, { recursive: true });
      continue;
    }

    const setPhase = async (nextPhase) => {
      if (!LOCK_PHASES.has(nextPhase))
        throw new TypeError(`unsupported credential lock phase: ${nextPhase}`);
      const ownerPath = path.join(lockPath, 'owner.json');
      const current = parseCredentialJson(await fsImpl.readFile(ownerPath, 'utf8'));
      if (current.nonce !== nonce || current.pid !== process.pid || current.host !== host)
        throw new CredentialStoreError('lock-owner-changed', 'Credential lock owner changed');
      current.phase = nextPhase;
      current.updatedAt = Date.now();
      const temporary = path.join(lockPath, `owner.${nonce}.tmp`);
      await writePrivateFile(fsImpl, temporary, stableJson(current), { exclusive: true });
      await fsImpl.rename(temporary, ownerPath);
      await fsyncPath(fsImpl, lockPath);
    };

    const release = async () => {
      const quarantine = `${lockPath}.release-${nonce}`;
      await fsImpl.rename(lockPath, quarantine);
      const current = parseCredentialJson(
        await fsImpl.readFile(path.join(quarantine, 'owner.json'), 'utf8')
      );
      if (current.nonce !== nonce || current.pid !== process.pid || current.host !== host)
        throw new CredentialStoreError(
          'lock-owner-changed',
          'Refusing to release another credential lock'
        );
      await fsImpl.rm(quarantine, { recursive: true });
    };
    return { nonce, setPhase, release };
  }
}
async function runWithOwnedLock(lock, operation) {
  let result;
  let primaryError = null;
  try {
    result = await operation();
  } catch (error) {
    primaryError = error;
  }

  try {
    await lock.release();
  } catch (releaseError) {
    if (primaryError) {
      throw new AggregateError(
        [primaryError, releaseError],
        'credential operation and lock release failed'
      );
    }
    throw new CredentialStoreError(
      'lock-release-uncertain',
      'Credential operation completed but lock release failed',
      {
        operationId: result?.operationId ?? null,
        result,
        cause: releaseError
      }
    );
  }
  if (primaryError) throw primaryError;
  return result;
}
function profileLockPath(paths, profileId) {
  return path.join(paths.refreshLocks, `${profileHash(profileId)}.lock`);
}

async function withProfileLock(home, profileId, options, operation) {
  requireSafeKey(profileId, 'profile id');
  const paths = credentialPaths(home);
  const fsImpl = options?.fsImpl || fs;
  await prepareDirectories(paths, fsImpl);
  const lock = await acquireOwnedLock(profileLockPath(paths, profileId), {
    fsImpl,
    processStatus: options?.processStatus,
    host: options?.host,
    phase: 'reserved',
    timeoutMs: options?.lockTimeoutMs ?? LOCK_TIMEOUT_MS
  });
  let result;
  let primaryError = null;
  try {
    result = await operation();
  } catch (error) {
    if (error?.[RETAIN_PROFILE_LOCK]) throw error;
    primaryError = error;
  }
  try {
    await lock.release();
  } catch (releaseError) {
    if (primaryError) {
      throw new AggregateError(
        [primaryError, releaseError],
        'credential profile operation and lock release failed'
      );
    }
    throw new CredentialStoreError(
      'lock-release-uncertain',
      'Credential profile operation completed but lock release failed',
      {
        result,
        cause: releaseError
      }
    );
  }
  if (primaryError) throw primaryError;
  return result;
}

async function writeJournal(fsImpl, journalPath, event) {
  const temporary = `${journalPath}.${crypto.randomUUID()}.tmp`;
  await writePrivateFile(fsImpl, temporary, stableJson(event), { exclusive: true });
  await fsImpl.rename(temporary, journalPath);
  await fsyncPath(fsImpl, path.dirname(journalPath));
}

async function digestFile(fsImpl, file) {
  try {
    return sha256(await fsImpl.readFile(file));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function mutateStore(home, mutator, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const paths = credentialPaths(home);
  await prepareDirectories(paths, fsImpl);
  const lock = await acquireOwnedLock(paths.lock, options);
  return runWithOwnedLock(lock, async () => {
    const before = await readStore(paths, fsImpl);
    const next = await mutator(validateCredentialStore(before));
    const after = validateCredentialStore({ ...next, revision: before.revision + 1 });
    const operationId = crypto.randomUUID();
    const storeText = stableJson(after);
    const beforeDigest = await digestFile(fsImpl, paths.store);
    const afterDigest = sha256(storeText);
    const temporary = `${paths.store}.${operationId}.tmp`;
    const journalPath = path.join(paths.journals, `${operationId}.json`);
    await writePrivateFile(fsImpl, temporary, storeText, { exclusive: true });
    const journal = {
      version: 1,
      operationId,
      state: 'prepared',
      beforeRevision: before.revision,
      afterRevision: after.revision,
      beforeDigest,
      afterDigest,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await writeJournal(fsImpl, journalPath, journal);
    try {
      await fsImpl.rename(temporary, paths.store);
      journal.state = 'renamed';
      journal.updatedAt = Date.now();
      await writeJournal(fsImpl, journalPath, journal);
      await fsyncPath(fsImpl, paths.root);
      journal.state = 'committed';
      journal.updatedAt = Date.now();
      await writeJournal(fsImpl, journalPath, journal);
      return {
        store: after,
        operationId,
        beforeRevision: before.revision,
        afterRevision: after.revision
      };
    } catch (error) {
      let observed;
      try {
        observed = await digestFile(fsImpl, paths.store);
      } catch (observationError) {
        journal.state = 'ambiguous';
        journal.updatedAt = Date.now();
        const causes = [error, observationError];
        try {
          await writeJournal(fsImpl, journalPath, journal);
        } catch (journalError) {
          causes.push(journalError);
        }
        throw new CredentialStoreError(
          'operation-ambiguous',
          'Credential operation could not be observed after failure',
          {
            operationId,
            beforeRevision: before.revision,
            afterRevision: after.revision,
            cause: new AggregateError(
              causes,
              'credential mutation, observation, and bookkeeping failed'
            )
          }
        );
      }

      if (observed === afterDigest) {
        try {
          await fsyncPath(fsImpl, paths.root);
          journal.state = 'committed';
          journal.updatedAt = Date.now();
          await writeJournal(fsImpl, journalPath, journal);
          return {
            store: after,
            operationId,
            beforeRevision: before.revision,
            afterRevision: after.revision
          };
        } catch (durabilityError) {
          journal.state = 'ambiguous';
          journal.updatedAt = Date.now();
          const causes = [error, durabilityError];
          try {
            await writeJournal(fsImpl, journalPath, journal);
          } catch (journalError) {
            causes.push(journalError);
          }
          throw new CredentialStoreError(
            'operation-ambiguous',
            'Credential operation durability is ambiguous',
            {
              operationId,
              beforeRevision: before.revision,
              afterRevision: after.revision,
              cause: new AggregateError(
                causes,
                'rename, durability, and bookkeeping acknowledgement failed'
              )
            }
          );
        }
      }

      journal.state = observed === beforeDigest ? 'not-committed' : 'ambiguous';
      journal.updatedAt = Date.now();
      const causes = [error];
      try {
        await writeJournal(fsImpl, journalPath, journal);
      } catch (journalError) {
        causes.push(journalError);
      }
      try {
        await fsImpl.unlink(temporary);
      } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') causes.push(cleanupError);
      }
      throw new CredentialStoreError(
        journal.state === 'ambiguous' ? 'operation-ambiguous' : 'operation-not-committed',
        `Credential operation ${journal.state}`,
        {
          operationId,
          beforeRevision: before.revision,
          afterRevision: after.revision,
          cause:
            causes.length === 1
              ? causes[0]
              : new AggregateError(causes, 'credential mutation, bookkeeping, and cleanup failed')
        }
      );
    }
  });
}

function redactedProfile(profileId, profile) {
  return {
    id: profileId,
    provider: profile.provider,
    kind: profile.kind,
    declaredScopes: [...profile.declaredScopes],
    verifiedScopes: [...profile.verifiedScopes],
    verifiedAt: profile.verifiedAt,
    expiresAt: profile.expiresAt,
    credentialFields: Object.keys(profile.credentials).sort(),
    credentials: '[redacted]'
  };
}

/** Initializes the owner-only store and returns its operation revision. */
export async function initCredentialStore({ home, ...options } = {}) {
  const result = await mutateStore(home, async (store) => store, options);
  return { operationId: result.operationId, revision: result.afterRevision };
}

/** Lists redacted profile metadata, optionally filtered by provider. */
export async function listCredentialProfiles({ home, provider, fsImpl } = {}) {
  const store = await readStore(credentialPaths(home), fsImpl || fs);
  return Object.entries(store.profiles)
    .filter(([, profile]) => !provider || profile.provider === provider)
    .map(([id, profile]) => redactedProfile(id, profile));
}

/** Reads one profile's redacted metadata, or returns null when absent. */
export async function inspectCredentialProfile({ home, profileId, fsImpl } = {}) {
  requireSafeKey(profileId, 'profile id');
  const store = await readStore(credentialPaths(home), fsImpl || fs);
  const profile = store.profiles[profileId];
  return profile ? redactedProfile(profileId, profile) : null;
}

/** Imports a profile through the revisioned, locked mutation path. */
export async function importCredentialProfile({ home, profileId, profile, ...options } = {}) {
  const imported = {
    ...profile,
    verifiedScopes: [],
    scopeEvidence: null,
    verifiedAt: null
  };
  const validated = validateProfile(profileId, imported);
  return withProfileLock(home, profileId, options, async () => {
    const result = await mutateStore(
      home,
      async (store) => {
        store.profiles[profileId] = validated;
        return store;
      },
      options
    );
    return {
      operationId: result.operationId,
      revision: result.afterRevision,
      profile: redactedProfile(profileId, validated)
    };
  });
}

/** Removes a profile and associated state markers. */
export async function removeCredentialProfile({ home, profileId, ...options } = {}) {
  requireSafeKey(profileId, 'profile id');
  return withProfileLock(home, profileId, options, async () => {
    const result = await mutateStore(
      home,
      async (store) => {
        if (!Object.hasOwn(store.profiles, profileId))
          throw new CredentialStoreError('profile-not-found', 'Credential profile not found');
        delete store.profiles[profileId];
        for (const [provider, selected] of Object.entries(store.defaults))
          if (selected === profileId) delete store.defaults[provider];
        return store;
      },
      options
    );
    return { operationId: result.operationId, revision: result.afterRevision };
  });
}

/** Sets the provider's default profile. */
export async function setDefaultCredentialProfile({ home, provider, profileId, ...options } = {}) {
  requireSafeKey(provider, 'provider');
  requireSafeKey(profileId, 'profile id');
  const result = await mutateStore(
    home,
    async (store) => {
      const profile = store.profiles[profileId];
      if (!profile || profile.provider !== provider)
        throw new CredentialStoreError(
          'profile-provider-mismatch',
          'Default profile is absent or belongs to another provider'
        );
      store.defaults[provider] = profileId;
      return store;
    },
    options
  );
  return { operationId: result.operationId, revision: result.afterRevision };
}

export async function recordVerifiedCredentialScopes({
  home,
  profileId,
  scopes,
  source,
  evidenceHash,
  verifiedAt = Date.now(),
  ...options
} = {}) {
  requireSafeKey(profileId, 'profile id');
  const verifiedScopes = stringList(scopes, 'verified scopes');
  const scopeEvidence = validateScopeEvidence(
    { source, evidenceHash, verifiedAt },
    verifiedScopes,
    `profile ${profileId}`
  );
  if (!scopeEvidence) throw new TypeError('at least one remotely verified scope is required');
  return withProfileLock(home, profileId, options, async () => {
    const result = await mutateStore(
      home,
      async (store) => {
        const profile = store.profiles[profileId];
        if (!profile)
          throw new CredentialStoreError('profile-not-found', 'Credential profile not found');
        store.profiles[profileId] = validateProfile(profileId, {
          ...profile,
          verifiedScopes,
          scopeEvidence,
          verifiedAt: scopeEvidence.verifiedAt,
          updatedAt: Date.now()
        });
        return store;
      },
      options
    );
    return {
      operationId: result.operationId,
      revision: result.afterRevision,
      profileId,
      verifiedScopes
    };
  });
}

function profileHash(profileId) {
  return sha256(profileId);
}

async function readMarker(paths, profileId, fsImpl = fs) {
  const file = path.join(paths.profileState, `${profileHash(profileId)}.json`);
  const text = await readSecureDescriptorText(fsImpl, file, {
    optional: true,
    label: 'Credential profile marker'
  });
  if (text == null) return null;
  const marker = parseCredentialJson(text);
  if (!PROFILE_MARKERS.has(marker.state) || marker.profileHash !== profileHash(profileId))
    throw new CredentialStoreError(
      'profile-marker-corrupt',
      'Credential profile state marker is corrupt'
    );
  return marker;
}

async function writeMarkerUnlocked(paths, profileId, state, evidenceHash, fsImpl = fs) {
  requireSafeKey(profileId, 'profile id');
  if (!PROFILE_MARKERS.has(state))
    throw new TypeError('unsupported credential profile marker state');
  requireString(evidenceHash, 'evidenceHash', { maximum: 128 });
  if (!/^[a-f0-9]{64}$/.test(evidenceHash))
    throw new TypeError('evidenceHash must be a SHA-256 hex digest');
  await prepareDirectories(paths, fsImpl);
  const file = path.join(paths.profileState, `${profileHash(profileId)}.json`);
  await assertSecureFile(fsImpl, file, { optional: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writePrivateFile(
    fsImpl,
    temporary,
    stableJson({
      version: 1,
      profileHash: profileHash(profileId),
      state,
      evidenceHash,
      updatedAt: Date.now()
    }),
    { exclusive: true }
  );
  await fsImpl.rename(temporary, file);
  await fsyncPath(fsImpl, paths.profileState);
  return { profileIdHash: profileHash(profileId), state };
}

export async function markCredentialProfileState({
  home,
  profileId,
  state,
  evidenceHash,
  ...options
} = {}) {
  const paths = credentialPaths(home);
  return withProfileLock(home, profileId, options, () =>
    writeMarkerUnlocked(paths, profileId, state, evidenceHash, options.fsImpl || fs)
  );
}

/** Resolves an eligible profile without exposing its credential values. */
export async function resolveCredentialProfile({
  home,
  provider,
  profileId,
  client,
  requiredScopes = [],
  now = Date.now(),
  fsImpl = fs
} = {}) {
  requireSafeKey(provider, 'provider');
  if (client && profileId)
    throw new CredentialStoreError(
      'profile-client-conflict',
      'Explicit client and stored profile cannot both be selected'
    );
  const required = stringList(requiredScopes, 'requiredScopes');
  if (client) {
    const verified = stringList(client.verifiedScopes, 'external client verifiedScopes');
    validateScopeEvidence(client.scopeEvidence, verified, 'external client');
    const available = new Set(verified);
    if (required.some((scope) => !available.has(scope))) {
      throw new CredentialStoreError(
        'profile-under-scoped',
        'External client lacks remotely verified scopes'
      );
    }
    return { status: 'external-client', client };
  }
  const paths = credentialPaths(home);
  const store = await readStore(paths, fsImpl);
  const selectedId = profileId || store.defaults[provider] || null;
  if (!selectedId) return { status: 'absent', profile: null };
  requireSafeKey(selectedId, 'profile id');
  const profile = store.profiles[selectedId];
  if (!profile || profile.provider !== provider)
    throw new CredentialStoreError('profile-invalid', 'Configured credential profile is invalid');
  const marker = await readMarker(paths, selectedId, fsImpl);
  if (marker)
    throw new CredentialStoreError(
      `profile-${marker.state}`,
      'Credential profile requires recovery'
    );
  if (profile.expiresAt != null && profile.expiresAt <= now)
    throw new CredentialStoreError('profile-expired', 'Credential profile is expired');
  const verified = new Set(profile.verifiedScopes);
  const missing = required.filter((scope) => !verified.has(scope));
  if (missing.length > 0)
    throw new CredentialStoreError(
      'profile-under-scoped',
      'Credential profile lacks remotely verified scopes'
    );
  return { status: 'selected', profileId: selectedId, profile: structuredClone(profile) };
}

/** Builds a profile from prefixed environment variables. */
export function profileFromEnvironment({ provider, kind, prefix, env = process.env } = {}) {
  requireSafeKey(provider, 'provider');
  requireSafeKey(kind, 'kind');
  const required = profileRequirements(provider, kind);
  const normalizedPrefix = requireString(prefix, 'environment prefix', { maximum: 128 });
  const credentials = nullRecord();
  for (const key of required) {
    const variable = `${normalizedPrefix}_${key.replace(/[A-Z]/g, (character) => `_${character}`).toUpperCase()}`;
    credentials[key] = requireString(env[variable], `environment ${variable}`);
  }
  return { provider, kind, credentials, declaredScopes: [], verifiedScopes: [] };
}

export async function profileFromSecureSource({ file, fsImpl = fs } = {}) {
  const source = path.resolve(requireString(file, 'credential source path'));
  return parseCredentialJson(
    await readSecureDescriptorText(fsImpl, source, {
      label: 'Credential source'
    })
  );
}

function oauthPercent(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function oauth1Authorization(credentials, { method, url, timestamp, nonce }) {
  const parsed = new URL(url);
  const protocolParameters = [
    ['oauth_consumer_key', credentials.consumerKey],
    ['oauth_nonce', nonce],
    ['oauth_signature_method', 'HMAC-SHA1'],
    ['oauth_timestamp', String(timestamp)],
    ['oauth_token', credentials.accessToken],
    ['oauth_version', '1.0']
  ];
  for (const key of parsed.searchParams.keys()) {
    if (/^oauth_/i.test(key)) {
      throw new CredentialStoreError(
        'oauth-query-conflict',
        'OAuth protocol parameters must not be supplied in the request query'
      );
    }
  }
  const encodedParameters = [...parsed.searchParams.entries(), ...protocolParameters].map(
    ([key, value]) => [oauthPercent(key), oauthPercent(value)]
  );
  encodedParameters.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
    return 0;
  });
  const parameterString = encodedParameters.map(([key, value]) => `${key}=${value}`).join('&');
  const baseUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname || '/'}`;
  const base = [method.toUpperCase(), oauthPercent(baseUrl), oauthPercent(parameterString)].join(
    '&'
  );
  const signingKey = `${oauthPercent(credentials.consumerSecret)}&${oauthPercent(credentials.accessTokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
  const headerParameters = [...protocolParameters, ['oauth_signature', signature]];
  return `OAuth ${headerParameters.map(([key, value]) => `${oauthPercent(key)}="${oauthPercent(value)}"`).join(', ')}`;
}

export function createOfficialCredentialAdapter({ profileId, profile }) {
  requireSafeKey(profileId, 'profile id');
  const validated = validateProfile(profileId, profile);
  return Object.freeze({
    provider: validated.provider,
    kind: validated.kind,
    profileId,
    authorize({
      method = 'GET',
      url,
      timestamp = Math.floor(Date.now() / 1000),
      nonce = crypto.randomUUID()
    } = {}) {
      const parsed = new URL(requireString(url, 'official request URL'));
      if (parsed.protocol !== 'https:') throw new TypeError('official request URL must use HTTPS');
      if (
        parsed.username ||
        parsed.password ||
        !OFFICIAL_ORIGINS[validated.provider]?.includes(parsed.origin)
      ) {
        throw new CredentialStoreError(
          'adapter-origin-rejected',
          'Official credentials may only be sent to an approved provider origin'
        );
      }
      const requestMethod = requireString(method, 'official request method', {
        maximum: 16
      }).toUpperCase();
      const headers = Object.create(null);
      const credentials = validated.credentials;

      if (validated.provider === 'youtube' && validated.kind === 'api-key') {
        parsed.searchParams.set('key', credentials.apiKey);
      } else if (validated.provider === 'coupang') {
        const signedDate = new Date(timestamp * 1000).toISOString().replace(/[-:]|\.\d{3}/g, '');
        const message = `${signedDate}\n${requestMethod}\n${parsed.pathname}\n${parsed.searchParams}`;
        const signature = crypto
          .createHmac('sha256', credentials.secretKey)
          .update(message)
          .digest('hex');
        headers.authorization = `CEA algorithm=HmacSHA256, access-key=${credentials.accessKey}, signed-date=${signedDate}, signature=${signature}`;
      } else if (validated.provider === 'naver') {
        headers['x-naver-client-id'] = credentials.clientId;
        headers['x-naver-client-secret'] = credentials.clientSecret;
      } else if (validated.provider === 'x' && validated.kind === 'oauth1') {
        headers.authorization = oauth1Authorization(credentials, {
          method: requestMethod,
          url: parsed.href,
          timestamp,
          nonce
        });
      } else {
        const token = credentials.bearerToken || credentials.accessToken;
        if (!token)
          throw new CredentialStoreError(
            'adapter-credential-missing',
            'Official adapter has no bearer credential'
          );
        headers.authorization = `Bearer ${token}`;
      }

      return Object.freeze({
        method: requestMethod,
        url: parsed.href,
        headers: Object.freeze(headers)
      });
    }
  });
}

export async function resolveOfficialCredentialAdapter(options = {}) {
  const resolved = await resolveCredentialProfile(options);
  if (resolved.status !== 'selected') return resolved;
  return {
    status: 'selected',
    profileId: resolved.profileId,
    adapter: createOfficialCredentialAdapter({
      profileId: resolved.profileId,
      profile: resolved.profile
    })
  };
}
export async function reconcileCredentialOperation({ home, operationId, fsImpl = fs } = {}) {
  requireSafeKey(operationId, 'operation id');
  const paths = credentialPaths(home);
  await prepareDirectories(paths, fsImpl);
  const journalPath = path.join(paths.journals, `${operationId}.json`);
  await assertSecureFile(fsImpl, journalPath);
  const journal = parseCredentialJson(await fsImpl.readFile(journalPath, 'utf8'));
  const observed = await digestFile(fsImpl, paths.store);
  const state =
    observed === journal.afterDigest
      ? 'committed'
      : observed === journal.beforeDigest
        ? 'not-committed'
        : 'ambiguous';
  journal.state = state;
  journal.updatedAt = Date.now();
  await writeJournal(fsImpl, journalPath, journal);
  return {
    operationId,
    state,
    beforeRevision: journal.beforeRevision,
    afterRevision: journal.afterRevision
  };
}

export async function recoverCredentialProfile({
  home,
  profileId,
  mode,
  correctedProfile,
  ...options
} = {}) {
  const paths = credentialPaths(home);
  const fsImpl = options.fsImpl || fs;
  return withProfileLock(home, profileId, options, async () => {
    const marker = await readMarker(paths, profileId, fsImpl);
    if (!marker)
      throw new CredentialStoreError(
        'profile-recovery-not-required',
        'Credential profile has no recovery marker'
      );
    const allowed = {
      'refresh-ambiguous': ['reimport'],
      'token-invalid': ['refresh', 'reimport'],
      'scope-unverified': ['introspect', 'refresh', 'reimport']
    };
    if (!allowed[marker.state].includes(mode))
      throw new CredentialStoreError(
        'profile-recovery-mode',
        'Recovery mode is not allowed for this marker'
      );
    const candidate =
      mode === 'reimport'
        ? { ...correctedProfile, verifiedScopes: [], scopeEvidence: null, verifiedAt: null }
        : correctedProfile;
    const validated = validateProfile(profileId, candidate);
    const markerDigest = sha256(stableJson(marker));
    const result = await mutateStore(
      home,
      async (store) => {
        store.profiles[profileId] = validated;
        return store;
      },
      options
    );
    const markerFile = path.join(paths.profileState, `${profileHash(profileId)}.json`);
    const quarantine = `${markerFile}.recovery-${crypto.randomUUID()}`;
    const receiptFields = {
      operationId: result.operationId,
      beforeRevision: result.beforeRevision,
      afterRevision: result.afterRevision
    };
    let quarantined = false;
    let consumed = false;
    try {
      await fsImpl.rename(markerFile, quarantine);
      quarantined = true;
      await fsyncPath(fsImpl, paths.profileState);

      const quarantinedText = await readSecureDescriptorText(fsImpl, quarantine, {
        label: 'Quarantined credential profile marker'
      });
      const quarantinedDigest = sha256(quarantinedText);
      let replacement;
      try {
        replacement = await readMarker(paths, profileId, fsImpl);
      } catch (replacementError) {
        throw new CredentialStoreError(
          'profile-marker-changed',
          'Credential profile marker replacement is invalid',
          {
            ...receiptFields,
            cause: replacementError
          }
        );
      }
      if (quarantinedDigest !== markerDigest || replacement) {
        throw new CredentialStoreError(
          'profile-marker-changed',
          'Credential profile marker changed during recovery',
          receiptFields
        );
      }

      await fsImpl.unlink(quarantine);
      consumed = true;
      await fsyncPath(fsImpl, paths.profileState);
      const postConsumeMarker = await readMarker(paths, profileId, fsImpl);
      if (postConsumeMarker) {
        throw new CredentialStoreError(
          'profile-marker-changed',
          'Credential profile marker changed while recovery evidence was consumed',
          receiptFields
        );
      }
    } catch (error) {
      let canonicalBlocks = false;
      try {
        canonicalBlocks = (await readMarker(paths, profileId, fsImpl)) !== null;
      } catch {
        canonicalBlocks = true;
      }
      if (canonicalBlocks) throw error;

      let restoreError = null;
      if (quarantined && !consumed) {
        try {
          await fsImpl.link(quarantine, markerFile);
          await fsImpl.unlink(quarantine);
          await fsyncPath(fsImpl, paths.profileState);
        } catch (failure) {
          restoreError = failure;
        }
        if (!restoreError) throw error;
        try {
          canonicalBlocks = (await readMarker(paths, profileId, fsImpl)) !== null;
        } catch {
          canonicalBlocks = true;
        }
        if (canonicalBlocks) {
          throw new CredentialStoreError(
            'profile-marker-changed',
            'Credential profile marker changed while recovery restoration failed',
            {
              ...receiptFields,
              cause: new AggregateError(
                [error, restoreError],
                'recovery and marker restoration failed'
              )
            }
          );
        }
      } else if (consumed) {
        try {
          await writeMarkerUnlocked(paths, profileId, marker.state, marker.evidenceHash, fsImpl);
        } catch (failure) {
          restoreError = failure;
        }
        if (!restoreError) throw error;
      }

      const retained = new CredentialStoreError(
        'profile-recovery-ambiguous',
        'Credential profile recovery is ambiguous; profile lock retained',
        {
          ...receiptFields,
          cause: restoreError
            ? new AggregateError(
                [error, restoreError],
                'recovery failed and marker could not be restored'
              )
            : error
        }
      );
      retained[RETAIN_PROFILE_LOCK] = true;
      throw retained;
    }
    return {
      operationId: result.operationId,
      revision: result.afterRevision,
      recoveredFrom: marker.state,
      mode
    };
  });
}

export async function withCredentialProfileOperation(
  {
    home,
    provider,
    profileId,
    requiredScopes,
    phase = 'reserved',
    evidenceHash = sha256('credential-operation'),
    fsImpl = fs,
    processStatus,
    host,
    lockTimeoutMs = LOCK_TIMEOUT_MS
  } = {},
  operation
) {
  if (typeof operation !== 'function')
    throw new TypeError('credential profile operation callback is required');
  if (phase !== 'reserved')
    throw new TypeError('credential profile operations must begin in the reserved phase');
  requireSafeKey(provider, 'provider');
  const paths = credentialPaths(home);
  const initialStore = await readStore(paths, fsImpl);
  const selectedId = profileId || initialStore.defaults[provider] || null;
  if (!selectedId)
    throw new CredentialStoreError('profile-required', 'Stored credential profile is required');
  requireSafeKey(selectedId, 'profile id');

  const lock = await acquireOwnedLock(profileLockPath(paths, selectedId), {
    fsImpl,
    processStatus,
    host,
    phase: 'reserved',
    timeoutMs: lockTimeoutMs
  });
  let lastPhase = 'reserved';
  let operationStarted = false;
  let result;
  let primaryError = null;
  let releaseAllowed = true;
  const setPhase = async (next) => {
    await lock.setPhase(next);
    lastPhase = next;
  };

  try {
    const resolved = await resolveCredentialProfile({
      home,
      provider,
      profileId: selectedId,
      requiredScopes,
      fsImpl
    });
    if (resolved.status !== 'selected')
      throw new CredentialStoreError('profile-required', 'Stored credential profile is required');
    operationStarted = true;
    result = await operation({
      profileId: resolved.profileId,
      profile: resolved.profile,
      setPhase
    });
  } catch (error) {
    primaryError = error;
    if (operationStarted) {
      try {
        if (error?.code === 'invalid_token' && lastPhase === 'official-dispatched') {
          await setPhase('denial-invalid-token');
          await writeMarkerUnlocked(paths, selectedId, 'token-invalid', evidenceHash, fsImpl);
        } else if (error?.code === 'insufficient_scope' && lastPhase === 'official-dispatched') {
          await setPhase('denial-insufficient-scope');
          await writeMarkerUnlocked(paths, selectedId, 'scope-unverified', evidenceHash, fsImpl);
        } else if (lastPhase === 'refresh-dispatched') {
          await writeMarkerUnlocked(paths, selectedId, 'refresh-ambiguous', evidenceHash, fsImpl);
        }
      } catch (persistenceError) {
        releaseAllowed = false;
        primaryError = new AggregateError(
          [error, persistenceError],
          'credential failure state could not be persisted; profile lock retained'
        );
      }
    }
  }

  if (!releaseAllowed) throw primaryError;
  try {
    await lock.release();
  } catch (releaseError) {
    if (primaryError) {
      throw new AggregateError(
        [primaryError, releaseError],
        'credential operation and profile lock release failed'
      );
    }
    throw new CredentialStoreError(
      'lock-release-uncertain',
      'Credential operation completed but profile lock release failed',
      {
        result,
        cause: releaseError
      }
    );
  }
  if (primaryError) throw primaryError;
  return result;
}
