import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import {
  MANAGED_EXCLUDED_SEGMENTS,
  OWNED_CANONICAL_MANIFEST
} from '../mcp/engine/agents/lib/sync-mirror.mjs';
import {
  assertOuterPackagePolicy,
  LEGACY_ENGINE_ROOTS,
  verifyRelocation
} from './engine-relocation-manifest.mjs';

const root = process.cwd();
const pluginRoot = 'plugins/hyper-cloaking';
const expectedVersion = '0.0.1';
const skillNames = ['hyper-cloaking'];
const rootSkillNames = ['hyper-cloaking'];
const errors = [];

function fail(message) {
  errors.push(message);
}

function fullPath(file) {
  return path.join(root, file);
}

function toPosix(file) {
  return file.split(path.sep).join('/');
}

function readText(file) {
  return readFileSync(fullPath(file), 'utf8');
}

function requireFile(file) {
  if (!existsSync(fullPath(file))) fail(`Missing ${file}`);
}

function pathExists(file) {
  try {
    lstatSync(fullPath(file));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function rejectPathExists(file, reason) {
  if (pathExists(file)) fail(`${file} must not exist: ${reason}`);
}

function parseJson(file) {
  requireFile(file);
  try {
    return JSON.parse(readText(file));
  } catch (error) {
    fail(`Invalid JSON in ${file}: ${error.message}`);
    return {};
  }
}

function frontmatter(text, file) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    fail(`Missing YAML frontmatter in ${file}`);
    return new Map();
  }

  const fields = new Map();
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.startsWith('  ') || line.startsWith('- ')) continue;
    const index = line.indexOf(':');
    if (index === -1) continue;
    fields.set(
      line.slice(0, index).trim(),
      line
        .slice(index + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '')
    );
  }
  return fields;
}

function validateSkill(file, expectedName) {
  requireFile(file);
  if (!existsSync(fullPath(file))) return;
  const text = readText(file);
  const fm = frontmatter(text, file);
  const name = fm.get('name');
  const description = fm.get('description');

  if (name !== expectedName)
    fail(`${file} has name=${name ?? '<missing>'}, expected ${expectedName}`);
  if (!description) fail(`${file} is missing description`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name ?? '')) fail(`${file} name is not kebab-case`);
}

function assertSame(left, right) {
  requireFile(left);
  requireFile(right);
  if (!existsSync(fullPath(left)) || !existsSync(fullPath(right))) return;
  if (readText(left) !== readText(right))
    fail(`${right} is not byte-for-byte mirrored from ${left}`);
}
function assertOwnedFilesSame(left, right) {
  requireFile(left);
  requireFile(right);
  if (!existsSync(fullPath(left)) || !existsSync(fullPath(right))) return;
  for (const relative of OWNED_CANONICAL_MANIFEST)
    assertSame(toPosix(path.join(left, relative)), toPosix(path.join(right, relative)));
}

function validateVersionMetadata(file, manifest) {
  if (Object.hasOwn(manifest, 'version') && manifest.version !== expectedVersion) {
    fail(`${file} version must be ${expectedVersion}`);
  }
  if (Object.hasOwn(manifest, 'schemaVersion') && manifest.schemaVersion !== expectedVersion) {
    fail(`${file} schemaVersion must be ${expectedVersion}`);
  }
}

function validatePluginVersionMetadata(file, plugin) {
  if (!plugin || typeof plugin !== 'object') return;
  if (Object.hasOwn(plugin, 'version') && plugin.version !== expectedVersion) {
    fail(`${file} plugin version must be ${expectedVersion}`);
  }
  if (Object.hasOwn(plugin, 'schemaVersion') && plugin.schemaVersion !== expectedVersion) {
    fail(`${file} plugin schemaVersion must be ${expectedVersion}`);
  }
}

function validateSkillPaths(file, skills) {
  if (!Array.isArray(skills)) {
    fail(`${file} skills must be an array`);
    return;
  }
  if (!skills.includes('./skills/hyper-cloaking'))
    fail(`${file} must reference ./skills/hyper-cloaking`);
  if (skills.includes('./skills/cloak-browser'))
    fail(`${file} must not reference ./skills/cloak-browser`);
}

