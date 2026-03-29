import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';

const rootDir = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const outputDir = path.join(rootDir, packageJson.build?.directories?.output ?? 'release');
const cacheDir = path.join(rootDir, '.electron-builder-cache');
const tempDir = path.join(cacheDir, 'tmp');
const builderArgs = process.argv.slice(2);
const knownTargets = new Set(['portable', 'nsis']);
const finalBuilderArgs = builderArgs.includes('--publish') || builderArgs.includes('-p')
  ? builderArgs
  : [...builderArgs, '--publish', 'never'];

mkdirSync(tempDir, { recursive: true });

const cleanupPartialDownloads = (bucket) => {
  const targetDir = path.join(cacheDir, bucket);

  try {
    for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
      if (!/^\d+$/.test(entry.name)) {
        continue;
      }

      const entryPath = path.join(targetDir, entry.name);
      const stat = statSync(entryPath);

      if (stat.isDirectory() || stat.isFile()) {
        rmSync(entryPath, { recursive: true, force: true });
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }

    throw error;
  }
};

cleanupPartialDownloads('winCodeSign');
cleanupPartialDownloads('nsis');

const safeRemove = (targetPath, options) => {
  try {
    rmSync(targetPath, options);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error.code === 'ENOENT' || error.code === 'EBUSY')) {
      return;
    }

    throw error;
  }
};

const resolveArtifactName = (template) =>
  template
    ?.replace('${productName}', packageJson.build?.productName ?? 'app')
    .replace('${version}', packageJson.version)
    .replace('${ext}', 'exe');

const resolveRequestedArtifactNames = () => {
  const explicitTargets = builderArgs.filter((arg) => knownTargets.has(arg));

  if (explicitTargets.length === 0) {
    return [
      resolveArtifactName(packageJson.build?.portable?.artifactName),
      resolveArtifactName(packageJson.build?.nsis?.artifactName)
    ].filter(Boolean);
  }

  return explicitTargets.map((target) =>
    resolveArtifactName(packageJson.build?.[target]?.artifactName)
  ).filter(Boolean);
};

const cleanupStaleOutputs = () => {
  safeRemove(path.join(outputDir, 'win-unpacked'), { recursive: true, force: true });
  safeRemove(path.join(outputDir, 'builder-debug.yml'), { force: true });
  safeRemove(path.join(outputDir, 'builder-effective-config.yaml'), { force: true });

  const artifactNames = resolveRequestedArtifactNames();

  for (const artifactName of artifactNames) {
    safeRemove(path.join(outputDir, artifactName), { force: true });
    safeRemove(path.join(outputDir, `${artifactName}.blockmap`), { force: true });
  }
};

cleanupStaleOutputs();

const env = {
  ...process.env,
  ELECTRON_BUILDER_CACHE: cacheDir,
  TEMP: tempDir,
  TMP: tempDir,
};

const electronBuilderEntrypoint = path.join(rootDir, 'node_modules', 'electron-builder', 'cli.js');

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });

    child.on('error', reject);
  });

await run('npm', ['run', 'build']);
await run(process.execPath, [electronBuilderEntrypoint, ...finalBuilderArgs]);
