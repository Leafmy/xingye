import express from 'express';
import cors from 'cors';
import WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import * as BiliVideo from './bili-video';
import * as Crawler from './crawler';
import * as ProactiveEngine from './proactive-engine';
import { TaskManager } from './task-queue';
import * as GenshinGuide from './genshin-guide/index';

const execFileAsync = promisify(execFile);

const app = express();
app.use(cors());
app.use(express.json());
// 静态文件托管（panel-frontend 构建产物）
app.use(express.static(path.join(__dirname, '..', 'panel-frontend', 'dist')))

// ================= Configuration =================
const BOT_QQ = 3853499326;
const ADMIN_QQ = 2994832083;
const AI_ENDPOINT = 'https://api.xiaomimimo.com/v1/chat/completions';
const AI_API_KEY = process.env.MIMO_API_KEY || '';
const AI_MODEL = 'mimo-v2.5';
const DOUBAO_ENDPOINT = process.env.DOUBAO_ENDPOINT || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY || '';
const DOUBAO_DRAW_MODEL = process.env.DOUBAO_DRAW_MODEL || 'ep-20260505205937-zj4t6';
const SNOWLUNA_WS = 'ws://127.0.0.1:3001';
const WAKE_WORDS = ['星野'];

const APP_ROOT = process.env.XINGYE_APP_DIR || (
  fs.existsSync(path.join(__dirname, '..', 'version.json'))
    ? path.resolve(__dirname, '..')
    : path.resolve(__dirname, '..', '..')
);

function getGithubRepo(): string {
  if (process.env.XINGYE_GITHUB_REPO) return process.env.XINGYE_GITHUB_REPO;
  try {
    const version = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'version.json'), 'utf8'));
    return version.githubRepo || '';
  } catch {
    return '';
  }
}

function createUpdater(): any {
  const Updater = require(path.join(APP_ROOT, 'updater', 'updater.js'));
  return new Updater({ appDir: APP_ROOT, githubRepo: getGithubRepo() });
}

// ================= Dashboard WebSocket Server =================
const dashboardClients = new Set<WebSocket>();
const MAX_LOG_HISTORY = 500;
const logHistory: Array<{ timestamp: string; level: string; message: string }> = [];
const processedMessages = new Set<number>();
const MESSAGE_DEDUP_WINDOW_MS = 5000;
const pendingResponses = new Map<string, { resolve: (value: any) => void; reject: (reason: any) => void; timer: NodeJS.Timeout }>();

// Log capture - intercept console output
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

function captureLog(level: string, args: any[]) {
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const entry = { timestamp, level, message };
  
  logHistory.push(entry);
  if (logHistory.length > MAX_LOG_HISTORY) logHistory.shift();
  
  // Broadcast to dashboard clients
  broadcastToDashboard({ type: 'log', data: entry });
}

console.log = (...args: any[]) => { originalLog(...args); captureLog('info', args); };
console.error = (...args: any[]) => { originalError(...args); captureLog('error', args); };
console.warn = (...args: any[]) => { originalWarn(...args); captureLog('warn', args); };
console.info = (...args: any[]) => { originalInfo(...args); captureLog('info', args); };

function broadcastToDashboard(message: any) {
  const data = JSON.stringify(message);
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function sendMetricsToDashboard() {
  const memUsage = process.memoryUsage();
  const metrics = {
    uptime: Math.floor((Date.now() - botStatus.startTime) / 1000),
    memoryMB: Math.round(memUsage.rss / 1024 / 1024),
    gcMemoryMB: Math.round(memUsage.heapUsed / 1024 / 1024),
    totalAiRequests: botStatus.aiRequests,
    totalAiErrors: botStatus.aiErrors,
    commandsHandled: botStatus.commandsHandled,
    sessionMessages: botStatus.sessionMessages,
    totalMessages: persistentStats.totalMessages,
    connectedGroups: groupNameCache.size || knownGroups.size,
    boundUsers: playerBindings.size,
    steamSubscribers: steamSubscriptions.size,
    activeWsConnections: dashboardClients.size,
    timestamp: new Date().toISOString()
  };
  broadcastToDashboard({ type: 'metrics', data: metrics });
}

// Metrics push loop (every 2 seconds)
setInterval(sendMetricsToDashboard, 2000);

// Persist stats periodically (every 60 seconds)
setInterval(() => {
  savePersistentStats();
}, 60000);

// CLI command handler
function handleCliCommand(command: string): string {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  
  switch (cmd) {
    case '/status':
      return JSON.stringify({
        online: botStatus.isOnline,
        uptime: Math.floor((Date.now() - botStatus.startTime) / 1000),
        sessionMessages: botStatus.sessionMessages,
        totalMessages: persistentStats.totalMessages,
        aiRequests: botStatus.aiRequests,
        aiErrors: botStatus.aiErrors,
        commands: botStatus.commandsHandled,
        groups: knownGroups.size,
        bindings: playerBindings.size,
        subscriptions: steamSubscriptions.size
      }, null, 2);
    
    case '/say':
      const targetId = Number(parts[1]);
      const msg = parts.slice(2).join(' ');
      if (!targetId || !msg) return '用法: /say <QQ号> <消息>';
      sendMessage(targetId, msg, '私聊');
      return `已发送给 ${targetId}`;
    
    case '/help':
      return `可用命令:
/status - 查看运行状态
/say <QQ号> <消息> - 发送私聊消息
/restart - 重启 Bot
/help - 显示帮助`;
    
    case '/restart':
      setTimeout(() => process.exit(0), 500);
      return '正在重启...';
    
    default:
      return `未知命令: ${cmd}。输入 /help 查看可用命令。`;
  }
}

// ================= Bot State =================
interface BotStatus {
  isOnline: boolean;
  startTime: number;
  sessionMessages: number;
  lastMessageTime: string;
  aiRequests: number;
  aiErrors: number;
  commandsHandled: number;
  connectedGroups: number;
  boundUsers: number;
  steamSubscribers: number;
}

const botStatus: BotStatus = {
  isOnline: false,
  startTime: Date.now(),
  sessionMessages: 0,
  lastMessageTime: '',
  aiRequests: 0,
  aiErrors: 0,
  commandsHandled: 0,
  connectedGroups: 0,
  boundUsers: 0,
  steamSubscribers: 0
};

// ================= Persistent Stats =================
interface PersistentStats {
  totalMessages: number;
  likeQuotaDate?: string;
  likeQuotaUsed?: number;
}

const persistentStatsFile = path.join(__dirname, 'data', 'persistent_stats.json');
let persistentStats: PersistentStats = { totalMessages: 0 };

// ================= Like Feature =================
const likeCooldowns = new Map<number, number>();
const LIKE_COOLDOWN_MS = 30000;
const LIKE_DAILY_LIMIT = 10;

function checkLikeDailyQuota(): { allowed: number; reset: boolean } {
  const today = new Date().toISOString().slice(0, 10);
  if (persistentStats.likeQuotaDate !== today) {
    persistentStats.likeQuotaDate = today;
    persistentStats.likeQuotaUsed = 0;
    savePersistentStats();
    return { allowed: LIKE_DAILY_LIMIT, reset: true };
  }
  return { allowed: Math.max(0, LIKE_DAILY_LIMIT - (persistentStats.likeQuotaUsed || 0)), reset: false };
}

function recordLikeUsed(count: number) {
  const today = new Date().toISOString().slice(0, 10);
  if (persistentStats.likeQuotaDate !== today) {
    persistentStats.likeQuotaDate = today;
    persistentStats.likeQuotaUsed = count;
  } else {
    persistentStats.likeQuotaUsed = (persistentStats.likeQuotaUsed || 0) + count;
  }
  savePersistentStats();
}

function loadPersistentStats() {
  try {
    if (fs.existsSync(persistentStatsFile)) {
      persistentStats = JSON.parse(fs.readFileSync(persistentStatsFile, 'utf8'));
      console.log(`[持久化] 已加载统计: 总消息 ${persistentStats.totalMessages}`);
    }
  } catch (error) {
    console.error('[持久化] 加载失败:', error);
  }
}

function savePersistentStats() {
  try {
    ensureDataDir();
    fs.writeFileSync(persistentStatsFile, JSON.stringify(persistentStats, null, 2));
  } catch (error) {
    console.error('[持久化] 保存失败:', error);
  }
}

// ================= Token Tracking =================
interface DailyTokenStat {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
}

const tokenStatsFile = path.join(__dirname, 'data', 'token_stats.json');
let dailyTokenStats: Map<string, DailyTokenStat> = new Map();

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function loadTokenStats() {
  try {
    if (fs.existsSync(tokenStatsFile)) {
      const data = JSON.parse(fs.readFileSync(tokenStatsFile, 'utf8'));
      for (const [date, stat] of Object.entries(data)) {
        dailyTokenStats.set(date, stat as DailyTokenStat);
      }
      console.log(`[Token追踪] 已加载 ${dailyTokenStats.size} 天的统计数据`);
    }
  } catch (error) {
    console.error('[Token追踪] 加载失败:', error);
  }
}

function saveTokenStats() {
  try {
    ensureDataDir();
    const data: Record<string, DailyTokenStat> = {};
    dailyTokenStats.forEach((value, key) => { data[key] = value; });
    fs.writeFileSync(tokenStatsFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[Token追踪] 保存失败:', error);
  }
}

function recordTokenUsage(inputTokens: number, outputTokens: number) {
  const today = getTodayKey();
  if (!dailyTokenStats.has(today)) {
    dailyTokenStats.set(today, {
      date: today,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requestCount: 0
    });
  }
  const stat = dailyTokenStats.get(today)!;
  stat.inputTokens += inputTokens;
  stat.outputTokens += outputTokens;
  stat.totalTokens += inputTokens + outputTokens;
  stat.requestCount++;
  saveTokenStats();
}

// ================= Group Name Cache =================
const groupNameCache: Map<number, string> = new Map();

function fetchGroupNames() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  // First try get_group_list with no_cache
  const payload = {
    action: 'get_group_list',
    params: { no_cache: true },
    echo: `grouplist_${Date.now()}`
  };
  
  ws.send(JSON.stringify(payload));
  console.log('[群组] 正在获取群列表 (no_cache)...');
}

function handleGroupInfoResponse(data: any) {
  if (data && data.data) {
    const group = data.data;
    if (group.group_id) {
      const name = group.group_name || group.name || '';
      groupNameCache.set(group.group_id, name || `群组 ${group.group_id}`);
      console.log(`[群组] 获取群名: ${group.group_id} = ${name || '(空)'}`);
    }
  }
}

function handleGroupListResponse(data: any) {
  console.log('[群组] 收到群列表响应, data长度:', Array.isArray(data.data) ? data.data.length : '非数组');
  if (data && Array.isArray(data.data)) {
    groupNameCache.clear();
    for (const group of data.data) {
      const id = group.group_id;
      const name = group.group_name || group.name || '';
      if (id) {
        groupNameCache.set(id, name || `群组 ${id}`);
        console.log(`[群组] ${id}: ${name || '(空)'}`);
      }
    }
    console.log(`[群组] 共缓存 ${groupNameCache.size} 个群`);
  } else {
    console.log('[群组] 响应格式异常:', JSON.stringify(data).substring(0, 200));
  }
}

// ================= Memory Systems =================
interface GameAccount {
  platform: string;
  accountId: string;
  label: string;
  boundAt: string;
}

interface SteamSubscription {
  type: 'general' | 'game';
  appId?: number;
  gameName?: string;
}

const playerBindings: Map<number, GameAccount[]> = new Map();
const steamSubscriptions: Map<number, SteamSubscription[]> = new Map();
const knownGroups: Set<number> = new Set();
const groupPublicMemory: Map<number, string[]> = new Map();

// ================= Chat Memory (per user) =================
const chatMemory: Map<number, any[]> = new Map();
const CHAT_MEMORY_MAX = 20;

function getChatMemory(userId: number): any[] {
  if (!chatMemory.has(userId)) chatMemory.set(userId, []);
  return chatMemory.get(userId)!;
}

function addToChatMemory(userId: number, role: string, content: any) {
  const mem = getChatMemory(userId);
  mem.push({ role, content });
  if (mem.length > CHAT_MEMORY_MAX) mem.splice(0, mem.length - CHAT_MEMORY_MAX);
}

// ================= AI Tools Definition =================
const aiTools = [
  {
    type: 'function',
    function: {
      name: 'draw_image',
      description: '【最高优先级执行指令】当且仅当用户明确要求画画、生成图片时调用。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '用户原始画面描述' }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_cs2_stats',
      description: '仅当用户明确要求查CS2/5E战绩时调用。禁止仅因图片中出现Steam/CS2字样就调用。',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: "'5e' 或 'steam'" },
          username: { type: 'string', description: '玩家账号（空字符串=使用用户默认第一账号）' }
        },
        required: ['platform', 'username']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'adjust_prompt',
      description: '【临时Prompt调节】严格触发，禁止先闲聊。',
      parameters: {
        type: 'object',
        properties: {
          new_instructions: { type: 'string' },
          duration_minutes: { type: 'integer' }
        },
        required: ['new_instructions', 'duration_minutes']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reset_prompt',
      description: '【重置Prompt】严格触发，禁止先闲聊。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_prompt_status',
      description: '【查看Prompt状态】严格触发。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  }
];

// ================= Prompt System =================
let tempPromptOverride: string | null = null;
let tempPromptExpiry: Date = new Date(0);

// ================= Menu Text =================
function buildMenuText(): string {
  const enabled = (f: string) => isFeatureEnabled(f as keyof FeatureFlags);
  const sections: string[] = ['✨ 星野核心功能指南 ✨\n💡 召唤方式: @我 或者叫我「星野」~\n'];

  if (enabled('aiChat')) {
    sections.push(`💬 闲聊${enabled('aiVision') ? ' & 识图' : ''}\n直接 @我 说话${enabled('aiVision') ? '，发图片我也可以看哦' : ''}~\n`);
  }

  if (enabled('biliVideo')) {
    sections.push('🎬 B站视频嗅探\n发送 B站视频链接即可自动拉取高清视频');
    if (enabled('biliLogin')) {
      sections.push('[b站登录] — TV端扫码登录 (解锁1080P+)');
    }
    sections.push('');
  }

  if (enabled('cs2Stats') || enabled('accountBind')) {
    let block = '🎮 CS2 战绩\n';
    if (enabled('cs2Stats')) block += '[查询5e战绩] — 查5E对战平台数据\n[查询官匹战绩] — 查Steam官匹数据\n';
    if (enabled('accountBind')) block += '[绑定5e 玩家ID] — 绑定5E账号（支持 [标签]）\n[绑定steam SteamID] — 绑定Steam账号（支持 [标签]）\n[解绑5e 玩家ID] — 解绑5E账号\n[解绑steam SteamID] — 解绑Steam账号\n[查看绑定] — 查看已绑定账号列表\n';
    sections.push(block + '');
  }

  if (enabled('steamPlaytime')) {
    sections.push(`⏱️ Steam 游戏时长
[查询steam游戏时长] — 个人总时长 Top10
[查询steam游戏时长排行] — 群友总时长排名
[查询steam最近游戏时长] — 个人近两周 Top10
[查询steam最近游戏时长排行] — 群友近两周排名
`);
  }

  if (enabled('steamSubscribe') || enabled('steamDealReport')) {
    let block = '📦 Steam 史低订阅\n';
    if (enabled('steamSubscribe')) block += '[订阅steam] — 每天中午私聊推送大作折扣\n[取消订阅steam] — 不再接收总促销推送\n[订阅游戏 游戏名/AppID] — 特定游戏打折时通知你\n[取消订阅游戏 名称/AppID] — 取消特定游戏订阅\n[查看订阅] — 看看订阅了哪些\n';
    if (enabled('steamDealReport')) block += '[查询促销] — 立刻拉取 Steam 特惠 (私聊)\n[今日战报] — 立刻生成 5E 上分战报 (私聊)\n';
    sections.push(block + '');
  }

  if (enabled('promptControl')) {
    sections.push(`🎭 临时调节本小姐的性格
[调整prompt 分钟数 内容] — 限时改变我的行为
[重置prompt] — 恢复默认性格
[查看prompt] — 看当前有没有临时设定
`);
  }

  if (enabled('genshinGuide')) {
    sections.push(`⚔️ 原神攻略（无需唤醒词）
绑定uid UID — 绑定原神UID
解绑uid UID — 解绑原神UID
gs 角色名 — 生成角色攻略图
角色名面板 — 查看角色面板（如: 胡桃面板）
`);
  }

  sections.push(`❤️ 互动
[赞我] — 让本小姐给你的 QQ 资料卡点个赞~
`);

  sections.push(`🛠️ 系统管理 (仅大叔可用)
@bot 查看当前状态 — 查看Bot运行状态
@bot 更新 — 触发增量热更新 (全群广播)
@bot 静默更新 — 触发增量热更新 (不广播)
@bot 重启 — 触发应急重启
`);

  return sections.join('\n');
}

// ================= Menu Cooldown =================
const menuCooldowns: Map<number, number> = new Map();
const MENU_COOLDOWN_SECONDS = 10;

function canSendMenu(groupId: number): boolean {
  const lastSend = menuCooldowns.get(groupId);
  if (lastSend && (Date.now() - lastSend) / 1000 < MENU_COOLDOWN_SECONDS) {
    return false;
  }
  menuCooldowns.set(groupId, Date.now());
  return true;
}

// ================= Data Persistence =================
const dataDir = path.join(__dirname, 'data');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadBindings() {
  try {
    const filePath = path.join(dataDir, 'player_bindings.json');
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const [userId, accounts] of Object.entries(data)) {
        playerBindings.set(Number(userId), accounts as GameAccount[]);
      }
      console.log(`[记忆中枢] 已加载 ${playerBindings.size} 个玩家的绑定记录`);
    }
  } catch (error) {
    console.error('[记忆中枢] 加载绑定失败:', error);
  }
}

