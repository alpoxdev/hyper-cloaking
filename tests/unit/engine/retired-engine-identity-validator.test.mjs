import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { LEGACY_ENGINE_ROOTS } from '../../../scripts/engine-relocation-manifest.mjs';
import {
  RETIRED_ENGINE_PACKAGE,
  findRetiredEngineIdentityViolations
} from '../../../scripts/validate.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureRoot = path.join(repositoryRoot, 'mcp/test/fixtures');
const [allowedFixture, rejectedFixture] = await Promise.all(
  ['retired-engine-identity-allowed.v1.json', 'retired-engine-identity-rejected.v1.json'].map(
    async (filename) => JSON.parse(await fs.readFile(path.join(fixtureRoot, filename), 'utf8'))
  )
);

function recordFromFixtureCase(fixtureCase) {
  return {
    file: fixtureCase.file,
    content: fixtureCase.content
      .replaceAll('$RETIRED_ENGINE_PACKAGE', RETIRED_ENGINE_PACKAGE)
      .replaceAll('$LEGACY_ENGINE_ROOT', LEGACY_ENGINE_ROOTS[0])
  };
}

test('retired identity fixtures declare the current schema version', () => {
  assert.equal(allowedFixture.schemaVersion, 1);
  assert.equal(rejectedFixture.schemaVersion, 1);
});

for (const fixtureCase of allowedFixture.cases) {
  test(`retired identity validator permits ${fixtureCase.name}`, () => {
    assert.deepEqual(findRetiredEngineIdentityViolations([recordFromFixtureCase(fixtureCase)]), []);
  });
}

for (const fixtureCase of rejectedFixture.cases) {
  test(`retired identity validator rejects ${fixtureCase.name}`, () => {
    const violations = findRetiredEngineIdentityViolations([recordFromFixtureCase(fixtureCase)]);
    assert.deepEqual(
      violations.map(({ rule }) => rule),
      [fixtureCase.expectedRule]
    );
  });
}
