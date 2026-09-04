// ============================================================
// 原神角色攻略与圣遗物评分系统 — Facade 入口
//
// 支持指令:
//   gs <角色名>          → 生成角色攻略图
//   攻略 <角色名>        → 同上
//   xx面板               → 查询绑定 UID 的角色面板 (如: 胡桃面板)
//   绑定uid <UID>        → 绑定原神 UID
//   解绑uid <UID>        → 解绑原神 UID
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { MiaoGuideService } from './services/MiaoGuideService';
import { ArtifactEvaluator } from './services/ArtifactEvaluator';
import { GuideImageGenerator } from './services/GuideImageGenerator';
import { EnkaService } from './services/EnkaService';
import { LiangshiService } from './services/LiangshiService';
import { PanelRenderer } from './services/PanelRenderer';
import { GuideData } from './types';

// ---- 单例服务 ----
const miaoService = new MiaoGuideService();
const evaluator = new ArtifactEvaluator();
const imageGenerator = new GuideImageGenerator();
const enkaService = new EnkaService();
const liangshiService = new LiangshiService();
const panelRenderer = new PanelRenderer();
let initialized = false;
let cleanupTimer: NodeJS.Timeout | null = null;

/** 临时图片目录 */
const TMP_IMG_DIR = path.join(__dirname, '..', 'data');

/** UID 绑定存储路径 */
const BINDINGS_PATH = path.join(__dirname, '..', 'data', 'player_bindings.json');

// ==================== UID 绑定系统 ====================

