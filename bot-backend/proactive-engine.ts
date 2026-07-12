import * as Crawler from './crawler';
import fs from 'fs';
import path from 'path';

type SendGroupMsg = (groupId: number, message: string) => Promise<void>;
type SendPrivateMsg = (userId: number, message: string) => Promise<void>;

// ==================== 配置 ====================
const SteamDealHour = 12;
const SteamDealMinute = 0;
const FiveEReportHour = 1;
const FiveEReportMinute = 0;
const BaselinePath = path.join(__dirname, 'data', '5e_baselines.json');

// ==================== 内部状态 ====================
let isRunning = false;
let cts: AbortController | null = null;
let lastSteamDealDay = '';
let lastFiveEReportDay = '';

// 依赖注入
let _getKnownGroups: (() => number[]) | null = null;
let _getSteamSubscribers: (() => number[]) | null = null;
let _get5EAccounts: (() => Array<{ userId: number; accountId: string; label: string }>) | null = null;
let _sendGroupMessage: SendGroupMsg | null = null;
let _sendPrivateMessage: SendPrivateMsg | null = null;

// 5E 基线缓存
const _5EBaselines: Map<string, string> = new Map();

function load5EBaselines() {
  try {
    if (fs.existsSync(BaselinePath)) {
      const data = JSON.parse(fs.readFileSync(BaselinePath, 'utf8'));
      for (const [k, v] of Object.entries(data)) {
        _5EBaselines.set(k, v as string);
      }
      console.log(`[5E战报] 加载 ${_5EBaselines.size} 条基线记录`);
    }
  } catch {}
}

function save5EBaselines() {
  try {
    const dir = path.dirname(BaselinePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data: Record<string, string> = {};
    _5EBaselines.forEach((v, k) => { data[k] = v; });
    fs.writeFileSync(BaselinePath, JSON.stringify(data, null, 2));
  } catch {}
}

// ==================== 启动/停止 ====================
export function start(
  deps: {
    getKnownGroups: () => number[];
    getSteamSubscribers: () => number[];
    get5EAccounts: () => Array<{ userId: number; accountId: string; label: string }>;
    sendGroupMessage: SendGroupMsg;
    sendPrivateMessage: SendPrivateMsg;
  }
) {
  if (isRunning) return;
  isRunning = true;

  _getKnownGroups = deps.getKnownGroups;
  _getSteamSubscribers = deps.getSteamSubscribers;
  _get5EAccounts = deps.get5EAccounts;
  _sendGroupMessage = deps.sendGroupMessage;
  _sendPrivateMessage = deps.sendPrivateMessage;

  load5EBaselines();
  cts = new AbortController();
  runCronLoop(cts.signal);
  console.log(`[主动引擎] 已就绪 | Steam 推送: ${SteamDealHour}:${String(SteamDealMinute).padStart(2, '0')} | 5E 战报: ${FiveEReportHour}:${String(FiveEReportMinute).padStart(2, '0')}`);
}

export function stop() {
  isRunning = false;
  cts?.abort();
}

// ==================== Cron 调度 ====================
async function runCronLoop(signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      const now = new Date();
      const todayKey = now.toISOString().split('T')[0];

      // Steam 史低 (每天 12:00)
      if (now.getHours() === SteamDealHour && now.getMinutes() >= SteamDealMinute && now.getMinutes() < SteamDealMinute + 2
        && lastSteamDealDay !== todayKey) {
        lastSteamDealDay = todayKey;
        runSteamDealBroadcast().catch(e => console.error('[Steam雷达] 广播异常:', e));
      }

      // 5E 战报 (每天 1:00)
      if (now.getHours() === FiveEReportHour && now.getMinutes() >= FiveEReportMinute && now.getMinutes() < FiveEReportMinute + 2
        && lastFiveEReportDay !== todayKey) {
        lastFiveEReportDay = todayKey;
        runFiveENightlyReport().catch(e => console.error('[5E战报] 日报异常:', e));
      }
    } catch {}

    await new Promise(r => setTimeout(r, 30000));
  }
}

