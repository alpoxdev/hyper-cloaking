import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  EXCEPTION_PATHS,
  readRelocationFixtures,
  replayEntry,
  verifyHistoricalRelocation,
  verifyRelocation
} from '../../scripts/engine-relocation-v1-historical.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const legacyCli = path.join(repositoryRoot, 'scripts/engine-relocation-manifest.mjs');

test('v1 fixtures remain replayable without becoming a live topology verifier', async () => {
  const fixtures = await readRelocationFixtures();
  const preimagesByPath = new Map(
    fixtures.preimages.records.map((record) => [record.path, record])
  );
  let replayed = 0;

  for (const entry of fixtures.manifest.entries) {
    if (entry.preimageRef === undefined) continue;
    const preimage = preimagesByPath.get(entry.preimageRef);
    assert.ok(preimage, `missing admitted v1 preimage for ${entry.source}`);
    const output = replayEntry(entry, Buffer.from(preimage.bytesBase64, 'base64'));
    if (output === null) {
      assert.equal(entry.destination, null);
      assert.equal(entry.postSha256, null);
    } else {
      assert.equal(createHash('sha256').update(output).digest('hex'), entry.postSha256);
    }
    replayed += 1;
  }

  assert.equal(replayed, EXCEPTION_PATHS.length);
  assert.deepEqual(await verifyHistoricalRelocation(), { exceptions: EXCEPTION_PATHS.length });
  await assert.rejects(
    verifyHistoricalRelocation({ fixtureRoot: path.join(repositoryRoot, 'mcp/engine') }),
    /historical v1 verification cannot target the live adapter tree/
  );
  await assert.rejects(
    verifyRelocation({ repoRoot: repositoryRoot }),
    /historical v1 verification does not accept live topology options: repoRoot/
  );
});

test('v1 live generate and verify commands fail closed', async (t) => {
  for (const operation of ['generate', 'verify']) {
    await t.test(operation, async () => {
      await assert.rejects(execFileAsync(process.execPath, [legacyCli, operation]), (error) => {
        assert.equal(error.code, 1);
        assert.match(
          error.stderr,
          new RegExp(`v1 live ${operation} is retired after the v2 migration`)
        );
        return true;
      });
    });
  }
});

test('root validation routes v1 fixtures to historical replay and live topology to v2', async () => {
  const validateSource = await fs.readFile(
    path.join(repositoryRoot, 'scripts/validate.mjs'),
    'utf8'
  );

  assert.match(validateSource, /from '\.\/engine-relocation-v1-historical\.mjs';/);
  assert.match(validateSource, /await verifyHistoricalRelocation\(/);
  assert.match(validateSource, /from '\.\/engine-relocation-v2\.mjs';/);
  assert.match(validateSource, /await verifyLiveRelocation\(\{ repoRoot: root \}\)/);
});
