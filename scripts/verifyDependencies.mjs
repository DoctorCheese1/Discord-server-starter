#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const packageFile = path.join(ROOT, 'package.json');
const lockFile = path.join(ROOT, 'package-lock.json');
const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${path.relative(ROOT, file)}: ${error.message}`);
  }
}

function dependencyNames(pkg) {
  return Object.keys({
    ...(pkg.dependencies || {}),
    ...(pkg.optionalDependencies || {})
  }).sort((a, b) => a.localeCompare(b));
}

function resolveDependency(name) {
  try {
    requireFromRoot.resolve(name);
    return true;
  } catch {
    return false;
  }
}

function lockHasDependency(lock, name) {
  if (!lock) return true;
  if (lock.packages?.[`node_modules/${name}`]) return true;
  if (lock.dependencies?.[name]) return true;
  return false;
}

function main() {
  const pkg = readJson(packageFile);
  const lock = fs.existsSync(lockFile) ? readJson(lockFile) : null;
  const deps = dependencyNames(pkg);

  if (!deps.length) {
    console.log('No runtime dependencies declared in package.json.');
    return;
  }

  const missingInstall = deps.filter(name => !resolveDependency(name));
  const missingLock = deps.filter(name => !lockHasDependency(lock, name));

  if (missingInstall.length || missingLock.length) {
    if (missingInstall.length) {
      console.error(`Missing installed dependencies: ${missingInstall.join(', ')}`);
    }
    if (missingLock.length) {
      console.error(`Dependencies missing from package-lock.json: ${missingLock.join(', ')}`);
    }
    console.error('Run `npm install` from the bot folder, then run `npm run verify:deps` again.');
    process.exit(1);
  }

  console.log(`Dependency verification passed (${deps.length} dependencies installed and locked).`);
}

try {
  main();
} catch (error) {
  console.error(`Dependency verification failed: ${error.message}`);
  process.exit(1);
}
