#!/usr/bin/env node
const { spawn } = require('child_process');
const cwd = __dirname;
const child = spawn('npm.cmd', ['run', 'dev'], {
  cwd,
  stdio: 'inherit',
  shell: true,
  windowsHide: true
});
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('close', (code) => process.exit(code));
