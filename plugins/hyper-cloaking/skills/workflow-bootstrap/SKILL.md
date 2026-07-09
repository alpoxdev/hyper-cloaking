---
name: workflow-bootstrap
description: Convert a broad or under-specified coding request into a bounded, executable workflow. Use when starting implementation, triage, repo onboarding, planning, or verification across Claude Code, Codex, Cursor, or another agent host.
---

# Workflow Bootstrap

Use this skill to turn the user's request into a concrete execution path without adding ceremony.

## Inputs

- The user's request and any explicit constraints.
- Current repository state and relevant configuration files.
- Available agent host capabilities: skills, subagents, plugins, shell, tests, and browser tools.

## Procedure

1. Restate the objective internally as one deliverable and one completion signal.
2. Classify the request:
   - Answer-only: explain without mutating files.
   - Read-only investigation: inspect files, commands, or docs; report evidence.
   - Planning: produce sequencing and acceptance criteria before mutation.
   - Implementation: edit the smallest correct surface and verify behavior.
   - Verification: independently prove or disprove a completion claim.
3. Discover before editing:
   - Locate files by name or symbol.
   - Read the existing pattern that should be extended.
   - Check package scripts or existing tests before inventing commands.
4. Choose the lightest safe execution shape:
   - Work directly for small single-surface fixes.
   - Spawn a read-only subagent for noisy exploration, API research, or review.
   - Spawn an executor subagent only when work can be described with clear acceptance criteria.
   - Use the verifier subagent for claims that require independent evidence.
5. Execute with a strict completion contract:
   - No stubs, placeholders, or fake fallbacks.
   - Update directly affected callsites, tests, manifests, and generated mirrors.
   - Prefer deleting obsolete code over leaving parallel paths.
6. Verify the behavior that matters:
   - Run the narrowest test or validation command that proves the change.
   - If validation cannot run, state the exact blocker and what evidence was still collected.

## Output Shape

When returning to the user, include only:

- What changed or what was found.
- The verification command or evidence used.
- Any remaining blocker that prevents completion.
