/**
 * Sanitizes and optionally persists privacy-safe run-shape learning records.
 * Learning is opt-in; persistence writes JSONL and strips secrets, PII, and raw content.
 * @module engine/run-shapes
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const RUN_SHAPES_FILE = 'run-shapes.jsonl';
const SECRET_KEY_PATTERN =
  /(?:cookie|token|secret|credential|auth|authorization|session|sessionid|sid|key|password|passwd|api[_-]?key)/iu;
const PII_KEY_PATTERN = /(?:email|phone|address|name|user|username|person|pii)/iu;
const CONTENT_KEY_PATTERN =
  /(?:raw|text|html|screenshot|image|download|body|content|dom|cookie|headers)/iu;

export function sanitizeRunShape(run, options = {}) {
  const readable = options.readable === true;
  const sanitized = sanitizeValue(run, { readable, path: [] });
  return {
    schema: 'hyper-cloaking.run-shape.v1',
    retention: {
      purpose: 'local reliability learning',
      createdAt: new Date(0).toISOString(),
      maxAgeDays: Number.isInteger(options.maxAgeDays) ? options.maxAgeDays : 30,
      containsRawContent: false,
      containsCredentials: false,
      learning: true
    },
    run: sanitized
  };
}

export async function appendRunShape(stateDir, run, options = { learning: false }) {
  if (options?.learning !== true) {
    return { learning: false, written: false, path: null, run: null };
  }

  const sanitized = sanitizeRunShape(run, options);
  await fs.mkdir(stateDir, { recursive: true });
  const filePath = path.join(stateDir, RUN_SHAPES_FILE);
  await fs.appendFile(filePath, `${JSON.stringify(sanitized)}\n`, 'utf8');
  return { learning: true, written: true, path: filePath, run: sanitized };
}

export async function clearRunShapes(stateDir) {
  const filePath = path.join(stateDir, RUN_SHAPES_FILE);
  await fs.rm(filePath, { force: true });
  return { cleared: true, path: filePath };
}

function sanitizeValue(value, context) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value))
    return value.map((entry, index) =>
      sanitizeValue(entry, { ...context, path: [...context.path, String(index)] })
    );

  if (typeof value === 'string') return sanitizeString(value, context);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (typeof value === 'object') {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      if (
        SECRET_KEY_PATTERN.test(normalizedKey) ||
        PII_KEY_PATTERN.test(normalizedKey) ||
        CONTENT_KEY_PATTERN.test(normalizedKey)
      ) {
        output[key] = '[stripped]';
        continue;
      }
      output[key] = sanitizeValue(child, { ...context, path: [...context.path, key] });
    }
    return output;
  }

  return '[stripped]';
}

function sanitizeString(value, context) {
  if (isProfileLabel(context.path)) return sanitizeLabel(value, context.readable);
  if (looksLikeUrl(value)) return sanitizeUrl(value, context.readable);
  if (looksSecretLike(value)) return '[stripped]';
  if (looksPiiLike(value)) return '[stripped]';
  if (looksRawContentLike(value, context.path)) return '[stripped]';
  if (value.length > 240) return '[stripped]';
  return value;
}

function sanitizeLabel(value, readable) {
  if (looksLikeUrl(value)) {
    try {
      return readable ? sanitizeUrl(value, true) : stableHash(new URL(value).origin.toLowerCase());
    } catch {
      return '[stripped]';
    }
  }
  if (looksSecretLike(value)) return '[stripped]';
  return readable ? value : stableHash(value);
}

function sanitizeUrl(value, readable) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY_PATTERN.test(key) || PII_KEY_PATTERN.test(key)) url.searchParams.delete(key);
    }
    if (!readable) {
      return {
        originHash: stableHash(url.origin.toLowerCase()),
        pathShape: shapePath(url.pathname),
        queryKeys: [...url.searchParams.keys()].sort()
      };
    }
    return url.toString();
  } catch {
    return '[stripped]';
  }
}

function looksLikeUrl(value) {
  return /^https?:\/\//iu.test(value);
}

function looksSecretLike(value) {
  if (/bearer\s+[a-z0-9._~+/-]+/iu.test(value)) return true;
  if (/\b(?:token|secret|password|sessionid|sid|api[_-]?key)=/iu.test(value)) return true;
  if (/^[a-z0-9+/]{32,}={0,2}$/iu.test(value)) return true;
  return false;
}

function looksPiiLike(value) {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(value)) return true;
  if (/\b(?:\+?\d[\d\s().-]{7,}\d)\b/u.test(value)) return true;
  if (/\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/u.test(value)) return true;
  return false;
}

function looksRawContentLike(value, pathParts = []) {
  const keySuggestsRawText = pathParts.some((part) =>
    /message|reason|error|text|content|body|html|title|dom/iu.test(part)
  );
  if (/<\/?[a-z][\s\S]*>/iu.test(value)) return true;
  if (/ignore\s+(all\s+)?previous\s+instructions/iu.test(value)) return true;
  if (keySuggestsRawText && /\s/u.test(value) && value.length > 40) return true;
  return false;
}

function isProfileLabel(pathParts) {
  return pathParts.some((part) => /profile|persona|label|origin/iu.test(part));
}

function stableHash(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

function shapePath(pathname) {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((part) =>
      /^\d+$/u.test(part) || /^[0-9a-f-]{8,}$/iu.test(part) ? ':id' : part.slice(0, 32)
    )
    .join('/');
}
