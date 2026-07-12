// ============================================================
// PanelRenderer — art-template 渲染 + Playwright 截图
//
// 使用 liangshi-calc 的 CSS/字体/背景资源
// ============================================================

import { chromium, Browser } from 'playwright';
import fs from 'fs';
import path from 'path';
import template from 'art-template';
import { PanelData } from '../types';

const LIANGSHI_DIR = path.join(__dirname, '..', 'liangshi-data');
const RES_PATH = path.join(LIANGSHI_DIR, 'resources', 'common') + '/';
const MIAO_RES_PATH = path.join(__dirname, '..', 'miao-data', 'meta-gs') + '/';

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserInstance;
}

export class PanelRenderer {

  /** 渲染角色面板图 */
  async renderPanel(data: PanelData): Promise<Buffer> {
    const html = this.buildPanelHTML(data);
    return await this.renderToPng(html, { width: 800, height: 1200 });
  }

  /** 渲染绑定面板图 */
  async renderBindPanel(data: {
    status: 'success' | 'error' | 'list';
    uid?: string;
    message: string;
    bindings?: Array<{ platform: string; label: string; accountId: string }>;
  }): Promise<Buffer> {
    const html = this.buildBindHTML(data);
    return await this.renderToPng(html, { width: 600, height: 400 });
  }

  /** 关闭浏览器 */
  async shutdown(): Promise<void> {
    if (browserInstance) {
      await browserInstance.close();
      browserInstance = null;
    }
  }

  // ==================== 私有方法 ====================

