// ============================================================
// 模块 C: 无头浏览器攻略图生成器 (GuideImageGenerator)
//
// 使用 Playwright 渲染 HTML/CSS 模板为 PNG 图片
// ============================================================

import { chromium, Browser } from 'playwright';
import fs from 'fs';
import path from 'path';
import { GuideData } from '../types';

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');

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
    if (browserInstance) {
      await browserInstance.close();
      browserInstance = null;
    }
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
    const b = await getBrowser();
    const page = await b.newPage();

    try {
      await page.setViewportSize(viewport);
      await page.setContent(html, { waitUntil: 'networkidle' });

      // 等待 JS 渲染完成
      await page.waitForTimeout(500);

      // 获取实际内容高度 (Playwright evaluate 在浏览器上下文执行)
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const bodyHeight: number = await page.evaluate('document.body.scrollHeight');

      // 截取完整页面
      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: true,
        clip: {
          x: 0,
          y: 0,
          width: viewport.width,
          height: Math.min(bodyHeight, 2000),
        },
      });

      return Buffer.from(screenshot);
    } finally {
      await page.close();
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