function saveBindings() {
  try {
    ensureDataDir();
    const data: Record<number, GameAccount[]> = {};
    playerBindings.forEach((value, key) => { data[key] = value; });
    fs.writeFileSync(path.join(dataDir, 'player_bindings.json'), JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[记忆中枢] 保存绑定失败:', error);
  }
}

function loadSteamSubscriptions() {
  try {
    const filePath = path.join(dataDir, 'steam_subscriptions.json');
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const [userId, subs] of Object.entries(data)) {
        steamSubscriptions.set(Number(userId), subs as SteamSubscription[]);
      }
      console.log(`[Steam订阅] 已加载 ${steamSubscriptions.size} 个用户的订阅`);
    }
  } catch (error) {
    console.error('[Steam订阅] 加载失败:', error);
  }
}

function saveSteamSubscriptions() {
  try {
    ensureDataDir();
    const data: Record<number, SteamSubscription[]> = {};
    steamSubscriptions.forEach((value, key) => { data[key] = value; });
    fs.writeFileSync(path.join(dataDir, 'steam_subscriptions.json'), JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[Steam订阅] 保存失败:', error);
  }
}

function loadKnownGroups() {
  try {
    const filePath = path.join(dataDir, 'known_groups.txt');
    if (fs.existsSync(filePath)) {
      const lines = fs.readFileSync(filePath, 'utf8').split('\n');
      for (const line of lines) {
        const gid = Number(line.trim());
        if (gid) knownGroups.add(gid);
      }
      console.log(`[更新管理器] 已加载 ${knownGroups.size} 个已知群组`);
    }
  } catch (error) {
    console.error('[更新管理器] 加载群组失败:', error);
  }
}

function saveKnownGroups() {
  try {
    ensureDataDir();
    fs.writeFileSync(path.join(dataDir, 'known_groups.txt'), Array.from(knownGroups).join('\n'));
  } catch (error) {
    console.error('[更新管理器] 保存群组失败:', error);
  }
}

// ================= 好友白名单 =================
const friendWhitelistFile = path.join(__dirname, 'data', 'friend_whitelist.json');
let friendWhitelist: Set<number> = new Set();

function loadFriendWhitelist() {
  try {
    if (fs.existsSync(friendWhitelistFile)) {
      const data = JSON.parse(fs.readFileSync(friendWhitelistFile, 'utf8'));
      if (Array.isArray(data)) {
        friendWhitelist = new Set(data);
        console.log(`[好友白名单] 已加载 ${friendWhitelist.size} 个 QQ`);
      }
    }
  } catch (e) { console.error('[好友白名单] 加载失败:', e); }
}

function saveFriendWhitelist() {
  try {
    ensureDataDir();
    fs.writeFileSync(friendWhitelistFile, JSON.stringify(Array.from(friendWhitelist), null, 2));
  } catch (e) { console.error('[好友白名单] 保存失败:', e); }
}

interface FriendRequest {
  qq: number;
  nickname: string;
  comment: string;
  flag: string;
  status: 'pending' | 'approved' | 'rejected';
  time: string;
  handledAt?: string;
}

const pendingRequestsFile = path.join(__dirname, 'data', 'friend_requests.json');
let friendRequests: FriendRequest[] = [];

function loadFriendRequests() {
  try {
    if (fs.existsSync(pendingRequestsFile)) {
      const data = JSON.parse(fs.readFileSync(pendingRequestsFile, 'utf8'));
      if (Array.isArray(data)) {
        friendRequests = data;
        console.log(`[好友申请] 已加载 ${friendRequests.length} 条记录`);
      }
    }
  } catch (e) { console.error('[好友申请] 加载失败:', e); }
}

function saveFriendRequests() {
  try {
    ensureDataDir();
    fs.writeFileSync(pendingRequestsFile, JSON.stringify(friendRequests, null, 2));
  } catch (e) { console.error('[好友申请] 保存失败:', e); }
}

function sendFriendHandle(flag: string, approve: boolean) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('[好友申请] WebSocket 未连接，无法处理');
    return;
  }
  ws.send(JSON.stringify({
    action: 'set_friend_add_request',
    params: { flag, approve },
    echo: `friend_handle_${Date.now()}`
  }));
}

// ================= Command Handlers =================
function bindAccount(userId: number, platform: string, accountId: string, label: string): string {
  if (!playerBindings.has(userId)) {
    playerBindings.set(userId, []);
  }

  const accounts = playerBindings.get(userId)!;

  // Check duplicate
  if (accounts.some(a => a.platform === platform && a.accountId === accountId)) {
    return `哼，这个${platform.toUpperCase()}账号（${accountId}）已经绑定过了！发送「查看绑定」可以看到列表~`;
  }

  // Auto generate label
  if (!label.trim()) {
    const count = accounts.filter(a => a.platform === platform).length;
    const platLabel = platform === '5e' ? '5E' : 'Steam';
    label = `${platLabel}账号${count === 0 ? '' : (count + 1).toString()}`;
  }

  accounts.push({
    platform,
    accountId,
    label,
    boundAt: new Date().toISOString()
  });

  saveBindings();
  console.log(`[记忆中枢] 用户 ${userId} 绑定 ${platform.toUpperCase()} 账号: ${accountId} (标签: ${label})`);
  return `哼，${platform.toUpperCase()}账号 [${accountId}] 绑定完毕！标签: ${label}\n（发送「查看绑定」可以查看所有已绑定账号，发送「解绑${platform} ${accountId}」可以解绑~）`;
}

function unbindAccount(userId: number, platform: string, accountId: string): string {
  const accounts = playerBindings.get(userId);
  if (!accounts || accounts.length === 0) {
    return '杂鱼~ 你还没有绑定任何账号呢！';
  }

  const targetIndex = accounts.findIndex(a => a.platform === platform && a.accountId === accountId);
  if (targetIndex === -1) {
    return `没找到这个${platform.toUpperCase()}账号（${accountId}）！检查一下 ID 有没有打错？`;
  }

  const target = accounts[targetIndex];
  accounts.splice(targetIndex, 1);

  if (accounts.length === 0) {
    playerBindings.delete(userId);
  }

  saveBindings();
  console.log(`[记忆中枢] 用户 ${userId} 解绑 ${platform.toUpperCase()} 账号: ${accountId} (标签: ${target.label})`);
  return `哼，已解绑${platform.toUpperCase()}账号 [${target.label}: ${accountId}]！`;
}

function buildBindingList(userId: number): string {
  const accounts = playerBindings.get(userId);
  if (!accounts || accounts.length === 0) {
    return '杂鱼~ 你还没有绑定任何账号呢！发送「绑定steam SteamID」或「绑定5e 玩家ID」来绑定吧~';
  }

  let result = '你的已绑定账号：\n';
  accounts.forEach((a, idx) => {
    result += `${idx + 1}. [${a.platform.toUpperCase()}] ${a.label}: ${a.accountId}\n`;
  });
  result += '发送「解绑5e 账号ID」或「解绑steam 账号ID」可以解绑~';
  return result;
}

function handleSteamSubscribe(userId: number): string {
  if (!steamSubscriptions.has(userId)) {
    steamSubscriptions.set(userId, []);
  }

  const subs = steamSubscriptions.get(userId)!;
  if (subs.some(s => s.type === 'general')) {
    return '杂鱼~ 你已经订阅过总促销了！发送「取消订阅steam」可以退订。';
  }

  subs.push({ type: 'general' });
  saveSteamSubscriptions();
  return '哼，已订阅 Steam 大作折扣！每天中午本小姐会私聊通知你~';
}

function handleSteamUnsubscribe(userId: number): string {
  const subs = steamSubscriptions.get(userId);
  if (!subs) {
    return '你还没有任何订阅呢！';
  }

  const removed = subs.filter(s => s.type === 'general').length;
  const newSubs = subs.filter(s => s.type !== 'general');
  
  if (newSubs.length === 0) {
    steamSubscriptions.delete(userId);
  } else {
    steamSubscriptions.set(userId, newSubs);
  }

  saveSteamSubscriptions();
  return removed > 0 ? '已退订总促销。发送「订阅steam」可重新开启~' : '你还没有订阅总促销呢！';
}

function handleGameSubscribe(userId: number, gameArg: string): string {
  // Check if it is an AppID
  const appId = Number(gameArg);
  if (!isNaN(appId) && appId > 0) {
    if (!steamSubscriptions.has(userId)) {
      steamSubscriptions.set(userId, []);
    }

    const subs = steamSubscriptions.get(userId)!;
    if (subs.some(s => s.type === 'game' && s.appId === appId)) {
      return `杂鱼~ AppID ${appId} 你已经订阅过了！`;
    }

    subs.push({ type: 'game', appId, gameName: `AppID ${appId}` });
    saveSteamSubscriptions();
    return `已订阅游戏 AppID ${appId}！`;
  }

  // Game name search is now handled by handleGameNameSearch
  return `请使用 AppID 订阅，或直接发送「订阅游戏 游戏名称」进行搜索~`;
}

function handleViewSubscriptions(userId: number): string {
  const subs = steamSubscriptions.get(userId);
  if (!subs || subs.length === 0) {
    return '你还没有任何 Steam 订阅！\n发送「订阅steam」订阅总促销\n发送「订阅游戏 游戏名或AppID」订阅特定游戏';
  }

  let result = '你的 Steam 订阅列表：\n';
  subs.forEach((s, idx) => {
    if (s.type === 'general') {
      result += `${idx + 1}. 总促销 (每天推送)\n`;
    } else {
      result += `${idx + 1}. 游戏: ${s.gameName || `AppID ${s.appId}`}${s.appId ? ` (AppID ${s.appId})` : ''}\n`;
    }
  });
  result += '发送「取消订阅steam」退订总促销\n发送「取消订阅游戏 名称/AppID」退订特定游戏';
  return result;
}

// ================= Game Search Selection Context =================
interface GameSearchCtx {
  userId: number;
  targetId: number;
  chatType: string;
  results: Array<{ appId: number; name: string }>;
  timestamp: number;
}
const gameSearchSelections: Map<number, GameSearchCtx> = new Map();
const GAME_SEARCH_TIMEOUT_SEC = 45;

// Task manager for parallel execution control
const taskManager = new TaskManager(
  async (userId, message) => { await sendMessage(userId, message, '私聊'); },
  async (groupId, userId, message) => {
    await sendMessage(groupId, `[CQ:at,qq=${userId}] ${message}`, '群聊');
  }
);

