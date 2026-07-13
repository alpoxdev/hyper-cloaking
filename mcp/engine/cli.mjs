#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runEngineCli } from '@mcp/engine/cli';

export {
  closeBrowserHandle,
  gotoAndClassify,
  installNavigationSafety,
  runCli,
  runEngineCli,
  runLiveVerification
} from '@mcp/engine/cli';

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = await runEngineCli();
}
