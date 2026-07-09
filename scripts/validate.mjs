import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pluginRoot = 'plugins/hyper-cloaking';
const skillNames = ['workflow-bootstrap', 'plugin-packaging', 'agent-orchestration', 'cloak-browser'];
const rootSkillNames = ['cloak-browser'];
const agentNames = ['architect', 'executor', 'verifier'];
const errors = [];

function fail(message) {
  errors.push(message);
}

function readText(file) {
  return readFileSync(path.join(root, file), 'utf8');
}

function requireFile(file) {
  if (!existsSync(path.join(root, file))) fail(`Missing ${file}`);
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
  if (!existsSync(path.join(root, file))) return;
  const text = readText(file);
  const fm = frontmatter(text, file);
  const name = fm.get('name');
  const description = fm.get('description');

  if (name !== expectedName) fail(`${file} has name=${name ?? '<missing>'}, expected ${expectedName}`);
  if (!description) fail(`${file} is missing description`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name ?? '')) fail(`${file} name is not kebab-case`);
}

function validateMarkdownAgent(file, expectedName) {
  requireFile(file);
  if (!existsSync(path.join(root, file))) return;
  const text = readText(file);
  const fm = frontmatter(text, file);
  const name = fm.get('name');
  const description = fm.get('description');

  if (name !== expectedName) fail(`${file} has name=${name ?? '<missing>'}, expected ${expectedName}`);
  if (!description) fail(`${file} is missing description`);
}

function validateTomlAgent(file, expectedName) {
  requireFile(file);
  if (!existsSync(path.join(root, file))) return;
  const text = readText(file);
  const name = text.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  const description = text.match(/^description\s*=\s*"([^"]+)"/m)?.[1];
  const developerInstructions = text.match(/^developer_instructions\s*=\s*"""[\s\S]+?"""/m);

  if (name !== expectedName) fail(`${file} has name=${name ?? '<missing>'}, expected ${expectedName}`);
  if (!description) fail(`${file} is missing description`);
  if (!developerInstructions) fail(`${file} is missing developer_instructions`);
}

function assertSame(left, right) {
  requireFile(left);
  requireFile(right);
  if (!existsSync(path.join(root, left)) || !existsSync(path.join(root, right))) return;
  if (readText(left) !== readText(right)) fail(`${right} is not byte-for-byte mirrored from ${left}`);
}

const claudeMarketplace = parseJson('.claude-plugin/marketplace.json');
const codexMarketplace = parseJson('.agents/plugins/marketplace.json');
const claudePlugin = parseJson(`${pluginRoot}/.claude-plugin/plugin.json`);
const codexPlugin = parseJson(`${pluginRoot}/.codex-plugin/plugin.json`);

if (claudeMarketplace.name !== 'hyper-cloaking') fail('Claude marketplace name must be hyper-cloaking');
if (claudeMarketplace.plugins?.[0]?.source !== './plugins/hyper-cloaking') fail('Claude marketplace source must point at ./plugins/hyper-cloaking');
if (codexMarketplace.plugins?.[0]?.source?.path !== './plugins/hyper-cloaking') fail('Codex marketplace source.path must point at ./plugins/hyper-cloaking');
if (claudePlugin.name !== 'hyper-cloaking') fail('Claude plugin name must be hyper-cloaking');
if (codexPlugin.name !== 'hyper-cloaking') fail('Codex plugin name must be hyper-cloaking');
if (codexPlugin.skills !== './skills/') fail('Codex plugin skills path must be ./skills/');

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

for (const agentName of agentNames) {
  const canonical = `${pluginRoot}/agents/${agentName}.md`;
  validateMarkdownAgent(canonical, agentName);
  validateMarkdownAgent(`.claude/agents/${agentName}.md`, agentName);
  validateMarkdownAgent(`.cursor/agents/${agentName}.md`, agentName);
  validateTomlAgent(`.codex/agents/${agentName}.toml`, agentName);
  assertSame(canonical, `.claude/agents/${agentName}.md`);
}

const pluginSkillDirs = readdirSync(path.join(root, pluginRoot, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const expectedSkillDirs = [...skillNames].sort();
if (JSON.stringify(pluginSkillDirs) !== JSON.stringify(expectedSkillDirs)) {
  fail(`Plugin skill directories ${JSON.stringify(pluginSkillDirs)} do not match expected ${JSON.stringify(expectedSkillDirs)}`);
}

const pluginAgentFiles = readdirSync(path.join(root, pluginRoot, 'agents'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => entry.name.replace(/\.md$/, ''))
  .sort();
const expectedAgentFiles = [...agentNames].sort();
if (JSON.stringify(pluginAgentFiles) !== JSON.stringify(expectedAgentFiles)) {
  fail(`Plugin agent files ${JSON.stringify(pluginAgentFiles)} do not match expected ${JSON.stringify(expectedAgentFiles)}`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`Validated ${skillNames.length} skills, ${agentNames.length} agents, and plugin manifests for Claude Code, Codex, Cursor, and Open Agent Skills.`);
