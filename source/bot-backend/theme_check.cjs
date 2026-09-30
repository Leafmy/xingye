// 开发期主题截图工具（**仅开发依赖**，不随发布包分发）
//
// 运行期已不再使用 Playwright：攻略/面板截图改由
// genshin-guide/services/browser-render.ts 直连系统 Edge/Chrome 的 CDP 完成。
// 本脚本需要交互式点击（切页、配色方案模拟），因此仍使用 Playwright，
// 它只出现在 devDependencies 中；执行前请在 source/bot-backend 下 npm install。
const { chromium } = require('playwright-core');
const path = require('path');
const OUT = process.env.TEMP || 'C:/Users/Leaf_/AppData/Local/Temp';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--no-proxy-server'] });
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(OUT, `theme_${scheme}_overview.png`) });
    await page.click('.nav-item:has-text("功能管理")', { timeout: 5000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, `theme_${scheme}_settings.png`) });
    await page.close();
    console.log('done:', scheme);
  }
  await browser.close();
})();
