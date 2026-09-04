/**
 * 星野 Xingye - 增量包生成器
 * 对比新旧 manifest，找出变更文件，打包为增量包
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class PatchGenerator {
  constructor(appDir) {
    this.appDir = appDir;
  }

  /**
   * 对比两个 manifest，找出差异
   * @param {Object} oldManifest - 旧版本 manifest
   * @param {Object} newManifest - 新版本 manifest
   * @returns {Object} { added, modified, deleted }
   */
  diff(oldManifest, newManifest) {
    const oldFiles = oldManifest.files || {};
    const newFiles = newManifest.files || {};

    const added = [];
    const modified = [];
    const deleted = [];

    // 检查新增和修改
    for (const [filePath, newInfo] of Object.entries(newFiles)) {
      if (!(filePath in oldFiles)) {
        added.push(filePath);
      } else if (oldFiles[filePath].hash !== newInfo.hash) {
        modified.push(filePath);
      }
    }

    // 检查删除
    for (const filePath of Object.keys(oldFiles)) {
      if (!(filePath in newFiles)) {
        deleted.push(filePath);
      }
    }

    console.log(`[Patch] Diff: +${added.length} added, ~${modified.length} modified, -${deleted.length} deleted`);

    return { added, modified, deleted };
  }

  /**
   * 生成增量包
   * @param {Object} oldManifest - 旧版本 manifest
   * @param {Object} newManifest - 新版本 manifest
   * @param {string} outputDir - 输出目录
   * @returns {Object} { patchJsonPath, patchZipPath }
   */
  generate(oldManifest, newManifest, outputDir) {
    const { added, modified, deleted } = this.diff(oldManifest, newManifest);

    if (added.length === 0 && modified.length === 0 && deleted.length === 0) {
      console.log('[Patch] No changes detected, skipping patch generation.');
      return null;
    }

    // 创建输出目录
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const fromVersion = oldManifest.version;
    const toVersion = newManifest.version;
    const patchPrefix = `patch-${fromVersion}-to-${toVersion}`;

    // 1. 收集变更文件到临时目录
    const stagingDir = path.join(outputDir, '.staging');
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true });
    }
    fs.mkdirSync(stagingDir, { recursive: true });

    const filesToInclude = [...added, ...modified];
    for (const filePath of filesToInclude) {
      const srcPath = path.join(this.appDir, filePath);
      const destPath = path.join(stagingDir, filePath);

      if (fs.existsSync(srcPath)) {
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(srcPath, destPath);
      }
    }

    // 2. 生成 patch.json
    const patchJson = {
      fromVersion,
      toVersion,
      generatedAt: new Date().toISOString(),
      added,
      modified,
      deleted,
      newManifest
    };

    const patchJsonPath = path.join(outputDir, `${patchPrefix}.json`);
    fs.writeFileSync(patchJsonPath, JSON.stringify(patchJson, null, 2));
    console.log(`[Patch] Created: ${patchJsonPath}`);

    // 3. 打包 patch.zip（使用 PowerShell）
    const patchZipPath = path.join(outputDir, `${patchPrefix}.zip`);
    try {
      // 先删除已存在的 zip
      if (fs.existsSync(patchZipPath)) {
        fs.unlinkSync(patchZipPath);
      }

      execSync(
        `powershell -Command "Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${patchZipPath}' -Force"`,
        { stdio: 'pipe' }
      );
      console.log(`[Patch] Created: ${patchZipPath}`);
    } catch (err) {
      throw new Error(`Failed to create patch zip: ${err.message}`);
    }

    // 4. 清理 staging 目录
    fs.rmSync(stagingDir, { recursive: true, force: true });

    // 5. 计算增量包大小
    const patchJsonSize = fs.statSync(patchJsonPath).size;
    const patchZipSize = fs.statSync(patchZipPath).size;

    console.log(`[Patch] Patch size: JSON ${(patchJsonSize / 1024).toFixed(1)}KB, ZIP ${(patchZipSize / 1024).toFixed(1)}KB`);

    return {
      patchJsonPath,
      patchZipPath,
      stats: {
        added: added.length,
        modified: modified.length,
        deleted: deleted.length,
        totalFiles: added.length + modified.length,
        patchJsonSize,
        patchZipSize
      }
    };
  }

  /**
   * 生成完整包
   * @param {string} outputDir - 输出目录
   * @returns {string} 完整包 zip 路径
   */
  generateFullPackage(outputDir) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const manifest = ManifestGenerator.load(path.join(this.appDir, 'manifest.json'));
    const version = manifest?.version || '0.0.0';
    const fullZipPath = path.join(outputDir, `full-${version}.zip`);

    try {
      if (fs.existsSync(fullZipPath)) {
        fs.unlinkSync(fullZipPath);
      }

      // 排除不需要的目录
      const excludeDirs = ['node_modules', '.git', 'data', 'logs', '.update-temp', '.update-backup'];
      let excludeArgs = excludeDirs.map(d => `-Exclude '${d}'`).join(', ');

      execSync(
        `powershell -Command "Compress-Archive -Path '${this.appDir}\\*' -DestinationPath '${fullZipPath}' -Force"`,
        { stdio: 'pipe' }
      );

      const size = fs.statSync(fullZipPath).size;
      console.log(`[Patch] Full package: ${fullZipPath} (${(size / 1024 / 1024).toFixed(1)}MB)`);
      return fullZipPath;
    } catch (err) {
      throw new Error(`Failed to create full package: ${err.message}`);
    }
  }
}

// 需要引用 ManifestGenerator
const ManifestGenerator = require('./manifest-generator');
PatchGenerator.ManifestGenerator = ManifestGenerator;

module.exports = require('../../updater/patch-generator');
