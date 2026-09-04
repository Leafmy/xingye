const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ManifestGenerator = require('../updater/manifest-generator');
const PatchGenerator = require('../updater/patch-generator');

const SOURCE_DIR = path.resolve(__dirname, '..');            // source/
const PROJECT_ROOT = path.resolve(SOURCE_DIR, '..');         // 项目根（release 布局）
const APP_DIR = path.join(PROJECT_ROOT, 'app');
const DIST_DIR = path.join(PROJECT_ROOT, 'release');
const VERSION_PATH = path.join(PROJECT_ROOT, 'version.json');
const RELEASE_MANIFEST_PATH = path.join(DIST_DIR, 'manifest.json');

function log(message) {
  console.log(`[Build] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function parseArgs(args) {
  const result = { mode: '--patch', dryRun: false, repo: '' };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['--patch', '--full', '--release'].includes(arg)) result.mode = arg;
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--repo') result.repo = args[++index] || '';
    else if (arg === '--help') result.help = true;
    else fail(`Unknown argument: ${arg}`);
  }
  return result;
}

function run(command, args) {
  log(`Running ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    windowsHide: false,
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) fail(`${command} failed with exit code ${result.status}`);
}

function readVersion() {
  const data = JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8'));
  const version = String(data.version || '').replace(/-(?:dev|build\.\d+).*$/i, '').replace(/\+.*$/, '');
  const build = Number(data.build || 0);
  const release = data.release || `${version}-build.${build}`;
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`Invalid version: ${data.version}`);
  if (!Number.isInteger(build) || build < 0) fail(`Invalid build: ${data.build}`);
  return { ...data, version, build, release };
}

function copyDirectory(source, destination, excluded = new Set()) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to, excluded);
    else fs.copyFileSync(from, to);
  }
}

function copyFileIfExists(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function prepareAppDir() {
  log('Preparing deployable app directory');
  fs.rmSync(APP_DIR, { recursive: true, force: true });
  fs.mkdirSync(APP_DIR, { recursive: true });

  copyDirectory(path.join(SOURCE_DIR, 'bot-backend'), path.join(APP_DIR, 'bot-backend'), new Set(['node_modules', 'data', '.env', 'dist']));
  copyDirectory(path.join(SOURCE_DIR, 'bot-backend', 'dist'), path.join(APP_DIR, 'bot-backend', 'dist'));
  copyDirectory(path.join(SOURCE_DIR, 'panel-frontend', 'dist'), path.join(APP_DIR, 'panel-frontend', 'dist'));
  copyFileIfExists(path.join(SOURCE_DIR, 'panel-frontend', 'package.json'), path.join(APP_DIR, 'panel-frontend', 'package.json'));
  copyFileIfExists(path.join(SOURCE_DIR, 'panel-frontend', 'package-lock.json'), path.join(APP_DIR, 'panel-frontend', 'package-lock.json'));

  copyDirectory(path.join(PROJECT_ROOT, 'SnowLuma'), path.join(APP_DIR, 'SnowLuma'), new Set(['node_modules', 'data', 'logs', 'config']));
  copyDirectory(path.join(PROJECT_ROOT, 'BBDown'), path.join(APP_DIR, 'BBDown'));
  copyDirectory(path.join(SOURCE_DIR, 'updater'), path.join(APP_DIR, 'updater'));

  copyFileIfExists(VERSION_PATH, path.join(APP_DIR, 'version.json'));
}

function cleanReleaseAssets() {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  for (const entry of fs.readdirSync(DIST_DIR, { withFileTypes: true })) {
    if (entry.name === 'manifest.json') continue;
    fs.rmSync(path.join(DIST_DIR, entry.name), { recursive: true, force: true });
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function generateChecksums() {
  const files = fs.readdirSync(DIST_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name !== 'checksums.sha256')
    .map(entry => entry.name)
    .sort();
  const content = files.map(name => `${sha256(path.join(DIST_DIR, name))}  ${name}`).join('\n');
  const checksumPath = path.join(DIST_DIR, 'checksums.sha256');
  fs.writeFileSync(checksumPath, `${content}\n`);
  return checksumPath;
}

function publish(versionInfo, repo) {
  const tag = `v${versionInfo.release}`;
  const assets = fs.readdirSync(DIST_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.join(DIST_DIR, entry.name));
  if (!assets.length) fail('No release assets generated');
  const args = ['release', 'create', tag, '--repo', repo, '--title', tag, '--notes', `Xingye ${tag}`, '--latest', ...assets];
  run('gh', args);
}

function buildDesktopBundle() {
  log('Building desktop NSIS bundle (tauri build)');
  const env = { ...process.env };
  const keyPath = path.join(process.env.USERPROFILE || '', '.tauri', 'xingye.key');
  if (fs.existsSync(keyPath)) {
    env.TAURI_SIGNING_PRIVATE_KEY_PATH = keyPath;
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '';
  } else {
    log('Warning: updater signing key not found at ~/.tauri/xingye.key, updates will not be signed');
  }
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', '@tauri-apps/cli', 'build']);
  const bundleDir = path.join(SOURCE_DIR, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  if (!fs.existsSync(bundleDir)) fail('NSIS bundle directory not found');
  const setupFiles = fs.readdirSync(bundleDir).filter(f => f.endsWith('-setup.exe'));
  if (!setupFiles.length) fail('No NSIS setup exe produced');
  const setupName = setupFiles.sort().pop();
  fs.copyFileSync(path.join(bundleDir, setupName), path.join(DIST_DIR, setupName));
  // 同步 exe 到项目根目录（桌面 App 主入口）
  try {
    fs.copyFileSync(path.join(SOURCE_DIR, 'src-tauri', 'target', 'release', 'xingye.exe'), path.join(PROJECT_ROOT, 'xingye.exe'));
    log('Root binary updated: xingye.exe');
  } catch (e) {
    log(`Warning: failed to copy root xingye.exe: ${e.message} (is it running?)`);
  }
  log(`Desktop installer: ${setupName}`);
  return setupName;
}

function generateLatestJson(versionInfo, repo, setupName) {
  const sigPath = path.join(SOURCE_DIR, 'src-tauri', 'target', 'release', 'bundle', 'nsis', `${setupName}.sig`);
  if (!fs.existsSync(sigPath)) fail(`Updater signature not found: ${sigPath}`);
  const signature = fs.readFileSync(sigPath, 'utf8').trim();
  const latest = {
    version: versionInfo.version,
    notes: `Xingye v${versionInfo.version}`,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature,
        url: `https://github.com/${repo}/releases/download/v${versionInfo.release}/${encodeURIComponent(setupName)}`
      }
    }
  };
  const latestPath = path.join(DIST_DIR, 'latest.json');
  fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2));
  log(`Updater manifest: latest.json`);
}

