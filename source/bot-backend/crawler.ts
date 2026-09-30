import { ProxyAgent } from 'undici';

const STEAM_API_KEY = process.env.STEAM_API_KEY || '';
const STEAM_API_BASE = process.env.STEAM_API_BASE || 'https://api.steampowered.com';
const STEAM_STORE_BASE = process.env.STEAM_STORE_BASE || 'https://store.steampowered.com';
const STEAM_PROXY_URL = process.env.STEAM_PROXY_URL || '';

// Proxy-aware fetch for Steam endpoints (5E/AI go direct)
import * as net from 'net';

let proxyCooldownUntil = 0;
const PROXY_COOLDOWN_MS = 60_000;

function getProxyAgent(): ProxyAgent | null {
  if (!STEAM_PROXY_URL) return null;
  return new ProxyAgent(STEAM_PROXY_URL);
}

function isProxyReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const u = new URL(STEAM_PROXY_URL);
      const socket = net.createConnection({ host: u.hostname, port: parseInt(u.port) || 7890 });
      socket.setTimeout(2000);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
    } catch { resolve(false); }
  });
}

async function steamFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const canTryProxy = STEAM_PROXY_URL && Date.now() >= proxyCooldownUntil;
  if (canTryProxy && await isProxyReachable()) {
    const agent = getProxyAgent();
    if (agent) {
      try {
        const { fetch: undiciFetch } = await import('undici');
        return undiciFetch(url, { ...options, dispatcher: agent } as any);
      } catch (ex: any) {
        proxyCooldownUntil = Date.now() + PROXY_COOLDOWN_MS;
        console.warn(`[Steam代理] 请求失败: ${ex.message}，冷却${PROXY_COOLDOWN_MS / 1000}s后重试`);
      }
    }
  } else if (STEAM_PROXY_URL && !canTryProxy) {
    // still in cooldown, skip
  } else if (STEAM_PROXY_URL && canTryProxy) {
    proxyCooldownUntil = Date.now() + PROXY_COOLDOWN_MS;
    console.log('[Steam代理] 探活失败，冷却60s');
  }

  return fetch(url, options);
}

const preWarmedGameCache: Record<number, string> = {
  730: 'Counter-Strike 2', 570: 'Dota 2', 578080: 'PUBG: BATTLEGROUNDS',
  1172470: 'Apex Legends', 271590: 'Grand Theft Auto V', 252490: 'Rust',
  440: 'Team Fortress 2', 1085660: 'Destiny 2', 1938090: 'Call of Duty: Modern Warfare III',
  359550: "Tom Clancy's Rainbow Six Siege", 381210: 'Dead by Daylight',
  2923300: 'Monster Hunter Wilds', 1091500: 'Cyberpunk 2077', 1245620: 'ELDEN RING',
  1174180: 'Red Dead Redemption 2', 2920300: 'Kingdom Come: Deliverance II',
  582010: 'Monster Hunter: World', 413150: 'Stardew Valley', 236390: 'War Thunder',
  431960: 'Wallpaper Engine', 739630: 'Phasmophobia', 1599340: 'Lost Ark',
  105600: 'Terraria', 393380: 'Squad', 550: 'Left 4 Dead 2', 620: 'Portal 2',
  289070: "Sid Meier's Civilization VI", 1248130: 'Farming Simulator 22',
  264710: 'Subnautica', 1086940: "Baldur's Gate 3", 892970: 'Valheim',
  227300: 'Euro Truck Simulator 2', 1151640: 'Horizon Zero Dawn', 945360: 'Among Us',
  427520: 'Factorio', 1238810: 'Battlefield 2042', 594650: 'Hunt: Showdown',
  346110: 'ARK: Survival Evolved', 281990: 'Stellaris', 240: 'Counter-Strike: Source',
  218620: 'PAYDAY 2', 374320: 'DARK SOULS III', 377160: 'Fallout 4',
  489830: 'The Elder Scrolls V: Skyrim Special Edition', 4000: "Garry's Mod",
  648800: 'Raft', 242760: 'The Forest', 275850: "No Man's Sky",
  322170: 'Geometry Dash', 238960: 'Path of Exile', 107410: 'Arma 3',
  252950: 'Rocket League', 1446780: 'MONSTER HUNTER RISE',
  367520: 'Hollow Knight', 1942280: 'V Rising', 1690800: 'HELLDIVERS 2',
  1623730: 'Palworld', 2358720: 'Black Myth: Wukong', 1372810: 'NARAKA: BLADEPOINT',
  548430: 'Deep Rock Galactic', 553850: 'HELLDIVERS', 2601650: 'R.E.P.O.',
  2694490: 'FragPunk', 2074920: 'Path of Exile 2', 1850570: 'Schedule I',
  2246340: 'inZOI', 2322011: 'Assetto Corsa EVO', 1326470: 'Sons Of The Forest',
  1948980: 'Marvel Rivals', 1708090: 'Once Human', 1794680: 'Nightingale',
  236110: 'Dungeon Defenders', 230410: 'Warframe', 251570: '7 Days to Die',
  255710: 'Cities: Skylines', 261550: 'Mount & Blade II: Bannerlord',
  270880: 'American Truck Simulator', 271870: 'Planet Coaster',
  276810: 'Mordhau', 282140: 'SOMA', 282860: 'Risk of Rain',
  284160: 'BeamNG.drive', 250900: 'The Binding of Isaac: Rebirth',
   219640: 'Chivalry: Medieval Warfare', 220200: 'Kerbal Space Program',
   221100: 'DayZ', 222880: 'Insurgency',
   232090: 'Killing Floor 2', 233450: 'Prison Architect'
};

