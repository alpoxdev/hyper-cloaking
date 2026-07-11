import fs from 'node:fs';
import crypto from 'node:crypto';
import { parse } from 'acorn';

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function parseSource(source, { onComment, onToken } = {}) {
  const comments = [];
  const tokens = [];
  const ast = parse(source, {
    ecmaVersion: 2024,
    sourceType: 'module',
    locations: true,
    ranges: true,
    allowHashBang: true,
    onComment(type, value, start, end, startLoc, endLoc) {
      const commentType = type === true ? 'Block' : type === false ? 'Line' : type;
      const comment = {
        type: commentType,
        value,
        start,
        end,
        startLine: startLoc?.line || 0,
        startColumn: startLoc?.column || 0,
        endLine: endLoc?.line || 0,
        endColumn: endLoc?.column || 0
      };
      comments.push(comment);
      onComment?.(commentType, value, start, end, startLoc, endLoc);
    },
    onToken(token) {
      const item = {
        type: token.type.label,
        value: token.value == null ? null : source.slice(token.start, token.end),
        start: token.start,
        end: token.end,
        startLine: token.loc.start.line,
        startColumn: token.loc.start.column,
        endLine: token.loc.end.line,
        endColumn: token.loc.end.column
      };
      tokens.push(item);
      onToken?.(token);
    }
  });
  return { ast, comments, tokens };
}

function bindingNames(node) {
  if (!node) return [];
  if (node.type === 'Identifier') return [node.name];
  if (node.type === 'RestElement' || node.type === 'AssignmentPattern')
    return bindingNames(node.argument || node.left);
  if (node.type === 'ObjectPattern' || node.type === 'ArrayPattern')
    return (node.properties || []).flatMap((p) => bindingNames(p.value || p.argument));
  return [];
}

function stable(node) {
  if (Array.isArray(node)) return node.map(stable);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !['start', 'end', 'loc', 'range'].includes(key))
      .map(([key, value]) => [key, stable(value)])
  );
}

export function exportSignatures(ast) {
  const out = [];
  for (const node of ast.body || []) {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        const names =
          node.declaration.declarations?.flatMap((item) => bindingNames(item.id)) ||
          bindingNames(node.declaration.id);
        for (const local of names)
          out.push({
            kind: 'named',
            exported: local,
            local,
            signatureSha256: sha256(JSON.stringify(stable(node.declaration)))
          });
      }
      for (const specifier of node.specifiers || [])
        out.push({
          kind: 'named',
          exported: specifier.exported.name || specifier.exported.value,
          local: specifier.local.name,
          signatureSha256: sha256(JSON.stringify(stable(specifier)))
        });
    } else if (node.type === 'ExportDefaultDeclaration')
      out.push({
        kind: 'default',
        exported: 'default',
        local: node.declaration.id?.name || 'default',
        signatureSha256: sha256(JSON.stringify(stable(node.declaration)))
      });
    else if (node.type === 'ExportAllDeclaration')
      out.push({
        kind: 'star',
        exported: '*',
        local: '*',
        signatureSha256: sha256(JSON.stringify(stable(node.source)))
      });
  }
  return out.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function nonCommentTokenBasis(source, tokens, comments) {
  const spans = comments.map((comment) => [comment.start, comment.end]);
  return tokens
    .filter((token) => !spans.some(([start, end]) => token.start >= start && token.end <= end))
    .map((token) => ({ type: token.type, value: token.value }));
}

function documentable(node) {
  return (
    [
      'FunctionDeclaration',
      'ClassDeclaration',
      'VariableDeclaration',
      'MethodDefinition',
      'PropertyDefinition'
    ].includes(node.type) || node.type === 'Property'
  );
}
function walk(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (documentable(node)) out.push(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'range'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((item) => walk(item, out));
    else walk(value, out);
  }
  return out;
}
function analyze(file) {
  const source = fs.readFileSync(file, 'utf8');
  const parsed = parseSource(source);
  return {
    path: file,
    source,
    ast: parsed.ast,
    sourceSha256: sha256(source),
    astSha256: sha256(JSON.stringify(parsed.ast)),
    exportSignatures: exportSignatures(parsed.ast),
    nonCommentTokenBasis: nonCommentTokenBasis(source, parsed.tokens, parsed.comments),
    comments: parsed.comments,
    tokens: parsed.tokens
  };
}
export function analyzeFile(file) {
  try {
    return analyze(file);
  } catch (error) {
    return {
      path: file,
      error: {
        code: 'parse-error',
        message: error.message,
        line: error.loc?.line,
        column: error.loc?.column
      }
    };
  }
}