function printHelp() {
  console.log('Usage: node scripts/build.js [--patch|--full|--release] [--repo owner/repo] [--dry-run]');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  const versionInfo = readVersion();
  const repo = options.repo || versionInfo.githubRepo || process.env.XINGYE_GITHUB_REPO || '';
  log(`Building ${versionInfo.release} (${options.mode})`);
  if (options.mode === '--release' && !/^[^/]+\/[^/]+$/.test(repo)) fail('Release requires --repo owner/repo or githubRepo in version.json');

  const oldManifest = ManifestGenerator.load(RELEASE_MANIFEST_PATH);
  cleanReleaseAssets();
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:backend']);
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:frontend']);
  prepareAppDir();

  const generator = new ManifestGenerator(APP_DIR);
  const manifest = generator.generate(versionInfo.version, versionInfo.build, versionInfo.release, repo);
  generator.save(manifest, path.join(APP_DIR, 'manifest.json'));

  if ((options.mode === '--patch' || options.mode === '--release') && oldManifest) {
    const patch = new PatchGenerator(APP_DIR).generate(oldManifest, manifest, DIST_DIR);
    if (patch) log(`Patch: ${patch.stats.totalFiles} changed files, ${(patch.stats.patchZipSize / 1024).toFixed(1)} KB`);
    else log('No file changes detected; no patch generated');
  }
  if (options.mode === '--full' || options.mode === '--release' || !oldManifest) {
    const full = new PatchGenerator(APP_DIR).generateFullPackage(DIST_DIR);
    log(`Full package: ${path.basename(full)}`);
  }
  generator.save(manifest, RELEASE_MANIFEST_PATH);
  const checksumPath = generateChecksums();
  log(`Checksums: ${path.basename(checksumPath)}`);

  // 桌面安装包：--full/--release 时构建 NSIS 并生成更新清单 latest.json
  if (options.mode === '--full' || options.mode === '--release') {
    if (!options.dryRun || options.mode === '--release') {
      const setupName = buildDesktopBundle();
      generateLatestJson(versionInfo, repo || versionInfo.githubRepo || 'Leafmy/xingye', setupName);
      generateChecksums();
    }
  }

  if (options.mode === '--release' && !options.dryRun) publish(versionInfo, repo);
  log(`Output: ${DIST_DIR}`);
}

try {
  main();
} catch (error) {
  console.error(`[Build Error] ${error.message}`);
  process.exitCode = 1;
}
