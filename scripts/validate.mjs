import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

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
    fields.set(line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ''));
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

  if (name !== expectedName) fail(`${file} has name=${name ?? '<missing>'}, expected ${expectedName}`);
  if (!description) fail(`${file} is missing description`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name ?? '')) fail(`${file} name is not kebab-case`);
}



function assertSame(left, right) {
  requireFile(left);
  requireFile(right);
  if (!existsSync(fullPath(left)) || !existsSync(fullPath(right))) return;
  if (readText(left) !== readText(right)) fail(`${right} is not byte-for-byte mirrored from ${left}`);
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
        output.push(...walk(absolute));
      } else if (entry.isFile()) {
        output.push(relative);
      }
    }
    return output;
  }
  return walk(base).sort();
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
  if (!skills.includes('./skills/hyper-cloaking')) fail(`${file} must reference ./skills/hyper-cloaking`);
  if (skills.includes('./skills/cloak-browser')) fail(`${file} must not reference ./skills/cloak-browser`);
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
  const customAgentDirs = [
    `${pluginRoot}/agents`,
    '.claude/agents',
    '.codex',
    '.cursor'
  ];

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
    { label: 'resolve-cloak-mcp.mjs', regex: /resolve-cloak-mcp\.mjs/g },
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
    rejectPathExists(`${base}/scripts`, 'skill-local scripts helper surface was removed in the engine-only migration');
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
  const files = scanTargets.flatMap((target) => (existsSync(fullPath(target)) ? walkFiles(target) : []));

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
function requireText(file, needle, label = needle) {
  requireFile(file);
  if (!existsSync(fullPath(file))) return;
  if (!readText(file).includes(needle)) fail(`${file} must mention ${label}`);
}

function validateClientSupportSurfaces() {
  requireText('skills/hyper-cloaking/engine/mcp-config.mjs', 'openclaw', 'OpenClaw MCP client target');
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
const claudeMarketplace = parseJson('.claude-plugin/marketplace.json');
const codexMarketplace = parseJson('.agents/plugins/marketplace.json');
const claudePlugin = parseJson(`${pluginRoot}/.claude-plugin/plugin.json`);
const codexPlugin = parseJson(`${pluginRoot}/.codex-plugin/plugin.json`);

validateVersionMetadata('package.json', packageManifest);
validateVersionMetadata('.claude-plugin/marketplace.json', claudeMarketplace);
validatePluginVersionMetadata('.claude-plugin/marketplace.json plugins[0]', claudeMarketplace.plugins?.[0]);
validateVersionMetadata(`${pluginRoot}/.claude-plugin/plugin.json`, claudePlugin);
validateVersionMetadata(`${pluginRoot}/.codex-plugin/plugin.json`, codexPlugin);

if (packageManifest.name !== 'hyper-cloaking') fail('Package name must be hyper-cloaking');
if (claudeMarketplace.name !== 'hyper-cloaking') fail('Claude marketplace name must be hyper-cloaking');
if (claudeMarketplace.plugins?.[0]?.source !== './plugins/hyper-cloaking') fail('Claude marketplace source must point at ./plugins/hyper-cloaking');
if (codexMarketplace.plugins?.[0]?.source?.path !== './plugins/hyper-cloaking') fail('Codex marketplace source.path must point at ./plugins/hyper-cloaking');
if (claudePlugin.name !== 'hyper-cloaking') fail('Claude plugin name must be hyper-cloaking');
if (codexPlugin.name !== 'hyper-cloaking') fail('Codex plugin name must be hyper-cloaking');
if (codexPlugin.skills !== './skills/') fail('Codex plugin skills path must be ./skills/');

validateSkillPaths('.claude-plugin/marketplace.json plugins[0]', claudeMarketplace.plugins?.[0]?.skills);
validateSkillPaths(`${pluginRoot}/.claude-plugin/plugin.json`, claudePlugin.skills);

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
  'engine/outcome-diagnostics-boundary.test.mjs',
  'engine/recon-run-shapes.test.mjs',
  'engine/target-safety.test.mjs'
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




const expectedSkillDirs = [...skillNames].sort();
for (const dir of [`${pluginRoot}/skills`, '.agents/skills', '.claude/skills', 'skills']) {
  const actualSkillDirs = readdirSync(fullPath(dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(actualSkillDirs) !== JSON.stringify(expectedSkillDirs)) {
    fail(`${dir} directories ${JSON.stringify(actualSkillDirs)} do not match expected ${JSON.stringify(expectedSkillDirs)}`);
  }
}


validateClientSupportSurfaces();

validateNoStalePublicIdentity();

validateEngineOnlyMigration();

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`Validated ${skillNames.length} skill, version metadata, skill paths, helper scripts, OpenClaw/Hermes client support, and stale identity checks for Claude Code, Codex, Cursor, OpenClaw, Hermes, and Open Agent Skills.`);
