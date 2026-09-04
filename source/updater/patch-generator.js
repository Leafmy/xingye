const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ManifestGenerator = require('./manifest-generator');

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function assertSafeRelative(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Unsafe relative path: ${filePath}`);
  }
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe relative path: ${filePath}`);
  }
  return normalized;
}

function compress(sourceDir, destination) {
  const command = `Compress-Archive -Path (Join-Path -Path ${psQuote(sourceDir)} -ChildPath '*') -DestinationPath ${psQuote(destination)} -Force`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Compress-Archive failed').trim());
  }
}

class PatchGenerator {
  constructor(appDir) {
    this.appDir = path.resolve(appDir);
  }

  diff(oldManifest, newManifest) {
    const oldFiles = oldManifest?.files || {};
    const newFiles = newManifest?.files || {};
    const added = [];
    const modified = [];
    const deleted = [];

    for (const [filePath, info] of Object.entries(newFiles)) {
      if (!(filePath in oldFiles)) added.push(filePath);
      else if (oldFiles[filePath].hash !== info.hash) modified.push(filePath);
    }
    for (const filePath of Object.keys(oldFiles)) {
      if (!(filePath in newFiles)) deleted.push(filePath);
    }
    return { added, modified, deleted };
  }

  generate(oldManifest, newManifest, outputDir) {
    const diff = this.diff(oldManifest, newManifest);
    if (!diff.added.length && !diff.modified.length && !diff.deleted.length) return null;

    fs.mkdirSync(outputDir, { recursive: true });
    const fromRelease = oldManifest.release || oldManifest.version;
    const toRelease = newManifest.release || newManifest.version;
    const prefix = `patch-${fromRelease}-to-${toRelease}`;
    const stagingDir = path.join(outputDir, `.staging-${Date.now()}`);
    fs.mkdirSync(stagingDir, { recursive: true });

    try {
      for (const rawPath of [...diff.added, ...diff.modified]) {
        const filePath = assertSafeRelative(rawPath);
        const srcPath = path.join(this.appDir, filePath);
        const destPath = path.join(stagingDir, filePath);
        if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) {
          throw new Error(`Patch source file missing: ${filePath}`);
        }
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }

      const patchJsonPath = path.join(outputDir, `${prefix}.json`);
      const patchZipPath = path.join(outputDir, `${prefix}.zip`);
      const patchJson = {
        fromVersion: oldManifest.version,
        toVersion: newManifest.version,
        fromRelease,
        toRelease,
        generatedAt: new Date().toISOString(),
        ...diff,
        newManifest
      };
      fs.writeFileSync(patchJsonPath, `${JSON.stringify(patchJson, null, 2)}\n`);
      if (fs.existsSync(patchZipPath)) fs.unlinkSync(patchZipPath);
      compress(stagingDir, patchZipPath);

      return {
        patchJsonPath,
        patchZipPath,
        stats: {
          added: diff.added.length,
          modified: diff.modified.length,
          deleted: diff.deleted.length,
          totalFiles: diff.added.length + diff.modified.length,
          patchJsonSize: fs.statSync(patchJsonPath).size,
          patchZipSize: fs.statSync(patchZipPath).size
        }
      };
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  generateFullPackage(outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    const manifest = ManifestGenerator.load(path.join(this.appDir, 'manifest.json'));
    const release = manifest?.release || manifest?.version || '0.0.0-build.0';
    const fullZipPath = path.join(outputDir, `full-${release}.zip`);
    if (fs.existsSync(fullZipPath)) fs.unlinkSync(fullZipPath);
    compress(this.appDir, fullZipPath);
    return fullZipPath;
  }
}

PatchGenerator.assertSafeRelative = assertSafeRelative;
PatchGenerator.ManifestGenerator = ManifestGenerator;
module.exports = PatchGenerator;
