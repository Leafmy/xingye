import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

// ==================== Constants ====================
const BILI_URL_REGEX = /https?:\/\/(?:www\.)?bilibili\.com\/video\/(BV[a-zA-Z0-9]+|av\d+)[^\s]*|https?:\/\/b23\.tv\/\w+[^\s]*/gi;
const BOT_DIR = path.resolve(__dirname, '..');
const TEMP_VIDEOS_DIR = path.join(BOT_DIR, 'temp_videos');
const BILI_MAX_BYTES = 750_000_000; // ~750MB
const BILI_DOWNLOAD_TIMEOUT = 120_000;
const BILI_FFMPEG_TIMEOUT = 60_000;
const BILI_LOGIN_TIMEOUT = 180_000;
const FFMPEG_PATH = 'ffmpeg';

// ==================== Types ====================
export interface BiliVideoResult {
  success: boolean;
  filePath?: string;
  errorMessage?: string;
  title?: string;
}

export interface BiliLoginResult {
  success: boolean;
  qrCodePath?: string;
  message?: string;
  errorMessage?: string;
  loginProcess?: ChildProcess;
}

// ==================== URL Detection ====================
export function containsBiliUrl(text: string): boolean {
  BILI_URL_REGEX.lastIndex = 0;
  return BILI_URL_REGEX.test(text);
}

export function extractBiliUrl(text: string): string | null {
  BILI_URL_REGEX.lastIndex = 0;
  const match = BILI_URL_REGEX.exec(text);
  return match ? match[0] : null;
}

// ==================== BBDown Path Resolution ====================
function resolveBBDownPath(): string | null {
  const projectRoot = path.resolve(__dirname, '..');
  const candidates = [
    path.join(projectRoot, 'BBDown', 'BBDown.exe'),
    path.join(projectRoot, 'BBDown.exe'),
    path.join(__dirname, 'BBDown', 'BBDown.exe'),
    path.join(__dirname, 'BBDown.exe'),
  ];

  for (const candidate of candidates) {
    const full = path.resolve(candidate);
    if (fs.existsSync(full)) {
      console.log(`[BiliVideo] BBDown 路径: ${full}`);
      return full;
    }
  }

  console.log('[BiliVideo] BBDown.exe 未找到');
  return null;
}

// ==================== Run Process ====================
async function runProcess(
  fileName: string,
  args: string,
  timeoutMs: number,
  workDir: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(fileName, args.split(' '), {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      const line = data.toString();
      stdout += line;
      console.log(`[BBDown] ${line.trimEnd()}`);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const line = data.toString();
      stderr += line;
      console.log(`[BBDown] ${line.trimEnd()}`);
    });

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr + `\n[BiliVideo] 超时 (${timeoutMs / 1000}s)`,
      });
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr: stderr + `\n[BiliVideo] 进程错误: ${err.message}` });
    });
  });
}

// ==================== Fetch & Mux ====================
export async function fetchAndMux(rawUrl: string): Promise<BiliVideoResult> {
  const result: BiliVideoResult = { success: false };

  try {
    // Ensure temp dir
    fs.mkdirSync(TEMP_VIDEOS_DIR, { recursive: true });

    // Create work dir
    const jobId = Math.random().toString(36).substring(2, 10);
    const workDir = path.join(TEMP_VIDEOS_DIR, `job_${jobId}`);
    fs.mkdirSync(workDir, { recursive: true });

    // Find BBDown
    const bbdownPath = resolveBBDownPath();
    if (!bbdownPath) {
      result.errorMessage = 'BBDown 未找到，请将 BBDown.exe 放在机器人程序目录';
      return result;
    }

    // Build args
    const args = `"${rawUrl}" -tv --work-dir "${workDir}" -F "<bvid>" --delay-per-page 0 --ffmpeg-path "${FFMPEG_PATH}"`;
    console.log(`[BiliVideo] 启动: ${bbdownPath} ${args}`);

    // Run BBDown
    const { exitCode, stdout, stderr } = await runProcess(
      bbdownPath, args, BILI_DOWNLOAD_TIMEOUT + BILI_FFMPEG_TIMEOUT, workDir
    );

    // Parse title
    let title = '未知标题';
    for (const line of (stdout + '\n' + stderr).split('\n')) {
      const trimmed = line.trim();
      if (trimmed.includes('视频标题:') || trimmed.includes('视频标题：') || trimmed.includes('標題:')) {
        const idx = Math.max(trimmed.indexOf(':'), trimmed.indexOf('：'));
        if (idx >= 0) title = trimmed.substring(idx + 1).trim();
      }
    }
    result.title = title;

    if (exitCode !== 0) {
      const allOutput = stdout + stderr;
      if (allOutput.includes('412')) result.errorMessage = '视频拉取被 B站 风控拦截（412），请稍后再试';
      else if (allOutput.includes('403')) result.errorMessage = '视频拉取被拒绝（403），该视频可能需要登录';
      else if (allOutput.includes('404')) result.errorMessage = '视频不存在或已被删除（404）';
      else if (allOutput.includes('会员') || allOutput.includes('大會員')) result.errorMessage = '该视频需要大会员才能观看';
      else result.errorMessage = `BBDown 下载失败（退出码 ${exitCode}）`;
      return result;
    }

    // Find output MP4
    const mp4Files = findFiles(workDir, '.mp4');
    if (mp4Files.length === 0) {
      result.errorMessage = 'BBDown 运行完成但未生成 MP4 文件';
      return result;
    }

    // Get largest MP4
    const outputPath = mp4Files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
    const finalSize = fs.statSync(outputPath).size;
    console.log(`[BiliVideo] 成品: ${path.basename(outputPath)} (${(finalSize / 1024 / 1024).toFixed(1)}MB)`);

    if (finalSize > BILI_MAX_BYTES) {
      result.errorMessage = `视频体积过大（${(finalSize / 1024 / 1024).toFixed(0)}MB），超出限制`;
      purgeDirectory(workDir);
      return result;
    }

    result.success = true;
    result.filePath = outputPath;
    return result;
  } catch (ex: any) {
    result.errorMessage = `视频处理异常：${ex.message}`;
    console.error('[BiliVideo] 异常:', ex);
    return result;
  }
}

