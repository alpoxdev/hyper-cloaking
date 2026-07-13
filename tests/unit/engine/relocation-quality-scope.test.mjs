import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packageManifest = JSON.parse(
  await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8')
);

test('relocation quality scripts lint canonical source and route live topology through v2', async () => {
  const { lint, format, 'format:check': formatCheck } = packageManifest.scripts;

  assert.match(lint, /packages\/mcp-engine\/src\/\*\*\/\*.mjs/);
  for (const command of [format, formatCheck]) {
    assert.doesNotMatch(command, /mcp\/engine\/\*\*\/\*.mjs/);
    for (const scope of [
      'scripts/**/*.mjs',
      'tests/**/*.mjs',
      'mcp/test/**/*.mjs',
      'packages/mcp-engine/src/**/*.mjs'
    ]) {
      assert.ok(command.includes(scope), `${scope} must remain in the formatter scope`);
    }
  }
  const prettierIgnore = await fs.readFile(path.join(repositoryRoot, '.prettierignore'), 'utf8');
  assert.match(prettierIgnore, /^mcp\/engine\/$/m);

  const validator = await fs.readFile(path.join(repositoryRoot, 'scripts/validate.mjs'), 'utf8');
  assert.match(validator, /validateAuthoredSourceQualityScope/);
  assert.match(validator, /validateHistoricalV1Replay/);
  assert.match(validator, /validateLiveEngineTopology/);
  assert.match(validator, /verifyLiveRelocation/);
});
