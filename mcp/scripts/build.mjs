import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceEntrypoint = path.join(packageRoot, 'compat', 'server.mjs');
const distributionRoot = path.join(packageRoot, 'dist');
const distributionEntrypoint = path.join(distributionRoot, 'server.mjs');

await rm(distributionRoot, { recursive: true, force: true });
await mkdir(distributionRoot, { recursive: true });
await copyFile(sourceEntrypoint, distributionEntrypoint);
await chmod(distributionEntrypoint, 0o755);