// ==================== Steam 史低广播 ====================
export async function runSteamDealBroadcast(targetUserId = 0) {
  try {
    const deals = await Crawler.fetchSteamDeals();

    const now = new Date();
    const dateStr = `${now.getMonth() + 1}月${now.getDate()}日`;

    if (deals.length === 0) {
      const noDealMsg = `🎮 Steam 大作史低雷达\n\n📅 ${dateStr}\n🔍 筛选条件: 原价≥¥${MinOriginalPriceCents / 100} | 评价≥1万\n━━━━━━━━━━━━━━━━━━\n😴 今天没有符合条件的大作打折呢…\n   换个时间再看看吧~`;

      if (targetUserId !== 0) {
        await _sendPrivateMessage?.(targetUserId, noDealMsg);
      } else if (_getKnownGroups) {
        const groups = _getKnownGroups();
        for (const gid of groups) {
          try { await _sendGroupMessage?.(gid, noDealMsg); } catch {}
          await new Promise(r => setTimeout(r, 500));
        }
      }
      return;
    }

    const top = deals.sort((a, b) => b.discountPct - a.discountPct).slice(0, MaxDealsToPush);

    const sb: string[] = [];
    sb.push('🎮 Steam 大作史低雷达');
    sb.push(`📅 ${dateStr} · 筛选条件: 原价≥¥${MinOriginalPriceCents / 100} 评价≥1万`);
    sb.push('━━━━━━━━━━━━━━━━━━');
    top.forEach((d, i) => {
      const priceStr = `¥${(d.finalCents / 100).toFixed(0)}`;
      const origStr = `¥${(d.originalCents / 100).toFixed(0)}`;
      const reviewStr = d.reviews >= 10000 ? `${(d.reviews / 10000).toFixed(0)}万` : `${d.reviews}`;
      sb.push(`${i + 1}. ${d.name}`);
      sb.push(`   ${origStr} → ${priceStr} | -${d.discountPct}% | 👍${reviewStr}`);
    });
    sb.push(`\n🤖 本雷达由星野主动引擎自动播报`);
    const message = sb.join('\n');

    if (targetUserId !== 0) {
      // 按需唤醒
      const onDemandMsg = '🎮 即时 Steam 特惠查询\n\n' + message;
      await _sendPrivateMessage?.(targetUserId, onDemandMsg);
    } else {
      // 广播所有群
      const groups = _getKnownGroups?.() || [];
      let pushed = 0;
      for (const gid of groups) {
        try {
          await _sendGroupMessage?.(gid, message);
          pushed++;
          await new Promise(r => setTimeout(r, 500));
        } catch {}
      }

      // 私聊通知订阅者
      const subscribers = _getSteamSubscribers?.() || [];
      const dmMsg = '🎮 Steam 大作史低来啦~\n\n' + message;
      for (const uid of subscribers) {
        try {
          await _sendPrivateMessage?.(uid, dmMsg);
        } catch {}
        await new Promise(r => setTimeout(r, 300));
      }

      console.log(`[Steam雷达] ✅ 完成: ${pushed}/${groups.length} 个群 + ${subscribers.length} 个订阅者私聊, ${top.length} 款游戏`);
    }
  } catch (ex: any) {
    console.error(`[Steam雷达] 异常: ${ex.message}`);
  }
}

const MinOriginalPriceCents = 6000;
const MinReviewCount = 10000;
const MaxDealsToPush = 8;

