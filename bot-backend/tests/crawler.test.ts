// 爬虫模块单元测试
import * as Crawler from '../crawler';

// ==================== 工具函数测试 ====================
function testNormalizeSteamId() {
  // SteamID32 → SteamID64 转换
  const result1 = Crawler.normalizeSteamId('123456');
  const expected1 = (123456 + 76561197960265728).toString();
  console.assert(result1 === expected1, `normalizeSteamId(123456) 应为 ${expected1}，实际为 ${result1}`);

  // SteamID64 不变
  const sid64 = '76561199065842465';
  const result2 = Crawler.normalizeSteamId(sid64);
  console.assert(result2 === sid64, `normalizeSteamId(${sid64}) 应不变，实际为 ${result2}`);

  console.log('[PASS] normalizeSteamId');
}

// ==================== 游戏名解析测试 ====================
async function testResolveGameName() {
  const name = await Crawler.resolveGameName(730);
  console.assert(name === 'Counter-Strike 2', `resolveGameName(730) 应为 Counter-Strike 2，实际为 ${name}`);
  console.log('[PASS] resolveGameName(730) =', name);
}

async function testResolveGameNames() {
  const names = await Crawler.resolveGameNames([730, 570, 578080, 1245620]);
  console.assert(names[730] === 'Counter-Strike 2', 'CS2 应命中预热缓存');
  console.assert(names[570] === 'Dota 2', 'Dota 2 应命中预热缓存');
  console.assert(names[1245620] === 'ELDEN RING', 'ELDEN RING 应命中预热缓存');
  console.log('[PASS] resolveGameNames:', Object.keys(names).length, 'games resolved');
}

// ==================== Steam游戏搜索测试 ====================
async function testSearchSteamGames() {
  // 搜索英文名
  const results = await Crawler.searchSteamGames('Counter-Strike 2');
  console.assert(results.length > 0, `searchSteamGames('Counter-Strike 2') 应返回结果，实际为 0`);
  if (results.length > 0) {
    console.log(`[PASS] searchSteamGames: 找到 ${results.length} 个结果，第一个: ${results[0].name} (${results[0].appId})`);
  }

  // 中文搜索
  const cnResults = await Crawler.searchSteamGames('赛博朋克2077');
  console.log(`[INFO] searchSteamGames(中文): 找到 ${cnResults.length} 个结果`);
  if (cnResults.length > 0) {
    console.log(`  第一个: ${cnResults[0].name} (${cnResults[0].appId})`);
  }
}

// ==================== Steam玩家信息测试 ====================
async function testFetchPlayerName() {
  const name = await Crawler.fetchPlayerName('76561199065842465');
  if (name) {
    console.log(`[PASS] fetchPlayerName: ${name}`);
  } else {
    console.log('[WARN] fetchPlayerName: 返回 null（API Key 可能受限或玩家资料私密）');
  }
}

// ==================== Steam游戏时长测试 ====================
async function testFetchTotalPlaytime() {
  const minutes = await Crawler.fetchTotalPlaytimeMinutes('76561199065842465');
  if (minutes >= 0) {
    console.log(`[PASS] fetchTotalPlaytimeMinutes: ${minutes}min (${(minutes / 60).toFixed(1)}h)`);
  } else {
    console.log('[WARN] fetchTotalPlaytimeMinutes: 查询失败（API Key 可能受限或玩家资料私密）');
  }
}

async function testFetchOwnedGames() {
  const games = await Crawler.fetchAllOwnedGames('76561199065842465');
  if (games && games.length > 0) {
    const top3 = games.sort((a, b) => b.playtimeForeverMinutes - a.playtimeForeverMinutes).slice(0, 3);
    console.log(`[PASS] fetchAllOwnedGames: 共 ${games.length} 个游戏，Top3:`);
    for (const g of top3) {
      const name = await Crawler.resolveGameName(g.appId);
      console.log(`  ${name}: ${(g.playtimeForeverMinutes / 60).toFixed(1)}h`);
    }
  } else {
    console.log('[WARN] fetchAllOwnedGames: 返回 null 或空列表');
  }
}

// ==================== 游戏名翻译测试 ====================
async function testTranslateGameName() {
  const translated = await Crawler.translateGameName('赛博朋克2077');
  console.log(`[INFO] translateGameName('赛博朋克2077'): ${translated}`);
  // 应该翻译为 "Cyberpunk 2077"
}

async function testTranslateEnglishName() {
  const result = await Crawler.translateGameName('Counter-Strike 2');
  console.assert(result === 'Counter-Strike 2', `纯英文名不变：${result}`);
  console.log(`[PASS] translateGameName(英文): ${result}`);
}

// ==================== Steam史低爬取测试 ====================
async function testFetchSteamDeals() {
  try {
    const deals = await Crawler.fetchSteamDeals();
    console.log(`[INFO] fetchSteamDeals: 获取到 ${deals.length} 款打折大作`);
    if (deals.length > 0) {
      deals.slice(0, 3).forEach((d, i) => {
        console.log(`  ${i + 1}. ${d.name} -${d.discountPct}% ¥${(d.finalCents / 100).toFixed(0)} (${d.reviews.toLocaleString()} 评价)`);
      });
    }
  } catch (ex: any) {
    console.log(`[WARN] fetchSteamDeals 异常: ${ex.message}`);
  }
}

// ==================== 运行测试 ====================
async function runTests() {
  console.log('===== 爬虫模块单元测试 =====\n');

  // 单元测试
  testNormalizeSteamId();
  await testResolveGameName();
  await testResolveGameNames();

  // 集成测试 (需要网络)
  console.log('\n----- 网络集成测试 -----');
  await testSearchSteamGames();
  await testFetchPlayerName();
  await testFetchOwnedGames();
  await testFetchTotalPlaytime();
  await testTranslateGameName();
  await testTranslateEnglishName();
  await testFetchSteamDeals();

  console.log('\n===== 测试完成 =====');
}

runTests().catch(console.error);
