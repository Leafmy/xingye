/**
 * 星野 Xingye - 增量更新器
 * 仿 C# ClickOnce / Squirrel 模式
 * 通过 GitHub Releases 托管更新包
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class IncrementalUpdater {
  /**
   * @param {Object} options
   * @param {string} options.appDir - 本地应用目录
   * @param {string} options.githubRepo - GitHub 仓库，格式 "owner/repo"
   */
  constructor(options) {
    this.appDir = options.appDir;
    this.githubRepo = options.githubRepo;
    this.manifestPath = path.join(this.appDir, 'manifest.json');
    this.tempDir = path.join(this.appDir, '..', '.update-temp');
  }

  // ================= GitHub API =================

  /**
   * 获取最新 Release 信息
   */
  async getLatestRelease() {
    return new Promise((resolve, reject) => {
      const url = `https://api.github.com/repos/${this.githubRepo}/releases/latest`;
      https.get(url, {
        headers: { 'User-Agent': 'Xingye-Updater/1.0' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 404) {
            return reject(new Error('No releases found'));
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`GitHub API error: ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse release info'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * 下载文件到本地
   */
  async downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const protocol = url.startsWith('https') ? https : http;
      protocol.get(url, {
        headers: { 'User-Agent': 'Xingye-Updater/1.0' }
      }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          return this.downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: ${res.statusCode}`));
        }

        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(destPath); });
        file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
      }).on('error', reject);
    });
  }

  // ================= 更新检查 =================

  /**
   * 检查是否有可用更新
   * @returns {Object} { hasUpdate, latestVersion, type, patchUrl, fullUrl, patchInfo }
   */
  async checkForUpdates() {
    const localManifest = this.readLocalManifest();
    const currentVersion = localManifest?.version || '0.0.0';

    let release;
    try {
      release = await this.getLatestRelease();
    } catch (err) {
      return { hasUpdate: false, error: err.message };
    }

    const latestVersion = release.tag_name?.replace(/^v/, '') || '0.0.0';

    // 版本比较
    if (this.compareVersions(currentVersion, latestVersion) >= 0) {
      return { hasUpdate: false, currentVersion, latestVersion };
    }

    // 查找增量包和完整包
    const assets = release.assets || [];
    const patchJsonAsset = assets.find(a => a.name.endsWith('.json') && a.name.startsWith('patch-'));
    const patchZipAsset = assets.find(a => a.name.endsWith('.zip') && a.name.startsWith('patch-'));
    const fullZipAsset = assets.find(a => a.name.startsWith('full-') && a.name.endsWith('.zip'));

    if (patchJsonAsset && patchZipAsset) {
      // 有增量包
      return {
        hasUpdate: true,
        currentVersion,
        latestVersion,
        type: 'patch',
        patchInfo: {
          manifestUrl: patchJsonAsset.browser_download_url,
          patchUrl: patchZipAsset.browser_download_url,
          fromVersion: currentVersion,
          toVersion: latestVersion
        }
      };
    } else if (fullZipAsset) {
      // 只有完整包
      return {
        hasUpdate: true,
        currentVersion,
        latestVersion,
        type: 'full',
        fullUrl: fullZipAsset.browser_download_url
      };
    }

    return { hasUpdate: false, currentVersion, latestVersion };
  }

  // ================= 应用更新 =================

  /**
   * 应用增量更新
   * @param {Object} patchInfo - 增量包信息
   */
  async applyPatch(patchInfo) {
    console.log(`[Updater] Applying patch: ${patchInfo.fromVersion} → ${patchInfo.toVersion}`);

    // 1. 创建临时目录
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // 2. 下载 patch.json 和 patch.zip
    const patchJsonPath = path.join(this.tempDir, 'patch.json');
    const patchZipPath = path.join(this.tempDir, 'patch.zip');

    console.log('[Updater] Downloading patch manifest...');
    await this.downloadFile(patchInfo.manifestUrl, patchJsonPath);

    console.log('[Updater] Downloading patch archive...');
    await this.downloadFile(patchInfo.patchUrl, patchZipPath);

    // 3. 读取 patch.json
    const patchJson = JSON.parse(fs.readFileSync(patchJsonPath, 'utf8'));

    // 4. 解压 patch.zip
    const extractDir = path.join(this.tempDir, 'extracted');
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true });
    }
    fs.mkdirSync(extractDir, { recursive: true });

    // 使用 PowerShell 解压（Windows 原生）
    try {
      execSync(
        `powershell -Command "Expand-Archive -Path '${patchZipPath}' -DestinationPath '${extractDir}' -Force"`,
        { stdio: 'pipe' }
      );
    } catch (err) {
      throw new Error(`Failed to extract patch: ${err.message}`);
    }

    // 5. 应用变更
    let appliedCount = 0;

    // 处理 modified 和 added 文件
    const filesToApply = [...(patchJson.modified || []), ...(patchJson.added || [])];
    for (const filePath of filesToApply) {
      const srcPath = path.join(extractDir, filePath);
      const destPath = path.join(this.appDir, filePath);

      if (!fs.existsSync(srcPath)) {
        console.warn(`[Updater] File not found in patch: ${filePath}`);
        continue;
      }

      // 确保目标目录存在
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // 复制文件
      fs.copyFileSync(srcPath, destPath);
      appliedCount++;
      console.log(`[Updater] Updated: ${filePath}`);
    }

    // 处理 deleted 文件
    for (const filePath of (patchJson.deleted || [])) {
      const destPath = path.join(this.appDir, filePath);
      if (fs.existsSync(destPath)) {
        // 不删除关键运行时文件
        if (this.isProtectedFile(filePath)) {
          console.log(`[Updater] Skipped protected file: ${filePath}`);
          continue;
        }
        fs.unlinkSync(destPath);
        appliedCount++;
        console.log(`[Updater] Deleted: ${filePath}`);
      }
    }

    // 6. 更新本地 manifest.json
    if (patchJson.newManifest) {
      fs.writeFileSync(this.manifestPath, JSON.stringify(patchJson.newManifest, null, 2));
    }

    // 7. 更新 version.json
    const versionPath = path.join(this.appDir, 'version.json');
    if (fs.existsSync(versionPath)) {
      const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
      versionData.version = patchInfo.toVersion;
      fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2));
    }

    // 8. 清理临时文件
    this.cleanupTemp();

    console.log(`[Updater] Patch applied successfully. ${appliedCount} files updated.`);
    return { success: true, filesUpdated: appliedCount };
  }

  /**
   * 应用完整更新
   * @param {string} fullUrl - 完整包下载地址
   */
  async applyFullUpdate(fullUrl) {
    console.log('[Updater] Applying full update...');

    // 1. 创建临时目录
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // 2. 备份当前版本
    const backupDir = path.join(this.appDir, '..', '.update-backup');
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true });
    }
    fs.cpSync(this.appDir, backupDir, { recursive: true });

    // 3. 下载完整包
    const fullZipPath = path.join(this.tempDir, 'full.zip');
    console.log('[Updater] Downloading full package...');
    await this.downloadFile(fullUrl, fullZipPath);

    // 4. 解压覆盖（保留受保护的文件）
    const extractDir = path.join(this.tempDir, 'extracted');
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true });
    }
    fs.mkdirSync(extractDir, { recursive: true });

    try {
      execSync(
        `powershell -Command "Expand-Archive -Path '${fullZipPath}' -DestinationPath '${extractDir}' -Force"`,
        { stdio: 'pipe' }
      );
    } catch (err) {
      // 解压失败，从备份恢复
      console.error('[Updater] Extract failed, restoring backup...');
      fs.rmSync(this.appDir, { recursive: true });
      fs.cpSync(backupDir, this.appDir, { recursive: true });
      throw new Error(`Failed to extract full package: ${err.message}`);
    }

    // 5. 逐文件覆盖（跳过受保护文件）
    this.copyWithProtection(extractDir, this.appDir);

    // 6. 清理
    this.cleanupTemp();

    console.log('[Updater] Full update applied successfully.');
    return { success: true };
  }

  // ================= 辅助方法 =================

  /**
   * 读取本地 manifest.json
   */
  readLocalManifest() {
    if (fs.existsSync(this.manifestPath)) {
      return JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
    }
    return null;
  }

  /**
   * 判断是否为受保护文件（不被增量更新覆盖）
   */
  isProtectedFile(filePath) {
    const protectedPatterns = [
      /^data\//,           // 运行时数据
      /\.env$/,            // 环境配置
      /node_modules\//,    // 依赖
      /\.git\//,           // Git
      /miao-data\//        // 角色数据（体积大，单独更新）
    ];
    return protectedPatterns.some(p => p.test(filePath));
  }

  /**
   * 带保护的复制（跳过受保护文件）
   */
  copyWithProtection(src, dest) {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      const relativePath = path.relative(this.appDir, destPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (!this.isProtectedFile(relativePath + '/')) {
          if (!fs.existsSync(destPath)) {
            fs.mkdirSync(destPath, { recursive: true });
          }
          this.copyWithProtection(srcPath, destPath);
        }
      } else {
        if (!this.isProtectedFile(relativePath)) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }
  }

  /**
   * 清理临时目录
   */
  cleanupTemp() {
    if (fs.existsSync(this.tempDir)) {
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      } catch {}
    }
  }

  /**
   * 版本号比较
   * @returns {number} 1 = a > b, 0 = a == b, -1 = a < b
   */
  compareVersions(a, b) {
    // 去掉预发布标签（如 -dev+2）
    const cleanA = a.replace(/-.*$/, '').split('.').map(Number);
    const cleanB = b.replace(/-.*$/, '').split('.').map(Number);

    for (let i = 0; i < Math.max(cleanA.length, cleanB.length); i++) {
      const na = cleanA[i] || 0;
      const nb = cleanB[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }
}

module.exports = require('../../updater/updater');