const gameNameCache: Record<number, string> = {};
let appListCache: Record<number, string> | null = null;
let appListCacheTime = 0;
let consecutiveNameFailures = 0;

export function normalizeSteamId(steamId: string): string {
  const id = Number(steamId);
  if (!isNaN(id) && id > 0 && id < 76561197960265728) {
    return (id + 76561197960265728).toString();
  }
  return steamId;
}

// ==================== 5E Cookie 管理 ====================
interface CookieStore {
  fiveEToken: string;
  fiveEWinAuthToken: string;
  fiveESession: string;
  fiveEWinSession: string;
  lastUpdated: string;
}

let cachedCookies: CookieStore | null = null;
const cookieFilePath = '5e_cookies.json';
const fs = require('fs');
const path = require('path');

function loadCookies(): CookieStore {
  if (cachedCookies) return cachedCookies;
  try {
    const filePath = path.join(__dirname, cookieFilePath);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      cachedCookies = data;
      return cachedCookies!;
    }
  } catch {}
  cachedCookies = {
    fiveEToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiIxNTc3ODIxOSIsInYiOiIwIiwiYyI6MiwiayI6InYxIiwiY2kiOiIiLCJzdWIiOiI1ZXdpbi5jbiIsImV4cCI6MTc4MjM5MzAyNywibmJmIjoxNzc5ODAxMDE3LCJpYXQiOjE3Nzk4MDEwMjd9.MgB2GBrAITgfSmIuu-TIoW0W-s5JDtTSd2YDkRGqqUg',
    fiveEWinAuthToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiIxNTc3ODIxOSIsInYiOiIwIiwiYyI6MiwiayI6InYxIiwiY2kiOiIiLCJzdWIiOiI1ZXdpbi5jbiIsImV4cCI6MTc4MjM5MzAyOCwibmJmIjoxNzc5ODAxMDE4LCJpYXQiOjE3Nzk4MDEwMjh9.DUsXWjLzMo0X6_rGu92VPUpxckWFHBY2Qkph7mlX2K8',
    fiveESession: 'gnn775qh1p28ov2uo2jtt5v5umcjv0st',
    fiveEWinSession: '8bli9ikjf47qgqnfpmcl2e3o929r6e2s',
    lastUpdated: new Date().toISOString()
  };
  return cachedCookies!;
}

// ==================== 5E 战绩查询 ====================
const CS5E_ENDPOINT = 'https://arena.5eplay.com';

export async function fetch5EStats(username: string): Promise<string> {
  const cookies = loadCookies();
  const cookieHeader = `5e_token=${cookies.fiveEToken}; 5e_session_=${cookies.fiveESession}` +
    (cookies.fiveEWinAuthToken ? `; 5ewin_authtoken=${cookies.fiveEWinAuthToken}` : '') +
    (cookies.fiveEWinSession ? `; 5ewin_session_=${cookies.fiveEWinSession}` : '');

  const response = await fetch(`${CS5E_ENDPOINT}/data/player/home?uid=${encodeURIComponent(username)}`, {
    headers: {
      'Cookie': cookieHeader,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://arena-next.5eplaycdn.com/'
    },
    signal: AbortSignal.timeout(10000)
  });

  const body = await response.text();
  if (body.includes('aliyun_waf') || body.includes('acw_sc__v2') || body.startsWith('<')) {
    return `[5E] 查询被安全防护拦截 (WAF)，请稍后再试或联系管理员刷新 Cookie`;
  }

  try {
    const data = JSON.parse(body);
    return formatPlayerHomeResponse(data, username);
  } catch {
    return `[5E] 数据解析失败，服务器返回格式异常`;
  }
}