function walkFiles(start) {
  if (!existsSync(fullPath(start))) return [];
  const statEntries = readdirSync(fullPath(start), { withFileTypes: true });
  const files = [];

  for (const entry of statEntries) {
    const file = toPosix(path.join(start, entry.name));
    if (entry.isDirectory()) {
      if (['.git', '.gjc', '.omc', '.omx', '.impeccable', 'node_modules'].includes(entry.name))
        continue;
      files.push(...walkFiles(file));
    } else if (entry.isFile()) {
      files.push(file);
    }
  }

  return files;
}

function validateNoStalePublicIdentity() {
  const staleSkillDirs = [
    `${pluginRoot}/skills/cloak-browser`,
    '.agents/skills/cloak-browser',
    '.claude/skills/cloak-browser',
    'skills/cloak-browser'
  ];

  for (const dir of staleSkillDirs) {
    rejectPathExists(dir, 'old cloak-browser skill directory is not supported');
  }
  const customAgentDirs = [`${pluginRoot}/agents`, '.claude/agents', '.codex', '.cursor'];

  for (const dir of customAgentDirs) {
    rejectPathExists(dir, 'custom agents are not part of this skill-only package');
  }

  const scanTargets = [
    'package.json',
    '.claude-plugin',
    '.agents',
    '.claude',
    '.codex',
    '.cursor',
    pluginRoot,
    'skills',
    'scripts'
  ];
  const files = scanTargets.flatMap((target) => {
    if (!existsSync(fullPath(target))) return [];
    if (target.endsWith('.json')) return [target];
    return walkFiles(target);
  });

  const staleContentPatterns = [
    { label: './skills/cloak-browser', regex: /\.\/skills\/cloak-browser\b/g },
    { label: '/cloak-browser/', regex: /\/cloak-browser\//g },
    { label: 'name: cloak-browser', regex: /^name:\s*['"]?cloak-browser['"]?\s*$/gm },
    { label: '"name": "cloak-browser"', regex: /"name"\s*:\s*"cloak-browser"/g },
    { label: 'name = "cloak-browser"', regex: /^name\s*=\s*"cloak-browser"\s*$/gm },
    { label: '[mcp_servers.cloak-browser]', regex: /^\[mcp_servers\.cloak-browser\]\s*$/gm },
    { label: '[mcpServers.cloak-browser]', regex: /^\[mcpServers\.cloak-browser\]\s*$/gm },
    { label: 'claude mcp add cloak-browser', regex: /\bclaude\s+mcp\s+add\s+cloak-browser\b/g },
    { label: 'CLOAK_BROWSER_WORKSPACE', regex: /\bCLOAK_BROWSER_WORKSPACE\b/g },
    { label: 'HYPERCORE_BUSINESS_HOME', regex: /\bHYPERCORE_BUSINESS_HOME\b/g },
    { label: '~/.hypercore-business', regex: /~\/\.hypercore-business\b/g },
    { label: '~/.cloakbrowser', regex: /~\/\.cloakbrowser\b/g },
    { label: 'resolve-cloak-mcp.mjs', regex: /resolve-cloak-mcp\.mjs/g }
  ];

  for (const file of files) {
    if (file === 'scripts/validate.mjs') continue;
    if (path.basename(file) === 'resolve-cloak-mcp.mjs') {
      fail(`${file} must be renamed or removed from public source`);
      continue;
    }

    const text = readText(file);
    for (const pattern of staleContentPatterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(text)) fail(`${file} contains stale ${pattern.label}`);
    }
  }
}
export const RETIRED_ENGINE_PACKAGE = 'hyper-cloaking-engine';
const OUTER_ENGINE_BIN_MANIFEST = 'mcp/package.json';
const HISTORICAL_RELOCATION_MANIFEST = 'mcp/test/fixtures/engine-relocation-manifest.v1.json';
const retiredEnginePackagePattern = RETIRED_ENGINE_PACKAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const legacyEnginePath = new RegExp(
  LEGACY_ENGINE_ROOTS.map((root) => root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
);

function isPackageManifest(file) {
  return file === 'package.json' || file.endsWith('/package.json');
}

function isDocumentationFile(file) {
  return file.endsWith('.md');
}

function isJavaScriptFile(file) {
  return /\.(?:[cm]?js)$/.test(file);
}

function parseRecordJson(record) {
  try {
    return JSON.parse(record.content);
  } catch {
    return null;
  }
}

function isRetiredEngineSpecifier(value) {
  return value === RETIRED_ENGINE_PACKAGE || value?.startsWith(`${RETIRED_ENGINE_PACKAGE}/`);
}

function moduleSpecifierValue(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type !== 'TemplateLiteral' || node.expressions.length !== 0) return null;
  return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? null;
}

function findRetiredEngineImports(record) {
  let program;
  try {
    program = parse(record.content, {
      allowHashBang: true,
      ecmaVersion: 'latest',
      sourceType: 'module'
    });
  } catch (error) {
    return [
      {
        rule: 'unparseable-javascript',
        message: `${record.file} could not be parsed for retired engine imports: ${error.message}`
      }
    ];
  }

  const violations = [];
  const nodes = [program];
  while (nodes.length > 0) {
    const node = nodes.pop();
    if (!node || typeof node !== 'object') continue;

    const source =
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration' ||
      node.type === 'ImportExpression'
        ? moduleSpecifierValue(node.source)
        : node.type === 'CallExpression' &&
            node.callee?.type === 'Identifier' &&
            node.callee.name === 'require'
          ? moduleSpecifierValue(node.arguments?.[0])
          : null;
    if (isRetiredEngineSpecifier(source)) {
      violations.push({
        rule: 'retired-import',
        message: `${record.file} must not import from the retired engine package`
      });
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child === 'object') nodes.push(child);
      } else if (value && typeof value === 'object') {
        nodes.push(value);
      }
    }
  }
  return violations;
}

