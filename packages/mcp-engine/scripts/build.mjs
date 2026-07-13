import { access, chmod, copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(packageRoot, 'src');
const distributionRoot = path.join(packageRoot, 'dist');
const schemaAsset = path.join('agents', 'schemas', 'hyper-cloaking-agent-output.schema.json');
const executableEntrypoints = [
  'browser-utils.mjs',
  'cli.mjs',
  'cookie.mjs',
  path.join('agents', 'parent-dispatcher.mjs')
];

async function copyTree(sourceDirectory, destinationDirectory) {
  await mkdir(destinationDirectory, { recursive: true });
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  for (const entry of entries) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const destinationPath = path.join(destinationDirectory, entry.name);

    if (entry.isDirectory()) {
      await copyTree(sourcePath, destinationPath);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unsupported source entry: ${sourcePath}`);

    const sourceMetadata = await stat(sourcePath);
    await copyFile(sourcePath, destinationPath);
    await chmod(destinationPath, sourceMetadata.mode & 0o777);
  }
}

await rm(distributionRoot, { recursive: true, force: true });
await copyTree(sourceRoot, distributionRoot);
await access(path.join(distributionRoot, schemaAsset));
await Promise.all(
  executableEntrypoints.map((entrypoint) => chmod(path.join(distributionRoot, entrypoint), 0o755))
);
