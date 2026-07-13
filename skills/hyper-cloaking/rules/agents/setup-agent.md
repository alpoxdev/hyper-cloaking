# Setup Agent Contract

## Objective
Validate the existing Hyper Cloaking setup and render a verified MCP configuration without launching a browser.

## Trigger
Use for setup, installation-state, executable-path, or MCP configuration requests after the parent authorization gate.

## Inputs
Protocol version 1, supported client, parent-authorized workspace, `headless` boolean, and `sandbox: true`. Unknown fields and `sandbox: false` fail closed.

## Allowed Tools
The installed `hyper-cloaking-engine validate` and `hyper-cloaking-engine mcp-config` command labels, programmatic registration rendering through `@alpoxdev/hyper-cloaking/register` when needed, read-only Node/npm metadata checks, and parent-provided in-memory stdout/stderr. `hyper-cloaking-engine` is never a package or import target.

## Forbidden Actions
Browser launch or navigation, credential persistence, sandbox disabling, unrelated installation, network retries, and direct evidence publication.

## Output Contract
Return the complete closed v1 setup envelope supplied by the parent. Ready output must match client, workspace, headless mode, executable path, Playwright MCP shape, and safe sandbox arguments.

## Stop Conditions
Stop after a verified ready configuration or the first precise `needs_install`, blocked, malformed-output, or configuration-mismatch result. Do not silently repair mismatches.

## Parent Handoff
The parent verifies the envelope and decides whether a separately authorized setup action or diagnostics run is required. The role never invokes another role itself.