function hasRetiredLockfileDependency(dependencies) {
  if (!dependencies || typeof dependencies !== 'object') return false;
  return Object.entries(dependencies).some(
    ([name, dependency]) =>
      name === RETIRED_ENGINE_PACKAGE || hasRetiredLockfileDependency(dependency?.dependencies)
  );
}

function hasRetiredLockfileIdentity(lockfile) {
  const packageIdentity = Object.entries(lockfile?.packages || {}).some(([location, manifest]) => {
    const normalizedLocation = location.replaceAll('\\', '/');
    if (new RegExp(`(?:^|/)node_modules/${retiredEnginePackagePattern}$`).test(normalizedLocation))
      return true;
    if (manifest?.name === RETIRED_ENGINE_PACKAGE) return true;
    return Object.hasOwn(manifest?.dependencies || {}, RETIRED_ENGINE_PACKAGE);
  });
  return packageIdentity || hasRetiredLockfileDependency(lockfile?.dependencies);
}

function isNamedHistoricalFixtureSource(file, line) {
  return file === HISTORICAL_RELOCATION_MANIFEST && /^\s*"source"\s*:\s*"[^"]+"/.test(line);
}

function isNegatedDocumentationContext(line) {
  const english = new RegExp(
    String.raw`${retiredEnginePackagePattern}[^\n]{0,120}\b(?:never|not|no\s+longer)\b[^\n]{0,40}\b(?:npm\s+)?(?:package|dependency|workspace|import(?:\s+specifier)?|specifier)\b|\bdo\s+not\b[^\n]{0,140}${retiredEnginePackagePattern}[^\n]{0,64}\b(?:as\s+)?(?:an?\s+)?(?:npm\s+)?(?:package|dependency|workspace|import(?:\s+specifier)?|specifier)\b`,
    'i'
  );
  const korean = new RegExp(
    String.raw`${retiredEnginePackagePattern}[^\n]{0,120}(?:npm\s+)?(?:package|import|specifier)(?:가|은|는|로)?[^\n]{0,24}(?:아니|아닙|없|취급하지\s*않)`,
    'i'
  );
  return english.test(line) || korean.test(line);
}

function documentationClauses(line) {
  const boundary = new RegExp(
    String.raw`(?:[.;:!?]\s*|\s+[—–-]\s+|,\s*(?=[^.;:!?]*${retiredEnginePackagePattern})|\s+(?:and|yet|but|however|although|whereas|그리고|하지만|그러나)\s+(?=[^.;:!?]*${retiredEnginePackagePattern}))`,
    'iu'
  );
  return line.split(boundary);
}

