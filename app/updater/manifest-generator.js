const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXCLUDED_PARTS = new Set([
  'node_modules',
  '.git',
  '.update-temp',
  '.update-backup',
  'data',
  'logs',
  'config'
]);

function normalize(relativePath) {
  return relativePath.replace(/\\/g, '/');
}

class ManifestGenerator {
  constructor(appDir) {
    this.appDir = path.resolve(appDir);
  }

  hashFile(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return `sha256-${hash.digest('hex')}`;
  }

  shouldExclude(relativePath) {
    const normalized = normalize(relativePath);
    const basename = path.basename(normalized);
    if (basename === '.env' || basename.startsWith('.env.')) return true;
    if (basename === '.service-pids') return true;
    if (/\.db(?:-wal|-shm)?$/i.test(basename)) return true;
    return normalized.split('/').some(part => EXCLUDED_PARTS.has(part));
  }

  scanDirectory(dir, result = {}) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = normalize(path.relative(this.appDir, fullPath));
      if (this.shouldExclude(relativePath)) continue;
      if (entry.isDirectory()) {
        this.scanDirectory(fullPath, result);
        continue;
      }
      const stats = fs.statSync(fullPath);
      result[relativePath] = {
        hash: this.hashFile(fullPath),
        size: stats.size,
        mtime: stats.mtime.toISOString()
      };
    }
    return result;
  }

  generate(version, build, release, githubRepo = '') {
    const files = this.scanDirectory(this.appDir);
    return {
      version,
      build,
      release: release || `${version}-build.${build}`,
      githubRepo,
      generatedAt: new Date().toISOString(),
      fileCount: Object.keys(files).length,
      files
    };
  }

  save(manifest, outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  static load(manifestPath) {
    if (!fs.existsSync(manifestPath)) return null;
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }
}

ManifestGenerator.normalize = normalize;
module.exports = ManifestGenerator;
