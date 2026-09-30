// ============================================================
// 模块 C: 无头浏览器攻略图生成器 (GuideImageGenerator)
//
// 使用 HtmlToImage（CDP 直连系统 Edge/Chrome）渲染 HTML/CSS 模板为 PNG 图片
// ============================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import { htmlToImage } from './browser-render';
import { GuideData } from '../types';

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');

let htmlSeq = 0;

/** 把待渲染的 HTML 落盘到临时文件（浏览器按 file:// 加载，相对资源才能解析） */
function writeTempHtml(html: string): string {
  const file = path.join(os.tmpdir(), `xingye-guide-${process.pid}-${++htmlSeq}.html`);
  fs.writeFileSync(file, html, 'utf8');
  return file;
}

export class GuideImageGenerator {

  /** 生成角色攻略图 */
  async generateGuideImage(data: GuideData): Promise<Buffer> {
    const html = await this.renderGuideTemplate(data);
    return await this.renderToPng(html, { width: 800, height: 600 });
  }

  /** 生成圣遗物评级图 */
  async generateScoreImage(data: GuideData): Promise<Buffer> {
    const html = await this.renderScoreTemplate(data);
    return await this.renderToPng(html, { width: 800, height: 500 });
  }

  /** 关闭浏览器实例 */
  async shutdown(): Promise<void> {
    await htmlToImage.shutdown();
  }

  // ==================== 私有方法 ====================

  /** 渲染攻略模板 */
  private async renderGuideTemplate(data: GuideData): Promise<string> {
    const htmlPath = path.join(TEMPLATE_DIR, 'guide.html');
    const cssPath = path.join(TEMPLATE_DIR, 'guide.css');

    let html = fs.readFileSync(htmlPath, 'utf8');
    const css = fs.readFileSync(cssPath, 'utf8');

    // 内联 CSS (Playwright 不处理外部相对路径)
    html = html.replace(
      '<link rel="stylesheet" href="guide.css">',
      `<style>${css}</style>`
    );

    // 注入数据 (替换 JS 中的占位符)
    const charJson = JSON.stringify(data.character || {});
    const weightJson = JSON.stringify(data.weights || {});
    const scoreJson = JSON.stringify(data.scoreResults || []);

    html = html.replace('CHARACTER_DATA_PLACEHOLDER', charJson);
    html = html.replace('WEIGHT_DATA_PLACEHOLDER', weightJson);
    html = html.replace('SCORE_DATA_PLACEHOLDER', scoreJson);

    // 模板变量替换
    html = replaceTemplateVar(html, 'character.name', data.character?.name || '未知');
    html = replaceTemplateVar(html, 'character.title', data.character?.title || '');
    html = replaceTemplateVar(html, 'character.star', String(data.character?.star || 5));
    html = replaceTemplateVar(html, 'character.elem', data.character?.elem || '');
    html = replaceTemplateVar(html, 'character.weapon', data.character?.weapon || '');
    html = replaceTemplateVar(html, 'buildName', data.buildName || '默认');

    return html;
  }

  /** 渲染评分模板 */
  private async renderScoreTemplate(data: GuideData): Promise<string> {
    // 使用攻略模板的评分区块
    return this.renderGuideTemplate(data);
  }

  /** 将 HTML 渲染为 PNG Buffer */
  private async renderToPng(
    html: string,
    viewport: { width: number; height: number }
  ): Promise<Buffer> {
    const file = writeTempHtml(html);
    try {
      return await htmlToImage.renderFile(file, {
        width: viewport.width,
        height: viewport.height,
        scale: 2,
        maxHeight: 2000,
      });
    } finally {
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }
}

/** 替换模板变量 {{xxx.yyy}} */
function replaceTemplateVar(html: string, varPath: string, value: string): string {
  const pattern = new RegExp(`\\{\\{${escapeRegex(varPath)}\\}\\}`, 'g');
  return html.replace(pattern, value);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
