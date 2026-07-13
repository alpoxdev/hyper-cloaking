#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runParentDispatcher } from '@mcp/engine/agents/parent-dispatcher';

export {
  dispatchParent,
  runParentDispatcher,
  runParentDispatcherCli
} from '@mcp/engine/agents/parent-dispatcher';

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await runParentDispatcher();
}