function formatPlayerHomeResponse(doc: any, username: string): string {
  try {
    const d = doc.data;
    const s = d.season_data;
    const c = d.career;
    const e = d.elo_info;
    const u = d.uinfo;

    let currentElo = 0;
    const careerElo = c.elo;
    if (e.modes && e.modes['9'] && e.modes['9'].elo != null) {
      currentElo = e.modes['9'].elo;
    }

    const kills = s.kill;
    const deaths = s.death;
    const kd = deaths > 0 ? (kills / deaths).toFixed(2) : 'N/A';

    return `**玩家:** ${u.username}
**段位:** ${eloToRank(currentElo)}
**ELO:** ${currentElo}
━━ **当前赛季 (${s.season})** ━━
  **场次:** ${s.match_total}
  **胜率:** ${(s.per_win_match * 100).toFixed(0)}%
  **Rating:** ${s.rating.toFixed(2)}
  **RWS:** ${s.rws.toFixed(2)}
  **ADR:** ${s.adr.toFixed(2)}
  **K/D:** ${kd} (击杀 ${kills} / 死亡 ${deaths})
  **KAST:** ${(s.kast * 100).toFixed(0)}%
  **爆头率:** ${(s.per_headshot * 100).toFixed(0)}%
  **MVP:** ${s.mvp_total}
━━ **生涯总览** ━━
  **总场次:** ${c.match_total} (胜${c.match_win} / 平${c.match_tie} / 负${c.match_loss})
  **最佳赛季:** ${c.best_season}
  **游戏时长:** ${Math.floor(c.match_time_total / 60)}h
  **最高段位:** ${eloToRank(careerElo)} (ELO ${careerElo})`;
  } catch (ex: any) {
    return `[5E] 数据解析失败: ${ex.message}`;
  }
}

function eloToRank(elo: number): string {
  if (elo >= 2401) return 'S';
  if (elo >= 2301) return 'A++';
  if (elo >= 2151) return 'A+';
  if (elo >= 2001) return 'A';
  if (elo >= 1901) return 'B++';
  if (elo >= 1751) return 'B+';
  if (elo >= 1601) return 'B';
  if (elo >= 1501) return 'C++';
  if (elo >= 1351) return 'C+';
  if (elo >= 1201) return 'C';
  return 'D';
}

// ==================== Steam 官匹战绩 ====================
export async function fetchSteamStats(steamId: string): Promise<string> {
  const steamId64 = normalizeSteamId(steamId);

  const apiResult = await trySteamApi(steamId64);
  if (apiResult) return apiResult;

  return `[Steam 官匹] 查询失败：无法通过 Steam API 获取数据。
请确保：
1. Steam API Key 配置正确
2. 该玩家的 CS2 游戏详情已设为公开`;
}