// ==================== Login ====================
export function startLoginTv(): BiliLoginResult {
  const result: BiliLoginResult = { success: false };

  try {
    const bbdownPath = resolveBBDownPath();
    if (!bbdownPath) {
      result.errorMessage = 'BBDown.exe 未找到';
      return result;
    }

    const bbdownDir = path.dirname(path.resolve(bbdownPath));
    const qrPath = path.join(bbdownDir, 'qrcode.png');

    // Clean old QR
    if (fs.existsSync(qrPath)) try { fs.unlinkSync(qrPath); } catch {}

    console.log('[BiliVideo] 启动 BBDown TV 扫码登录...');

    const proc = spawn(bbdownPath, ['logintv'], {
      cwd: bbdownDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,
    });

    proc.stdout?.on('data', (d: Buffer) => console.log(`[BBDown:login] ${d.toString().trimEnd()}`));
    proc.stderr?.on('data', (d: Buffer) => console.log(`[BBDown:login] ${d.toString().trimEnd()}`));

    result.loginProcess = proc;
    result.qrCodePath = qrPath;
    result.message = '请用 B站 APP 扫描二维码完成 TV 端登录（3 分钟内有效）';
    console.log('[BiliVideo] QR 图片生成中，等待扫码...');

    return result;
  } catch (ex: any) {
    result.errorMessage = `登录启动异常：${ex.message}`;
    console.error('[BiliVideo] 登录异常:', ex);
    return result;
  }
}

export async function waitForLogin(result: BiliLoginResult): Promise<BiliLoginResult> {
  if (!result.loginProcess) return result;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { result.loginProcess?.kill('SIGTERM'); } catch {}
      result.errorMessage = '登录超时（3 分钟），请重新发起扫码';
      resolve(result);
    }, BILI_LOGIN_TIMEOUT);

    result.loginProcess!.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        result.success = true;
        result.message = 'B站 TV 端登录成功！现在可以拉取 1080P+ 高画质视频了~';
        console.log('[BiliVideo] ✅ B站 TV 端登录成功');
      } else {
        result.errorMessage = `登录失败（退出码 ${code}）`;
        console.log(`[BiliVideo] ❌ 登录失败 (exit ${code})`);
      }
      try { result.loginProcess?.kill(); } catch {}
      resolve(result);
    });

    result.loginProcess!.on('error', (err) => {
      clearTimeout(timer);
      result.errorMessage = `登录异常：${err.message}`;
      resolve(result);
    });
  });
}

// ==================== Cleanup ====================
function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

function purgeDirectory(dir: string) {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (ex: any) {
    console.error(`[BiliVideo] 清理目录失败: ${ex.message}`);
  }
}

export function cleanupOutputFile(filePath?: string | null) {
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    if (dir.startsWith(TEMP_VIDEOS_DIR) && fs.existsSync(dir)) {
      purgeDirectory(dir);
      console.log(`[BiliVideo] 工作目录已清理: ${path.basename(dir)}`);
    } else if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[BiliVideo] 已清理: ${path.basename(filePath)}`);
    }
  } catch (ex: any) {
    console.error(`[BiliVideo] 清理失败: ${ex.message}`);
  }
}

export function purgeTempDirectory() {
  try {
    if (fs.existsSync(TEMP_VIDEOS_DIR)) {
      for (const entry of fs.readdirSync(TEMP_VIDEOS_DIR)) {
        const fullPath = path.join(TEMP_VIDEOS_DIR, entry);
        try { fs.rmSync(fullPath, { recursive: true, force: true }); } catch {}
      }
      console.log('[BiliVideo] temp_videos 目录已清空');
    }
  } catch (ex: any) {
    console.error(`[BiliVideo] 清理 temp_videos 异常: ${ex.message}`);
  }
}

export function diagnoseFfmpeg() {
  try {
    const proc = spawn(FFMPEG_PATH, ['-version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,
    });

    let output = '';
    proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[BiliVideo] ✅ FFmpeg 就绪: ${output.split('\n')[0]?.trim()}`);
      } else {
        console.log(`[BiliVideo] ⚠️ FFmpeg 退出码 ${code}`);
      }
    });

    proc.on('error', () => {
      console.log('[BiliVideo] ❌ FFmpeg 未找到！请安装 FFmpeg 并确保在系统 PATH 中');
    });
  } catch (ex: any) {
    console.error(`[BiliVideo] FFmpeg 诊断异常: ${ex.message}`);
  }
}
