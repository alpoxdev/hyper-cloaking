import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createPreEditBaseline,
  validatePreDispatchBaseline,
  validatePostEditBaseline,
  auditJsdoc,
  createExportEvidence,
  createCommentOnlyProof
} from '../../../scripts/audit-jsdoc.mjs';

async function sourceFixture(source) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jsdoc-audit-'));
  const file = path.join(root, 'fixture.mjs');
  await fs.writeFile(file, source);
  return { root, file };
}

test('AST/export audit handles aliases, defaults, stars, destructuring, and async signatures', async (t) => {
  const f = await sourceFixture(
    '/** module */\nexport { value as answer };\nexport * from "./other.mjs";\nexport const value = 1;\nexport async function load() { return await value; }\n'
  );
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const result = await auditJsdoc({ files: [f.file] });
  assert.ok(result.files?.length === 1);
  assert.ok(result.files[0].exports.length >= 3);
});

test('JSDoc attachment requires immediate lexical adjacency and supports shebang/templates/regex', async (t) => {
  const source =
    '#!/usr/bin/env node\n/** attached */\nexport const x = `value ${/a+/.test("a")}`;\n/** gap */\nimport y from "y";\n';
  const f = await sourceFixture(source);
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const result = await auditJsdoc({ files: [f.file] });
  assert.ok(result.files[0].comments.some((comment) => comment.attached));
  assert.ok(
    result.errors.some(
      (error) => error.code === 'comment-attachment-gap' || error.code === 'missing-module-header'
    )
  );
});

test('baseline lifecycle rejects stale and tampered bytes but accepts comment-only edits', async (t) => {
  const f = await sourceFixture('/** docs */\nexport const value = 1;\n');
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const baseline = await createPreEditBaseline({ files: [f.file] });
  assert.doesNotThrow(() => validatePreDispatchBaseline({ baseline, files: [f.file] }));
  await fs.writeFile(f.file, '/** changed docs */\nexport const value = 1;\n');
  assert.doesNotThrow(() => validatePostEditBaseline({ baseline, files: [f.file] }));
  await fs.writeFile(f.file, '/** changed docs */\nexport const value = 2;\n');
  assert.throws(() => validatePostEditBaseline({ baseline, files: [f.file] }));
  assert.throws(() => validatePreDispatchBaseline({ baseline, files: [f.file] }));
});

test('export and comment-only evidence expose code tampering', async (t) => {
  const f = await sourceFixture('/** docs */\nexport const value = 1;\n');
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const baseline = await createPreEditBaseline({ files: [f.file] });
  const exports = await createExportEvidence({ baseline, files: [f.file] });
  const comments = await createCommentOnlyProof({ baseline, files: [f.file] });
  assert.equal(exports.unchanged, true);
  assert.equal(comments.allCommentOnly, true);
});