  /** 构建面板 HTML (使用 art-template) */
  private buildPanelHTML(data: PanelData): string {
    // 读取 CSS
    const baseCSS = this.readCSS('base.css');
    const commonCSS = this.readCSS('common.css');
    const tplCSS = this.readCSS('tpl.css');
    const avatarCardCSS = this.readCSSFile('tpl/avatar-card.css');

    // 使用 art-template 渲染角色卡片
    const avatarCardHTML = this.renderTemplate('tpl/avatar-card.html', {
      $data: [this.buildAvatarData(data), { _res_path: MIAO_RES_PATH, cardType: 'wide' }],
    });

    // 构建完整 HTML
    const elemClass = data.elem || 'pyro';

    return `<!DOCTYPE html>
<html lang="zh-cn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800">
<style>
${baseCSS}
${commonCSS}
${tplCSS}
${avatarCardCSS}
${this.getPanelCSS()}
</style>
</head>
<body class="elem-${elemClass} default-mode">
<div class="container panel-container">

  <!-- 角色头部 -->
  <div class="panel-header">
    <div class="char-name-block">
      <h1 class="char-name">${data.characterName}</h1>
      <div class="char-info">
        <span>UID ${data.uid}</span>
        <span>Lv.${data.level}</span>
        <span>${data.constellation}命</span>
      </div>
    </div>
  </div>

  <!-- 属性面板 -->
  <div class="panel-stats">
    ${this.buildStatsHTML(data)}
  </div>

  <!-- 圣遗物评分 -->
  <div class="panel-score">
    <div class="score-total">
      <span class="score-label">圣遗物总分</span>
      <span class="score-value">${data.score.averageScore.toFixed(1)}</span>
      <span class="score-grade grade-${data.score.grade}">${data.score.grade}</span>
    </div>
  </div>

  <!-- 5件圣遗物 -->
  <div class="panel-artifacts">
    ${data.artifacts.map((art, i) => this.buildArtifactHTML(art, i)).join('\n')}
  </div>

  <!-- 伤害计算 -->
  <div class="panel-damage">
    <h3>伤害计算</h3>
    <table class="damage-table">
      <thead>
        <tr><th>伤害类型</th><th>暴击伤害</th><th>期望伤害</th></tr>
      </thead>
      <tbody>
        ${data.damages.map(d => `
        <tr>
          <td>${d.title}</td>
          <td class="damage-value">${d.critDamage.toLocaleString()}</td>
          <td class="damage-value">${d.expectedDamage.toLocaleString()}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="copyright">Created By Xingye-Bot & Liangshi-Calc</div>
</div>
</body>
</html>`;
  }

  /** 构建属性 HTML */
  private buildStatsHTML(data: PanelData): string {
    const stats = [
      { label: '生命值', icon: '❤', ...data.stats.hp, color: '#66aa66', suffix: '' },
      { label: '攻击力', icon: '⚔', ...data.stats.atk, color: '#ffcc00', suffix: '' },
      { label: '防御力', icon: '🛡', ...data.stats.def, color: '#888888', suffix: '' },
      { label: '元素精通', icon: '✦', ...data.stats.mastery, color: '#44cc44', suffix: '' },
      { label: '暴击率', icon: '✧', ...data.stats.cpct, color: '#ff4444', suffix: '%' },
      { label: '暴击伤害', icon: '💥', ...data.stats.cdmg, color: '#ff8800', suffix: '%' },
      { label: '元素充能', icon: '⚡', ...data.stats.recharge, color: '#4488ff', suffix: '%' },
      { label: '伤害加成', icon: '🔥', ...data.stats.dmgBonus, color: '#cc44ff', suffix: '%' },
    ];

    return stats.map(s => `
      <div class="stat-row">
        <span class="stat-icon">${s.icon}</span>
        <span class="stat-label">${s.label}</span>
        <span class="stat-total">${s.total.toFixed(s.suffix ? 1 : 0)}${s.suffix || ''}</span>
        <span class="stat-detail">
          <span class="stat-base">${s.base}${s.suffix || ''}</span>
          <span class="stat-bonus" style="color:${s.color}">+${s.bonus.toFixed(s.suffix ? 1 : 0)}${s.suffix || ''}</span>
        </span>
      </div>`).join('');
  }

  /** 构建单件圣遗物 HTML */
  private buildArtifactHTML(art: any, index: number): string {
    const slotNames: Record<string, string> = {
      flower: '生之花', plume: '死之羽', sands: '时之沙', goblet: '空之杯', circlet: '理之冠',
    };
    const gradeClass = `grade-${art.score.grade}`;

    return `
    <div class="artifact-card ${gradeClass}">
      <div class="art-header">
        <span class="art-slot">${slotNames[art.slotKey] || art.slotKey}</span>
        <span class="art-set">${art.setName}</span>
        <span class="art-score">${art.score.totalScore.toFixed(1)} - ${art.score.grade}</span>
      </div>
      <div class="art-main">
        <span class="art-main-stat">${art.mainStat.label} +${art.mainStat.value}${art.mainStat.label.includes('%') ? '' : ''}</span>
      </div>
      <div class="art-substats">
        ${art.subStats.map((sub: any) => `
          <div class="art-substat">
            <span class="sub-label">${sub.label}</span>
            <span class="sub-value">+${sub.value}${sub.label.includes('%') ? '' : ''}</span>
            ${sub.weight > 0 ? `<span class="sub-weight" style="color:${sub.weight >= 80 ? '#ff4444' : sub.weight >= 50 ? '#ffaa00' : '#888'}">${sub.weight}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>`;
  }

  /** 构建 avatar 数据 (供 art-template 使用) */
  private buildAvatarData(data: PanelData): any {
    return {
      name: data.characterName,
      abbr: data.characterName,
      star: data.star,
      elem: data.elem,
      level: data.level,
      cons: data.constellation,
      face: `character/${data.characterName}/imgs/face.webp`,
      gacha: `character/${data.characterName}/imgs/gacha.webp`,
      talent: {
        a: { level: data.talents.a, original: 10 },
        e: { level: data.talents.e, original: 10 },
        q: { level: data.talents.q, original: 10 },
      },
      weapon: {
        name: data.weapon.name,
        star: data.weapon.star,
        level: data.weapon.level,
        affix: data.weapon.affix,
        img: '',
      },
      artisSet: { names: [], imgs: [] },
    };
  }

  /** art-template 渲染 */
  private renderTemplate(tplPath: string, data: any): string {
    const fullPath = path.join(LIANGSHI_DIR, 'resources', 'common', tplPath);
    if (!fs.existsSync(fullPath)) return '';
    try {
      return template(fullPath, data);
    } catch {
      return '';
    }
  }

  /** 读取 CSS 文件 */
  private readCSS(filename: string): string {
    const cssPath = path.join(LIANGSHI_DIR, 'resources', 'common', filename);
    if (!fs.existsSync(cssPath)) return '';
    return fs.readFileSync(cssPath, 'utf8');
  }

  private readCSSFile(relPath: string): string {
    const cssPath = path.join(LIANGSHI_DIR, 'resources', 'common', relPath);
    if (!fs.existsSync(cssPath)) return '';
    return fs.readFileSync(cssPath, 'utf8');
  }

  /** 面板专用 CSS */
  private getPanelCSS(): string {
    return `
    .panel-container { width: 800px; padding: 20px; background: #1a1a2e; color: #e0e0e0; font-family: 'Microsoft YaHei', sans-serif; }
    .panel-header { text-align: center; margin-bottom: 20px; }
    .char-name { font-size: 32px; font-weight: 700; color: #fff; }
    .char-info { font-size: 14px; color: rgba(255,255,255,0.6); margin-top: 4px; }
    .char-info span { margin: 0 8px; }

    .panel-stats { margin-bottom: 16px; }
    .stat-row { display: flex; align-items: center; padding: 6px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .stat-icon { width: 24px; text-align: center; }
    .stat-label { width: 70px; font-size: 13px; color: rgba(255,255,255,0.7); }
    .stat-total { width: 80px; font-size: 16px; font-weight: 700; color: #fff; font-family: 'tttgbnumber', monospace; }
    .stat-detail { flex: 1; text-align: right; font-size: 12px; }
    .stat-base { color: rgba(255,255,255,0.4); margin-right: 8px; }
    .stat-bonus { font-family: 'tttgbnumber', monospace; }

    .panel-score { text-align: center; margin: 16px 0; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; }
    .score-label { font-size: 14px; color: rgba(255,255,255,0.6); margin-right: 12px; }
    .score-value { font-size: 28px; font-weight: 700; color: #fff; font-family: 'tttgbnumber', monospace; }
    .score-grade { font-size: 20px; font-weight: 700; margin-left: 12px; }
    .grade-ACE { color: #ffd700; } .grade-SS { color: #ff8800; } .grade-S { color: #ff4444; }
    .grade-A { color: #cc44ff; } .grade-B { color: #4488ff; } .grade-C { color: #888; }

    .panel-artifacts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
    .artifact-card { background: rgba(255,255,255,0.05); border-radius: 8px; padding: 10px; border-left: 3px solid #533483; }
    .artifact-card.grade-ACE { border-left-color: #ffd700; }
    .artifact-card.grade-SS { border-left-color: #ff8800; }
    .artifact-card.grade-S { border-left-color: #ff4444; }
    .art-header { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 6px; }
    .art-slot { color: rgba(255,255,255,0.5); }
    .art-set { color: rgba(255,255,255,0.7); }
    .art-score { font-weight: 700; }
    .art-main { font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 6px; }
    .art-substats { font-size: 11px; }
    .art-substat { display: flex; justify-content: space-between; padding: 2px 0; color: rgba(255,255,255,0.7); }
    .sub-weight { font-weight: 700; width: 24px; text-align: right; }

    .panel-damage { margin-top: 16px; }
    .panel-damage h3 { font-size: 16px; color: #fff; margin-bottom: 8px; }
    .damage-table { width: 100%; border-collapse: collapse; }
    .damage-table th, .damage-table td { padding: 8px 12px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 13px; }
    .damage-table th { color: rgba(255,255,255,0.5); font-weight: 600; }
    .damage-value { font-family: 'tttgbnumber', monospace; font-weight: 700; color: #fff; }

    .copyright { text-align: center; margin-top: 16px; font-size: 11px; color: rgba(255,255,255,0.3); }
    `;
  }

  /** 构建绑定面板 HTML */
  private buildBindHTML(data: {
    status: string;
    uid?: string;
    message: string;
    bindings?: Array<{ platform: string; label: string; accountId: string }>;
  }): string {
    const statusColors: Record<string, string> = {
      success: '#44cc44', error: '#ff4444', list: '#4488ff',
    };
    const statusIcons: Record<string, string> = {
      success: '✅', error: '❌', list: '📋',
    };

    return `<!DOCTYPE html>
<html lang="zh-cn">
<head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Microsoft YaHei', sans-serif; background: #1a1a2e; color: #e0e0e0; width: 600px; padding: 24px; }
.bind-card { background: linear-gradient(135deg, #16213e, #0f3460); border-radius: 12px; padding: 24px; }
.bind-status { text-align: center; margin-bottom: 16px; }
.bind-icon { font-size: 48px; }
.bind-message { font-size: 16px; text-align: center; color: #fff; margin: 12px 0; }
.bind-uid { text-align: center; font-size: 24px; font-weight: 700; color: ${statusColors[data.status]}; font-family: 'tttgbnumber', monospace; }
.bind-list { margin-top: 16px; }
.bind-item { display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.05); border-radius: 6px; margin-bottom: 4px; font-size: 13px; }
.bind-platform { color: rgba(255,255,255,0.5); }
.bind-account { color: #fff; font-family: 'tttgbnumber', monospace; }
.footer { text-align: center; margin-top: 16px; font-size: 11px; color: rgba(255,255,255,0.3); }
</style></head>
<body>
<div class="bind-card">
  <div class="bind-status">
    <div class="bind-icon">${statusIcons[data.status]}</div>
  </div>
  <div class="bind-message">${data.message}</div>
  ${data.uid ? `<div class="bind-uid">UID ${data.uid}</div>` : ''}
  ${data.bindings && data.bindings.length > 0 ? `
  <div class="bind-list">
    ${data.bindings.map(b => `
    <div class="bind-item">
      <span class="bind-platform">${b.label}</span>
      <span class="bind-account">${b.accountId}</span>
    </div>`).join('')}
  </div>` : ''}
  <div class="footer">Xingye-Bot · 原神UID绑定</div>
</div>
</body></html>`;
  }

  /** HTML → PNG */
  private async renderToPng(html: string, viewport: { width: number; height: number }): Promise<Buffer> {
    const b = await getBrowser();
    const page = await b.newPage();
    try {
      await page.setViewportSize(viewport);
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);

      const bodyHeight: number = await page.evaluate('document.body.scrollHeight');
      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: true,
        clip: { x: 0, y: 0, width: viewport.width, height: Math.min(bodyHeight, 3000) },
      });
      return Buffer.from(screenshot);
    } finally {
      await page.close();
    }
  }
}
