---
name: agent-orchestration
description: Coordinate specialized subagents for exploration, implementation, review, and verification. Use when a task has parallelizable workstreams, noisy investigation, independent review needs, or a clear handoff between architect, executor, and verifier agents.
---

# Agent Orchestration

Use this skill to delegate without losing ownership of the final answer.

## Built-in Roles in This Pack

- `architect`: read-only architecture and risk assessment.
- `executor`: bounded implementation and refactoring.
- `verifier`: independent validation of behavior, tests, and completion claims.

## Delegation Rules

1. Delegate only a bounded slice with explicit inputs, constraints, and expected output.
2. Use `architect` before implementation when the change crosses boundaries, APIs, security, data flow, or build systems.
3. Use `executor` for implementation when the task can be described with acceptance criteria and the parent can integrate results.
4. Use `verifier` after non-trivial changes or when another agent claims completion.
5. Prefer parallel subagents for independent investigation or review lanes; keep dependent changes sequential.
6. The parent agent remains responsible for integration, conflict resolution, and final verification.

## Prompt Template for a Subagent

Provide:

- Objective: one sentence.
- Scope: files, modules, or behavior to inspect or change.
- Constraints: what not to touch, compatibility requirements, safety boundaries.
- Evidence required: tests, file references, command output, or findings format.
- Stop condition: when to return instead of continuing.

## Integration Procedure

1. Read each subagent result skeptically.
2. Reconcile contradictions by checking source files or rerunning the relevant command.
3. Apply only changes that match the user's requested outcome.
4. Run verification in the parent session or through the verifier agent.
5. Report concise evidence, not subagent transcripts.

## Anti-patterns

- Do not delegate vague tasks such as "fix everything" without scope.
- Do not accept a subagent's success claim without evidence.
- Do not spawn implementation agents before requirements and safety boundaries are clear.
- Do not hide failed verification behind a summary.