async function trySteamApi(steamId64: string): Promise<string | null> {
  try {
    const url = `${STEAM_API_BASE}/ISteamUserStats/GetUserStatsForGame/v2/?key=${STEAM_API_KEY}&steamid=${steamId64}&appid=730`;
    const response = await steamFetch(url, { signal: AbortSignal.timeout(10000) });
    const json = await response.json() as any;
    if (!json.playerstats || !json.playerstats.stats) return null;

    const stats = json.playerstats.stats;
    const dict: Record<string, number> = {};
    for (const s of stats) dict[s.name] = s.value;

    const kills = dict.total_kills || 0;
    const deaths = dict.total_deaths || 0;
    const wins = dict.total_matches_won || 0;
    const matches = dict.total_matches_played || 0;
    const hs = dict.total_kills_headshot || 0;
    const damage = dict.total_damage_done || 0;
    const rounds = dict.total_rounds_played || 0;
    const timeSec = dict.total_time_played || 0;

    const kd = deaths > 0 ? (kills / deaths).toFixed(2) : 'N/A';
    const wr = matches > 0 ? ((wins * 100 / matches).toFixed(1) + '%') : 'N/A';
    const hsr = kills > 0 ? ((hs * 100 / kills).toFixed(1) + '%') : 'N/A';
    const adr = rounds > 0 ? Math.round(damage / rounds).toString() : 'N/A';

    let realHours = timeSec / 3600;
    try {
      const ownedUrl = `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v0001/?key=${STEAM_API_KEY}&steamid=${steamId64}&format=json`;
      const ownedResp = await steamFetch(ownedUrl, { signal: AbortSignal.timeout(5000) });
      const ownedJson = await ownedResp.json() as any;
      if (ownedJson?.response?.games) {
        for (const g of ownedJson.response.games) {
          if (g.appid === 730) {
            realHours = g.playtime_forever / 60;
            break;
          }
        }
      }
    } catch {}

    const eloGuess = Math.max(0, Math.min(25000, Math.round(kills * 10 / Math.max(1, matches))));
    const rankEmoji = eloGuess >= 15000 ? '🟣' : eloGuess >= 10000 ? '🟡' : eloGuess >= 5000 ? '🟢' : '⚪';

    return `[Steam 官匹 · 官方 API]
${rankEmoji} Steam ID: ${steamId64}
━━ **总览** ━━
  总场次: ${matches} | 胜场: ${wins} | 胜率: ${wr}
  K/D: ${kd} (击杀: ${kills} | 死亡: ${deaths})
  爆头率: ${hsr}
  ADR: ${adr} | 总伤害: ${damage}
${rankEmoji} CS2 游戏时长: ${realHours.toFixed(0)}h (对战时间: ${(timeSec / 3600).toFixed(0)}h)`;
  } catch (ex: any) {
    console.error(`[Steam API] 查询失败: ${ex.message}`);
    return null;
  }
}

// ==================== Steam 玩家信息 ====================
export async function fetchPlayerName(steamId64: string): Promise<string | null> {
  try {
    const url = `${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${steamId64}`;
    const resp = await steamFetch(url, { signal: AbortSignal.timeout(8000) });
    const json = await resp.json() as any;
    return json?.response?.players?.[0]?.personaname || null;
  } catch {
    return null;
  }
}

// ==================== Steam 游戏列表 ====================
export interface SteamOwnedGame {
  appId: number;
  playtimeForeverMinutes: number;
  playtime2WeeksMinutes: number;
}

export async function fetchAllOwnedGames(steamId64: string): Promise<SteamOwnedGame[] | null> {
  try {
    const url = `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v0001/?key=${STEAM_API_KEY}&steamid=${steamId64}&format=json&include_played_free_games=1`;
    const resp = await steamFetch(url, { signal: AbortSignal.timeout(10000) });
    const json = await resp.json() as any;
    if (!json?.response?.games) return null;
    return json.response.games.map((g: any) => ({
      appId: g.appid,
      playtimeForeverMinutes: g.playtime_forever || 0,
      playtime2WeeksMinutes: g.playtime_2weeks || 0
    }));
  } catch {
    return null;
  }
}

export async function fetchTotalPlaytimeMinutes(steamId64: string): Promise<number> {
  const games = await fetchAllOwnedGames(steamId64);
  if (!games) return -1;
  return games.reduce((sum, g) => sum + g.playtimeForeverMinutes, 0);
}

export async function fetchTotalRecentPlaytimeMinutes(steamId64: string): Promise<number> {
  const games = await fetchAllOwnedGames(steamId64);
  if (!games) return -1;
  return games.reduce((sum, g) => sum + g.playtime2WeeksMinutes, 0);
}

// ==================== Steam 游戏名解析 ====================
async function tryResolveViaAppDetails(appId: number): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = `${STEAM_STORE_BASE}/api/appdetails?appids=${appId}`;
      const resp = await steamFetch(url, { signal: AbortSignal.timeout(12000) });
      const json = await resp.json() as any;
      const key = appId.toString();
      if (!json[key]) return null;
      if (!json[key].success) return null;
      const name = json[key]?.data?.name;
      if (name && typeof name === 'string' && name.trim()) {
        const trimmed = name.trim();
        if (isValidGameName(trimmed)) {
          consecutiveNameFailures = Math.max(0, consecutiveNameFailures - 2);
          return trimmed;
        }
      }
      return null;
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  consecutiveNameFailures++;
  return null;
}