function documentationClauseViolation(file, clause) {
  if (!clause.includes(RETIRED_ENGINE_PACKAGE)) return null;
  const occurrences = [...clause.matchAll(new RegExp(retiredEnginePackagePattern, 'g'))].length;
  if (occurrences > 1) {
    return {
      rule: 'documentation-identity',
      message: `${file} must separate each retired engine identity occurrence into an independently valid clause`
    };
  }

  const packageInstall = new RegExp(
    String.raw`\b(?:npm|pnpm|yarn)\s+(?:install|i|add)\b[^\n]*${retiredEnginePackagePattern}|\binstall\s+(?:the\s+)?[\x60'"]?${retiredEnginePackagePattern}`,
    'i'
  );
  if (packageInstall.test(clause)) {
    return {
      rule: 'documentation-install',
      message: `${file} must not document installation of the retired engine package`
    };
  }
  const importReference = new RegExp(
    String.raw`\b(?:import\s*(?:[\w*{}\s,]*\s+from\s*)?|export\s*(?:[\w*{}\s,]*\s+from\s*)?|require\s*\(|import\s*\()\s*[\x60'"]${retiredEnginePackagePattern}`,
    'i'
  );
  if (importReference.test(clause)) {
    return {
      rule: 'documentation-import',
      message: `${file} must not document importing from the retired engine package`
    };
  }
  if (isNegatedDocumentationContext(clause)) return null;
  if (/\b(?:npm\s+)?(?:package|dependency|workspace)\b/i.test(clause)) {
    return {
      rule: 'documentation-package',
      message: `${file} must not document the retired engine as a package identity`
    };
  }
  if (/\b(?:installed\s+)?(?:executable\s+)?command labels?\b/i.test(clause)) return null;
  if (
    clause.includes(`\`${RETIRED_ENGINE_PACKAGE} `) ||
    new RegExp(`^\\s*${retiredEnginePackagePattern}\\s+\\S+`).test(clause)
  )
    return null;
  return {
    rule: 'documentation-identity',
    message: `${file} may mention the retired engine only as an executable command`
  };
}

function documentationViolation(file, line) {
  for (const clause of documentationClauses(line)) {
    const violation = documentationClauseViolation(file, clause);
    if (violation) return violation;
  }
  return null;
}

export function findRetiredEngineIdentityViolations(records) {
  const violations = [];

  for (const record of records) {
    const { file, content } = record;
    if (isPackageManifest(file)) {
      const manifest = parseRecordJson(record);
      if (manifest?.name === RETIRED_ENGINE_PACKAGE) {
        violations.push({
          rule: 'package-identity',
          message: `${file} must not use the retired engine package identity`
        });
      }
      for (const field of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies'
      ]) {
        if (Object.hasOwn(manifest?.[field] || {}, RETIRED_ENGINE_PACKAGE)) {
          violations.push({
            rule: 'package-dependency',
            message: `${file} must not retain ${RETIRED_ENGINE_PACKAGE} in ${field}`
          });
        }
      }
      const workspaces = manifest?.workspaces;
      const workspacePaths = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
      if (Array.isArray(workspacePaths) && workspacePaths.includes(RETIRED_ENGINE_PACKAGE)) {
        violations.push({
          rule: 'package-workspace',
          message: `${file} must not retain the retired engine workspace identity`
        });
      }
      if (
        Object.hasOwn(manifest?.bin || {}, RETIRED_ENGINE_PACKAGE) &&
        file !== OUTER_ENGINE_BIN_MANIFEST
      ) {
        violations.push({
          rule: 'package-bin',
          message: `${file} may retain ${RETIRED_ENGINE_PACKAGE} only in ${OUTER_ENGINE_BIN_MANIFEST} bin`
        });
      }
    }

    if (file === 'package-lock.json') {
      const lockfile = parseRecordJson(record);
      if (hasRetiredLockfileIdentity(lockfile)) {
        violations.push({
          rule: 'lockfile-package-identity',
          message: `${file} must not retain the retired engine package identity`
        });
      }
    }

    if (file.startsWith('artifacts/') && content.includes(RETIRED_ENGINE_PACKAGE)) {
      violations.push({
        rule: 'artifact-retired-package-identity',
        message: `${file} must not retain the retired engine package identity`
      });
    }

    if (file === 'scripts/engine-relocation-manifest.mjs') continue;

    if (isJavaScriptFile(file)) violations.push(...findRetiredEngineImports(record));
    for (const line of content.split('\n')) {
      if (isDocumentationFile(file)) {
        const documentationContext = documentationViolation(file, line);
        if (documentationContext) {
          violations.push(documentationContext);
          continue;
        }
      }
      if (legacyEnginePath.test(line) && !isNamedHistoricalFixtureSource(file, line)) {
        violations.push({
          rule: 'legacy-engine-path',
          message: `${file} must not retain a legacy engine filesystem path`
        });
      }
    }
  }

  return violations;
}

