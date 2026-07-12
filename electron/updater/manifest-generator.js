/**
 * 星野 Xingye - Manifest 生成器
 * 遍历应用目录，计算每个文件的 SHA-256 哈希，生成 manifest.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 不纳入 manifest 的目录/文件
const EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  '.update-temp',
  '.update-backup',
  'data',
  '.env',
  'dist',          // 编译产物单独处理
  'logs',
  '*.db',
  '*.db-wal',
  '*.db-shm',
  '.service-pids'
];

class ManifestGenerator {
  constructor(appDir) {
    this.appDir = appDir;
  }

  /**
   * 计算单个文件的 SHA-256 哈希
   */
  hashFile(filePath) {
    const content = fs.readFileSync(filePath);
    return 'sha256-' + crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * 判断是否应该排除
   */
  shouldExclude(relativePath) {
    const basename = path.basename(relativePath);
    return EXCLUDE_PATTERNS.some(pattern => {
      if (pattern.startsWith('*')) {
        return basename.endsWith(pattern.slice(1));
      }
      // 检查路径中的每一级目录
      const parts = relativePath.split(/[/\\]/);
      return parts.includes(pattern);
    });
  }

  /**
   * 递归遍历目录，生成文件清单
   */
  scanDirectory(dir, result = {}) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(this.appDir, fullPath).replace(/\\/g, '/');

      if (this.shouldExclude(relativePath)) continue;

      if (entry.isDirectory()) {
        this.scanDirectory(fullPath, result);
      } else {
        try {
          const stats = fs.statSync(fullPath);
          result[relativePath] = {
            hash: this.hashFile(fullPath),
            size: stats.size,
            mtime: stats.mtime.toISOString()
          };
        } catch (err) {
          console.warn(`[Manifest] Cannot hash: ${relativePath} - ${err.message}`);
        }
      }
    }

    return result;
  }

  /**
   * 生成完整的 manifest.json
   * @param {string} version - 版本号
   * @param {number} build - 构建号
   */
  generate(version, build) {
    console.log(`[Manifest] Scanning ${this.appDir}...`);

    const files = this.scanDirectory(this.appDir);
    const fileCount = Object.keys(files).length;

    const manifest = {
      version,
      build,
      generatedAt: new Date().toISOString(),
      fileCount,
      files
    };

    console.log(`[Manifest] Generated manifest: ${fileCount} files`);

    return manifest;
  }

  /**
   * 保存 manifest 到文件
   */
  save(manifest, outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
    console.log(`[Manifest] Saved to ${outputPath}`);
  }

  /**
   * 加载已有的 manifest
   */
  static load(manifestPath) {
    if (fs.existsSync(manifestPath)) {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
    return null;
  }
}

module.exports = require('../../updater/manifest-generator');
