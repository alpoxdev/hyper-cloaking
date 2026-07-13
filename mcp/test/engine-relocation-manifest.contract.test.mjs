import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  ADMISSION_DIRECTORY,
  CANONICAL_ENGINE_ROOT,
  EXCEPTION_PATHS,
  FIXTURE_ROOT,
  MANIFEST_FILENAME,
  NEGATIVE_ADMISSION_FILENAMES,
  OUTER_PACKAGE_POLICY,
  POSITIVE_ADMISSION_FILENAME,
  PREIMAGES_FILENAME,
  assertOuterPackagePolicy,
  buildRelocationFixtureBundle,
  readRelocationFixtures,
  replayEntry,
  validateManifest,
  validatePositiveAdmission,
  validatePreimageAdmission,
  verifyRelocation
} from '../../scripts/engine-relocation-manifest.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = path.join(repositoryRoot, FIXTURE_ROOT);
const canonicalEngineRoot = path.join(repositoryRoot, CANONICAL_ENGINE_ROOT);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function fixtureBundle() {
  return readRelocationFixtures({ fixtureRoot });
}

function expectedOuterPackage() {
  return {
    name: '@alpoxdev/hyper-cloaking',
    main: OUTER_PACKAGE_POLICY.main,
    files: OUTER_PACKAGE_POLICY.files,
    bin: OUTER_PACKAGE_POLICY.bin,
    exports: OUTER_PACKAGE_POLICY.exports,
    dependencies: OUTER_PACKAGE_POLICY.dependencies
  };
}

function tarballEngineBinTargetPaths() {
  const prefix = './engine/';
  return new Set(
    Object.values(OUTER_PACKAGE_POLICY.bin)
      .filter((target) => target.startsWith(prefix))
      .map((target) => target.slice(prefix.length))
  );
}

async function materializeExpectedEngine(engineRoot, manifest, preimages) {
  if (!(await exists(canonicalEngineRoot))) {
    await fs.cp(path.join(repositoryRoot, 'mcp/engine'), engineRoot, {
      recursive: true,
      preserveTimestamps: true
    });
    return;
  }

  const preimagesByPath = new Map(preimages.records.map((record) => [record.path, record]));
  for (const entry of manifest.entries) {
    if (entry.destination === null) continue;
    const relativePath = entry.source.slice(`${CANONICAL_ENGINE_ROOT}/`.length);
    const source = path.join(canonicalEngineRoot, relativePath);
    let bytes = await fs.readFile(source);
    if (entry.preimageRef !== undefined) {
      const preimage = preimagesByPath.get(entry.preimageRef);
      if (!preimage) throw new Error(`missing preimage fixture for ${entry.preimageRef}`);
      bytes = replayEntry(entry, Buffer.from(preimage.bytesBase64, 'base64'));
    }
    const destination = path.join(engineRoot, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes, { mode: Number.parseInt(entry.mode, 8) });
    await fs.chmod(destination, Number.parseInt(entry.mode, 8));
  }
}

async function makeRelocatedFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-relocation-'));
  const bundle = await fixtureBundle();
  const engineRoot = path.join(root, 'mcp/engine');
  await fs.mkdir(path.dirname(engineRoot), { recursive: true });
  await fs.writeFile(
    path.join(root, 'mcp/package.json'),
    `${JSON.stringify(expectedOuterPackage(), null, 2)}\n`
  );
  await materializeExpectedEngine(engineRoot, bundle.manifest, bundle.preimages);
  return { root, engineRoot, bundle };
}

test('relocation fixtures have a strict sorted schema', async () => {
  const bundle = await fixtureBundle();
  validateManifest(bundle.manifest);
  assert.deepEqual(
    bundle.manifest.entries.map((entry) => entry.source),
    [...bundle.manifest.entries.map((entry) => entry.source)].sort()
  );
  assert.equal(
    bundle.manifest.entries.filter((entry) => entry.preimageRef !== undefined).length,
    EXCEPTION_PATHS.length
  );

  const malformed = structuredClone(bundle.manifest);
  malformed.unknown = true;
  assert.throws(() => validateManifest(malformed), /unexpected keys/);
});

test('generator is deterministic while all four legacy source trees exist', async (t) => {
  if (!(await exists(canonicalEngineRoot))) {
    t.skip('legacy source trees were intentionally removed after fixture generation');
    return;
  }
  const bundle = await fixtureBundle();
  const generated = await buildRelocationFixtureBundle();
  assert.deepEqual(generated.manifest, bundle.manifest);
  assert.deepEqual(generated.preimages, bundle.preimages);
});

test('all six admitted preimages are hash and mode bound while five synthetic payloads are rejected', async () => {
  const bundle = await fixtureBundle();
  validatePositiveAdmission(bundle.positive, bundle.preimages, bundle.manifest);
  assert.doesNotThrow(() => validatePreimageAdmission(bundle.preimages.records, bundle.manifest));
  assert.equal(bundle.positive.records.length, EXCEPTION_PATHS.length);

  for (const record of bundle.preimages.records) {
    const bytes = Buffer.from(record.bytesBase64, 'base64');
    assert.equal(sha256(bytes), record.sha256, `preimage bytes hash for ${record.path}`);
  }

  for (const filename of NEGATIVE_ADMISSION_FILENAMES) {
    const negative = bundle.negatives[filename];
    assert.throws(
      () => validatePreimageAdmission(negative.records, bundle.manifest),
      filename.includes('altered') ? /path\/hash\/mode is not admitted/ : /path is not admitted/,
      filename
    );
  }
});

