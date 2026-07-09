---
name: plugin-packaging
description: Package or update this repository as a portable skill and agent distribution for Claude Code plugins, Codex plugins, Cursor project skills, and Open Agent Skills clients. Use when adding skills, agents, manifests, mirrors, or release metadata.
---

# Plugin Packaging

Use this skill whenever repository changes affect installability or discovery by agent hosts.

## Compatibility Targets

Maintain these surfaces together:

- Claude Code marketplace: `.claude-plugin/marketplace.json`.
- Claude Code plugin: `plugins/hyper-cloaking/.claude-plugin/plugin.json`.
- Codex marketplace: `.agents/plugins/marketplace.json`.
- Codex plugin: `plugins/hyper-cloaking/.codex-plugin/plugin.json`.
- Canonical plugin skills: `plugins/hyper-cloaking/skills/<skill>/SKILL.md`.
- Direct Codex/Cursor/Open Agent Skills project skills: `.agents/skills/<skill>/SKILL.md`.
- Direct Claude project skills: `.claude/skills/<skill>/SKILL.md`.
- Claude plugin subagents: `plugins/hyper-cloaking/agents/*.md`.
- Claude project subagents: `.claude/agents/*.md`.
- Cursor project subagents: `.cursor/agents/*.md`.
- Codex project subagents: `.codex/agents/*.toml`.

## Rules

1. Every skill directory must contain `SKILL.md` with YAML frontmatter fields `name` and `description`.
2. Skill `name` values must be lowercase kebab-case and match their directory name.
3. Keep canonical plugin skills and project skill mirrors byte-for-byte identical unless a target format requires a difference.
4. Keep agent intent aligned across Claude, Cursor, and Codex even when file formats differ.
5. Use relative manifest paths starting with `./`.
6. Do not place skills, agents, hooks, or assets inside `.claude-plugin/` or `.codex-plugin/`; those directories hold only plugin metadata.
7. Bump plugin and marketplace versions together when publishing a compatibility-breaking change.

## Update Procedure

1. Add or edit the canonical file under `plugins/hyper-cloaking/`.
2. Mirror skills into `.agents/skills/` and `.claude/skills/`.
3. Mirror Markdown agents into `plugins/hyper-cloaking/agents/`, `.claude/agents/`, and `.cursor/agents/` with host-specific frontmatter where needed.
4. Mirror Codex agents as TOML files under `.codex/agents/`.
5. Update both marketplace files and both plugin manifests if names, paths, descriptions, versions, or components changed.
6. Run `npm run validate`.
7. Run `npm run skills:list` when network and `npx` are available to verify discovery through the Vercel `skills` CLI.

## Validation Checklist

- Claude can load the plugin with `claude --plugin-dir ./plugins/hyper-cloaking`.
- Claude marketplace users can add this repo through `.claude-plugin/marketplace.json`.
- Codex can discover the repo marketplace at `.agents/plugins/marketplace.json`.
- Codex and Cursor can discover direct project skills from `.agents/skills/`.
- Claude can discover direct project skills from `.claude/skills/`.
- Cursor can discover project subagents from `.cursor/agents/`.
- Codex can discover project subagents from `.codex/agents/`.