export async function auditJsdoc({ files = [] } = {}) {
  const results = files.map((file) => {
    const result = analyzeFile(file);
    if (result.error) return { ...result, exports: [], errors: [result.error] };
    const nodes = walk(result.ast);
    const errors = [];
    for (const comment of result.comments) {
      const jsdoc = comment.type === 'Block' && comment.value.startsWith('*');
      const next = nodes.find((node) => node.start >= comment.end);
      const gap = next ? result.source.slice(comment.end, next.start) : '';
      comment.attached = !!(jsdoc && next && /^(?:\s*export(?:\s+default)?\s*)?$/.test(gap));
      if (jsdoc && !comment.attached && !/^\s*module\b/i.test(comment.value)) {
        comment.attachmentError = 'comment-attachment-gap';
        errors.push({ code: comment.attachmentError, path: file });
      }
    }
    if (
      nodes.length &&
      !result.comments.some(
        (comment) =>
          comment.type === 'Block' &&
          comment.value.startsWith('*') &&
          /^\s*module\b/i.test(comment.value)
      )
    )
      errors.push({ code: 'missing-module-header', path: file });
    return { ...result, documentableCount: nodes.length, exports: result.exportSignatures, errors };
  });
  return { files: results, errors: results.flatMap((result) => result.errors || []) };
}

export async function createPreEditBaseline({ files = [] } = {}) {
  return {
    schemaVersion: 1,
    files: files.map((file) => {
      const analysis = analyze(file);
      return {
        path: file,
        contentSha256: sha256(fs.readFileSync(file)),
        exportSignatures: analysis.exportSignatures,
        nonCommentTokenBasis: analysis.nonCommentTokenBasis,
        sourceSha256: analysis.sourceSha256
      };
    })
  };
}
function current({ files, baseline }) {
  return files.map((file) => ({
    file,
    base: baseline.files.find((item) => item.path === file),
    now: analyze(file)
  }));
}
export function validatePreDispatchBaseline({ baseline, files }) {
  for (const { file, base } of current({ files, baseline }))
    if (!base || sha256(fs.readFileSync(file)) !== base.contentSha256)
      throw new Error('baseline-content-mismatch');
  return true;
}
export function validatePostEditBaseline({ baseline, files }) {
  for (const { base, now } of current({ files, baseline }))
    if (
      !base ||
      JSON.stringify(now.exportSignatures) !== JSON.stringify(base.exportSignatures) ||
      JSON.stringify(now.nonCommentTokenBasis) !== JSON.stringify(base.nonCommentTokenBasis)
    )
      throw new Error('baseline-token-mismatch');
  return true;
}
export async function createExportEvidence({ baseline, files }) {
  const rows = current({ files, baseline });
  return {
    unchanged: rows.every(
      (row) =>
        JSON.stringify(row.now.exportSignatures) === JSON.stringify(row.base?.exportSignatures)
    ),
    files: rows.map((row) => ({ path: row.file, exports: row.now.exportSignatures }))
  };
}
export async function createCommentOnlyProof({ baseline, files }) {
  const rows = current({ files, baseline });
  const same = rows.every(
    (row) =>
      JSON.stringify(row.now.exportSignatures) === JSON.stringify(row.base?.exportSignatures) &&
      JSON.stringify(row.now.nonCommentTokenBasis) ===
        JSON.stringify(row.base?.nonCommentTokenBasis)
  );
  return {
    allCommentOnly: same,
    changedHunksAreComments: same,
    nonCommentRanges: [],
    errors: same ? [] : [{ code: 'baseline-token-mismatch' }]
  };
}
export function commentOnlyProof(before, after) {
  const a = analyzeFile(before),
    b = analyzeFile(after);
  const same =
    JSON.stringify(a.exportSignatures) === JSON.stringify(b.exportSignatures) &&
    JSON.stringify(a.nonCommentTokenBasis) === JSON.stringify(b.nonCommentTokenBasis);
  return {
    changedHunksAreComments: same,
    nonCommentRanges: [],
    allCommentOnly: same,
    errors: same ? [] : [{ code: 'baseline-token-mismatch', path: after }]
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(3);
  const command = process.argv[2];
  if (command === 'audit') {
    auditJsdoc({ files }).then((result) => console.log(JSON.stringify(result, null, 2)));
  } else if (command === 'verify') {
    try {
      const baseline = JSON.parse(fs.readFileSync(files[0], 'utf8'));
      validatePostEditBaseline({ baseline, files: files.slice(1) });
      console.log(JSON.stringify({ valid: true }));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  } else if (command === 'check') {
    const { CANONICAL_ROOT, enumerateMjsFiles } = await import('./jsdoc-inventory.mjs');
    const moduleFiles = enumerateMjsFiles(CANONICAL_ROOT).map(
      (relative) => `${CANONICAL_ROOT}/${relative}`
    );
    const failures = [];
    for (const file of moduleFiles) {
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes('/**')) failures.push({ code: 'missing-jsdoc', path: file });
      const result = analyzeFile(file);
      if (result.error) failures.push(result.error);
    }
    if (failures.length) {
      console.error(JSON.stringify({ valid: false, failures }, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ valid: true, files: moduleFiles.length }));
    }
  } else {
    console.error('usage: audit <files...> | verify <baseline> <files...> | check');
    process.exitCode = 1;
  }
}