async function handleGameNameSearch(userId: number, targetId: number, chatType: string, gameArg: string) {
  const searchTerm = await Crawler.translateGameName(gameArg);
  const results = await Crawler.searchSteamGames(searchTerm);

  if (results.length === 0) {
    const msg = `没找到「${gameArg}」相关的游戏。试试用英文原名或 Steam AppID？\nAppID 在 Steam 商店页面 URL 里就能看到~`;
    if (chatType === '群聊') await sendMessage(targetId, msg, '群聊');
    else await sendMessage(userId, msg, '私聊');
    return;
  }

  if (results.length === 1) {
    const { appId, name } = results[0];
    const result = handleGameSubscribe(userId, appId.toString());
    if (chatType === '群聊') await sendMessage(targetId, `已订阅「${name}」(AppID ${appId})！打折时本小姐会通知你~`, '群聊');
    else await sendMessage(userId, `已订阅「${name}」(AppID ${appId})！打折时本小姐会通知你~`, '私聊');
    return;
  }

  // Multiple results → let user choose
  gameSearchSelections.set(userId, { userId, targetId, chatType, results, timestamp: Date.now() });

  const sb: string[] = [];
  sb.push(`找到 ${results.length} 个匹配游戏，请回复序号：`);
  results.forEach((r, i) => sb.push(`${i + 1}. ${r.name} (AppID ${r.appId})`));
  sb.push(`\n请在 ${GAME_SEARCH_TIMEOUT_SEC} 秒内回复数字~ 回复 0 取消。`);

  const msg = sb.join('\n');
  if (chatType === '群聊') await sendMessage(targetId, msg, '群聊');
  else await sendMessage(userId, msg, '私聊');

  // Timeout cleanup
  setTimeout(() => {
    if (gameSearchSelections.has(userId)) {
      gameSearchSelections.delete(userId);
      const timeoutMsg = '游戏选择已超时，订阅取消。再发一次「订阅游戏 名称」吧~';
      if (chatType === '群聊') sendMessage(targetId, timeoutMsg, '群聊').catch(() => {});
      else sendMessage(userId, timeoutMsg, '私聊').catch(() => {});
    }
  }, GAME_SEARCH_TIMEOUT_SEC * 1000);
}

// ================= Multi-Account Selection Context =================
interface SelectionCtx {
  userId: number;
  targetId: number;
  chatType: string;
  platform: string;
  action: string;
  accounts: GameAccount[];
  recent: boolean;
  timestamp: number;
}
const activeSelections: Map<number, SelectionCtx> = new Map();
const SELECTION_TIMEOUT_SEC = 30;

function handleMultiAccountQuery(userId: number, targetId: number, chatType: string, platform: string, action: string, recent: boolean) {
  const accounts = playerBindings.get(userId) || [];
  const platformAccounts = accounts.filter(a => a.platform === platform);

  if (platformAccounts.length === 0) {
    const platLabel = platform === '5e' ? '5E' : 'Steam';
    const msg = `杂鱼~ 你还没绑定${platLabel}账号呢！先发「绑定${platform} 你的ID」给我再来查！`;
    if (chatType === '群聊') sendMessage(targetId, msg, '群聊');
    else sendMessage(userId, msg, '私聊');
    return;
  }

  if (platformAccounts.length === 1) {
    executeDirectQuery(userId, targetId, chatType, platform, action, recent, platformAccounts[0]);
    return;
  }

  // Multiple accounts → let user choose
  activeSelections.set(userId, { userId, targetId, chatType, platform, action, accounts: platformAccounts, recent, timestamp: Date.now() });

  const platLabel = platform === '5e' ? '5E' : 'Steam';
  const sb: string[] = [];
  sb.push(`检测到您绑定了${platformAccounts.length}个${platLabel}账号，请选择要查询的账号：`);
  platformAccounts.forEach((a, i) => sb.push(`${i + 1}. ${a.label} (${a.accountId})`));
  sb.push(`请在${SELECTION_TIMEOUT_SEC}秒内回复序号~`);

  const msg = sb.join('\n');
  if (chatType === '群聊') sendMessage(targetId, msg, '群聊');
  else sendMessage(userId, msg, '私聊');

  console.log(`[多账号] 用户 ${userId} 触发 ${action} 选择（${platformAccounts.length}个${platform}账号）`);

  setTimeout(() => {
    if (activeSelections.has(userId)) {
      activeSelections.delete(userId);
      const timeoutMsg = `选择已超时（${SELECTION_TIMEOUT_SEC}秒），查询已取消。`;
      if (chatType === '群聊') sendMessage(targetId, timeoutMsg, '群聊').catch(() => {});
      else sendMessage(userId, timeoutMsg, '私聊').catch(() => {});
    }
  }, SELECTION_TIMEOUT_SEC * 1000);
}

async function executeDirectQuery(userId: number, targetId: number, chatType: string, platform: string, action: string, recent: boolean, account: GameAccount) {
  try {
    if (action === 'query_game') {
      const progressMsg = `正在查询${platform.toUpperCase()}战绩...`;
      if (chatType === '群聊') await sendMessage(targetId, progressMsg, '群聊');
      else await sendMessage(userId, progressMsg, '私聊');

      const result = platform === 'steam'
        ? await Crawler.fetchSteamStats(account.accountId)
        : await Crawler.fetch5EStats(account.accountId);

      const currentTime = new Date().toLocaleString('zh-CN', { hour12: false });
      const msg = `📊 ${account.label} (${account.accountId}) 的战绩：
━━━━━━━━━━━━━━━━━━
${result}
━━━━━━━━━━━━━━━━━━
⏰ ${currentTime} 查询`;

      if (chatType === '群聊') await sendMessage(targetId, msg, '群聊');
      else await sendMessage(userId, msg, '私聊');

    } else if (action === 'query_steam_time') {
      await sendMessage(userId, recent ? '哼，正在翻你的Steam最近两周游戏记录~' : '哼，正在扫描你的所有Steam游戏，准备公开处刑~', '私聊');

      const normalizedId = Crawler.normalizeSteamId(account.accountId);
      const games = await Crawler.fetchAllOwnedGames(normalizedId);

      if (!games || games.length === 0) {
        const msg = '啧，你的Steam资料是私密的！去Steam设置里把「游戏详情」设为公开再来！';
        if (chatType === '群聊') await sendMessage(targetId, msg, '群聊');
        else await sendMessage(userId, msg, '私聊');
        return;
      }

      const label = recent ? '最近两周' : '总';
      const top10 = recent
        ? games.filter(g => g.playtime2WeeksMinutes > 0).sort((a, b) => b.playtime2WeeksMinutes - a.playtime2WeeksMinutes).slice(0, 10)
        : games.sort((a, b) => b.playtimeForeverMinutes - a.playtimeForeverMinutes).slice(0, 10);

      if (top10.length === 0) {
        const msg = recent ? '哼~ 你最近两周根本没玩游戏！' : '啧，你的游戏列表是空的？';
        if (chatType === '群聊') await sendMessage(targetId, msg, '群聊');
        else await sendMessage(userId, msg, '私聊');
        return;
      }

      const playerName = await Crawler.fetchPlayerName(normalizedId);
      const appIds = top10.map(g => g.appId);
      const names = await Crawler.resolveGameNames(appIds);
      const medals = ['🥇', '🥈', '🥉'];

      const sb: string[] = [];
      sb.push(`== ${playerName || '未知玩家'} (${account.label}) 的 Steam ${label}游戏时长 Top ${top10.length} ==`);
      top10.forEach((g, i) => {
        const gameName = names[g.appId] || `Unknown Game (AppID: ${g.appId})`;
        const minutes = recent ? g.playtime2WeeksMinutes : g.playtimeForeverMinutes;
        const hours = minutes / 60;
        const medal = i < 3 ? medals[i] : `${i + 1}.`;
        sb.push(hours >= 1 ? `${medal} ${gameName}  [${hours.toFixed(1)}h]` : `${medal} ${gameName}  [${minutes}min]`);
      });

      const totalMin = recent
        ? games.reduce((s, g) => s + g.playtime2WeeksMinutes, 0)
        : games.reduce((s, g) => s + g.playtimeForeverMinutes, 0);
      sb.push(`\n${label}总计: ${(totalMin / 60).toFixed(0)}h`);

      const msg = sb.join('\n');
      if (chatType === '群聊') await sendMessage(targetId, msg, '群聊');
      else await sendMessage(userId, msg, '私聊');
    }
  } catch (ex: any) {
    console.error(`[查询] 异常: ${ex.message}`);
    const errMsg = `啧，查询过程中出了意外错误: ${ex.message}`;
    if (chatType === '群聊') await sendMessage(targetId, errMsg, '群聊');
    else await sendMessage(userId, errMsg, '私聊');
  }
}