function retiredIdentityScanRecords() {
  const scanTargets = [
    'package.json',
    'package-lock.json',
    'mcp',
    'tests',
    'scripts',
    'artifacts',
    pluginRoot,
    '.agents',
    '.claude',
    'skills'
  ];
  const files = new Set();
  for (const target of scanTargets) {
    if (!existsSync(fullPath(target))) continue;
    if (target.endsWith('.json')) {
      files.add(target);
      continue;
    }
    for (const file of walkFiles(target)) files.add(file);
  }
  for (const entry of readdirSync(fullPath('.'), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) files.add(entry.name);
  }

  return [...files]
    .filter(
      (file) =>
        file.endsWith('.md') ||
        file.endsWith('.mjs') ||
        file.endsWith('.cjs') ||
        file.endsWith('.js') ||
        file.endsWith('.json') ||
        isPackageManifest(file) ||
        file === 'package-lock.json' ||
        file === HISTORICAL_RELOCATION_MANIFEST
    )
    .map((file) => ({ file, content: readText(file) }));
}

function validateNoRetiredEngineIdentity() {
  for (const { message } of findRetiredEngineIdentityViolations(retiredIdentityScanRecords()))
    fail(message);
}
function validateRelocationQualityScope(packageManifest) {
  const lint = packageManifest.scripts?.lint;
  const format = packageManifest.scripts?.format;
  const formatCheck = packageManifest.scripts?.['format:check'];
  if (!lint?.includes('mcp/engine/**/*.mjs'))
    fail('package.json lint must cover mcp/engine/**/*.mjs');

  requireFile('.prettierignore');
  if (
    existsSync(fullPath('.prettierignore')) &&
    !readText('.prettierignore').split(/\r?\n/).includes('mcp/engine/')
  ) {
    fail('.prettierignore must exclude ledger-bound mcp/engine/');
  }

  for (const [name, command] of [
    ['format', format],
    ['format:check', formatCheck]
  ]) {
    if (!command) {
      fail(`package.json must define ${name}`);
      continue;
    }
    // The relocation ledger proves mcp/engine payload bytes. Prettier must not rewrite that
    // immutable payload; .prettierignore, lint, and relocation verification enforce the boundary.
    if (command.includes('mcp/engine/**/*.mjs'))
      fail(`package.json ${name} must exclude ledger-bound mcp/engine/**/*.mjs`);
    for (const requiredScope of [
      'scripts/**/*.mjs',
      'tests/**/*.mjs',
      'mcp/src/**/*.mjs',
      'mcp/test/**/*.mjs'
    ]) {
      if (!command.includes(requiredScope))
        fail(`package.json ${name} must cover ${requiredScope}`);
    }
  }
}

// Headings under which removed skill-local helper command strings may appear (bounded migration block).
const migrationBlockHeadings = new Set([
  '## Engine-only migration: removed commands',
  '## Engine-only migration: removed helper commands',
  '## Engine-only 마이그레이션: 제거된 명령',
  '## Removed skill-local helper commands',
  '## 제거된 skill-local helper 명령'
]);

