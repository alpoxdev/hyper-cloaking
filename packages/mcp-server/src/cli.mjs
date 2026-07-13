import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SERVER_INFO, createServer, main } from './app.mjs';

export { SERVER_INFO, createServer, main };

/**
 * Determines whether this module was invoked as the server entry point.
 *
 * @returns {boolean} True when the invoked path resolves to this module.
 */
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((error) => {
    process.stderr.write(`hyper-cloaking-mcp failed to start: ${error?.stack || error}\n`);
    process.exit(1);
  });
}
