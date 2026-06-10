#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const DEFAULT_REPO_URL = 'https://github.com/DoctorCheese1/Discord-server-starter.git';
const repoUrl = process.env.SERVER_CONTROL_BOT_REPO_URL || DEFAULT_REPO_URL;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) {
    throw new Error(`${command} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.${stderr}`);
  }
  return result;
}

function output(command, args, options = {}) {
  const result = run(command, args, { ...options, capture: true });
  return (result.stdout || '').trim();
}

function ensureTool(command, installHint) {
  const result = run(command, ['--version'], { capture: true, allowFailure: true });
  if (result.status !== 0) {
    throw new Error(`${command} is required. ${installHint}`);
  }
}

function defaultBranchFor(url) {
  const result = run('git', ['ls-remote', '--symref', url, 'HEAD'], { capture: true, allowFailure: true });
  if (result.status !== 0) return null;
  const match = result.stdout.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD/m);
  return match?.[1] || null;
}

function workingTreeIsClean() {
  return output('git', ['status', '--porcelain']) === '';
}

function stashLocalChanges() {
  if (workingTreeIsClean()) return false;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  console.log('Local changes found. Stashing them before updating...');
  run('git', ['stash', 'push', '--include-untracked', '-m', `server-control-bot auto-stash before update ${stamp}`]);
  return true;
}

function insideGitRepo() {
  const result = run('git', ['rev-parse', '--is-inside-work-tree'], { capture: true, allowFailure: true });
  return result.status === 0 && result.stdout.trim() === 'true';
}

function ensureOrigin(url) {
  const currentOrigin = output('git', ['remote', 'get-url', 'origin'], { allowFailure: true });
  if (!currentOrigin) {
    run('git', ['remote', 'add', 'origin', url]);
    console.log(`Added origin remote: ${url}`);
    return;
  }
  if (currentOrigin !== url) {
    console.log(`Keeping existing origin remote: ${currentOrigin}`);
    console.log(`Updating directly from: ${url}`);
  }
}

function main() {
  ensureTool('git', 'Install Git from https://git-scm.com/downloads and try again.');

  if (!insideGitRepo()) {
    throw new Error(`This folder is not a Git repository. Clone the project first with: git clone ${repoUrl}`);
  }

  const stashed = stashLocalChanges();

  ensureOrigin(repoUrl);

  const branch = process.env.SERVER_CONTROL_BOT_UPDATE_BRANCH || defaultBranchFor(repoUrl) || output('git', ['branch', '--show-current']) || 'main';
  console.log(`Fetching latest ${branch} from ${repoUrl}...`);
  run('git', ['fetch', repoUrl, branch]);

  console.log('Applying update with a fast-forward merge...');
  run('git', ['merge', '--ff-only', 'FETCH_HEAD']);
  if (stashed) {
    console.log('Re-applying your stashed local changes...');
    const pop = run('git', ['stash', 'pop'], { allowFailure: true });
    if (pop.status !== 0) {
      throw new Error('Update succeeded, but your stashed changes could not be applied cleanly. Run `git stash list` and `git stash pop` after resolving conflicts.');
    }
  }
  console.log('Server Control Bot is up to date.');
}

try {
  main();
} catch (error) {
  console.error(`Update failed: ${error.message}`);
  process.exit(1);
}
