#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const IncrementalUpdater = require('./updater');

const appDir = path.resolve(__dirname, '..');
const githubRepo = process.env.XINGYE_GITHUB_REPO || readRepoFromVersion();
const pm2Services = (process.env.XINGYE_PM2_SERVICES || 'xingye-snowluma,xingye-backend,xingye-frontend,xingye-gaokao')
  .split(',').map(value => value.trim()).filter(Boolean);

function readRepoFromVersion() {
  try {
    const version = JSON.parse(fs.readFileSync(path.join(appDir, 'version.json'), 'utf8'));
    return version.githubRepo || '';
  } catch {
    return '';
  }
}

function updater() {
  return new IncrementalUpdater({ appDir, githubRepo });
}

function runPm2(args) {
  const pm2 = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
  return spawnSync(pm2, args, { cwd: appDir, stdio: 'inherit', shell: true, windowsHide: true });
}

async function main() {
  const command = process.argv[2] || 'check';
  if (command === 'check') {
    console.log(JSON.stringify(await updater().checkForUpdates(), null, 2));
    return;
  }
  if (command !== 'apply') throw new Error(`Unknown command: ${command}`);
  runPm2(['stop', ...pm2Services]);
  try {
    const update = await updater().resolveUpdate();
    if (update.type === 'patch') await updater().applyPatch(update.patchInfo);
    else await updater().applyFullUpdate(update.fullUrl, update.checksumsUrl);
  } catch (error) {
    runPm2(['start', 'ecosystem.config.cjs']);
    throw error;
  }
  const result = runPm2(['start', 'ecosystem.config.cjs']);
  if (result.status !== 0) throw new Error('Update applied, but PM2 restart failed');
}

main().catch(error => {
  console.error(`[Xingye Update] ${error.message}`);
  process.exitCode = 1;
});
