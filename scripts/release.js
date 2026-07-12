const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const VERSION_PATH = path.join(ROOT_DIR, 'version.json');
const BUILD_SCRIPT = path.join(__dirname, 'build.js');

function argsOf(argv) {
  const result = { version: '', repo: '', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--version') result.version = argv[++i] || '';
    else if (argv[i] === '--repo') result.repo = argv[++i] || '';
    else if (argv[i] === '--dry-run') result.dryRun = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return result;
}

function readJson() {
  return JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8'));
}

function baseVersion(value) {
  return String(value || '').replace(/-(?:dev|build\.\d+).*$/i, '').replace(/\+.*$/, '');
}

function getOwner() {
  const result = spawnSync('gh', ['api', 'user', '--jq', '.login'], { cwd: ROOT_DIR, encoding: 'utf8', windowsHide: false });
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

async function askVersion(current) {
  if (!stdin.isTTY) return current;
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`Release version [${current}]: `);
    return answer.trim() || current;
  } finally {
    rl.close();
  }
}

async function main() {
  const options = argsOf(process.argv.slice(2));
  const original = readJson();
  const releaseManifestPath = path.join(ROOT_DIR, 'release', 'manifest.json');
  const originalReleaseManifest = fs.existsSync(releaseManifestPath)
    ? fs.readFileSync(releaseManifestPath)
    : null;
  const version = await askVersion(baseVersion(options.version || original.version));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Version must be x.y.z, got ${version}`);
  const build = Number(original.build || 0) + 1;
  const owner = options.repo || original.githubRepo || process.env.XINGYE_GITHUB_REPO || `${getOwner()}/xingye`;
  if (!/^[^/]+\/[^/]+$/.test(owner)) throw new Error('GitHub login required or pass --repo owner/repo');
  const next = { ...original, version, build, release: `${version}-build.${build}`, githubRepo: owner };
  fs.writeFileSync(VERSION_PATH, `${JSON.stringify(next, null, 2)}\n`);
  const buildArgs = [BUILD_SCRIPT, '--release', '--repo', owner];
  if (options.dryRun) buildArgs.push('--dry-run');
  const command = process.execPath;
  const result = spawnSync(command, buildArgs, { cwd: ROOT_DIR, stdio: 'inherit', windowsHide: false });
  if (options.dryRun || result.status !== 0) {
    fs.writeFileSync(VERSION_PATH, `${JSON.stringify(original, null, 2)}\n`);
    if (options.dryRun) {
      if (originalReleaseManifest) fs.writeFileSync(releaseManifestPath, originalReleaseManifest);
      else fs.rmSync(releaseManifestPath, { force: true });
    }
  }
  if (result.status !== 0) process.exitCode = result.status || 1;
}

main().catch(error => {
  console.error(`[Release Error] ${error.message}`);
  process.exitCode = 1;
});