test('each declared exception replays to the committed posthash and preserves its recorded mode', async () => {
  const bundle = await fixtureBundle();
  const preimagesByPath = new Map(bundle.preimages.records.map((record) => [record.path, record]));
  const exceptions = bundle.manifest.entries.filter((entry) => entry.preimageRef !== undefined);
  assert.deepEqual(
    exceptions.map((entry) => entry.preimageRef),
    EXCEPTION_PATHS
  );

  for (const entry of exceptions) {
    const preimage = preimagesByPath.get(entry.preimageRef);
    assert.equal(preimage.mode, entry.mode, `mode for ${entry.preimageRef}`);
    const replayed = replayEntry(entry, Buffer.from(preimage.bytesBase64, 'base64'));
    if (entry.destination === null) {
      assert.equal(replayed, null, 'package.json is absorbed into the outer package policy');
    } else {
      assert.equal(sha256(replayed), entry.postSha256, `posthash for ${entry.preimageRef}`);
    }
  }
});

test('post-deletion verification applies only outer bin map tarball mode transforms and rejects other drift', async () => {
  const { root, engineRoot, bundle } = await makeRelocatedFixtureRoot();
  const tarballRoot = path.join(root, 'tarball');
  const tarballEngineRoot = path.join(tarballRoot, 'engine');
  const binTargetPaths = tarballEngineBinTargetPaths();
  await fs.mkdir(tarballRoot, { recursive: true });
  await fs.cp(engineRoot, tarballEngineRoot, { recursive: true, preserveTimestamps: true });
  assert.ok(binTargetPaths.size > 0, 'outer bin map must declare engine targets');

  for (const relativePath of binTargetPaths)
    await fs.chmod(path.join(tarballEngineRoot, relativePath), 0o755);
  assert.deepEqual(await verifyRelocation({ repoRoot: root, fixtureRoot, tarballRoot }), {
    entries: bundle.manifest.entries.length - 1,
    tarballVerified: true
  });

  const binTarget = [...binTargetPaths].sort()[0];
  const binEntry = bundle.manifest.entries.find(
    (entry) => entry.destination === `mcp/engine/${binTarget}`
  );
  assert.ok(binEntry, `tarball bin target is an engine entry: ${binTarget}`);
  assert.notEqual(
    binEntry.mode,
    '0755',
    `worktree ledger mode differs for bin target: ${binTarget}`
  );
  await fs.chmod(path.join(tarballEngineRoot, binTarget), Number.parseInt(binEntry.mode, 8));
  await assert.rejects(
    verifyRelocation({ repoRoot: root, fixtureRoot, tarballRoot }),
    /tarball engine file mismatch/
  );
  await fs.chmod(path.join(tarballEngineRoot, binTarget), 0o755);

  const nonBinEntry = bundle.manifest.entries.find(
    (entry) =>
      entry.destination !== null &&
      !binTargetPaths.has(entry.destination.slice('mcp/engine/'.length)) &&
      entry.mode !== '0755'
  );
  assert.ok(nonBinEntry, 'fixture must include a non-bin non-executable engine file');
  const nonBinPath = nonBinEntry.destination.slice('mcp/engine/'.length);
  await fs.chmod(path.join(tarballEngineRoot, nonBinPath), 0o755);
  await assert.rejects(
    verifyRelocation({ repoRoot: root, fixtureRoot, tarballRoot }),
    /tarball engine file mismatch/
  );
  await fs.chmod(path.join(tarballEngineRoot, nonBinPath), Number.parseInt(nonBinEntry.mode, 8));

  await fs.chmod(path.join(engineRoot, binTarget), 0o755);
  await assert.rejects(
    verifyRelocation({ repoRoot: root, fixtureRoot, tarballRoot }),
    /worktree engine file mismatch/
  );
  await fs.chmod(path.join(engineRoot, binTarget), Number.parseInt(binEntry.mode, 8));

  await fs.writeFile(path.join(engineRoot, 'unexpected.mjs'), 'export {};\n');
  await assert.rejects(verifyRelocation({ repoRoot: root, fixtureRoot }), /inventory mismatch/);
  await fs.rm(path.join(engineRoot, 'unexpected.mjs'));

  const expectedPath = bundle.manifest.entries.find((entry) =>
    entry.destination?.endsWith('/config.mjs')
  );
  await fs.rm(path.join(engineRoot, 'config.mjs'));
  await assert.rejects(verifyRelocation({ repoRoot: root, fixtureRoot }), /inventory mismatch/);
  await materializeExpectedEngine(engineRoot, bundle.manifest, bundle.preimages);

  await fs.rm(path.join(tarballEngineRoot, expectedPath.destination.slice('mcp/engine/'.length)));
  await assert.rejects(
    verifyRelocation({ repoRoot: root, fixtureRoot, tarballRoot }),
    /tarball engine inventory mismatch/
  );

  assertOuterPackagePolicy(expectedOuterPackage());
  const retiredDependency = expectedOuterPackage();
  retiredDependency.dependencies = {
    ...retiredDependency.dependencies,
    'hyper-cloaking-engine': '*'
  };
  assert.throws(() => assertOuterPackagePolicy(retiredDependency), /hyper-cloaking-engine/);
});

test('fixture paths remain the committed manifest, bounded preimage bundle, and admission directory', async () => {
  assert.equal(await exists(path.join(fixtureRoot, MANIFEST_FILENAME)), true);
  assert.equal(await exists(path.join(fixtureRoot, PREIMAGES_FILENAME)), true);
  assert.equal(
    await exists(path.join(fixtureRoot, ADMISSION_DIRECTORY, POSITIVE_ADMISSION_FILENAME)),
    true
  );
  for (const filename of NEGATIVE_ADMISSION_FILENAMES) {
    assert.equal(
      await exists(path.join(fixtureRoot, ADMISSION_DIRECTORY, filename)),
      true,
      filename
    );
  }
});
