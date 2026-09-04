const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ManifestGenerator = require('./manifest-generator');

function normalize(filePath) {
  return String(filePath).replace(/\\/g, '/');
}

function safeRelative(filePath) {
  const value = normalize(filePath);
  if (!value || value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw new Error(`Unsafe path: ${filePath}`);
  if (value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe path: ${filePath}`);
  return value;
}

function hashFile(filePath) {
  return `sha256-${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function parseRelease(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)(?:-build\.(\d+))?(?:-(.+))?$/);
  if (!match) return { numbers: [0, 0, 0], build: 0, text: String(value || '0.0.0-build.0') };
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    build: Number(match[4] || 0),
    suffix: match[5] || '',
    text: String(value)
  };
}

function compareRelease(a, b) {
  const left = parseRelease(a);
  const right = parseRelease(b);
  for (let i = 0; i < 3; i++) {
    if (left.numbers[i] !== right.numbers[i]) return left.numbers[i] > right.numbers[i] ? 1 : -1;
  }
  if (left.build !== right.build) return left.build > right.build ? 1 : -1;
  if (left.suffix === right.suffix) return 0;
  return left.suffix ? -1 : 1;
}

class IncrementalUpdater {
  constructor(options = {}) {
    this.appDir = path.resolve(options.appDir);
    this.githubRepo = options.githubRepo || process.env.XINGYE_GITHUB_REPO || '';
    this.manifestPath = path.join(this.appDir, 'manifest.json');
    this.tempDir = path.join(this.appDir, '..', '.update-temp');
    if (!this.githubRepo || !/^[^/]+\/[^/]+$/.test(this.githubRepo)) {
      throw new Error('XINGYE_GITHUB_REPO must be set to owner/repo');
    }
  }

  request(url, redirects = 0) {
    if (!/^https?:\/\//.test(url)) return Promise.reject(new Error(`Unsupported URL: ${url}`));
    return new Promise((resolve, reject) => {
      const transport = url.startsWith('https:') ? https : http;
      const request = transport.get(url, {
        headers: {
          'User-Agent': 'Xingye-Updater/2.0',
          Accept: 'application/vnd.github+json'
        }
      }, response => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          if (redirects >= 5 || !response.headers.location) return reject(new Error('Too many redirects'));
          response.resume();
          return this.request(response.headers.location, redirects + 1).then(resolve, reject);
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => {
          if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}: ${body.slice(0, 200)}`));
          resolve(body);
        });
      });
      request.on('error', reject);
    });
  }

  async getLatestRelease() {
    return JSON.parse(await this.request(`https://api.github.com/repos/${this.githubRepo}/releases/latest`));
  }

  async downloadFile(url, destPath) {
    const parent = path.dirname(destPath);
    fs.mkdirSync(parent, { recursive: true });
    return new Promise((resolve, reject) => {
      const transport = url.startsWith('https:') ? https : http;
      const request = transport.get(url, {
        headers: { 'User-Agent': 'Xingye-Updater/2.0' }
      }, response => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          return this.downloadFile(response.headers.location, destPath).then(resolve, reject);
        }
        if (response.statusCode !== 200) {
          response.resume();
          return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        }
        const file = fs.createWriteStream(destPath);
        response.pipe(file);
        file.on('finish', () => file.close(() => resolve(destPath)));
        file.on('error', error => {
          file.destroy();
          fs.rmSync(destPath, { force: true });
          reject(error);
        });
      });
      request.on('error', reject);
    });
  }

  getAsset(release, predicate) {
    return (release.assets || []).find(asset => predicate(asset.name));
  }

  async checkForUpdates() {
    const localManifest = this.readLocalManifest();
    const currentRelease = localManifest?.release || this.releaseFromManifest(localManifest);
    const release = await this.getLatestRelease();
    const latestRelease = String(release.tag_name || '').replace(/^v/, '');
    if (!latestRelease) throw new Error('Latest release has no tag');
    if (compareRelease(currentRelease, latestRelease) >= 0) {
      return { hasUpdate: false, currentRelease, latestRelease };
    }

    const patchJson = this.getAsset(release, name => /^patch-.*\.json$/i.test(name));
    const patchZip = this.getAsset(release, name => /^patch-.*\.zip$/i.test(name));
    const fullZip = this.getAsset(release, name => /^full-.*\.zip$/i.test(name));
    const checksums = this.getAsset(release, name => name === 'checksums.sha256');
    const result = {
      hasUpdate: true,
      currentRelease,
      latestRelease,
      latestVersion: latestRelease,
      checksumsUrl: checksums?.browser_download_url || null
    };

    if (patchJson && patchZip) {
      result.type = 'patch';
      result.patchInfo = {
        manifestUrl: patchJson.browser_download_url,
        patchUrl: patchZip.browser_download_url,
        checksumsUrl: checksums?.browser_download_url || null,
        fromRelease: currentRelease,
        toRelease: latestRelease
      };
    }
    if (fullZip) {
      result.fullUrl = fullZip.browser_download_url;
      if (!result.patchInfo) result.type = 'full';
    }
    if (!result.patchInfo && !result.fullUrl) {
      return { hasUpdate: false, currentRelease, latestRelease, error: 'Release has no usable update asset' };
    }
    return result;
  }

  async resolveUpdate(updateInfo = null) {
    const info = updateInfo || await this.checkForUpdates();
    if (!info.hasUpdate) throw new Error('No update available');
    if (info.type === 'patch' && info.patchInfo) {
      const patchPath = path.join(this.tempDir, 'check-patch.json');
      await this.downloadFile(info.patchInfo.manifestUrl, patchPath);
      const patch = JSON.parse(fs.readFileSync(patchPath, 'utf8'));
      fs.rmSync(patchPath, { force: true });
      if (patch.fromRelease === (this.readLocalManifest()?.release || this.releaseFromManifest(this.readLocalManifest()))) {
        return { type: 'patch', patchInfo: info.patchInfo, latestRelease: info.latestRelease };
      }
    }
    if (info.fullUrl) return { type: 'full', fullUrl: info.fullUrl, checksumsUrl: info.checksumsUrl, latestRelease: info.latestRelease };
    throw new Error('Patch does not match current release and no full package is available');
  }

  async applyPatch(patchInfo) {
    const local = this.readLocalManifest();
    const currentRelease = local?.release || this.releaseFromManifest(local);
    const temp = this.prepareTemp();
    const patchJsonPath = path.join(temp, 'patch.json');
    const patchZipPath = path.join(temp, 'patch.zip');
    await this.downloadFile(patchInfo.manifestUrl, patchJsonPath);
    await this.downloadFile(patchInfo.patchUrl, patchZipPath);
    const patch = JSON.parse(fs.readFileSync(patchJsonPath, 'utf8'));
    if (patch.fromRelease !== currentRelease) throw new Error(`Patch starts at ${patch.fromRelease}, local release is ${currentRelease}`);
    if (!patch.newManifest || patch.toRelease !== (patch.newManifest.release || patch.newManifest.version)) throw new Error('Invalid patch manifest');
    await this.verifyAssetFiles(patchInfo.checksumsUrl, [patchJsonPath, patchZipPath]);
    const extractDir = path.join(temp, 'extracted');
    this.extractArchive(patchZipPath, extractDir);
    const changed = [...(patch.added || []), ...(patch.modified || [])].map(safeRelative);
    const deleted = (patch.deleted || []).map(safeRelative);
    const touched = [...changed, ...deleted, 'manifest.json', 'version.json'];
    const backupDir = path.join(temp, 'backup');
    this.backupFiles(touched, backupDir);
    try {
      for (const filePath of changed) {
        const source = path.join(extractDir, filePath);
        if (!fs.existsSync(source)) throw new Error(`Patch file missing: ${filePath}`);
        const expected = patch.newManifest.files[filePath]?.hash;
        if (expected && hashFile(source) !== expected) throw new Error(`Patch hash mismatch: ${filePath}`);
        const target = path.join(this.appDir, filePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
      for (const filePath of deleted) {
        if (!this.isProtectedFile(filePath)) fs.rmSync(path.join(this.appDir, filePath), { force: true });
      }
      fs.writeFileSync(this.manifestPath, `${JSON.stringify(patch.newManifest, null, 2)}\n`);
      this.cleanupTemp();
      return { success: true, filesUpdated: changed.length + deleted.length };
    } catch (error) {
      this.restoreFiles(touched, backupDir);
      this.cleanupTemp();
      throw error;
    }
  }

  async applyFullUpdate(fullUrl, checksumsUrl = null) {
    const temp = this.prepareTemp();
    const fullZipPath = path.join(temp, 'full.zip');
    await this.downloadFile(fullUrl, fullZipPath);
    await this.verifyAssetFiles(checksumsUrl, [fullZipPath]);
    const extractDir = path.join(temp, 'extracted');
    this.extractArchive(fullZipPath, extractDir);
    const nextManifest = ManifestGenerator.load(path.join(extractDir, 'manifest.json'));
    if (!nextManifest) throw new Error('Full package has no manifest.json');
    for (const [filePath, info] of Object.entries(nextManifest.files || {})) {
      const safePath = safeRelative(filePath);
      const source = path.join(extractDir, safePath);
      if (!fs.existsSync(source) || hashFile(source) !== info.hash) throw new Error(`Full package hash mismatch: ${safePath}`);
    }
    const local = this.readLocalManifest();
    const managed = Object.keys(local?.files || {});
    const next = new Set(Object.keys(nextManifest.files || {}));
    const touched = [...new Set([...managed, ...Object.keys(nextManifest.files || {}), 'manifest.json', 'version.json'])].map(safeRelative);
    const backupDir = path.join(temp, 'backup');
    this.backupFiles(touched, backupDir);
    try {
      for (const filePath of managed) {
        if (!next.has(filePath) && !this.isProtectedFile(filePath)) fs.rmSync(path.join(this.appDir, filePath), { force: true });
      }
      this.copyWithProtection(extractDir, this.appDir);
      this.cleanupTemp();
      return { success: true, release: nextManifest.release || nextManifest.version };
    } catch (error) {
      this.restoreFiles(touched, backupDir);
      this.cleanupTemp();
      throw error;
    }
  }

  readLocalManifest() {
    return ManifestGenerator.load(this.manifestPath);
  }

  releaseFromManifest(manifest) {
    if (!manifest) return '0.0.0-build.0';
    return manifest.release || `${manifest.version || '0.0.0'}-build.${manifest.build || 0}`;
  }

  prepareTemp() {
    this.cleanupTemp();
    fs.mkdirSync(this.tempDir, { recursive: true });
    return this.tempDir;
  }

  extractArchive(zipPath, destination) {
    fs.mkdirSync(destination, { recursive: true });
    const command = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Expand-Archive failed').trim());
  }

  async verifyAssetFiles(checksumsUrl, files) {
    if (!checksumsUrl) return;
    const checksumPath = path.join(this.tempDir, 'checksums.sha256');
    await this.downloadFile(checksumsUrl, checksumPath);
    const expected = new Map();
    for (const line of fs.readFileSync(checksumPath, 'utf8').split(/\r?\n/)) {
      const match = line.trim().match(/^([a-f0-9]{64})\s+[* ](.+)$/i);
      if (match) expected.set(path.basename(match[2]), `sha256-${match[1].toLowerCase()}`);
    }
    for (const filePath of files) {
      const expectedHash = expected.get(path.basename(filePath));
      if (expectedHash && hashFile(filePath) !== expectedHash) throw new Error(`Asset hash mismatch: ${path.basename(filePath)}`);
    }
  }

  isProtectedFile(filePath) {
    const value = normalize(filePath);
    return value === '.env' || value.startsWith('.env.') || value === '.git' || value.startsWith('.git/') ||
      value.startsWith('data/') || value.includes('/data/') ||
      value.startsWith('logs/') || value.includes('/logs/') || value.startsWith('config/') ||
      value.includes('/config/') || value.includes('node_modules/') || /\.db(?:-wal|-shm)?$/i.test(value);
  }

  backupFiles(filePaths, backupDir) {
    for (const rawPath of filePaths) {
      const filePath = safeRelative(rawPath);
      if (this.isProtectedFile(filePath)) continue;
      const source = path.join(this.appDir, filePath);
      if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
      const target = path.join(backupDir, filePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }

  restoreFiles(filePaths, backupDir) {
    for (const rawPath of filePaths) {
      const filePath = safeRelative(rawPath);
      if (this.isProtectedFile(filePath)) continue;
      const backup = path.join(backupDir, filePath);
      const target = path.join(this.appDir, filePath);
      if (fs.existsSync(backup)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(backup, target);
      }
    }
  }

  copyWithProtection(sourceDir, destinationDir) {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const source = path.join(sourceDir, entry.name);
      const target = path.join(destinationDir, entry.name);
      const relative = normalize(path.relative(this.appDir, target));
      if (this.isProtectedFile(relative)) continue;
      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        this.copyWithProtection(source, destinationDir === this.appDir ? target : target);
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
    }
  }

  cleanupTemp() {
    fs.rmSync(this.tempDir, { recursive: true, force: true });
  }
}

IncrementalUpdater.compareVersions = compareRelease;
IncrementalUpdater.safeRelative = safeRelative;
module.exports = IncrementalUpdater;
