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
  auditTargetManifest,
  createExportEvidence,
  createCommentOnlyProof
} from '../../../scripts/audit-jsdoc.mjs';
import { buildTargetManifest } from '../../../scripts/jsdoc-inventory.mjs';

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
test('whitespace-only separation attaches JSDoc to its shared target', async (t) => {
  const f = await sourceFixture(
    '#!/usr/bin/env node\n/** @module fixture */\n"use strict";\n\n/** documented export */\n\nexport const value = 1;\n'
  );
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const result = await auditJsdoc({ files: [f.file] });
  assert.equal(
    result.files[0].comments.find((comment) => comment.value.includes('documented')).attached,
    true
  );
  assert.equal(
    result.files[0].errors.some((error) => error.code === 'comment-attachment-gap'),
    false
  );
  assert.equal(
    result.files[0].errors.some((error) => error.code === 'misplaced-module-header'),
    false
  );
});

test('exports, re-exports, qualifying internals, descriptors, and phase comments are audited', async (t) => {
  const f = await sourceFixture(
    '/** @module fixture */\n' +
      '/** exported */\nexport function exported() {}\n' +
      '/** alias */\nexport { exported as alias };\n' +
      '/** stars */\nexport * from "./other.mjs";\n' +
      '/** internal */\nconst helper = () => 1;\n' +
      '/** descriptor */\nexport const tool = { name: "tool", inputSchema: {} };\n' +
      '// phase1 setup\n' +
      '/** phase */\nconst phase1 = () => {};\n'
  );
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const result = await auditJsdoc({ files: [f.file] });
  assert.deepEqual(
    result.files[0].descriptors.map((item) => item.classification),
    ['descriptor']
  );
  assert.equal(
    result.files[0].errors.some((error) => error.code === 'missing-export-jsdoc'),
    false
  );
  assert.equal(
    result.files[0].errors.some((error) => error.code === 'missing-reexport-jsdoc'),
    false
  );
  assert.equal(
    result.files[0].errors.some((error) => error.code === 'missing-phase-comment'),
    false
  );
});

test('exemptions require an exact internal form and are forbidden on exports', async (t) => {
  const f = await sourceFixture(
    '/** @module fixture */\n' +
      '/** @jsdoc-exempt internal-top-level helper */\nconst helper = () => 1;\n' +
      '/** @jsdoc-exempt internal-top-level */\nconst invalid = () => 1;\n' +
      '/** @jsdoc-exempt internal-top-level exported */\nexport const exported = 1;\n'
  );
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const result = await auditJsdoc({ files: [f.file] });
  const codes = result.files[0].errors.map((error) => error.code);
  assert.ok(codes.includes('invalid-exemption'));
  assert.ok(codes.includes('export-exemption-forbidden'));
});
test('default exports are strict export targets, including anonymous declarations', async (t) => {
  const documented = await sourceFixture(
    '/** @module fixture */\n/** named default */\nexport default function named() {}\n'
  );
  const missing = await sourceFixture(
    '/** @module fixture */\nexport default class Anonymous {}\n'
  );
  t.after(() =>
    Promise.all([
      fs.rm(documented.root, { recursive: true, force: true }),
      fs.rm(missing.root, { recursive: true, force: true })
    ])
  );
  const documentedResult = await auditJsdoc({ files: [documented.file] });
  const missingResult = await auditJsdoc({ files: [missing.file] });
  assert.equal(
    documentedResult.errors.some((error) => error.code === 'missing-export-jsdoc'),
    false
  );
  assert.equal(
    missingResult.errors.filter((error) => error.code === 'missing-export-jsdoc').length,
    1
  );
  assert.equal(
    missingResult.errors.some((error) => error.code === 'missing-reexport-jsdoc'),
    false
  );
});

test('default expression attachment and misplaced documentation are deterministic', async (t) => {
  const attached = await sourceFixture(
    '/** @module fixture */\n/** attached expression */\nexport default { value: 1 };\n'
  );
  const misplaced = await sourceFixture(
    '/** @module fixture */\n/** misplaced expression */\nconst helper = 1;\nexport default helper;\n'
  );
  t.after(() =>
    Promise.all([
      fs.rm(attached.root, { recursive: true, force: true }),
      fs.rm(misplaced.root, { recursive: true, force: true })
    ])
  );
  const attachedResult = await auditJsdoc({ files: [attached.file] });
  const misplacedResult = await auditJsdoc({ files: [misplaced.file] });
  assert.equal(
    attachedResult.errors.some((error) => error.code === 'missing-export-jsdoc'),
    false
  );
  assert.equal(
    misplacedResult.errors.filter((error) => error.code === 'missing-export-jsdoc').length,
    1
  );
  assert.ok(misplacedResult.errors.some((error) => error.code === 'comment-attachment-gap'));
});
test('mcp-src is strict while mcp-engine only requires parsing and JSDoc presence', async (t) => {
  const strict = await sourceFixture('/** docs */\nexport const value = 1;\n');
  const bounded = await sourceFixture('/** docs */\nexport const value = 1;\n');
  const malformed = await sourceFixture('/** docs */\nexport const = 1;\n');
  const undocumented = await sourceFixture('export const value = 1;\n');
  t.after(() =>
    Promise.all(
      [strict, bounded, malformed, undocumented].map(({ root }) =>
        fs.rm(root, { recursive: true, force: true })
      )
    )
  );

  const strictManifest = buildTargetManifest({ key: 'mcp-src', root: strict.root });
  const strictResult = auditTargetManifest(strictManifest);
  const boundedResult = auditTargetManifest(
    buildTargetManifest({ key: 'mcp-engine', root: bounded.root })
  );
  const malformedResult = auditTargetManifest(
    buildTargetManifest({ key: 'mcp-engine', root: malformed.root })
  );
  const undocumentedResult = auditTargetManifest(
    buildTargetManifest({ key: 'mcp-engine', root: undocumented.root })
  );

  assert.ok(strictResult.failures.some((error) => error.code === 'missing-module-header'));
  assert.deepEqual(boundedResult.failures, []);
  assert.ok(malformedResult.failures.some((error) => error.code === 'parse-error'));
  assert.ok(undocumentedResult.failures.some((error) => error.code === 'missing-jsdoc'));
  assert.throws(
    () => auditTargetManifest({ ...strictManifest, policy: 'bounded' }),
    /unknown-audit-target/
  );
});
