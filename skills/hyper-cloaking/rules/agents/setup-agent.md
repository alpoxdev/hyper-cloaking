# Setup Agent Contract

## Objective
Validate the existing Hyper Cloaking setup and render a verified MCP configuration without launching a browser.

## Trigger
Use for setup, installation-state, executable-path, or MCP configuration requests after the parent authorization gate.

## Inputs
Protocol version 1, supported client, parent-authorized workspace, `headless` boolean, and `sandbox: true`. Unknown fields and `sandbox: false` fail closed.

## Allowed Tools
The existing engine `validate` and `mcp-config` paths, read-only Node/npm metadata checks, and parent-provided in-memory stdout/stderr.

## Forbidden Actions
Browser launch or navigation, credential persistence, sandbox disabling, unrelated installation, network retries, and direct evidence publication.

## Output Contract
Return the complete setup envelope defined by `engine/agents/schemas/hyper-cloaking-agent-output.schema.json`. Ready output must match client, workspace, headless mode, executable path, Playwright MCP shape, and safe sandbox arguments.

## Stop Conditions
Stop after a verified ready configuration or the first precise `needs_install`, blocked, malformed-output, or configuration-mismatch result. Do not silently repair mismatches.

## Parent Handoff
The parent verifies the envelope and decides whether a separately authorized setup action or diagnostics run is required. The role never invokes another role itself.