function validateEngineOnlyMigration() {
  // The skill-local scripts helper surface must not exist in canonical or mirrors.
  const skillBases = [
    `${pluginRoot}/skills/hyper-cloaking`,
    '.agents/skills/hyper-cloaking',
    '.claude/skills/hyper-cloaking',
    'skills/hyper-cloaking'
  ];
  for (const base of skillBases) {
    rejectPathExists(
      `${base}/scripts`,
      'skill-local scripts helper surface was removed in the engine-only migration'
    );
    rejectPathExists(
      `${base}/engine/providers/youtube.mjs`,
      'flat YouTube provider module was replaced by the directory module'
    );
  }

  // Old skill-local helper commands/imports are only allowed inside a bounded migration block in docs,
  // inside this validator (skipped below), and nowhere else.
  const stalePatterns = [
    { label: 'scripts/hyper-cloaking.mjs', regex: /scripts\/hyper-cloaking\.mjs/ },
    { label: 'scripts/browser-utils.mjs', regex: /scripts\/browser-utils\.mjs/ },
    { label: 'scripts/cookie.mjs', regex: /scripts\/cookie\.mjs/ },
    { label: 'skills/hyper-cloaking/scripts/', regex: /skills\/hyper-cloaking\/scripts\// },
    { label: '../scripts/ helper import', regex: /\.\.\/scripts\// }
  ];

  const scanTargets = ['.agents', '.claude', '.codex', '.cursor', pluginRoot, 'skills'];
  const files = scanTargets.flatMap((target) =>
    existsSync(fullPath(target)) ? walkFiles(target) : []
  );

  for (const file of files) {
    if (file === 'scripts/validate.mjs') continue;
    const lines = readText(file).split('\n');
    let blockLevel = 0;
    for (const line of lines) {
      const heading = line.match(/^(#{1,6})\s+/);
      if (heading) {
        const level = heading[1].length;
        if (blockLevel && level <= blockLevel) blockLevel = 0;
        if (!blockLevel && migrationBlockHeadings.has(line.trim())) blockLevel = level;
        continue;
      }
      if (blockLevel) continue;
      for (const pattern of stalePatterns) {
        if (pattern.regex.test(line)) {
          fail(`${file} contains stale ${pattern.label} outside the engine-only migration block`);
        }
      }
    }
  }
}
// Deliberate-bump tripwire: the number of *.test.mjs files expected under
// tests/unit/engine/. Bump this constant only when engine unit tests are
// intentionally added or removed, so an accidental drop is caught here.
const TESTS_BASELINE = 31;

function countTestFiles(start) {
  if (!existsSync(fullPath(start))) return 0;
  let count = 0;
  for (const entry of readdirSync(fullPath(start), { withFileTypes: true })) {
    const file = path.join(start, entry.name);
    if (entry.isDirectory()) {
      count += countTestFiles(file);
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      count += 1;
    }
  }
  return count;
}

function validateLegacyEnginePathsAbsent() {
  for (const engineRoot of LEGACY_ENGINE_ROOTS)
    rejectPathExists(engineRoot, 'legacy engine roots must be removed rather than symlinked');
}

function validateEngineTestRelocation() {
  // Enumerated named roots only — NEVER a repo-root **/engine glob, which would
  // also match the relocated tests/unit/engine tree and permanently fail this guard.
  for (const engineRoot of LEGACY_ENGINE_ROOTS) {
    const count = countTestFiles(engineRoot);
    if (count > 0)
      fail(`${engineRoot} must not contain colocated *.test.mjs files (found ${count})`);
  }

  const unitEngineCount = countTestFiles('tests/unit/engine');
  if (unitEngineCount !== TESTS_BASELINE) {
    fail(
      `tests/unit/engine must contain exactly ${TESTS_BASELINE} *.test.mjs files (found ${unitEngineCount})`
    );
  }
}
function validateAgentContracts(packageManifest, packageLock) {
  const canonical = `${pluginRoot}/skills/hyper-cloaking`;
  const roleNames = ['setup-agent', 'browser-task-agent', 'diagnostics-agent'];
  const requiredSections = [
    '## Objective',
    '## Trigger',
    '## Inputs',
    '## Allowed Tools',
    '## Forbidden Actions',
    '## Output Contract',
    '## Stop Conditions',
    '## Parent Handoff'
  ];

  for (const role of roleNames) {
    for (const suffix of ['.md', '.ko.md']) {
      const file = `${canonical}/rules/agents/${role}${suffix}`;
      requireFile(file);
      if (!existsSync(fullPath(file))) continue;
      const text = readText(file);
      let previous = -1;
      for (const section of requiredSections) {
        const index = text.indexOf(section);
        if (index === -1) fail(`${file} is missing ${section}`);
        if (index <= previous) fail(`${file} has role sections out of order`);
        previous = index;
      }
    }
  }

  for (const file of [
    `${canonical}/SKILL.md`,
    `${canonical}/SKILL.ko.md`,
    `${canonical}/rules/hyper-cloaking-workflow.md`,
    `${canonical}/rules/hyper-cloaking-workflow.ko.md`
  ]) {
    requireText(file, '3A.', 'portable parent-executed routing marker');
    requireText(file, 'hyper-cloaking-parent-dispatcher', 'installed parent dispatcher command');
  }

  const schemaFile = 'mcp/engine/agents/schemas/hyper-cloaking-agent-output.schema.json';
  const schema = parseJson(schemaFile);
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema')
    fail(`${schemaFile} must use JSON Schema 2020-12`);
  if (schema.unevaluatedProperties !== false)
    fail(`${schemaFile} root must set unevaluatedProperties=false`);
  if (schema.properties?.schemaVersion?.const !== 1)
    fail(`${schemaFile} agent protocol schemaVersion must be integer 1`);
  if (expectedVersion !== '0.0.1') fail('engine release/config version must remain 0.0.1');

  const expectedExclusions = ['.git', '.gjc', '.impeccable', '.omc', '.omx', 'node_modules'];
  if (JSON.stringify(MANAGED_EXCLUDED_SEGMENTS) !== JSON.stringify(expectedExclusions)) {
    fail('managed mirror exclusion policy changed unexpectedly');
  }
  if (new Set(OWNED_CANONICAL_MANIFEST).size !== OWNED_CANONICAL_MANIFEST.length) {
    fail('owned canonical manifest contains duplicates');
  }
  for (const relative of OWNED_CANONICAL_MANIFEST) {
    if (relative.includes('*') || path.isAbsolute(relative) || relative.startsWith('..')) {
      fail(`owned canonical manifest contains unsafe path ${relative}`);
    }
    requireFile(`${canonical}/${relative}`);
  }

  if (!packageManifest.dependencies?.ajv || !packageManifest.dependencies.ajv.startsWith('^8.')) {
    fail('package.json must include Ajv 8 as a production dependency');
  }
  const lockedAjv =
    packageLock.packages?.['node_modules/ajv']?.version || packageLock.dependencies?.ajv?.version;
  if (!lockedAjv || !String(lockedAjv).startsWith('8.')) {
    fail('package-lock.json must lock Ajv 8');
  }
}
function requireText(file, needle, label = needle) {
  requireFile(file);
  if (!existsSync(fullPath(file))) return;
  if (!readText(file).includes(needle)) fail(`${file} must mention ${label}`);
}

function validateClientSupportSurfaces() {
  requireText('mcp/engine/mcp-config.mjs', 'openclaw', 'OpenClaw MCP client target');
  requireText('mcp/engine/mcp-config.mjs', 'hermes', 'Hermes MCP client target');

  for (const file of [
    'skills/hyper-cloaking/SKILL.md',
    'skills/hyper-cloaking/rules/hyper-cloaking-workflow.md',
    'skills/hyper-cloaking/references/cloakbrowser-playwright-mcp.md',
    'skills/hyper-cloaking/SKILL.ko.md',
    'skills/hyper-cloaking/rules/hyper-cloaking-workflow.ko.md',
    'skills/hyper-cloaking/references/cloakbrowser-playwright-mcp.ko.md'
  ]) {
    requireText(file, 'OpenClaw');
    requireText(file, 'Hermes');
  }

  for (const file of [
    'skills/hyper-cloaking/rules/hyper-cloaking-workflow.md',
    'skills/hyper-cloaking/references/cloakbrowser-playwright-mcp.md',
    'skills/hyper-cloaking/rules/hyper-cloaking-workflow.ko.md',
    'skills/hyper-cloaking/references/cloakbrowser-playwright-mcp.ko.md'
  ]) {
    requireText(file, 'mcp.servers', 'OpenClaw mcp.servers config');
    requireText(file, 'mcp_servers', 'Hermes mcp_servers config');
  }
}

async function main() {
  const packageManifest = parseJson('package.json');
  const packageLock = parseJson('package-lock.json');
  const claudeMarketplace = parseJson('.claude-plugin/marketplace.json');
  const codexMarketplace = parseJson('.agents/plugins/marketplace.json');
  const claudePlugin = parseJson(`${pluginRoot}/.claude-plugin/plugin.json`);
  const codexPlugin = parseJson(`${pluginRoot}/.codex-plugin/plugin.json`);

  validateVersionMetadata('package.json', packageManifest);
  validateVersionMetadata('.claude-plugin/marketplace.json', claudeMarketplace);
  validatePluginVersionMetadata(
    '.claude-plugin/marketplace.json plugins[0]',
    claudeMarketplace.plugins?.[0]
  );
  validateVersionMetadata(`${pluginRoot}/.claude-plugin/plugin.json`, claudePlugin);
  validateVersionMetadata(`${pluginRoot}/.codex-plugin/plugin.json`, codexPlugin);

  if (packageManifest.name !== 'hyper-cloaking') fail('Package name must be hyper-cloaking');
  if (claudeMarketplace.name !== 'hyper-cloaking')
    fail('Claude marketplace name must be hyper-cloaking');
  if (claudeMarketplace.plugins?.[0]?.source !== './plugins/hyper-cloaking')
    fail('Claude marketplace source must point at ./plugins/hyper-cloaking');
  if (codexMarketplace.plugins?.[0]?.source?.path !== './plugins/hyper-cloaking')
    fail('Codex marketplace source.path must point at ./plugins/hyper-cloaking');
  if (claudePlugin.name !== 'hyper-cloaking') fail('Claude plugin name must be hyper-cloaking');
  if (codexPlugin.name !== 'hyper-cloaking') fail('Codex plugin name must be hyper-cloaking');
  if (codexPlugin.skills !== './skills/') fail('Codex plugin skills path must be ./skills/');

  validateSkillPaths(
    '.claude-plugin/marketplace.json plugins[0]',
    claudeMarketplace.plugins?.[0]?.skills
  );
  validateSkillPaths(`${pluginRoot}/.claude-plugin/plugin.json`, claudePlugin.skills);
  validateAgentContracts(packageManifest, packageLock);

  async function validateRelocatedEngine() {
    const outerPackage = parseJson('mcp/package.json');
    try {
      assertOuterPackagePolicy(outerPackage);
    } catch (error) {
      fail(`mcp/package.json violates relocation outer-package policy: ${error.message}`);
    }
    try {
      await verifyRelocation({ repoRoot: root });
    } catch (error) {
      fail(`engine relocation verification failed: ${error.message}`);
    }
  }

  for (const skillName of skillNames) {
    const canonical = `${pluginRoot}/skills/${skillName}/SKILL.md`;
    validateSkill(canonical, skillName);
    validateSkill(`.agents/skills/${skillName}/SKILL.md`, skillName);
    validateSkill(`.claude/skills/${skillName}/SKILL.md`, skillName);
    if (rootSkillNames.includes(skillName))
      validateSkill(`skills/${skillName}/SKILL.md`, skillName);
    assertSame(canonical, `.agents/skills/${skillName}/SKILL.md`);
    assertSame(canonical, `.claude/skills/${skillName}/SKILL.md`);
    if (rootSkillNames.includes(skillName)) assertSame(canonical, `skills/${skillName}/SKILL.md`);
  }

  const hyperCanonicalDir = `${pluginRoot}/skills/hyper-cloaking`;
  assertOwnedFilesSame(hyperCanonicalDir, '.agents/skills/hyper-cloaking');
  assertOwnedFilesSame(hyperCanonicalDir, '.claude/skills/hyper-cloaking');
  assertOwnedFilesSame(hyperCanonicalDir, 'skills/hyper-cloaking');

  const expectedSkillDirs = [...skillNames].toSorted();
  for (const dir of [`${pluginRoot}/skills`, '.agents/skills', '.claude/skills', 'skills']) {
    const actualSkillDirs = readdirSync(fullPath(dir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
    if (JSON.stringify(actualSkillDirs) !== JSON.stringify(expectedSkillDirs)) {
      fail(
        `${dir} directories ${JSON.stringify(actualSkillDirs)} do not match expected ${JSON.stringify(expectedSkillDirs)}`
      );
    }
  }

  validateClientSupportSurfaces();
  validateNoStalePublicIdentity();
  validateEngineOnlyMigration();
  validateEngineTestRelocation();
  validateLegacyEnginePathsAbsent();
  validateNoRetiredEngineIdentity();
  validateRelocationQualityScope(packageManifest);
  await validateRelocatedEngine();

  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join('\n'));
    process.exit(1);
  }

  console.log(
    `Validated ${skillNames.length} skill, mirror parity, relocation policy, client support, and stale identity checks for Claude Code, Codex, Cursor, OpenClaw, Hermes, and Open Agent Skills.`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
