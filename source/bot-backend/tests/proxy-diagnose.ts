// 代理诊断脚本 — 测试 Steam API 连通性
import { ProxyAgent } from 'undici';

const STEAM_PROXY_URL = process.env.STEAM_PROXY_URL || '';
const TEST_STEAM_URL = 'https://store.steampowered.com/api/featuredcategories';

interface DiagResult {
  label: string;
  success: boolean;
  status?: number;
  error?: string;
  timeMs: number;
  bodyPreview?: string;
}

async function diag(label: string, fn: () => Promise<Response>): Promise<DiagResult> {
  const start = Date.now();
  try {
    const resp = await fn();
    const timeMs = Date.now() - start;
    const text = await resp.text();
    return { label, success: true, status: resp.status, timeMs, bodyPreview: text.substring(0, 200) };
  } catch (ex: any) {
    return { label, success: false, error: ex.message, timeMs: Date.now() - start };
  }
}

async function run() {
  console.log('===== Steam API 代理诊断 =====\n');

  // 1. 直连测试
  console.log(`[1/4] 直连 Steam API...`);
  const r1 = await diag('直连', () => fetch(TEST_STEAM_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000)
  }));
  console.log(`      状态: ${r1.success ? `✅ ${r1.status} (${r1.timeMs}ms)` : `❌ ${r1.error}`}`);

  let r2: DiagResult | undefined;
  
  // 2. 代理连接测试 (如果配置了)
  if (STEAM_PROXY_URL) {
    console.log(`\n[2/4] 通过代理 ${STEAM_PROXY_URL} 访问 Steam API...`);
    const proxyAgent = new ProxyAgent(STEAM_PROXY_URL);
    r2 = await diag('代理', async () => {
      const { fetch: uf } = await import('undici');
      return await uf(TEST_STEAM_URL, { dispatcher: proxyAgent, headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) } as any);
    });
    console.log(`      状态: ${r2.success ? `✅ ${r2.status} (${r2.timeMs}ms)` : `❌ ${r2.error}`}`);

    if (r2.success && r2.bodyPreview) {
      const hasSpecials = r2.bodyPreview.includes('specials');
      console.log(`      含特惠数据: ${hasSpecials ? '✅ 是' : '⚠️ 否'}`);
      console.log(`      响应前200字符: ${r2.bodyPreview.substring(0, 120)}...`);
    }
  } else {
    console.log(`\n[2/4] 跳过: STEAM_PROXY_URL 未设置`);
  }

  // 3. 5E API 连通性 (不需要代理)
  console.log(`\n[3/4] 测试 5E API (直连)...`);
  const r3 = await diag('5E', () => fetch('https://arena.5eplay.com', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000)
  }));
  console.log(`      状态: ${r3.success ? `✅ ${r3.status} (${r3.timeMs}ms)` : `❌ ${r3.error}`}`);

  // 4. Steam API Key 测试
  console.log(`\n[4/4] 测试 Steam API Key...`);
  const r4 = await diag('SteamAPI', async () => {
    const apiKey = process.env.STEAM_API_KEY || '';
    if (!apiKey) throw new Error('STEAM_API_KEY is not configured');
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=76561199065842465`;
    if (STEAM_PROXY_URL) {
      const proxyAgent = new ProxyAgent(STEAM_PROXY_URL);
      const { fetch: uf } = await import('undici');
      return uf(url, { dispatcher: proxyAgent, signal: AbortSignal.timeout(10000) } as any);
    }
    return fetch(url, { signal: AbortSignal.timeout(10000) });
  });
  console.log(`      状态: ${r4.success ? `✅ ${r4.status} (${r4.timeMs}ms)` : `❌ ${r4.error}`}`);
  if (r4.success && r4.bodyPreview) {
    const hasPlayers = r4.bodyPreview.includes('players');
    console.log(`      含玩家数据: ${hasPlayers ? '✅ 是' : '⚠️ 否'}`);
  }

  // 结论
  console.log('\n===== 诊断结论 =====');
  const steamOk = STEAM_PROXY_URL ? (typeof r2 !== 'undefined' && r2.success && r2.status === 200) : r1.success;
  const apiOk = r4.success && r4.status === 200;

  if (steamOk && apiOk) {
    console.log('🎉 Steam API 和 Store 均通畅，机器人功能应正常工作！');
  } else if (steamOk && !apiOk) {
    console.log('⚠️ Store 可访问但 Web API Key 失败 — 检查 API Key 是否有效');
  } else if (!steamOk && STEAM_PROXY_URL) {
    console.log('❌ 代理配置后仍无法访问 Steam。请检查:');
    console.log('   1. Flclash 核心 (mihomo) 是否已启动并连接节点');
    console.log('   2. 代理端口是否正确 (当前: ' + STEAM_PROXY_URL + ')');
    console.log('   3. 节点是否能正常访问 Steam 商店');
  } else {
    console.log('❌ 直连不可用，请配置 STEAM_PROXY_URL 环境变量指向你的代理。');
    console.log('   例如: set STEAM_PROXY_URL=http://127.0.0.1:7890');
  }
}

run().catch(console.error);
