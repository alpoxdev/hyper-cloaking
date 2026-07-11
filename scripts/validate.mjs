import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MANAGED_EXCLUDED_SEGMENTS,
  OWNED_CANONICAL_MANIFEST
} from '../plugins/hyper-cloaking/skills/hyper-cloaking/engine/agents/lib/sync-mirror.mjs';

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

function rejectPathExists(file, reason) {
  if (existsSync(fullPath(file))) fail(`${file} must not exist: ${reason}`);
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
function listRelativeFiles(dir) {
  const base = fullPath(dir);
  if (!existsSync(base)) return [];
  const output = [];
  const skipDirs = new Set(['.git', '.gjc', '.omc', '.omx', '.impeccable', 'node_modules']);
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = toPosix(path.relative(base, absolute));
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(absolute);
      } else if (entry.isFile()) {
        output.push(relative);
      }
    }
    return output;
  }
  return walk(base).toSorted();
}

function assertDirectorySame(left, right) {
  requireFile(left);
  requireFile(right);
  if (!existsSync(fullPath(left)) || !existsSync(fullPath(right))) return;
  const leftFiles = listRelativeFiles(left);
  const rightFiles = listRelativeFiles(right);
  if (JSON.stringify(leftFiles) !== JSON.stringify(rightFiles)) {
    fail(`${right} file inventory is not mirrored from ${left}`);
    return;
  }
  for (const relative of leftFiles) {
    assertSame(toPosix(path.join(left, relative)), toPosix(path.join(right, relative)));
  }
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
      if (['.git', '.gjc', 'node_modules'].includes(entry.name)) continue;
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

// Headings under which removed skill-local helper command strings may appear (bounded migration block).
const migrationBlockHeadings = new Set([
  '## Engine-only migration: removed commands',
  '## Engine-only migration: removed helper commands',
  '## Engine-only 마이그레이션: 제거된 명령'
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
    rejectPathExists(
      `${base}/engine/providers/reddit.mjs`,
      'flat Reddit provider module was replaced by the directory module'
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
    requireText(file, 'parent-dispatcher.mjs', 'internal parent dispatcher');
  }

  const schemaFile = `${canonical}/engine/agents/schemas/hyper-cloaking-agent-output.schema.json`;
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
  requireText(
    'skills/hyper-cloaking/engine/mcp-config.mjs',
    'openclaw',
    'OpenClaw MCP client target'
  );
  requireText('skills/hyper-cloaking/engine/mcp-config.mjs', 'hermes', 'Hermes MCP client target');

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

for (const helper of [
  'engine/config.mjs',
  'engine/mcp-config.mjs',
  'engine/cli.mjs',
  'engine/browser-utils.mjs',
  'engine/cookie.mjs',
  'engine/input-core.mjs',
  'engine/mouse.mjs',
  'engine/keyboard.mjs',
  'engine/scroll.mjs',
  'engine/target-safety.mjs',
  'engine/outcome.mjs',
  'engine/diagnostics.mjs',
  'engine/evidence-boundary.mjs',
  'engine/recon-scope.mjs',
  'engine/run-shapes.mjs',
  'engine/cli-integration.test.mjs',
  'engine/agents/setup-agent.mjs',
  'engine/agents/setup-agent.test.mjs',
  'engine/agents/browser-task-agent.mjs',
  'engine/agents/browser-task-agent.test.mjs',
  'engine/agents/diagnostics-agent.mjs',
  'engine/agents/diagnostics-agent.test.mjs',
  'engine/agents/parent-dispatcher.mjs',
  'engine/agents/parent-verify.mjs',
  'engine/agents/parent-verify.test.mjs',
  'engine/agents/evidence-writer.mjs',
  'engine/agents/evidence-writer.test.mjs',
  'engine/agents/routing.test.mjs',
  'engine/agents/lib/allowed-origin-guard.mjs',
  'engine/agents/lib/allowed-origin-guard.test.mjs',
  'engine/agents/lib/sync-mirror.mjs',
  'engine/agents/lib/sync-mirror.test.mjs',
  'engine/agents/schemas/hyper-cloaking-agent-output.schema.json',
  'engine/agents/schemas/hyper-cloaking-agent-output.ko.md',
  'engine/outcome-diagnostics-boundary.test.mjs',
  'engine/recon-run-shapes.test.mjs',
  'engine/target-safety.test.mjs',
  'engine/providers/schema.mjs',
  'engine/providers/registry.mjs',
  'engine/providers/generic.mjs',
  'engine/providers/naver.mjs',
  'engine/providers/session.mjs',
  'engine/providers/reddit/index.mjs',
  'engine/providers/reddit/metadata.mjs',
  'engine/providers/reddit/selectors.mjs',
  'engine/providers/reddit/session.mjs',
  'engine/providers/reddit/actions/ids.mjs',
  'engine/providers/reddit/actions/listing.mjs',
  'engine/providers/reddit/actions/post.mjs',
  'engine/providers/reddit/actions/user.mjs',
  'engine/providers/reddit/actions/analyze.mjs',
  'engine/providers/reddit/actions/reactions.mjs',
  'engine/providers/reddit/actions/analyze.test.mjs',
  'engine/providers/reddit/actions/reads.test.mjs',
  'engine/providers/reddit/reddit-actions.test.mjs',
  'engine/providers/instagram/index.mjs',
  'engine/providers/instagram/metadata.mjs',
  'engine/providers/instagram/selectors.mjs',
  'engine/providers/instagram/session.mjs',
  'engine/providers/instagram/actions/user.mjs',
  'engine/providers/instagram/actions/posts.mjs',
  'engine/providers/instagram/actions/analyze.mjs',
  'engine/providers/instagram/actions/reactions.mjs',
  'engine/providers/instagram/actions/dm.mjs',
  'engine/providers/instagram/actions/analyze.test.mjs',
  'engine/providers/instagram/instagram-actions.test.mjs',
  'engine/action-runtime/guardrails.mjs',
  'engine/action-runtime/action-result.mjs',
  'engine/action-runtime/guardrails.test.mjs',
  'engine/providers/youtube/index.mjs',
  'engine/providers/youtube/metadata.mjs',
  'engine/providers/youtube/selectors.mjs',
  'engine/providers/youtube/session.mjs',
  'engine/providers/youtube/actions/ids.mjs',
  'engine/providers/youtube/actions/search.mjs',
  'engine/providers/youtube/actions/video.mjs',
  'engine/providers/youtube/actions/channel.mjs',
  'engine/providers/youtube/actions/analyze.mjs',
  'engine/providers/youtube/actions/reactions.mjs',
  'engine/providers/youtube/actions/analyze.test.mjs',
  'engine/providers/youtube/actions/reads.test.mjs',
  'engine/providers/youtube/youtube-actions.test.mjs',
  'engine/providers/x.mjs',
  'engine/providers/index.mjs',
  'engine/providers/provider-registry.test.mjs',
  'engine/providers/schema.test.mjs'
]) {
  requireFile(`${pluginRoot}/skills/hyper-cloaking/${helper}`);
  requireFile(`skills/hyper-cloaking/${helper}`);
}

for (const skillName of skillNames) {
  const canonical = `${pluginRoot}/skills/${skillName}/SKILL.md`;
  validateSkill(canonical, skillName);
  validateSkill(`.agents/skills/${skillName}/SKILL.md`, skillName);
  validateSkill(`.claude/skills/${skillName}/SKILL.md`, skillName);
  if (rootSkillNames.includes(skillName)) validateSkill(`skills/${skillName}/SKILL.md`, skillName);
  assertSame(canonical, `.agents/skills/${skillName}/SKILL.md`);
  assertSame(canonical, `.claude/skills/${skillName}/SKILL.md`);
  if (rootSkillNames.includes(skillName)) assertSame(canonical, `skills/${skillName}/SKILL.md`);
}
const hyperCanonicalDir = `${pluginRoot}/skills/hyper-cloaking`;
assertDirectorySame(hyperCanonicalDir, '.agents/skills/hyper-cloaking');
assertDirectorySame(hyperCanonicalDir, '.claude/skills/hyper-cloaking');
assertDirectorySame(hyperCanonicalDir, 'skills/hyper-cloaking');

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

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(
  `Validated ${skillNames.length} skill, version metadata, skill paths, helper scripts, OpenClaw/Hermes client support, and stale identity checks for Claude Code, Codex, Cursor, OpenClaw, Hermes, and Open Agent Skills.`
);