// ==================== 5E 上分日报 ====================
export async function runFiveENightlyReport() {
  try {
    const accounts = _get5EAccounts?.() || [];
    if (accounts.length === 0) {
      console.log('[5E战报] 无绑定账号，跳过');
      return;
    }

    console.log(`[5E战报] 开始生成 ${accounts.length} 个账号的日报...`);

    const reports: Array<{ userId: number; accountId: string; label: string; delta: string }> = [];

    for (const { userId, accountId, label } of accounts) {
      try {
        const stats = await Crawler.fetch5EStats(accountId);

        const baselineKey = accountId;
        let deltaDesc = '首次记录，无历史对照';
        if (_5EBaselines.has(baselineKey)) {
          const prevStats = _5EBaselines.get(baselineKey)!;
          deltaDesc = compute5EDelta(prevStats, stats);
        }
        if (stats) _5EBaselines.set(baselineKey, stats);

        reports.push({ userId, accountId, label, delta: deltaDesc });
      } catch {}
    }

    save5EBaselines();

    // 按用户分组，私聊推送
    const grouped: Map<number, typeof reports> = new Map();
    for (const r of reports) {
      if (!grouped.has(r.userId)) grouped.set(r.userId, []);
      grouped.get(r.userId)!.push(r);
    }

    for (const [uid, userReports] of grouped) {
      const sb: string[] = [];
      sb.push('🌙 5E 上分日报');
      sb.push(`📅 ${new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} 凌晨自动生成`);
      sb.push('━━━━━━━━━━━━━━━━━━');
      for (const r of userReports) {
        sb.push(`\n📊 ${r.label} (${r.accountId})`);
        sb.push(`   变动: ${r.delta}`);
      }
      sb.push('\n🤖 本战报由星野主动引擎自动生成');
      try {
        await _sendPrivateMessage?.(uid, sb.join('\n'));
      } catch {}
    }

    console.log(`[5E战报] ✅ 完成: 生成 ${reports.length} 份报告, 推送到 ${grouped.size} 人`);
  } catch (ex: any) {
    console.error(`[5E战报] 异常: ${ex.message}`);
  }
}

// 按需唤醒来执行 5E 战报
export async function run5EReportForUser(userId: number) {
  const accounts = _get5EAccounts?.() || [];
  const userAccounts = accounts.filter(a => a.userId === userId);
  if (userAccounts.length === 0) {
    await _sendPrivateMessage?.(userId, '你还没有绑定 5E 账号！发送「绑定5e 玩家ID」先绑定吧~');
    return;
  }

  const sb: string[] = [];
  sb.push('🌙 5E 即时战报');
  sb.push(`📅 ${new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 手动生成`);
  sb.push('━━━━━━━━━━━━━━━━━━');

  for (const { userId: uid, accountId, label } of userAccounts) {
    let stats: string;
    try {
      stats = await Crawler.fetch5EStats(accountId);
    } catch (ex: any) {
      stats = `查询失败: ${ex.message}`;
    }

    const baselineKey = accountId;
    let delta = '无历史数据';
    if (_5EBaselines.has(baselineKey)) {
      delta = compute5EDelta(_5EBaselines.get(baselineKey)!, stats);
    }
    _5EBaselines.set(baselineKey, stats);

    sb.push(`\n📊 ${label} (${accountId})`);
    sb.push(`   ${delta}`);
  }
  save5EBaselines();
  sb.push('\n🤖 手动唤醒战报');
  await _sendPrivateMessage?.(userId, sb.join('\n'));
}

function compute5EDelta(prev: string, current: string): string {
  if (prev === current) return '无变化';

  const deltas: string[] = [];

  // MMR/ELO 变化
  const mmrRegex = /(\d{3,5})\s*(分|MMR|ELO|elo)/;
  const prevMatch = prev.match(mmrRegex);
  const currMatch = current.match(mmrRegex);
  if (prevMatch && currMatch) {
    const prevMmr = Number(prevMatch[1]);
    const currMmr = Number(currMatch[1]);
    if (!isNaN(prevMmr) && !isNaN(currMmr)) {
      const diff = currMmr - prevMmr;
      deltas.push(`MMR: ${diff >= 0 ? '+' : ''}${diff}`);
    }
  }

  // 胜率变化
  const wrRegex = /(\d{1,2}\.\d?)%?\s*(胜率|Win)/i;
  const prevWr = prev.match(wrRegex);
  const currWr = current.match(wrRegex);
  if (prevWr && currWr) {
    const prevRate = Number(prevWr[1]);
    const currRate = Number(currWr[1]);
    if (!isNaN(prevRate) && !isNaN(currRate)) {
      const diff = currRate - prevRate;
      deltas.push(`胜率: ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`);
    }
  }

  return deltas.length > 0 ? deltas.join(', ') : '已更新 (细节请手动查看)';
}