async function tryResolveViaAppList(appId: number): Promise<string | null> {
  try {
    const needLoad = !appListCache || (Date.now() - appListCacheTime) > 24 * 60 * 60 * 1000;
    if (needLoad) {
      const url = `${STEAM_API_BASE}/ISteamApps/GetAppList/v2/`;
      const resp = await steamFetch(url, { signal: AbortSignal.timeout(30000) });
      const json = await resp.json() as any;
      if (json?.applist?.apps) {
        appListCache = {};
        for (const app of json.applist.apps) {
          if (app.name && app.name.trim()) appListCache[app.appid] = app.name.trim();
        }
        appListCacheTime = Date.now();
      }
    }
    if (appListCache && appListCache[appId]) {
      const name = appListCache[appId];
      if (isValidGameName(name)) {
        consecutiveNameFailures = Math.max(0, consecutiveNameFailures - 1);
        return name;
      }
    }
  } catch {}
  return null;
}

async function tryResolveViaStorePage(appId: number): Promise<string | null> {
  try {
    const url = `${STEAM_STORE_BASE}/app/${appId}/`;
    const resp = await steamFetch(url, { signal: AbortSignal.timeout(12000) });
    const html = await resp.text();
    const match = html.match(/<title>([^<]+)<\/title>/i);
    if (match) {
      let title = match[1].replace(/ on Steam$/i, '').trim();
      if (title && title !== 'Welcome to Steam' && title !== 'Steam Store') {
        if (isValidGameName(title)) {
          consecutiveNameFailures = Math.max(0, consecutiveNameFailures - 1);
          return title;
        }
      }
    }
  } catch {}
  return null;
}

function isValidGameName(name: string): boolean {
  if (!name || !name.trim()) return false;
  const trimmed = name.trim();
  if (/^\d+$/.test(trimmed)) return false;
  if (/^[^a-zA-Z0-9\u4e00-\u9fff]+$/.test(trimmed)) return false;
  return true;
}

export async function resolveGameName(appId: number): Promise<string> {
  if (preWarmedGameCache[appId]) return preWarmedGameCache[appId];
  if (gameNameCache[appId]) return gameNameCache[appId];

  let name = await tryResolveViaAppDetails(appId);
  if (name && isValidGameName(name)) { gameNameCache[appId] = name; return name; }

  name = await tryResolveViaAppList(appId);
  if (name && isValidGameName(name)) { gameNameCache[appId] = name; return name; }

  name = await tryResolveViaStorePage(appId);
  if (name && isValidGameName(name)) { gameNameCache[appId] = name; return name; }

  const fallback = `Unknown Game (AppID: ${appId})`;
  gameNameCache[appId] = fallback;
  return fallback;
}

export async function resolveGameNames(appIds: number[]): Promise<Record<number, string>> {
  const result: Record<number, string> = {};
  for (const id of appIds) {
    result[id] = await resolveGameName(id);
    const delay = consecutiveNameFailures >= 3 ? 800 : 400;
    await new Promise(r => setTimeout(r, delay));
  }
  return result;
}

// ==================== Steam 游戏搜索 ====================
export interface SteamSearchResult {
  appId: number;
  name: string;
}

async function trySuggestApi(term: string): Promise<SteamSearchResult[]> {
  try {
    const url = `https://store.steampowered.com/search/suggest?term=${encodeURIComponent(term)}&f=games&l=schinese&cc=cn`;
    const resp = await steamFetch(url, { signal: AbortSignal.timeout(8000) });
    const text = await resp.text();
    if (!text.trim().startsWith('[') && !text.trim().startsWith('{')) return [];
    const data = JSON.parse(text);
    const results: SteamSearchResult[] = [];
    for (const item of data) {
      if (item.type !== 'app') continue;
      const id = Number(item.id);
      if (!isNaN(id) && item.name) {
        results.push({ appId: id, name: item.name });
        if (results.length >= 8) break;
      }
    }
    return results;
  } catch { return []; }
}

async function tryStoreSearchApi(term: string): Promise<SteamSearchResult[]> {
  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=schinese&cc=cn`;
    const resp = await steamFetch(url, { signal: AbortSignal.timeout(8000) });
    const json = await resp.json() as any;
    const results: SteamSearchResult[] = [];
    if (json?.items) {
      for (const item of json.items) {
        const id = Number(item.id);
        if (!isNaN(id) && item.name) {
          results.push({ appId: id, name: item.name });
          if (results.length >= 8) break;
        }
      }
    }
    return results;
  } catch { return []; }
}

async function tryHtmlSearch(term: string): Promise<SteamSearchResult[]> {
  try {
    const url = `https://store.steampowered.com/search/?term=${encodeURIComponent(term)}&category1=998&l=schinese&cc=cn`;
    const resp = await steamFetch(url, { signal: AbortSignal.timeout(10000) });
    const html = await resp.text();
    const appIdRegex = /data-ds-appid="(\d+)"/gi;
    const nameRegex = /<span class="title">([^<]+)<\/span>/gi;
    const appIds: number[] = [];
    const names: string[] = [];
    let m;
    while ((m = appIdRegex.exec(html)) !== null && appIds.length < 8) appIds.push(Number(m[1]));
    while ((m = nameRegex.exec(html)) !== null && names.length < 8) names.push(m[1]);
    const results: SteamSearchResult[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < Math.min(appIds.length, names.length); i++) {
      if (!seen.has(appIds[i])) {
        seen.add(appIds[i]);
        results.push({ appId: appIds[i], name: names[i].trim() });
      }
    }
    return results;
  } catch { return []; }
}

