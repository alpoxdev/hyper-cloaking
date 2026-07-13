import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  generateInventory,
  partitionInventory,
  validateInventoryArtifact,
  validateSliceArtifact,
  serializeCanonicalJson,
  validateRelativeModulePath,
  selectCanonicalTargets,
  buildTargetManifest
} from '../../../scripts/jsdoc-inventory.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jsdoc-inventory-'));
  const canonicalRoot = path.join(root, 'plugins/hyper-cloaking/skills/hyper-cloaking');
  await fs.mkdir(canonicalRoot, { recursive: true });
  await fs.writeFile(path.join(canonicalRoot, 'A.mjs'), 'export const answer = 42;\n');
  await fs.writeFile(path.join(canonicalRoot, 'b.mjs'), '/** docs */\nexport function run() {}\n');
  return { root, canonicalRoot };
}

test('relative module paths are strict and portable', () => {
  for (const value of [
    '',
    '/x.mjs',
    'x\\y.mjs',
    'x//y.mjs',
    './x.mjs',
    '../x.mjs',
    'C:x.mjs',
    'x.txt',
    'é.mjs',
    'x\0.mjs'
  ])
    assert.equal(validateRelativeModulePath(value), false, value);
  assert.equal(validateRelativeModulePath('A.mjs'), true);
});

test('inventory generation, validation, and deterministic serialization preserve schema invariants', async (t) => {
  const { root, canonicalRoot } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inventory = await generateInventory({ canonicalRoot });
  assert.equal(inventory.canonicalRoot, canonicalRoot);
  assert.equal(inventory.paths.length, 2);
  assert.deepEqual(inventory.paths, ['A.mjs', 'b.mjs']);
  assert.doesNotThrow(() => validateInventoryArtifact(inventory, { canonicalRoot }));
  assert.equal(serializeCanonicalJson(inventory), serializeCanonicalJson(inventory));
  assert.throws(() =>
    validateInventoryArtifact({ ...inventory, paths: ['b.mjs', 'A.mjs'] }, { canonicalRoot })
  );
  assert.throws(() =>
    validateInventoryArtifact({ ...inventory, paths: ['A.mjs', 'A.mjs'] }, { canonicalRoot })
  );
});

test('slices form a sorted, non-overlapping complete partition', async (t) => {
  const { root, canonicalRoot } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inventory = await generateInventory({ canonicalRoot });
  const slices = partitionInventory(inventory, 1);
  assert.equal(slices.length, 2);
  assert.doesNotThrow(() => validateSliceArtifact(slices, inventory));
  assert.throws(() =>
    validateSliceArtifact(
      [{ ...slices[0], paths: ['A.mjs', 'b.mjs'] }, ...slices.slice(1)],
      inventory
    )
  );
});
test('canonical target selection preserves policy order and rejects retired selectors', async (t) => {
  assert.deepEqual(
    selectCanonicalTargets('mcp-src').map((target) => target.key),
    ['mcp-src']
  );
  assert.deepEqual(
    selectCanonicalTargets('mcp-engine').map((target) => target.key),
    ['mcp-engine']
  );
  assert.deepEqual(
    selectCanonicalTargets('all').map((target) => target.key),
    ['mcp-src', 'mcp-engine']
  );
  assert.deepEqual(
    selectCanonicalTargets('all').map((target) => target.policy),
    ['strict', 'bounded']
  );
  assert.throws(() => selectCanonicalTargets('mcp'), /unknown-audit-target/);
  assert.throws(() => selectCanonicalTargets('skills'), /unknown-audit-target/);
  assert.throws(() => selectCanonicalTargets('unknown'), /unknown-audit-target/);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jsdoc-target-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.throws(
    () => buildTargetManifest({ key: 'mcp-src', root: path.join(root, 'missing') }),
    /target-root-missing/
  );
  await fs.mkdir(path.join(root, 'empty'), { recursive: true });
  assert.throws(
    () => buildTargetManifest({ key: 'mcp-engine', root: path.join(root, 'empty') }),
    /target-empty/
  );
  assert.throws(() => buildTargetManifest({ key: 'other', root }), /unknown-audit-target/);
});