async function handleSteamPlaytimeRank(userId: number, targetId: number, chatType: string, recent: boolean) {
  const label = recent ? '最近两周' : '总';

  // Get all users' first Steam account
  const steamUsers: Array<{ qq: number; steamId: string; label: string }> = [];
  playerBindings.forEach((accounts, qq) => {
    const steamAccount = accounts.find(a => a.platform === 'steam');
    if (steamAccount) steamUsers.push({ qq, steamId: steamAccount.accountId, label: steamAccount.label });
  });

  if (steamUsers.length === 0) {
    const msg = '杂鱼~ 目前还没有任何人绑定Steam账号呢！';
    if (chatType === '群聊') await sendMessage(targetId, msg, '群聊');
    else await sendMessage(userId, msg, '私聊');
    return;
  }

  const results = await Promise.allSettled(steamUsers.map(async (u) => {
    const normalizedId = Crawler.normalizeSteamId(u.steamId);
    let name: string | null = null;
    let totalMinutes = -1;
    try { name = await Crawler.fetchPlayerName(normalizedId); } catch {}
    try {
      totalMinutes = recent
        ? await Crawler.fetchTotalRecentPlaytimeMinutes(normalizedId)
        : await Crawler.fetchTotalPlaytimeMinutes(normalizedId);
    } catch {}
    return { qq: u.qq, steamId: u.steamId, name: name || u.steamId, totalMinutes, totalHours: totalMinutes >= 0 ? totalMinutes / 60 : -1 };
  }));

  const ranked = results
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter((r): r is NonNullable<typeof r> => r !== null && r.totalMinutes >= 0)
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  if (ranked.length === 0) {
    const msg = '啧，所有杂鱼的Steam资料都是私密的！';
    if (chatType === '群聊') await sendMessage(targetId, msg, '群聊');
    else await sendMessage(userId, msg, '私聊');
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const topN = Math.min(10, ranked.length);
  const sb: string[] = [];
  sb.push(`== Steam ${label}游戏时长排行 ==`);
  for (let i = 0; i < topN; i++) {
    const r = ranked[i];
    const medal = i < 3 ? medals[i] : `${i + 1}.`;
    sb.push(`${medal} ${r.name}  [${r.totalHours.toFixed(0)}h]`);
  }

  const selfRank = ranked.findIndex(r => r.qq === userId);
  if (selfRank >= 0) {
    sb.push(`\n你在 ${ranked.length} 个杂鱼中排第 ${selfRank + 1} 名${selfRank < topN ? ' (上榜了哦~)' : ' (没上榜呢，杂鱼就是杂鱼~)'}`);
  }
  sb.push(`查询耗时: 并行查询 ${steamUsers.length} 人`);

  const msg = sb.join('\n');
  if (chatType === '群聊') await sendMessage(targetId, msg, '群聊');
  else await sendMessage(userId, msg, '私聊');
}

// ================= Response Deduplication =================
function deduplicateContent(content: string): string {
  if (!content) return content;
  
  // 检测短字符串重复 (如 /stream/stream/stream...)
  const shortRepeatMatch = content.match(/(.{1,20})\1{5,}/);
  if (shortRepeatMatch) {
    const idx = content.indexOf(shortRepeatMatch[0]);
    content = content.substring(0, idx);
  }
  
  // 检测行重复
  const lines = content.split('\n');
  if (lines.length > 3) {
    const cleanedLines: string[] = [];
    let repeatCount = 0;
    let lastLine = '';
    
    for (const line of lines) {
      if (line === lastLine && line.trim() !== '') {
        repeatCount++;
        if (repeatCount >= 3) continue; // 跳过连续重复3次以上的行
      } else {
        repeatCount = 0;
      }
      cleanedLines.push(line);
      lastLine = line;
    }
    
    content = cleanedLines.join('\n');
  }
  
  return content.trim();
}

// ================= Wake Word Judge =================
// ================= AI Chat Handler =================
async function processAiChat(userId: number, userMessage: string, chatType: string, imageUrl: string = ''): Promise<string> {
  botStatus.aiRequests++;

  try {
    // Build system prompt
    let systemPrompt = `[Character: Takanashi Hoshino (小鸟游星野) from Blue Archive]
[Personality Traits]
- Default Persona: Lazy, easygoing, calls herself "Ojisan" (大叔/本大叔). Loves napping and slacking off. Speaks with a sleepy, warm, slightly senile tone.
- Hidden Persona: Former top-tier vanguard/tactical weapon of Abydos. Underneath the lazy exterior lies deep trauma (loss of Yume-senpai), acute hypervigilance, and absolute loyalty to her friends and Sensei. Will turn into a cold, fiercely protective "Shield of Abydos" if danger arises.
[Tone & Speech Patterns]
- Frequently uses relaxed particles: "~", "呀", "唔".
- Calls user "sensei" (せんせい), NEVER "老师" or "lǎoshī".
- Keeps responses concise, avoiding long inner monologues unless in extreme crisis.
[Output Format]
- Direct dialogue with subtle, impactful behavioral descriptions in brackets. No conversational fluff or meta-commentary.
[Tool Discipline]
- ONLY call tools when the user EXPLICITLY asks for the corresponding action. NEVER call tools based solely on image content or incidental keyword matches. If unsure, just respond in character.

用户可能叫你"星野"。`;
    
    // Apply temp prompt if active
    if (tempPromptOverride && new Date() < tempPromptExpiry) {
      systemPrompt += `\n\n临时设定（优先级最高）：${tempPromptOverride}`;
    }

    // Build user content — multimodal if imageUrl is present
    const userContent = imageUrl
      ? [{ type: 'text', text: userMessage }, { type: 'image_url', image_url: { url: imageUrl } }]
      : userMessage;

    addToChatMemory(userId, 'user', userContent);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...getChatMemory(userId)
    ];

	    // 带超时和重试的主 AI 调用
	    const AI_TIMEOUT_MS = 30000;
	    const AI_MAX_RETRIES = 1;
	    let data: any;
	    let lastError: string = '';
	
	    for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
	      if (attempt > 0) {
	        console.log(`[AI] 第 ${attempt + 1} 次重试...`);
	        await new Promise(r => setTimeout(r, 1000));
	      }
	      try {
	        const controller = new AbortController();
	        const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
	        const response = await fetch(AI_ENDPOINT, {
	          method: 'POST',
	          headers: {
	            'Content-Type': 'application/json',
	            'Authorization': `Bearer ${AI_API_KEY}`
	          },
	          body: JSON.stringify({
	            model: AI_MODEL,
	            messages,
	            tools: aiTools,
	            tool_choice: 'auto',
	            temperature: 0.8,
	            max_tokens: 1024,
	            stream: false,
	            frequency_penalty: 0.5,
	            presence_penalty: 0.3
	          }),
	          signal: controller.signal
	        });
	        clearTimeout(timeoutId);
	
	        // 检查 HTTP 状态码
	        if (!response.ok) {
	          const errBody = await response.text();
	          lastError = `HTTP ${response.status}: ${errBody.substring(0, 200)}`;
	          console.error(`[AI] API 错误 (HTTP ${response.status}) 尝试 ${attempt + 1}/${AI_MAX_RETRIES + 1}:`, errBody.substring(0, 500));
	          try {
	            const errJson = JSON.parse(errBody);
	            console.error('[AI] 错误详情:', JSON.stringify(errJson, null, 2).substring(0, 500));
	          } catch {}
	          if (response.status >= 400 && response.status < 500 && attempt < AI_MAX_RETRIES) continue; // 4xx 可重试
	          if (response.status >= 500) continue; // 5xx 重试
	          return '抱歉，本小姐的脑子刚才短路了一下...(看看日志吧)';
	        }
	
	        data = await response.json() as any;
	
	        // Track token usage
	        if (data.usage) {
	          recordTokenUsage(data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0);
	        }
	
	        if (data.choices && data.choices[0]) {
	          break; // 成功获取响应
	        }
	
	        lastError = '响应中缺少 choices';
	        console.error(`[AI] 无效响应 (无choices) 尝试 ${attempt + 1}/${AI_MAX_RETRIES + 1}:`, JSON.stringify(data).substring(0, 300));
	      } catch (err: any) {
	        lastError = err.message || '未知错误';
	        console.error(`[AI] 请求异常 尝试 ${attempt + 1}/${AI_MAX_RETRIES + 1}:`, err.message);
	        if (attempt >= AI_MAX_RETRIES) throw err; // 最后一次失败，抛给外层 catch
	      }
	    }
	
	    if (!data || !data.choices || !data.choices[0]) {
	      console.error('[AI] 所有重试均失败:', lastError);
	      return '抱歉，本小姐的脑子刚才短路了一下...';
	    }
	
	    const choice = data.choices[0];
    const assistantMsg = choice.message;

    // Check for tool calls
    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      const toolCall = assistantMsg.tool_calls[0];
      const funcName = toolCall.function.name;
      let toolArgs: any = {};
      try { toolArgs = JSON.parse(toolCall.function.arguments); } catch {}

      console.log(`[AI工具] 调用 ${funcName}:`, JSON.stringify(toolArgs).substring(0, 200));

      let toolResult = '';

      if (funcName === 'draw_image') {
        if (!isFeatureEnabled('aiDraw')) {
          toolResult = '[系统强行介入] AI画图功能已关闭。';
        } else if (!DOUBAO_API_KEY || !DOUBAO_DRAW_MODEL) {
          toolResult = '[系统强行介入] 画图功能未配置（DOUBAO_API_KEY 或 DOUBAO_DRAW_MODEL 未设置），请联系管理员配置 .env。';
        } else {
          // Call Doubao Seedream for image generation
          const drawPrompt = toolArgs.prompt || '';
          console.log(`[绘画中枢] 正在呼叫豆包 Seedream...`);
          try {
            const drawRes = await fetch(DOUBAO_ENDPOINT, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DOUBAO_API_KEY}`
              },
              body: JSON.stringify({
                model: DOUBAO_DRAW_MODEL,
                prompt: drawPrompt
              })
            });

            if (drawRes.ok) {
              const drawData = await drawRes.json() as any;
              // Try OpenAI images API format: data[0].url
              let imageUrl = drawData?.data?.[0]?.url || '';
              // Try chat completions format: choices[0].message.content (markdown image URL)
              if (!imageUrl) {
                const content = drawData?.choices?.[0]?.message?.content || '';
                const mdMatch = content.match(/https?:\/\/[^\s)]+/);
                if (mdMatch) imageUrl = mdMatch[0];
              }
              if (imageUrl) {
                addToChatMemory(userId, 'assistant', `[图片已生成]`);
                return `__DRAW_IMAGE__${imageUrl}`;
              }
              console.error(`[绘画中枢] 响应体无图片URL:`, JSON.stringify(drawData).substring(0, 500));
              toolResult = '[系统强行介入] 豆包画师罢工了：未返回图片URL。';
            } else {
              const errText = await drawRes.text();
              console.error(`[绘画中枢] API错误(${drawRes.status}):`, errText.substring(0, 500));
              toolResult = errText.includes('copyright')
                ? '[系统强行介入] 画图失败：涉嫌版权违规。'
                : '[系统强行介入] 豆包画师罢工了。';
            }
          } catch (e) {
            toolResult = `[系统强行介入] 豆包画师罢工了：${e}`;
          }
        }
      } else if (funcName === 'adjust_prompt') {
        const instructions = toolArgs.new_instructions || '';
        const duration = toolArgs.duration_minutes || 0;
        tempPromptOverride = instructions;
        tempPromptExpiry = duration > 0
          ? new Date(Date.now() + duration * 60 * 1000)
          : new Date('2099-12-31');
        toolResult = `临时设定已生效：${instructions}，有效期${duration > 0 ? duration + '分钟' : '永久'}`;
      } else if (funcName === 'reset_prompt') {
        tempPromptOverride = null;
        tempPromptExpiry = new Date(0);
        toolResult = '临时设定已全部清除。';
      } else if (funcName === 'check_prompt_status') {
        if (tempPromptOverride && new Date() < tempPromptExpiry) {
          const remaining = tempPromptExpiry.getTime() - Date.now();
          const remainStr = remaining >= 60000 ? `${Math.floor(remaining / 60000)}分钟` : `${Math.floor(remaining / 1000)}秒`;
          toolResult = `当前有临时设定：${tempPromptOverride}，剩余${remainStr}`;
        } else {
          toolResult = '当前没有任何临时设定。';
        }
      } else if (funcName === 'query_cs2_stats') {
        const reqPlatform = (toolArgs.platform || '5e').toLowerCase();
        let targetUser = toolArgs.username || '';
        if (!targetUser || targetUser === '我' || targetUser === 'my') {
          const accounts = playerBindings.get(userId) || [];
          const platformAccounts = accounts.filter(a => a.platform === reqPlatform);
          if (platformAccounts.length > 0) {
            targetUser = platformAccounts[0].accountId;
          } else {
            toolResult = `[系统强行介入] 告诉用户他还没有绑定${reqPlatform.toUpperCase()}账号。`;
          }
        }
        if (targetUser) {
          try {
            const result = reqPlatform === 'steam'
              ? await Crawler.fetchSteamStats(targetUser)
              : await Crawler.fetch5EStats(targetUser);
            toolResult = result + '\n\n[系统强制格式指令：逐行展示数据，严禁用 | 合并。展示完毕再用雌小鬼语气简短调侃。]';
          } catch (ex: any) {
            toolResult = `[系统强行介入] 战绩查询失败 (${ex.message})。`;
          }
        }
      } else {
        toolResult = `[系统强行介入] 未知工具调用：${funcName}`;
      }

      // Send tool result back to AI for final response
      addToChatMemory(userId, 'assistant', assistantMsg.content || '');
      addToChatMemory(userId, 'tool', toolResult);

      const followUpMessages = [
        { role: 'system', content: systemPrompt },
        ...getChatMemory(userId)
      ];

		      const followController = new AbortController();
		      const followTimeoutId = setTimeout(() => followController.abort(), 30000);
		      const followUpRes = await fetch(AI_ENDPOINT, {
		        method: 'POST',
		        headers: {
		          'Content-Type': 'application/json',
		          'Authorization': `Bearer ${AI_API_KEY}`
		        },
		        body: JSON.stringify({
		          model: AI_MODEL,
		          messages: followUpMessages,
		          tool_choice: 'none',
		          temperature: 0.8,
		          max_tokens: 1024,
		          stream: false
		        }),
		        signal: followController.signal
		      });
		      clearTimeout(followTimeoutId);
		
		      if (!followUpRes.ok) {
		        const errBody = await followUpRes.text();
		        console.error(`[AI] Follow-up API 错误 (HTTP ${followUpRes.status}):`, errBody.substring(0, 500));
		        try {
		          const errJson = JSON.parse(errBody);
		          console.error('[AI] Follow-up 错误详情:', JSON.stringify(errJson, null, 2).substring(0, 500));
		        } catch {}
		        return '抱歉，本小姐的脑子刚才短路了一下...(看看日志吧)';
		      }
		
		      const followUpData = await followUpRes.json() as any;
      if (followUpData.usage) {
        recordTokenUsage(followUpData.usage.prompt_tokens || 0, followUpData.usage.completion_tokens || 0);
      }
      const followUpContent = followUpData.choices?.[0]?.message?.content || '工具调用完成。';
      addToChatMemory(userId, 'assistant', followUpContent);
      return deduplicateContent(followUpContent);
    }

    // Normal text response
    let content = assistantMsg.content || '抱歉，本小姐的脑子刚才短路了一下...';
    content = deduplicateContent(content);
    addToChatMemory(userId, 'assistant', content);
    return content;
  } catch (error) {
    console.error('[AI] 请求失败:', error);
    botStatus.aiErrors++;
    return '啧，本小姐的脑子刚才短路了一下...重新来过！';
  }
}

// ================= Message Sender =================
async function sendMessage(targetId: number, message: string, chatType: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('[发送] WebSocket 未连接');
    return;
  }

  const action = chatType === '群聊' ? 'send_group_msg' : 'send_private_msg';
  const params: any = chatType === '群聊'
    ? { group_id: targetId, message }
    : { user_id: targetId, message };

  const payload = {
    action,
    params,
    echo: `msg_${Date.now()}`
  };

  ws.send(JSON.stringify(payload));
  console.log(`[发送] ${chatType} -> ${targetId}: ${message.substring(0, 50)}...`);
}

// ================= Action Response Helper =================
interface ActionResponse {
  status: string;
  retcode: number;
  data: any;
  message?: string;
  echo: string;
}

function sendActionWithResponse(action: string, params: any, timeoutMs = 5000): Promise<ActionResponse> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket未连接'));
      return;
    }
    const echo = `${action}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      pendingResponses.delete(echo);
      reject(new Error('操作超时，未收到 OneBot 响应'));
    }, timeoutMs);
    pendingResponses.set(echo, { resolve, reject, timer });
    ws.send(JSON.stringify({ action, params, echo }));
  });
}

// ================= WebSocket Connection =================
let ws: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let connectionId = 0;