export async function searchSteamGames(term: string): Promise<SteamSearchResult[]> {
  let results: SteamSearchResult[] = [];

  results = await trySuggestApi(term);
  if (results.length === 0) results = await tryStoreSearchApi(term);
  if (results.length === 0) results = await tryHtmlSearch(term);

  return results;
}

// ==================== Steam Deal Radar ====================
const MinOriginalPriceCents = 6000;
const MinReviewCount = 10000;
const MaxDealsToPush = 8;

export interface SteamDeal {
  appId: number;
  name: string;
  originalCents: number;
  finalCents: number;
  discountPct: number;
  reviews: number;
}

export async function fetchSteamDeals(): Promise<SteamDeal[]> {
  console.log('[Steam雷达] 开始爬取 Steam 特惠列表...');

  let resp: Response;
  try {
    resp = await steamFetch('https://store.steampowered.com/api/featuredcategories', {
      signal: AbortSignal.timeout(15000)
    });
  } catch (ex: any) {
    console.error(`[Steam雷达] 网络不可用: ${ex.message}`);
    return [];
  }
  const json = await resp.json() as any;
  
  if (!json?.specials?.items) {
    console.log('[Steam雷达] 特惠列表为空');
    return [];
  }

  const items = json.specials.items;
  const candidates: SteamDeal[] = [];
  
  for (const item of items) {
    if (!item.id || !item.name) continue;
    const original = item.original_price || 0;
    if (original < MinOriginalPriceCents) continue;
    
    candidates.push({
      appId: item.id,
      name: item.name || '',
      originalCents: original,
      finalCents: item.final_price || 0,
      discountPct: item.discount_percent || 0,
      reviews: 0
    });
  }
  
  console.log(`[Steam雷达] 初筛 ${candidates.length} 款 (原价≥¥${MinOriginalPriceCents / 100})`);
  
  const deals: SteamDeal[] = [];
  for (const c of candidates) {
    try {
      const detailUrl = `${STEAM_STORE_BASE}/api/appdetails?appids=${c.appId}`;
      const detailResp = await steamFetch(detailUrl, { signal: AbortSignal.timeout(8000) });
      const detailJson = await detailResp.json() as any;
      const key = c.appId.toString();
      const total = detailJson?.[key]?.data?.recommendations?.total;
      if (total && total >= MinReviewCount) {
        c.reviews = total;
        deals.push(c);
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`[Steam雷达] 精筛 ${deals.length} 款 (评价≥${MinReviewCount})`);
  return deals;
}

// ==================== 游戏名翻译 (MiMo AI) ====================
const AI_ENDPOINT = 'https://api.xiaomimimo.com/v1/chat/completions';
const AI_API_KEY = process.env.MIMO_API_KEY || '';
const AI_MODEL = 'mimo-v2.5';

export async function translateGameName(chineseName: string): Promise<string> {
  if (/^[a-zA-Z0-9\s:\-\.]+$/.test(chineseName)) return chineseName;
  
  try {
    const response = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: "Translate the game name to its official English title on Steam. Output ONLY the English name, nothing else. Example: '荒野大镖客2' -> 'Red Dead Redemption 2'. Example: '巫师3' -> 'The Witcher 3'. Example: '赛博朋克2077' -> 'Cyberpunk 2077'." },
          { role: 'user', content: chineseName }
        ],
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(8000)
    });
    
    const data = await response.json() as any;
    const translated = (data?.choices?.[0]?.message?.content || '').trim().replace(/[.!?"'：，。]+$/, '');
    if (translated && translated.toLowerCase() !== chineseName.toLowerCase()) {
      console.log(`[游戏翻译] 「${chineseName}」→「${translated}」`);
      return translated;
    }
  } catch (ex: any) {
    console.log(`[游戏翻译] 异常: ${ex.message}`);
  }
  return chineseName;
}
