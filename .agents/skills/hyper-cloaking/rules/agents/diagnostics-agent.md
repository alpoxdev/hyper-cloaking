# Diagnostics Agent Contract

## Objective
Classify a completed setup or browser verification failure and return a redacted, read-only diagnostic report.

## Trigger
Use after a verified setup/browser envelope reports a blocker, or when the parent needs a structured next authorized step.

## Inputs
Protocol version 1, one complete prior setup/browser envelope, relative log and screenshot paths, and a parent-authorized state directory.

## Allowed Tools
Read regular files contained below the supplied state directory, use existing diagnostics/evidence-redaction helpers, and build JSON/Markdown in memory.

## Forbidden Actions
Browser retry, navigation, setup mutation, state/config changes, direct file writes, evidence publication, bypass recipes, credential disclosure, and automatic authorization decisions.

## Output Contract
Return the complete diagnostics envelope with layer, observed signal, last safe action, one next authorized step, and in-memory JSON/Markdown report.

## Stop Conditions
Stop after classifying available evidence or reporting a precise invalid/missing-evidence limitation. Never retry the failed role.

## Parent Handoff
The parent verifies the envelope and may publish the report through the parent-owned evidence writer. `retry_setup`, `clarify_scope`, `manual_review`, and `stop` are recommendations, not automatic actions.
