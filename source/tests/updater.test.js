const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ManifestGenerator = require('../updater/manifest-generator');
const PatchGenerator = require('../updater/patch-generator');
const IncrementalUpdater = require('../updater/updater');

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xingye-updater-'));
}

test('manifest includes deployable dist files and excludes runtime state', () => {
  const root = tempDir();
  writeFile(root, 'bot-backend/dist/index.js', 'compiled');
  writeFile(root, 'updater/server-update.js', 'updater');
  writeFile(root, 'data/state.db', 'state');
  writeFile(root, 'SnowLuma/config/webui.json', 'secret');
  writeFile(root, '.env', 'MIMO_API_KEY=secret');
  writeFile(root, 'logs/app.log', 'log');

  const manifest = new ManifestGenerator(root).generate('1.0.0', 1, '1.0.0-build.1', 'owner/repo');
  const files = Object.keys(manifest.files);
  assert.ok(files.includes('bot-backend/dist/index.js'));
  assert.ok(files.includes('updater/server-update.js'));
  assert.ok(!files.some(file => file.includes('/data/') || file.startsWith('data/')));
  assert.ok(!files.some(file => file.startsWith('SnowLuma/config/')));
  assert.ok(!files.includes('.env'));
  assert.ok(!files.some(file => file.startsWith('logs/')));
});

test('patch generator records add, modify and delete changes', () => {
  const root = tempDir();
  const output = tempDir();
  writeFile(root, 'changed.txt', 'new');
  writeFile(root, 'added.txt', 'added');

  const oldGenerator = new ManifestGenerator(root);
  const oldManifest = {
    version: '1.0.0',
    build: 1,
    release: '1.0.0-build.1',
    files: {
      'changed.txt': { hash: 'sha256-old' },
      'deleted.txt': { hash: 'sha256-deleted' }
    }
  };
  const newManifest = oldGenerator.generate('1.0.0', 2, '1.0.0-build.2', 'owner/repo');
  const result = new PatchGenerator(root).generate(oldManifest, newManifest, output);

  assert.ok(result);
  const patch = JSON.parse(fs.readFileSync(result.patchJsonPath, 'utf8'));
  assert.deepEqual(patch.added, ['added.txt']);
  assert.deepEqual(patch.modified, ['changed.txt']);
  assert.deepEqual(patch.deleted, ['deleted.txt']);
  assert.equal(patch.fromRelease, '1.0.0-build.1');
  assert.equal(patch.toRelease, '1.0.0-build.2');
  assert.ok(fs.statSync(result.patchZipPath).size > 0);
});

test('release comparison and protected paths are enforced', () => {
  assert.equal(IncrementalUpdater.compareVersions('1.0.0-build.2', '1.0.0-build.10'), -1);
  assert.equal(IncrementalUpdater.compareVersions('1.1.0-build.1', '1.0.0-build.99'), 1);
  assert.throws(() => IncrementalUpdater.safeRelative('../escape.txt'), /Unsafe path/);
  assert.throws(() => IncrementalUpdater.safeRelative('C:/escape.txt'), /Unsafe path/);

  const updater = new IncrementalUpdater({ appDir: tempDir(), githubRepo: 'owner/repo' });
  assert.equal(updater.isProtectedFile('.env'), true);
  assert.equal(updater.isProtectedFile('bot-backend/data/state.json'), true);
  assert.equal(updater.isProtectedFile('SnowLuma/config/webui.json'), true);
  assert.equal(updater.isProtectedFile('bot-backend/dist/index.js'), false);
});