/** 读取用户绑定的 UID 列表 */
function getUserBindings(userId: number): Array<{ platform: string; accountId: string; label: string; boundAt: string }> {
  try {
    if (!fs.existsSync(BINDINGS_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(BINDINGS_PATH, 'utf8'));
    return data[String(userId)] || [];
  } catch { return []; }
}

/** 获取用户绑定的原神 UID 列表 */
function getGSBindings(userId: number): string[] {
  return getUserBindings(userId)
    .filter(a => a.platform === 'gs')
    .map(a => a.accountId);
}

/** 保存绑定到 player_bindings.json */
function saveBinding(userId: number, platform: string, uid: string, label: string): void {
  const dir = path.dirname(BINDINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let data: Record<string, any[]> = {};
  try {
    if (fs.existsSync(BINDINGS_PATH)) {
      data = JSON.parse(fs.readFileSync(BINDINGS_PATH, 'utf8'));
    }
  } catch {}

  if (!data[String(userId)]) data[String(userId)] = [];

  // 去重检查
  const exists = data[String(userId)].some(
    (a: any) => a.platform === platform && a.accountId === uid
  );
  if (exists) return;

  data[String(userId)].push({
    platform,
    accountId: uid,
    label,
    boundAt: new Date().toISOString(),
  });

  fs.writeFileSync(BINDINGS_PATH, JSON.stringify(data, null, 2));
}

/** 删除绑定 */
function removeBinding(userId: number, platform: string, uid: string): boolean {
  try {
    if (!fs.existsSync(BINDINGS_PATH)) return false;
    const data = JSON.parse(fs.readFileSync(BINDINGS_PATH, 'utf8'));
    const accounts = data[String(userId)];
    if (!accounts) return false;

    const idx = accounts.findIndex((a: any) => a.platform === platform && a.accountId === uid);
    if (idx === -1) return false;

    accounts.splice(idx, 1);
    if (accounts.length === 0) delete data[String(userId)];
    fs.writeFileSync(BINDINGS_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch { return false; }
}

/** 清理超过 30 分钟的临时图片 */
function cleanupTempImages(): void {
  try {
    if (!fs.existsSync(TMP_IMG_DIR)) return;
    const now = Date.now();
    const maxAge = 30 * 60 * 1000;
    let cleaned = 0;
    for (const file of fs.readdirSync(TMP_IMG_DIR)) {
      if (!file.startsWith('gs_') || !file.endsWith('.png')) continue;
      const filePath = path.join(TMP_IMG_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    }
    if (cleaned > 0) console.log(`[GenshinGuide] 清理 ${cleaned} 张过期临时图片`);
  } catch {}
}

// ==================== 初始化 ====================

export async function init(): Promise<void> {
  if (initialized) return;

  try {
    await miaoService.init();
    await enkaService.init();
    initialized = true;

    cleanupTimer = setInterval(cleanupTempImages, 10 * 60 * 1000);
    cleanupTempImages();

    console.log('[GenshinGuide] 模块初始化完成');
  } catch (err: any) {
    console.error('[GenshinGuide] 模块初始化失败:', err.message);
  }
}

// ==================== 指令分发 ====================

export async function matchAndExecute(
  text: string,
  targetId: number,
  chatType: string
): Promise<Buffer | string | null> {
  if (!initialized) await init();

  const lower = text.trim();

  // ========== 绑定 UID ==========
  if (lower.startsWith('绑定uid ') || lower.startsWith('绑定UID ')) {
    const uid = text.replace(/^绑定[Uu][Ii][Dd]\s+/i, '').trim();
    if (!uid || !/^\d{9,10}$/.test(uid)) {
      return '用法: 绑定uid <UID>\nUID 为 9-10 位数字';
    }
    saveBinding(targetId, 'gs', uid, '原神UID');

    try {
      const bindImg = await panelRenderer.renderBindPanel({
        status: 'success',
        uid,
        message: '原神 UID 绑定成功！',
      });
      return bindImg;
    } catch {
      return `✅ 原神 UID ${uid} 绑定成功！\n现在可以直接输入「角色名面板」查询了`;
    }
  }

  // ========== 解绑 UID ==========
  if (lower.startsWith('解绑uid ') || lower.startsWith('解绑UID ')) {
    const uid = text.replace(/^解绑[Uu][Ii][Dd]\s+/i, '').trim();
    if (!uid) return '用法: 解绑uid <UID>';

    const removed = removeBinding(targetId, 'gs', uid);
    if (removed) {
      try {
        const unbindImg = await panelRenderer.renderBindPanel({
          status: 'error',
          uid,
          message: '原神 UID 已解绑',
        });
        return unbindImg;
      } catch {
        return `🗑 原神 UID ${uid} 已解绑`;
      }
    }
    return `未找到绑定的 UID ${uid}`;
  }

  // ========== 攻略命令 ==========
  if (lower.startsWith('gs ') || lower.startsWith('攻略 ')) {
    const charInput = text.replace(/^(gs|攻略)\s+/i, '').trim();
    if (!charInput) return '用法: gs <角色名>\n例: gs 胡桃';

    const resolved = miaoService.resolveCharacterName(charInput);
    if (!resolved) return `未找到角色「${charInput}」`;

    if (resolved === '列表' || charInput === '列表') {
      const names = miaoService.getAllCharacterNames();
      return `📋 共 ${names.length} 个角色:\n${names.join('、')}`;
    }

    const charData = await miaoService.getCharacterData(resolved);
    if (!charData) return `获取角色「${resolved}」数据失败`;

    const weights = miaoService.getArtifactWeights(resolved);
    const guideData: GuideData = {
      character: charData,
      weights: weights || { hp: 0, atk: 75, def: 0, cpct: 100, cdmg: 100, mastery: 50, dmg: 80, phy: 0, recharge: 0, heal: 0 },
      buildName: resolved,
    };

    try {
      return await imageGenerator.generateGuideImage(guideData);
    } catch (err: any) {
      return buildTextGuide(guideData);
    }
  }

  // ========== 角色面板命令 ==========
  // 匹配 "胡桃面板"、"雷神面板" 等
  const panelMatch = lower.match(/^(.+?)面板$/);
  if (panelMatch) {
    const charInput = panelMatch[1];
    const resolved = miaoService.resolveCharacterName(charInput);
    if (!resolved) return `未找到角色「${charInput}」`;

    // 获取绑定的 UID
    const gsUids = getGSBindings(targetId);
    if (gsUids.length === 0) {
      return `你还没有绑定原神 UID\n请先发送「绑定uid <UID>」绑定账号`;
    }

    let uid = gsUids[0]; // 默认使用第一个绑定的 UID
    if (gsUids.length > 1) {
      // 多 UID 时提示选择 (简化: 直接用第一个, 后续可扩展选择流)
      // TODO: 多 UID 选择交互
    }

    // Enka 查询
    if (!enkaService.isAvailable()) return '🔌 Enka 服务未就绪，请稍后再试';

    try {
      const uidData = await enkaService.fetchUIDData(uid);
      if (!uidData || uidData.showcase.length === 0) {
        return `UID ${uid} 未找到展柜数据`;
      }

      const charShowcase = uidData.showcase.find((c: any) => c.characterName === resolved);
      if (!charShowcase) {
        const charNames = uidData.showcase.map((c: any) => c.characterName).join('、');
        return `UID ${uid} 展柜中未找到「${resolved}」\n展柜角色: ${charNames}`;
      }

      // 转换为面板数据
      const panelData = liangshiService.convertToPanelData(charShowcase, uid, miaoService);
      if (!panelData) return `面板数据转换失败`;

      // 渲染面板图
      const panelImg = await panelRenderer.renderPanel(panelData);
      return panelImg;

    } catch (err: any) {
      return `查询失败: ${err.message}`;
    }
  }

  // 不匹配
  return null;
}

// ==================== 资源管理 ====================

export async function shutdown(): Promise<void> {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  enkaService.shutdown();
  await panelRenderer.shutdown();
  await imageGenerator.shutdown();
  console.log('[GenshinGuide] 资源已释放');
}

// ==================== 辅助函数 ====================

function buildTextGuide(data: GuideData): string {
  const c = data.character;
  const lines: string[] = [];

  lines.push(`📜 ${c.name} · 角色攻略`);
  lines.push(`${'─'.repeat(24)}`);
  lines.push(`稀有度: ${'⭐'.repeat(c.star || 5)}`);
  lines.push(`元素: ${c.elem || '--'}  |  武器: ${c.weapon || '--'}`);

  if (c.baseAttr) {
    lines.push(``);
    lines.push(`📊 基础属性 (Lv.90)`);
    lines.push(`  HP: ${Math.round(c.baseAttr.hp)}  ATK: ${Math.round(c.baseAttr.atk)}  DEF: ${Math.round(c.baseAttr.def)}`);
  }

  if (data.weights) {
    lines.push(``);
    lines.push(`⚖️ 词条权重`);
    const w = data.weights;
    const entries: [string, number][] = [
      ['暴击率', w.cpct], ['暴击伤害', w.cdmg], ['攻击力', w.atk],
      ['元素精通', w.mastery], ['元素伤害', w.dmg], ['生命值', w.hp],
      ['充能效率', w.recharge], ['防御力', w.def], ['物伤', w.phy],
    ];
    for (const [label, val] of entries) {
      if (val > 0) {
        const bar = '█'.repeat(Math.round(val / 10)) + '░'.repeat(10 - Math.round(val / 10));
        lines.push(`  ${label}: ${bar} ${val}`);
      }
    }
  }

  lines.push(``);
  lines.push(`数据来源: miao-plugin · 评分仅供参考`);
  return lines.join('\n');
}
