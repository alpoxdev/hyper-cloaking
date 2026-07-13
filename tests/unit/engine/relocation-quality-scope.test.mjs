import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packageManifest = JSON.parse(
  await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8')
);

test('relocation quality scripts lint the engine while preserving ledger-bound bytes', async () => {
  const { lint, format, 'format:check': formatCheck } = packageManifest.scripts;

  assert.match(lint, /mcp\/engine\/\*\*\/\*.mjs/);
  for (const command of [format, formatCheck]) {
    assert.doesNotMatch(command, /mcp\/engine\/\*\*\/\*.mjs/);
    for (const scope of [
      'scripts/**/*.mjs',
      'tests/**/*.mjs',
      'mcp/src/**/*.mjs',
      'mcp/test/**/*.mjs'
    ]) {
      assert.ok(command.includes(scope), `${scope} must remain in the formatter scope`);
    }
  }
  const prettierIgnore = await fs.readFile(path.join(repositoryRoot, '.prettierignore'), 'utf8');
  assert.match(prettierIgnore, /^mcp\/engine\/$/m);

  const validator = await fs.readFile(path.join(repositoryRoot, 'scripts/validate.mjs'), 'utf8');
  assert.match(validator, /validateRelocationQualityScope/);
  assert.match(validator, /ledger-bound mcp\/engine\/\*\*\/\*.mjs/);
});
