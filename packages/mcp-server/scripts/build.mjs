import { chmod, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(packageRoot, 'src');
const distributionRoot = path.join(packageRoot, 'dist');
const engineExternals = ['@mcp/engine', '@mcp/engine/*'];
const sharedOptions = {
  bundle: true,
  external: engineExternals,
  format: 'esm',
  platform: 'node',
  target: 'node20'
};

await rm(distributionRoot, { recursive: true, force: true });
await mkdir(distributionRoot, { recursive: true });
await build({
  ...sharedOptions,
  entryPoints: [path.join(sourceRoot, 'app.mjs')],
  outfile: path.join(distributionRoot, 'index.mjs')
});
await build({
  ...sharedOptions,
  banner: { js: '#!/usr/bin/env node' },
  entryPoints: [path.join(sourceRoot, 'cli.mjs')],
  outfile: path.join(distributionRoot, 'cli.mjs')
});
await chmod(path.join(distributionRoot, 'cli.mjs'), 0o755);