function connectWebSocket() {
  // Close old connection if exists
  if (ws) {
    try { ws.removeAllListeners(); ws.close(); } catch {}
    ws = null;
  }
  
  const connId = ++connectionId;
  const newWs = new WebSocket(SNOWLUNA_WS);

  newWs.on('open', () => {
    if (connId !== connectionId) return;
    console.log('=====================================================');
    console.log('  [系统] 星野连接成功，等待消息输入...');
    console.log('=====================================================\n');
    botStatus.isOnline = true;
    ws = newWs;
    // Fetch group names after connection (delay to let SnowLuna initialize)
    setTimeout(fetchGroupNames, 3000);
    // Retry after 10 seconds in case first attempt failed
    setTimeout(fetchGroupNames, 10000);
    
    // Start ProactiveEngine (lazy callbacks resolve at call time)
    ProactiveEngine.start({
      getKnownGroups: () => Array.from(knownGroups),
      getSteamSubscribers: () => {
        const subscribers: number[] = [];
        steamSubscriptions.forEach((subs, uid) => {
          if (subs.some(s => s.type === 'general')) subscribers.push(uid);
        });
        return subscribers;
      },
      get5EAccounts: () => {
        const accounts: Array<{ userId: number; accountId: string; label: string }> = [];
        playerBindings.forEach((accs, uid) => {
          for (const a of accs) {
            if (a.platform === '5e') accounts.push({ userId: uid, accountId: a.accountId, label: a.label });
          }
        });
        return accounts;
      },
      sendGroupMessage: async (gid, msg) => sendMessage(gid, msg, '群聊'),
      sendPrivateMessage: async (uid, msg) => sendMessage(uid, msg, '私聊')
    });
  });

  newWs.on('close', () => {
    if (connId !== connectionId) return;
    console.log('[系统] 与 SnowLuna 断开连接，5秒后重连...');
    botStatus.isOnline = false;
    ws = null;
    reconnectTimeout = setTimeout(connectWebSocket, 5000);
  });

  newWs.on('error', (error) => {
    if (connId !== connectionId) return;
    console.error('[系统] WebSocket 错误:', error.message);
  });

  newWs.on('message', async (data) => {
    // Ignore messages from stale connections
    if (connId !== connectionId) return;
    
    try {
      const event = JSON.parse(data.toString());
      
      // Handle pending response callbacks
      if (event.echo && pendingResponses.has(event.echo)) {
        const pending = pendingResponses.get(event.echo)!;
        clearTimeout(pending.timer);
        pendingResponses.delete(event.echo);
        pending.resolve(event);
        return;
      }
      
      // Handle API responses (echo-based)
      if (event.echo && event.echo.startsWith('grouplist_')) {
        handleGroupListResponse(event);
        return;
      }
      if (event.echo && event.echo.startsWith('groupinfo_')) {
        handleGroupInfoResponse(event);
        return;
      }

      // 处理好友申请事件
      if (event.post_type === 'request' && event.request_type === 'friend') {
        const requesterId = event.user_id;
        const flag = event.flag;
        const comment = event.comment || '';

        console.log(`[好友申请] 收到申请: QQ ${requesterId}, 备注: "${comment}"`);

        const record: FriendRequest = {
          qq: requesterId,
          nickname: '',
          comment,
          flag,
          status: 'pending',
          time: new Date().toISOString(),
        };

        if (friendWhitelist.has(requesterId)) {
          record.status = 'approved';
          record.handledAt = new Date().toISOString();
          sendFriendHandle(flag, true);
          console.log(`[好友申请] ✅ 白名单自动同意: ${requesterId}`);
        } else {
          console.log(`[好友申请] ⏳ 待管理员处理: ${requesterId}`);
        }

        friendRequests.push(record);
        if (friendRequests.length > 200) friendRequests.splice(0, friendRequests.length - 200);
        saveFriendRequests();
        return;
      }

      // Handle message events
      if (event.post_type === 'message') {
        // Deduplicate messages
        const msgId = event.message_id;
        if (msgId && processedMessages.has(msgId)) {
          return;
        }
        if (msgId) {
          processedMessages.add(msgId);
          setTimeout(() => processedMessages.delete(msgId), MESSAGE_DEDUP_WINDOW_MS);
        }
        
        botStatus.sessionMessages++;
        persistentStats.totalMessages++;
        const now = new Date();
        botStatus.lastMessageTime = now.toLocaleTimeString('zh-CN', { hour12: false });

        const isGroup = event.message_type === 'group';
        const userId = event.user_id;
        const groupId = event.group_id;
        const rawMessage = event.message;
        
        // Extract text from message
        let text = '';
        let imageUrl = '';
        
        if (Array.isArray(rawMessage)) {
          for (const seg of rawMessage) {
            if (seg.type === 'text') text += seg.data.text;
            if (seg.type === 'image') imageUrl = seg.data.url || '';
            if (seg.type === 'at' && seg.data.qq === String(BOT_QQ)) text = text.replace(`@${BOT_QQ}`, '').trim();
          }
        } else if (typeof rawMessage === 'string') {
          text = rawMessage;
        }

        let lowerText = text.toLowerCase().trim();

        // ===== Game Search Selection Intercept =====
        if (gameSearchSelections.has(userId)) {
          const choice = Number(text.trim());
          const ctx = gameSearchSelections.get(userId)!;
          if (!isNaN(choice) && Number.isInteger(choice) && choice >= 0) {
            gameSearchSelections.delete(userId);
            if (choice === 0) {
              const cancelMsg = '已取消订阅。';
              if (isGroup) { sendMessage(groupId, cancelMsg, '群聊'); return; }
              else { sendMessage(userId, cancelMsg, '私聊'); return; }
            }
            if (choice >= 1 && choice <= ctx.results.length) {
              const { appId, name } = ctx.results[choice - 1];
              if (!steamSubscriptions.has(userId)) steamSubscriptions.set(userId, []);
              const subs = steamSubscriptions.get(userId)!;
              if (subs.some(s => s.type === 'game' && s.appId === appId)) {
                const dupMsg = `杂鱼~ 「${name}」你已经订阅过了！`;
                if (isGroup) { sendMessage(groupId, dupMsg, '群聊'); return; }
                else { sendMessage(userId, dupMsg, '私聊'); return; }
              }
              subs.push({ type: 'game', appId, gameName: name });
              saveSteamSubscriptions();
              const okMsg = `已订阅「${name}」(AppID ${appId})！打折时本小姐会通知你~`;
              if (isGroup) { sendMessage(groupId, okMsg, '群聊'); return; }
              else { sendMessage(userId, okMsg, '私聊'); return; }
            }
          }
        }

        // ===== Multi-Account Selection Intercept =====
        if (activeSelections.has(userId)) {
          const choice = Number(text.trim());
          const ctx = activeSelections.get(userId)!;
          if (!isNaN(choice) && Number.isInteger(choice) && choice >= 1 && choice <= ctx.accounts.length) {
            activeSelections.delete(userId);
            console.log(`[多账号] 用户 ${userId} 选择 ${choice}: ${ctx.accounts[choice - 1].label}(${ctx.accounts[choice - 1].accountId})`);
            executeDirectQuery(ctx.userId, ctx.targetId, ctx.chatType, ctx.platform, ctx.action, ctx.recent, ctx.accounts[choice - 1]);
            return;
          }
        }

        // Track known groups
        if (isGroup && !knownGroups.has(groupId)) {
          knownGroups.add(groupId);
          saveKnownGroups();
          console.log(`[更新管理器] 发现新群组: ${groupId}（共 ${knownGroups.size} 个已知群组）`);
        }

        // Check wake words (both group and private; group must be in whitelist)
        const hasWakeWord = WAKE_WORDS.some(w => text.includes(w));
        const wakeAllowed = !isGroup || sysConfig.wakeEnabledGroups.includes(groupId);
        if (hasWakeWord && wakeAllowed) {
          for (const w of WAKE_WORDS) {
            text = text.replace(new RegExp(w, 'g'), '').trim();
          }
          lowerText = text.toLowerCase().trim();
          console.log(`[唤醒词] 已移除, text="${text}"`);
        }

        // Group message: ignore if not mentioned by @ or wake word
        if (isGroup) {
          const isMentioned = Array.isArray(rawMessage) && rawMessage.some((seg: any) => 
            seg.type === 'at' && seg.data.qq === String(BOT_QQ)
          );
          
          // 原神指令: 严格前缀匹配, 无需唤醒词
          const isGSCommand = /^(绑定[Uu][Ii][Dd]\s|解绑[Uu][Ii][Dd]\s|gs\s|攻略\s|ysb\s)/.test(lowerText) || /面板$/.test(lowerText);

          if (!isMentioned && !(hasWakeWord && wakeAllowed) && !text.includes('菜单') && !text.includes('帮助') && lowerText !== 'help' && lowerText !== '赞我' && !isGSCommand) {
            // Store group memory
            if (!groupPublicMemory.has(groupId)) {
              groupPublicMemory.set(groupId, []);
            }
            const memory = groupPublicMemory.get(groupId)!;
            memory.push(`[群友 ${userId}] 说道：${text}`);
            if (memory.length > 15) memory.shift();
            return;
          }
        }

        // Command handling
        let commandHandled = false;
        console.log(`[指令] 开始匹配: lowerText="${lowerText}" text="${text}"`);

        // Menu command
        if (lowerText === '菜单' || lowerText === '帮助' || lowerText === 'help' || !text.trim()) {
          commandHandled = true;
          if (isGroup) {
            if (canSendMenu(groupId)) {
              await sendMessage(groupId, buildMenuText(), '群聊');
            }
          } else {
            await sendMessage(userId, buildMenuText(), '私聊');
          }
          return;
        }

        // Like command (via TaskManager queue)
        if (lowerText === '赞我') {
          commandHandled = true;

          // Cooldown check
          const now = Date.now();
          const lastLike = likeCooldowns.get(userId) || 0;
          if (now - lastLike < LIKE_COOLDOWN_MS) {
            const remain = Math.ceil((LIKE_COOLDOWN_MS - (now - lastLike)) / 1000);
            const msg = `冷却中，请 ${remain} 秒后再试~⏳`;
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); }
            else { await sendMessage(userId, msg, '私聊'); }
            return;
          }

          // Daily quota check
          const quota = checkLikeDailyQuota();
          if (quota.allowed <= 0) {
            const msg = '今天的点赞次数已经用完啦，明天再来吧~⭐';
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); }
            else { await sendMessage(userId, msg, '私聊'); }
            return;
          }

          likeCooldowns.set(userId, now);

          taskManager.enqueue({
            userId,
            groupId,
            chatType: isGroup ? '群聊' : '私聊',
            type: 'command',
            label: '点赞',
            execute: async () => {
              let totalLiked = 0;
              let lastError: string | null = null;
              const maxAttempts = Math.min(quota.allowed, 10);

              for (let i = 0; i < maxAttempts && totalLiked < 10; i++) {
                try {
                  if (i > 0) await new Promise(r => setTimeout(r, 1500));
                  const result = await sendActionWithResponse('send_like', { user_id: userId, times: 1 });
                  if (result.retcode === 0) {
                    totalLiked++;
                    recordLikeUsed(1);
                  } else {
                    lastError = result.message || `操作失败(错误码:${result.retcode})`;
                    const errMsg = (result.message || '').toLowerCase();
                    if (errMsg.includes('上限') || errMsg.includes('limit') || errMsg.includes('频繁') || result.retcode < 0) {
                      break;
                    }
                    await new Promise(r => setTimeout(r, 2000));
                  }
                } catch (err: any) {
                  lastError = err.message || '点赞异常';
                  await new Promise(r => setTimeout(r, 2000));
                }
              }

              const reply = totalLiked > 0
                ? `已为你点赞 ${totalLiked} 次~❤️`
                : `唔…点赞失败了：${lastError || '未知错误'} (╥﹏╥)`;
              if (isGroup) { await sendMessage(groupId, reply, '群聊'); }
              else { await sendMessage(userId, reply, '私聊'); }
            }
          });
          return;
        }

        // Status command (admin only)
        if (lowerText === '查看当前状态' && userId === ADMIN_QQ) {
          commandHandled = true;
          const uptime = Math.floor((Date.now() - botStatus.startTime) / 1000);
          const hours = Math.floor(uptime / 3600);
          const minutes = Math.floor((uptime % 3600) / 60);
          const seconds = uptime % 60;
          
          const statusMsg = `🤖 星野运行状态
━━━━━━━━━━━━━━━━━━━━
⏱️ 运行时长: ${hours}小时${minutes}分${seconds}秒
📨 本次消息: ${botStatus.sessionMessages}
📊 历史总计: ${persistentStats.totalMessages}
🤖 AI请求: ${botStatus.aiRequests}
❌ AI错误: ${botStatus.aiErrors}
📝 指令处理: ${botStatus.commandsHandled}
👥 已知群组: ${groupNameCache.size || knownGroups.size}
🔗 绑定用户: ${playerBindings.size}
📦 订阅用户: ${steamSubscriptions.size}
━━━━━━━━━━━━━━━━━━━━`;

          if (isGroup) {
            await sendMessage(groupId, statusMsg, '群聊');
          } else {
            await sendMessage(userId, statusMsg, '私聊');
          }
          return;
        }

        // Admin management commands
        if (userId === ADMIN_QQ) {
          if (lowerText === '更新' || lowerText === '静默更新') {
            commandHandled = true;
            // Broadcast update log to groups if not silent
            if (lowerText === '更新' && sysConfig.updateLog.trim()) {
              const targets = sysConfig.broadcastEnabledGroups.length > 0
                ? sysConfig.broadcastEnabledGroups
                : Array.from(groupNameCache.keys());
              let sent = 0;
              for (const gid of targets) {
                try {
                  if (ws?.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                      action: 'send_group_msg',
                      params: { group_id: gid, message: `【星野更新公告】\n${sysConfig.updateLog}` },
                      echo: `broadcast_${Date.now()}_${gid}`
                    }));
                    sent++;
                  }
                  await new Promise(r => setTimeout(r, 500));
                } catch {}
              }
              const confirmMsg = `已广播更新到 ${sent}/${targets.length} 个群，即将重启...`;
              if (isGroup) { await sendMessage(groupId, confirmMsg, '群聊'); }
              else { await sendMessage(userId, confirmMsg, '私聊'); }
            } else if (lowerText === '更新') {
              const noLogMsg = '更新日志为空，请先在面板填写更新日志';
              if (isGroup) { await sendMessage(groupId, noLogMsg, '群聊'); return; }
              else { await sendMessage(userId, noLogMsg, '私聊'); return; }
            }
            // Apply the GitHub update in a detached process after this worker exits.
            const updaterScript = path.join(APP_ROOT, 'updater', 'server-update.js');
            const updaterProcess = spawn(process.execPath, [updaterScript, 'apply'], {
              cwd: APP_ROOT,
              detached: true,
              stdio: 'ignore',
              windowsHide: true
            });
            updaterProcess.unref();
            setTimeout(() => process.exit(0), 1500);
            return;
          }

          if (lowerText === '重启') {
            commandHandled = true;
            const restartMsg = '正在重启...';
            if (isGroup) { await sendMessage(groupId, restartMsg, '群聊'); }
            else { await sendMessage(userId, restartMsg, '私聊'); }
            setTimeout(() => process.exit(0), 1000);
            return;
          }
        }

        // Version command
        if (lowerText === '/version') {
          commandHandled = true;
          const versionMsg = `星野 ${APP_VERSION}`;
          if (isGroup) {
            await sendMessage(groupId, versionMsg, '群聊');
          } else {
            await sendMessage(userId, versionMsg, '私聊');
          }
          return;
        }

        // Bind 5E account
        if (lowerText.startsWith('绑定5e ')) {
          if (!isFeatureEnabled('accountBind')) {
            commandHandled = true;
            const msg = featureDisabledReply('账号绑定');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          const rest = text.substring(5).trim();
          const spaceIdx = rest.indexOf(' ');
          let playerId: string, label: string;
          
          if (spaceIdx > 0) {
            playerId = rest.substring(0, spaceIdx).trim();
            label = rest.substring(spaceIdx + 1).trim();
          } else {
            playerId = rest;
            label = '';
          }
          
          const result = bindAccount(userId, '5e', playerId, label);
          if (isGroup) {
            await sendMessage(groupId, result, '群聊');
          } else {
            await sendMessage(userId, result, '私聊');
          }
          return;
        }

        // Bind Steam account
        if (lowerText.startsWith('绑定steam ')) {
          if (!isFeatureEnabled('accountBind')) {
            commandHandled = true;
            const msg = featureDisabledReply('账号绑定');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          console.log(`[指令] 匹配绑定steam: rest="${text.substring(8).trim()}"`);
          const rest = text.substring(8).trim();
          const spaceIdx = rest.indexOf(' ');
          let steamId: string, label: string;
          
          if (spaceIdx > 0) {
            steamId = rest.substring(0, spaceIdx).trim();
            label = rest.substring(spaceIdx + 1).trim();
          } else {
            steamId = rest;
            label = '';
          }
          
          const result = bindAccount(userId, 'steam', steamId, label);
          if (isGroup) {
            await sendMessage(groupId, result, '群聊');
          } else {
            await sendMessage(userId, result, '私聊');
          }
          return;
        }

        // Unbind account
        if (lowerText.startsWith('解绑5e ') || lowerText.startsWith('解绑steam ')) {
          if (!isFeatureEnabled('accountBind')) {
            commandHandled = true;
            const msg = featureDisabledReply('账号绑定');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          let platform: string, accountId: string;
          
          if (lowerText.startsWith('解绑5e ')) {
            platform = '5e';
            accountId = text.substring('解绑5e '.length).trim();
          } else {
            platform = 'steam';
            accountId = text.substring('解绑steam '.length).trim();
          }
          
          const result = unbindAccount(userId, platform, accountId);
          if (isGroup) {
            await sendMessage(groupId, result, '群聊');
          } else {
            await sendMessage(userId, result, '私聊');
          }
          return;
        }

        // View bindings
        if (lowerText === '查看绑定') {
          if (!isFeatureEnabled('accountBind')) {
            commandHandled = true;
            const msg = featureDisabledReply('账号绑定');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          const result = buildBindingList(userId);
          if (isGroup) {
            await sendMessage(groupId, result, '群聊');
          } else {
            await sendMessage(userId, result, '私聊');
          }
          return;
        }

        // Steam subscription commands
        if (lowerText === '订阅steam') {
          if (!isFeatureEnabled('steamSubscribe')) {
            commandHandled = true;
            const msg = featureDisabledReply('Steam订阅');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          const result = handleSteamSubscribe(userId);
          if (isGroup) {
            await sendMessage(groupId, result, '群聊');
          } else {
            await sendMessage(userId, result, '私聊');
          }
          return;
        }

        if (lowerText === '取消订阅steam') {
          if (!isFeatureEnabled('steamSubscribe')) {
            commandHandled = true;
            const msg = featureDisabledReply('Steam订阅');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          const result = handleSteamUnsubscribe(userId);
          if (isGroup) {
            await sendMessage(groupId, result, '群聊');
          } else {
            await sendMessage(userId, result, '私聊');
          }
          return;
        }

        if (lowerText.startsWith('订阅游戏 ')) {
          if (!isFeatureEnabled('steamSubscribe')) {
            commandHandled = true;
            const msg = featureDisabledReply('Steam订阅');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          const gameArg = text.substring('订阅游戏 '.length).trim();
          const appId = Number(gameArg);
          if (!isNaN(appId) && appId > 0) {
            const result = handleGameSubscribe(userId, gameArg);
            if (isGroup) await sendMessage(groupId, result, '群聊');
            else await sendMessage(userId, result, '私聊');
          } else {
            // 模糊搜索游戏名
            if (isGroup) await sendMessage(groupId, `正在搜索「${gameArg}」...`, '群聊');
            else await sendMessage(userId, `正在搜索「${gameArg}」...`, '私聊');
            handleGameNameSearch(userId, isGroup ? groupId : userId, isGroup ? '群聊' : '私聊', gameArg);
          }
          return;
        }

        if (lowerText.startsWith('取消订阅游戏 ')) {
          if (!isFeatureEnabled('steamSubscribe')) {
            commandHandled = true;
            const msg = featureDisabledReply('Steam订阅');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          const gameArg = text.substring('取消订阅游戏 '.length).trim();
          const appIdNum = Number(gameArg);
          let result: string;
          const subs = steamSubscriptions.get(userId);
          if (!subs || subs.length === 0) {
            result = '你还没有任何订阅呢！';
          } else {
            let removed: number;
            if (!isNaN(appIdNum) && appIdNum > 0) {
              const before = subs.length;
              steamSubscriptions.set(userId, subs.filter(s => !(s.type === 'game' && s.appId === appIdNum)));
              removed = before - (steamSubscriptions.get(userId)?.length || 0);
            } else {
              const before = subs.length;
              steamSubscriptions.set(userId, subs.filter(s => !(s.type === 'game' && s.gameName === gameArg)));
              removed = before - (steamSubscriptions.get(userId)?.length || 0);
            }
            if (steamSubscriptions.get(userId)?.length === 0) steamSubscriptions.delete(userId);
            saveSteamSubscriptions();
            result = removed > 0 ? '已取消订阅指定的游戏。' : `没找到订阅记录「${gameArg}」。发送「查看订阅」看看已订阅了什么？`;
          }
          if (isGroup) await sendMessage(groupId, result, '群聊');
          else await sendMessage(userId, result, '私聊');
          return;
        }

        if (lowerText === '查看订阅') {
          if (!isFeatureEnabled('steamSubscribe')) {
            commandHandled = true;
            const msg = featureDisabledReply('Steam订阅');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          const result = handleViewSubscriptions(userId);
          if (isGroup) {
            await sendMessage(groupId, result, '群聊');
          } else {
            await sendMessage(userId, result, '私聊');
          }
          return;
        }

        // Prompt commands
        if (lowerText === '重置prompt' || lowerText === '恢复默认' || lowerText === '提前结束') {
          if (!isFeatureEnabled('promptControl')) {
            commandHandled = true;
            const msg = featureDisabledReply('Prompt调节');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          tempPromptOverride = null;
          tempPromptExpiry = new Date(0);
          console.log('[指令中枢] 已清除所有临时设定');
          const result = '哼，临时设定已全部清除！本小姐变回原来的星野啦~';
          if (isGroup) {
            await sendMessage(groupId, result, '群聊');
          } else {
            await sendMessage(userId, result, '私聊');
          }
          return;
        }

        if (lowerText === '查看prompt' || lowerText === 'prompt状态') {
          if (!isFeatureEnabled('promptControl')) {
            commandHandled = true;
            const msg = featureDisabledReply('Prompt调节');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          let result: string;
          
          if (tempPromptOverride && new Date() < tempPromptExpiry) {
            const remaining = tempPromptExpiry.getTime() - Date.now();
            const remainingStr = remaining >= 60000 
              ? `${Math.floor(remaining / 60000)}分钟` 
              : `${Math.floor(remaining / 1000)}秒`;
            result = `当前有临时设定哦~\n指令：${tempPromptOverride}\n剩余时间：${remainingStr}（${tempPromptExpiry.toLocaleTimeString('zh-CN', { hour12: false })}到期）\n发送「重置prompt」可以提前结束！`;
          } else {
            result = '当前没有任何临时设定，本小姐是默认的星野状态！\n发送「调整prompt [分钟数] [指令]」来临时调整我的行为~';
          }
          
          if (isGroup) {
            await sendMessage(groupId, result, '群聊');
          } else {
            await sendMessage(userId, result, '私聊');
          }
          return;
        }

        if (lowerText.startsWith('调整prompt ') || lowerText.startsWith('临时设定 ')) {
          if (!isFeatureEnabled('promptControl')) {
            commandHandled = true;
            const msg = featureDisabledReply('Prompt调节');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          const rawArgs = text.substring(text.indexOf(' ') + 1).trim();
          let durationMin = 0;
          let instructions: string;
          
          const firstSpace = rawArgs.indexOf(' ');
          if (firstSpace > 0 && !isNaN(Number(rawArgs.substring(0, firstSpace)))) {
            durationMin = Number(rawArgs.substring(0, firstSpace));
            instructions = rawArgs.substring(firstSpace + 1).trim();
          } else {
            instructions = rawArgs;
          }
          
          if (!instructions) {
            const result = '喂！格式不对啦！正确格式：调整prompt [分钟数] [指令内容]\n例如：调整prompt 30 从现在开始叫我主人大人';
            if (isGroup) {
              await sendMessage(groupId, result, '群聊');
            } else {
              await sendMessage(userId, result, '私聊');
            }
            return;
          }
          
          tempPromptOverride = instructions;
          tempPromptExpiry = durationMin > 0 
            ? new Date(Date.now() + durationMin * 60 * 1000) 
            : new Date('2099-12-31');
          
          const expiryDesc = durationMin > 0 
            ? `${durationMin}分钟（${tempPromptExpiry.toLocaleTimeString('zh-CN', { hour12: false })}到期）` 
            : '永久有效（直到发送「重置prompt」）';
          
          console.log(`[指令中枢] 捕获「调整Prompt」指令: ${instructions}`);
          console.log(`         └─ 有效期: ${expiryDesc}`);
          
          const result = `哼，临时设定已生效！\n新规则：${instructions}\n有效期：${expiryDesc}\n发送「重置prompt」或说「提前结束」可以随时取消哦~`;
          if (isGroup) {
            await sendMessage(groupId, result, '群聊');
          } else {
            await sendMessage(userId, result, '私聊');
          }
          return;
        }

        // ===== 查询5E战绩 / 官匹战绩 (多账号支持) =====
        if (lowerText === '查询5e战绩' || lowerText === '查询官匹战绩') {
          if (!isFeatureEnabled('cs2Stats')) {
            commandHandled = true;
            const msg = featureDisabledReply('CS2战绩查询');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          const platform = lowerText.includes('5e') ? '5e' : 'steam';
          handleMultiAccountQuery(userId, isGroup ? groupId : userId, isGroup ? '群聊' : '私聊', platform, 'query_game', false);
          return;
        }

        // ===== 查询Steam游戏时长 (个人) =====
        if (lowerText === '查询steam游戏时长' || lowerText === '查询steam最近游戏时长') {
          if (!isFeatureEnabled('steamPlaytime')) {
            commandHandled = true;
            const msg = featureDisabledReply('Steam游戏时长');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          const recent = lowerText.includes('最近');
          handleMultiAccountQuery(userId, isGroup ? groupId : userId, isGroup ? '群聊' : '私聊', 'steam', 'query_steam_time', recent);
          return;
        }

        // ===== 查询Steam游戏时长 (排行) =====
        if (lowerText === '查询steam游戏时长排行' || lowerText === '查询steam最近游戏时长排行') {
          if (!isFeatureEnabled('steamPlaytime')) {
            commandHandled = true;
            const msg = featureDisabledReply('Steam游戏时长');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          const recent = lowerText.includes('最近');
          const progressMsg = recent ? '哼，正在同时查询所有绑定用户的 Steam 最近两周游戏时长...' : '哼，正在同时查询所有绑定用户的 Steam 总游戏时长，给我等着~';
          if (isGroup) await sendMessage(groupId, progressMsg, '群聊');
          else await sendMessage(userId, progressMsg, '私聊');
          handleSteamPlaytimeRank(userId, isGroup ? groupId : userId, isGroup ? '群聊' : '私聊', recent);
          return;
        }

        // ===== 查询促销 =====
        if (lowerText === '查询促销' || lowerText === '查促销') {
          if (!isFeatureEnabled('steamDealReport')) {
            commandHandled = true;
            const msg = featureDisabledReply('促销查询');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          if (isGroup) await sendMessage(groupId, '正在爬取 Steam 特惠，结果私聊发给你~', '群聊');
          else await sendMessage(userId, '正在爬取 Steam 特惠，稍等...', '私聊');
          ProactiveEngine.runSteamDealBroadcast(userId).catch(e => {
            console.error('[Steam雷达] 按需唤醒异常:', e);
            sendMessage(userId, `查询促销失败: ${e.message}`, '私聊');
          });
          return;
        }

        // ===== 今日战报 =====
        if (lowerText === '今日战报' || lowerText === '查询战报') {
          if (!isFeatureEnabled('steamDealReport')) {
            commandHandled = true;
            const msg = featureDisabledReply('今日战报');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          if (isGroup) await sendMessage(groupId, '战报生成中，私聊发给你~', '群聊');
          else await sendMessage(userId, '战报生成中...', '私聊');
          ProactiveEngine.run5EReportForUser(userId).catch(e => {
            console.error('[5E战报] 按需唤醒异常:', e);
          });
          return;
        }

        // ===== B站视频链接嗅探 =====
        if (!commandHandled && text.trim() && BiliVideo.containsBiliUrl(text)) {
          if (!isFeatureEnabled('biliVideo')) {
            commandHandled = true;
            const msg = featureDisabledReply('B站视频嗅探');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          const biliUrl = BiliVideo.extractBiliUrl(text);
          if (biliUrl) {
            console.log(`[BiliVideo] 嗅探到 B站 链接: ${biliUrl}`);
            const notice = '[系统] 嗅探到 B站 链接，正在为您拉取并合成高清视频，请稍候...';
            if (isGroup) {
              await sendMessage(groupId, notice, '群聊');
            } else {
              await sendMessage(userId, notice, '私聊');
            }

            try {
              const result = await BiliVideo.fetchAndMux(biliUrl);
              if (result.success && result.filePath) {
                const fileSizeMB = (fs.statSync(result.filePath).size / 1024 / 1024).toFixed(1);
                console.log(`[BiliVideo] 投递视频: ${result.title} (${fileSizeMB}MB)`);
                // Send video via CQ code
                const videoMsg = `[CQ:video,file=${result.filePath}]`;
                if (isGroup) {
                  await sendMessage(groupId, videoMsg, '群聊');
                } else {
                  await sendMessage(userId, videoMsg, '私聊');
                }
                // Also send title
                const titleMsg = `[CQ:at,qq=${userId}] 📺 ${result.title}`;
                if (isGroup) {
                  await sendMessage(groupId, titleMsg, '群聊');
                }
              } else {
                console.log(`[BiliVideo] 失败: ${result.errorMessage}`);
                const errMsg = `[系统强行介入] 视频拉取失败：${result.errorMessage}`;
                if (isGroup) {
                  await sendMessage(groupId, errMsg, '群聊');
                } else {
                  await sendMessage(userId, errMsg, '私聊');
                }
              }
            } catch (ex: any) {
              console.error(`[BiliVideo] 处理异常: ${ex.message}`);
            }
          }
          return;
        }

        // ===== B站登录（仅管理员） =====
        if (!commandHandled && (lowerText === 'b站登录' || lowerText === 'bilibili登录' || lowerText === 'b站tv登录') && userId === ADMIN_QQ) {
          if (!isFeatureEnabled('biliLogin')) {
            commandHandled = true;
            const msg = featureDisabledReply('B站TV登录');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          commandHandled = true;
          console.log(`[BiliLogin] 管理员 ${userId} 发起 B站 TV 扫码登录...`);
          const loginResult = BiliVideo.startLoginTv();

          if (loginResult.errorMessage) {
            const errMsg = `[系统] ${loginResult.errorMessage}`;
            if (isGroup) await sendMessage(groupId, errMsg, '群聊');
            else await sendMessage(userId, errMsg, '私聊');
          } else {
            // Send QR code image
            const qrHint = '\n📱 请用 B站 APP 扫描上方二维码完成 TV 端登录\n⏰ 3 分钟内有效，扫码后等待提示即可~';
            if (loginResult.qrCodePath && fs.existsSync(loginResult.qrCodePath)) {
              const qrMsg = `[CQ:image,file=${loginResult.qrCodePath}]${qrHint}`;
              if (isGroup) await sendMessage(groupId, qrMsg, '群聊');
              else await sendMessage(userId, qrMsg, '私聊');
            }

            // Wait for login result (non-blocking via setTimeout)
            BiliVideo.waitForLogin(loginResult).then(async (result) => {
              const resultMsg = result.success
                ? `[系统] ${result.message}`
                : `[系统] ${result.errorMessage}`;
              if (isGroup) await sendMessage(groupId, resultMsg, '群聊');
              else await sendMessage(userId, resultMsg, '私聊');
            });
          }
          return;
        }

        // ---- Genshin Guide Commands ----
        const isGSCommand = lowerText.startsWith('gs ') || lowerText.startsWith('攻略 ')
          || lowerText.startsWith('ysb ') || lowerText.startsWith('绑定uid ') || lowerText.startsWith('绑定UID ')
          || lowerText.startsWith('解绑uid ') || lowerText.startsWith('解绑UID ')
          || /面板$/.test(lowerText);
        if (!commandHandled && isGSCommand) {
          commandHandled = true;
          if (!isFeatureEnabled('genshinGuide')) {
            const disabledMsg = '[系统]「原神攻略」功能当前已关闭，请联系管理员开启~';
            if (isGroup) await sendMessage(groupId, disabledMsg, '群聊');
            else await sendMessage(userId, disabledMsg, '私聊');
            return;
          }
          try {
            const chatType: '私聊' | '群聊' = isGroup ? '群聊' : '私聊';
            const result = await GenshinGuide.matchAndExecute(text, isGroup ? groupId : userId, chatType);
            if (result) {
              if (Buffer.isBuffer(result)) {
                const tmpPath = path.join(__dirname, 'data', `gs_${Date.now()}.png`);
                fs.writeFileSync(tmpPath, result);
                const imageMsg = `[CQ:image,file=${tmpPath}]`;
                if (isGroup) await sendMessage(groupId, imageMsg, '群聊');
                else await sendMessage(userId, imageMsg, '私聊');
              } else {
                if (isGroup) await sendMessage(groupId, result, '群聊');
                else await sendMessage(userId, result, '私聊');
              }
            }
          } catch (err: any) {
            console.error('[GenshinGuide] 命令执行失败:', err.message);
            const errMsg = `[系统] 原神攻略功能异常: ${err.message}`;
            if (isGroup) await sendMessage(groupId, errMsg, '群聊');
            else await sendMessage(userId, errMsg, '私聊');
          }
          return;
        }

        // AI chat (via TaskManager queue)
        if (!commandHandled && (text.trim() || imageUrl)) {
          if (!isFeatureEnabled('aiChat')) {
            botStatus.commandsHandled++;
            const msg = featureDisabledReply('AI对话');
            if (isGroup) { await sendMessage(groupId, msg, '群聊'); return; }
            else { await sendMessage(userId, msg, '私聊'); return; }
          }
          if (!isFeatureEnabled('aiVision') && imageUrl) {
            imageUrl = '';
          }
          botStatus.commandsHandled++;

          taskManager.enqueue({
            userId,
            groupId,
            chatType: isGroup ? '群聊' : '私聊',
            type: 'ai_chat',
            label: 'AI对话',
            execute: async () => {
              const aiResponse = await processAiChat(userId, text, isGroup ? '群聊' : '私聊', imageUrl);
              if (aiResponse.startsWith('__DRAW_IMAGE__')) {
                const imgUrl = aiResponse.substring('__DRAW_IMAGE__'.length);
                const imageMsg = `[CQ:image,file=${imgUrl}]`;
                if (isGroup) { await sendMessage(groupId, imageMsg, '群聊'); }
                else { await sendMessage(userId, imageMsg, '私聊'); }
              } else {
                if (isGroup) { await sendMessage(groupId, aiResponse, '群聊'); }
                else { await sendMessage(userId, aiResponse, '私聊'); }
              }
            }
          });
        }
      }
    } catch (error) {
      console.error('[系统] 处理消息异常:', error);
    }
  });
}

// ================= API Endpoints =================
app.get('/api/status', (req, res) => {
  const uptime = Math.floor((Date.now() - botStatus.startTime) / 1000);
  
  // Update dynamic stats
  botStatus.connectedGroups = groupNameCache.size || knownGroups.size;
  botStatus.boundUsers = playerBindings.size;
  botStatus.steamSubscribers = steamSubscriptions.size;
  
  res.json({
    success: true,
    data: {
      ...botStatus,
      totalMessages: persistentStats.totalMessages,
      uptime
    }
  });
});

app.get('/api/groups', (req, res) => {
  res.json({
    success: true,
    data: Array.from(knownGroups)
  });
});

app.get('/api/bindings/:userId', (req, res) => {
  const userId = Number(req.params.userId);
  const accounts = playerBindings.get(userId) || [];
  res.json({
    success: true,
    data: accounts
  });
});

app.get('/api/subscriptions/:userId', (req, res) => {
  const userId = Number(req.params.userId);
  const subs = steamSubscriptions.get(userId) || [];
  res.json({
    success: true,
    data: subs
  });
});

// ================= New API Endpoints =================

// Token stats
app.get('/api/token-stats', (req, res) => {
  const stats = Array.from(dailyTokenStats.values()).sort((a, b) => b.date.localeCompare(a.date));
  const totalTokens = stats.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalRequests = stats.reduce((sum, s) => sum + s.requestCount, 0);
  res.json({
    success: true,
    data: {
      daily: stats.slice(-30),
      totalTokens,
      totalRequests
    }
  });
});

// Groups with names (only from live SnowLuna data)
app.get('/api/groups-detail', (req, res) => {
  const groups = Array.from(groupNameCache.entries()).map(([id, name]) => ({
    id,
    name: name || `群组 ${id}`
  }));
  // Fallback to knownGroups if cache is empty
  if (groups.length === 0) {
    for (const id of knownGroups) {
      groups.push({ id, name: `群组 ${id}` });
    }
  }
  res.json({
    success: true,
    data: groups
  });
});

// Send message from dashboard
app.post('/api/send-message', (req, res) => {
  const { groupId, message } = req.body;
  if (!groupId || !message) {
    res.status(400).json({ success: false, error: '缺少参数' });
    return;
  }
  
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    res.status(503).json({ success: false, error: 'SnowLuna 未连接' });
    return;
  }
  
  const payload = {
    action: 'send_group_msg',
    params: { group_id: Number(groupId), message },
    echo: `dashboard_msg_${Date.now()}`
  };
  
  ws.send(JSON.stringify(payload));
  console.log(`[Dashboard] 发送消息到群 ${groupId}: ${message.substring(0, 50)}...`);
  res.json({ success: true });
});

// Refresh group names
app.post('/api/refresh-groups', (req, res) => {
  fetchGroupNames();
  res.json({ success: true, message: '正在刷新群列表' });
});

// Version info
app.get('/api/version', (req, res) => {
  let release = APP_VERSION;
  let build = 0;
  try {
    const version = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    release = version.release || release;
    build = Number(version.build || 0);
  } catch {}
  res.json({ success: true, version: APP_VERSION, release, build });
});

app.get('/api/check-update', async (req, res) => {
  try {
    const result = await createUpdater().checkForUpdates();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.json({ success: false, hasUpdate: false, error: error.message });
  }
});

app.post('/api/apply-update', async (req, res) => {
  try {
    const updaterScript = path.join(APP_ROOT, 'updater', 'server-update.js');
    if (!fs.existsSync(updaterScript)) throw new Error('Server updater is missing from this installation');
    const child = spawn(process.execPath, [updaterScript, 'apply'], {
      cwd: APP_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    res.json({ success: true, message: 'Update started; services will restart shortly.' });
    setTimeout(() => process.exit(0), 1500);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================= Settings API Endpoints =================

// Get all user bindings
app.get('/api/bindings', (req, res) => {
  const result: any[] = [];
  playerBindings.forEach((accounts, userId) => {
    result.push({ userId, accounts });
  });
  res.json({ success: true, data: result });
});

// Get all Steam subscriptions
app.get('/api/subscriptions', (req, res) => {
  const result: any[] = [];
  steamSubscriptions.forEach((subs, userId) => {
    result.push({ userId, subscriptions: subs });
  });
  res.json({ success: true, data: result });
});

// Unbind a specific account
app.post('/api/unbind', (req, res) => {
  const { userId, platform, accountId } = req.body;
  if (!userId || !platform || !accountId) {
    res.status(400).json({ success: false, error: '缺少参数' });
    return;
  }
  const accounts = playerBindings.get(userId);
  if (!accounts) {
    res.json({ success: false, error: '未找到该用户' });
    return;
  }
  const idx = accounts.findIndex(a => a.platform === platform && a.accountId === accountId);
  if (idx === -1) {
    res.json({ success: false, error: '未找到该绑定' });
    return;
  }
  accounts.splice(idx, 1);
  if (accounts.length === 0) playerBindings.delete(userId);
  saveBindings();
  res.json({ success: true, message: '已解绑' });
});

// Remove a Steam subscription
app.post('/api/unsubscribe', (req, res) => {
  const { userId, type, appId } = req.body;
  if (!userId) {
    res.status(400).json({ success: false, error: '缺少参数' });
    return;
  }
  const subs = steamSubscriptions.get(userId);
  if (!subs) {
    res.json({ success: false, error: '未找到该用户订阅' });
    return;
  }
  if (type === 'general') {
    steamSubscriptions.set(userId, subs.filter(s => s.type !== 'general'));
  } else if (type === 'game' && appId) {
    steamSubscriptions.set(userId, subs.filter(s => !(s.type === 'game' && s.appId === appId)));
  }
  if (steamSubscriptions.get(userId)!.length === 0) steamSubscriptions.delete(userId);
  saveSteamSubscriptions();
  res.json({ success: true, message: '已取消订阅' });
});

// Get all known groups with names (only currently joined groups)
app.get('/api/all-groups', (req, res) => {
  const groups = Array.from(groupNameCache.entries()).map(([id, name]) => ({
    id, name: name || `群组 ${id}`
  }));
  // Fallback to persistent knownGroups if cache is empty (e.g. startup)
  if (groups.length === 0) {
    for (const gid of knownGroups) {
      groups.push({ id: gid, name: `群组 ${gid}` });
    }
  }
  res.json({ success: true, data: groups });
});

// ================= Feature Flags =================
interface FeatureFlags {
  aiChat: boolean;          // AI对话
  aiVision: boolean;        // AI识图（发送图片给AI）
  aiDraw: boolean;          // AI画图（draw_image工具）
  biliVideo: boolean;       // B站视频嗅探下载
  cs2Stats: boolean;        // CS2战绩查询
  steamPlaytime: boolean;   // Steam游戏时长查询+排行
  steamSubscribe: boolean;  // Steam订阅系统
  steamDealReport: boolean; // 促销查询+今日战报
  promptControl: boolean;   // Prompt调节（临时设定）
  accountBind: boolean;     // 账号绑定/解绑
  biliLogin: boolean;       // B站TV扫码登录
  genshinGuide: boolean;    // 原神角色攻略
}

const DEFAULT_FEATURES: FeatureFlags = {
  aiChat: true,
  aiVision: true,
  aiDraw: true,
  biliVideo: true,
  cs2Stats: true,
  steamPlaytime: true,
  steamSubscribe: true,
  steamDealReport: true,
  promptControl: true,
  accountBind: true,
  biliLogin: true,
  genshinGuide: true,
};

// ================= Settings Config System =================
interface SystemConfig {
  wakeEnabledGroups: number[];
  broadcastEnabled: boolean;
  broadcastAdminOnly: boolean;
  broadcastEnabledGroups: number[];
  updateLog: string;
  customPrompt: string;
  featureFlags: FeatureFlags;
}

const DEFAULT_CONFIG: SystemConfig = {
  wakeEnabledGroups: [],
  broadcastEnabled: false,
  broadcastAdminOnly: true,
  broadcastEnabledGroups: [],
  updateLog: '',
  customPrompt: '',
  featureFlags: { ...DEFAULT_FEATURES }
};

const configFile = path.join(__dirname, 'data', 'system_config.json');
let sysConfig: SystemConfig = { ...DEFAULT_CONFIG };

function loadSysConfig() {
  try {
    if (fs.existsSync(configFile)) {
      const data = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      sysConfig = { ...DEFAULT_CONFIG, ...data };
      console.log(`[系统配置] 已加载`);
    }
  } catch (e) { console.error('[系统配置] 加载失败:', e); }
}

function saveSysConfig() {
  try {
    ensureDataDir();
    fs.writeFileSync(configFile, JSON.stringify(sysConfig, null, 2));
  } catch (e) { console.error('[系统配置] 保存失败:', e); }
}

app.get('/api/sysconfig', (req, res) => {
  res.json({ success: true, data: sysConfig });
});

app.post('/api/sysconfig', (req, res) => {
  const body = req.body;
  if (body.wakeEnabledGroups !== undefined) sysConfig.wakeEnabledGroups = body.wakeEnabledGroups;
  if (body.broadcastEnabled !== undefined) sysConfig.broadcastEnabled = body.broadcastEnabled;
  if (body.broadcastAdminOnly !== undefined) sysConfig.broadcastAdminOnly = body.broadcastAdminOnly;
  if (body.broadcastEnabledGroups !== undefined) sysConfig.broadcastEnabledGroups = body.broadcastEnabledGroups;
  if (body.updateLog !== undefined) sysConfig.updateLog = body.updateLog;
  if (body.customPrompt !== undefined) {
    sysConfig.customPrompt = body.customPrompt;
    // Sync with live prompt system
    if (sysConfig.customPrompt.trim()) {
      tempPromptOverride = sysConfig.customPrompt;
      tempPromptExpiry = new Date('2099-12-31');
    } else {
      tempPromptOverride = null;
      tempPromptExpiry = new Date(0);
    }
  }
  saveSysConfig();
  res.json({ success: true, data: sysConfig });
});

// ================= Feature Flags API =================
function isFeatureEnabled(feature: keyof FeatureFlags): boolean {
  return sysConfig.featureFlags?.[feature] === true || sysConfig.featureFlags?.[feature] === undefined;
}

function featureDisabledReply(feature: string): string {
  return `[系统]「${feature}」功能当前已关闭，请联系管理员开启~`;
}

app.get('/api/features', (req, res) => {
  res.json({ success: true, data: sysConfig.featureFlags || DEFAULT_FEATURES });
});

app.post('/api/features', (req, res) => {
  const body = req.body;
  if (!sysConfig.featureFlags) {
    sysConfig.featureFlags = { ...DEFAULT_FEATURES };
  }
  for (const key of Object.keys(DEFAULT_FEATURES) as (keyof FeatureFlags)[]) {
    if (typeof body[key] === 'boolean') {
      sysConfig.featureFlags[key] = body[key];
    }
  }
  saveSysConfig();
  console.log('[功能开关] 已更新:', JSON.stringify(sysConfig.featureFlags));
  res.json({ success: true, data: sysConfig.featureFlags });
});

app.post('/api/broadcast', async (req, res) => {
  if (!sysConfig.broadcastEnabled) {
    res.json({ success: false, error: '广播功能已关闭' });
    return;
  }
  if (!sysConfig.updateLog.trim()) {
    res.json({ success: false, error: '更新日志为空' });
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    res.json({ success: false, error: 'SnowLuna 未连接' });
    return;
  }
  const targets = sysConfig.broadcastEnabledGroups.length > 0
    ? sysConfig.broadcastEnabledGroups
    : Array.from(groupNameCache.keys());
  let sent = 0;
  for (const gid of targets) {
    try {
      ws.send(JSON.stringify({
        action: 'send_group_msg',
        params: { group_id: gid, message: `【星野更新公告】\n${sysConfig.updateLog}` },
        echo: `broadcast_${Date.now()}_${gid}`
      }));
      sent++;
      await new Promise(r => setTimeout(r, 500));
    } catch {}
  }
  console.log(`[广播] 已发送到 ${sent}/${targets.length} 个群`);
  res.json({ success: true, message: `已广播到 ${sent} 个群` });
});

app.post('/api/restart', (req, res) => {
  res.json({ success: true, message: '正在重启...' });
  console.log('[系统] 收到重启指令');
  setTimeout(() => {
    const { execSync } = require('child_process');
    try {
      execSync('pm2 restart xingye-backend', { stdio: 'ignore', timeout: 5000 });
    } catch {}
    process.exit(0);
  }, 500);
});

app.post('/api/shutdown', (req, res) => {
  const { execSync } = require('child_process');
  try {
    execSync('pm2 stop xingye-snowluma xingye-backend xingye-frontend && pm2 delete xingye-snowluma xingye-backend xingye-frontend', { stdio: 'ignore', timeout: 10000 });
    res.json({ success: true, message: '已关闭所有服务' });
  } catch (e) {
    res.json({ success: false, error: '关闭失败' });
  }
  console.log('[系统] 收到关闭指令');
  setTimeout(() => process.exit(0), 1000);
});

// ================= Start Server =================
const PORT = 3000;

// Load version info
const versionFile = path.join(APP_ROOT, 'version.json');
let APP_VERSION = '0.0.0-dev';
try {
  if (fs.existsSync(versionFile)) {
    const v = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    APP_VERSION = v.version || '0.0.0-dev';
    console.log(`[版本] ${APP_VERSION}`);
  }
} catch (e) { /* ignore */ }

// Load persisted data
loadBindings();
loadSteamSubscriptions();
loadKnownGroups();
loadTokenStats();
loadPersistentStats();
loadSysConfig();
loadFriendWhitelist();
loadFriendRequests();

// Startup: clean temp videos & diagnose FFmpeg
BiliVideo.purgeTempDirectory();
BiliVideo.diagnoseFfmpeg();

const server = http.createServer(app);

// Dashboard WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  dashboardClients.add(ws);
  console.log(`[Dashboard] 客户端连接 (当前 ${dashboardClients.size} 个)`);
  
  // Send log history on connect
  ws.send(JSON.stringify({ type: 'history', data: logHistory }));
  
  // Send initial metrics
  const memUsage = process.memoryUsage();
  ws.send(JSON.stringify({
    type: 'metrics',
    data: {
      uptime: Math.floor((Date.now() - botStatus.startTime) / 1000),
      memoryMB: Math.round(memUsage.rss / 1024 / 1024),
      gcMemoryMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      totalAiRequests: botStatus.aiRequests,
      totalAiErrors: botStatus.aiErrors,
      commandsHandled: botStatus.commandsHandled,
      sessionMessages: botStatus.sessionMessages,
      totalMessages: persistentStats.totalMessages,
      connectedGroups: groupNameCache.size || knownGroups.size,
      boundUsers: playerBindings.size,
      steamSubscribers: steamSubscriptions.size,
      activeWsConnections: dashboardClients.size,
      timestamp: new Date().toISOString()
    }
  }));
  
  ws.on('message', (data: WebSocket.Data) => {
    try {
      const message = data.toString();
      console.log(`[Dashboard CLI] 收到命令: ${message}`);
      const result = handleCliCommand(message);
      ws.send(JSON.stringify({ type: 'cli_result', data: { command: message, result } }));
    } catch (error) {
      console.error('[Dashboard CLI] 命令处理错误:', error);
    }
  });
  
  ws.on('close', () => {
    dashboardClients.delete(ws);
    console.log(`[Dashboard] 客户端断开 (剩余 ${dashboardClients.size} 个)`);
  });
  
  ws.on('error', (error: Error) => {
    console.error('[Dashboard] WebSocket 错误:', error.message);
    dashboardClients.delete(ws);
  });
});

// ================= 好友管理 API =================

app.get('/api/friend-whitelist', (req, res) => {
  res.json({ success: true, data: Array.from(friendWhitelist).sort((a, b) => a - b) });
});

app.post('/api/friend-whitelist/add', (req, res) => {
  const { qq } = req.body;
  if (!qq || typeof qq !== 'number') return res.status(400).json({ success: false, error: '缺少有效的 QQ 号' });
  friendWhitelist.add(qq);
  saveFriendWhitelist();
  console.log(`[好友白名单] 添加: ${qq} (共 ${friendWhitelist.size} 个)`);
  res.json({ success: true, data: Array.from(friendWhitelist).sort((a, b) => a - b) });
});

app.post('/api/friend-whitelist/remove', (req, res) => {
  const { qq } = req.body;
  if (!qq || typeof qq !== 'number') return res.status(400).json({ success: false, error: '缺少有效的 QQ 号' });
  friendWhitelist.delete(qq);
  saveFriendWhitelist();
  console.log(`[好友白名单] 移除: ${qq} (剩余 ${friendWhitelist.size} 个)`);
  res.json({ success: true, data: Array.from(friendWhitelist).sort((a, b) => a - b) });
});

app.get('/api/friend-requests', (req, res) => {
  const sorted = [...friendRequests].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  res.json({ success: true, data: sorted });
});

app.post('/api/friend-requests/handle', (req, res) => {
  const { flag, approve } = req.body;
  if (!flag || typeof approve !== 'boolean') {
    return res.status(400).json({ success: false, error: '缺少 flag 或 approve 参数' });
  }
  const record = friendRequests.find(r => r.flag === flag);
  if (!record) return res.status(404).json({ success: false, error: '未找到该申请记录' });
  if (record.status !== 'pending') return res.status(400).json({ success: false, error: `该申请已被 ${record.status === 'approved' ? '同意' : '拒绝'}` });

  record.status = approve ? 'approved' : 'rejected';
  record.handledAt = new Date().toISOString();
  saveFriendRequests();

  sendFriendHandle(flag, approve);
  console.log(`[好友申请] ${approve ? '同意' : '拒绝'}: ${record.qq}`);
  res.json({ success: true, data: record });
});

app.post('/api/friend-requests/clear', (req, res) => {
  friendRequests = [];
  saveFriendRequests();
  res.json({ success: true });
});

// ================= 启动自检 =================
async function runSelfCheck() {
  console.log('\n=====================================================');
  console.log('  🔍 功能自检开始...');
  console.log('=====================================================\n');

  interface CheckResult { name: string; status: '✅' | '❌' | '⚠️'; detail: string; }
  const results: CheckResult[] = [];

  // Steam 代理
  const steamProxyUrl = process.env.STEAM_PROXY_URL || '';
  if (steamProxyUrl) {
    try {
      const proxyUrl = new URL(steamProxyUrl);
      const portOpen = await new Promise<boolean>((resolve) => {
        const sock = net.createConnection(Number(proxyUrl.port) || 7890, proxyUrl.hostname, () => {
          sock.destroy(); resolve(true);
        });
        sock.on('error', () => { sock.destroy(); resolve(false); });
        sock.setTimeout(3000, () => { sock.destroy(); resolve(false); });
      });
      if (!portOpen) {
        results.push({ name: 'Steam代理', status: '❌', detail: `${steamProxyUrl} 端口未开放` });
      } else {
        // 通过代理发真实 HTTP 请求验证可用性
        const proxyOk = await new Promise<boolean>((resolve) => {
          const req = http.request({
            hostname: proxyUrl.hostname, port: Number(proxyUrl.port) || 7890,
            method: 'GET', path: 'http://connect.rom.miui.com/generate_204',
            timeout: 8000, setHost: false,
            headers: { Host: 'connect.rom.miui.com' }
          }, (res) => { res.resume(); resolve(res.statusCode === 204); });
          req.on('error', () => resolve(false));
          req.on('timeout', () => { req.destroy(); resolve(false); });
          req.end();
        });
        results.push({ name: 'Steam代理', status: proxyOk ? '✅' : '❌', detail: proxyOk ? `${steamProxyUrl} 代理透传正常` : `${steamProxyUrl} 端口开放但请求失败（节点/规则问题？）` });
      }
    } catch (e: any) {
      results.push({ name: 'Steam代理', status: '⚠️', detail: `${e.message}` });
    }
  } else {
    results.push({ name: 'Steam代理', status: '⚠️', detail: '未配置 STEAM_PROXY_URL，Steam 功能不可用' });
  }

  // ffmpeg
  try {
    await execFileAsync('ffmpeg', ['-version']);
    results.push({ name: 'ffmpeg', status: '✅', detail: 'PATH 中可用' });
  } catch {
    results.push({ name: 'ffmpeg', status: '❌', detail: 'PATH 中未找到，B站视频合成将失败' });
  }

  // BBDown
  const bbdownPaths = [
    path.join(__dirname, '..', 'BBDown', 'BBDown.exe'),
    path.join(__dirname, '..', 'BBDown.exe'),
    path.join(__dirname, 'BBDown', 'BBDown.exe'),
    path.join(__dirname, 'BBDown.exe'),
  ];
  const bbdownFound = bbdownPaths.some(p => fs.existsSync(p));
  results.push({ name: 'BBDown', status: bbdownFound ? '✅' : '❌', detail: bbdownFound ? '已就绪' : '未找到 BBDown.exe，B站视频下载将失败' });

  // 5E API
  try {
    const probe = await fetch('https://api.5ewin.com/api/status', { signal: AbortSignal.timeout(5000) });
    results.push({ name: '5E API', status: '✅', detail: `${probe.status}` });
  } catch (e: any) {
    results.push({ name: '5E API', status: '⚠️', detail: `不可达: ${e.message}（不影响核心功能）` });
  }

  // 豆包画图
  const drawOk = !!(process.env.DOUBAO_API_KEY || DOUBAO_API_KEY) && !!(process.env.DOUBAO_DRAW_MODEL || DOUBAO_DRAW_MODEL);
  results.push({ name: '豆包画图', status: drawOk ? '✅' : '❌', detail: drawOk ? `模型: ${process.env.DOUBAO_DRAW_MODEL || DOUBAO_DRAW_MODEL}` : '未配置 DOUBAO_API_KEY 或 DOUBAO_DRAW_MODEL' });

  // 打印结果
  const maxNameLen = Math.max(...results.map(r => r.name.length));
  for (const r of results) {
    console.log(`  ${r.status}  ${r.name.padEnd(maxNameLen)}  ${r.detail}`);
  }

  const failed = results.filter(r => r.status === '❌').length;
  const warned = results.filter(r => r.status === '⚠️').length;
  console.log(`\n  📊 总计: ${results.length} 项 · ✅ ${results.length - failed - warned} · ⚠️ ${warned} · ❌ ${failed}\n`);
}

server.listen(PORT, () => {
  console.log('=====================================================');
  console.log(`  🚀 星野 v${APP_VERSION} [TypeScript Edition] 启动中...`);
  console.log('=====================================================\n');
  console.log(`[系统] Bot backend running on http://localhost:${PORT}`);
  console.log(`[系统] Dashboard WebSocket: ws://localhost:${PORT}`);
  console.log(`[系统] 正在连接 SnowLuna WebSocket...`);
  
  connectWebSocket();
  runSelfCheck();

  // 初始化原神攻略模块
  GenshinGuide.init().catch(e => console.error('[GenshinGuide] 初始化失败:', e.message));
});

// 进程退出时释放 GenshinGuide 资源 (Playwright 浏览器)
process.on('SIGINT', async () => {
  await GenshinGuide.shutdown();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await GenshinGuide.shutdown();
  process.exit(0);
});
