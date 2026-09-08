# Plan: Fix Steam Radar "fetch failed"

## Root Cause

**`.env` 未加载导致 `STEAM_PROXY_URL` 为空，直连被墙**

- `package.json` 中 `npm start` = `ts-node index.ts`，**不加载 `.env`**
- `crawler.ts` 第 6 行读取 `process.env.STEAM_PROXY_URL`，import 时未设置 → 值为 `''`
- `_proxyAgent` 为 `null`，`steamFetch()` 走第 31 行直连
- 大陆直连 `store.steampowered.com` 被 DNS 污染/阻断 → "fetch failed"

仅 PM2 启动时 `pm2-start.cjs` 会载入 `.env`；`npm run dev` / `npm start` 均缺失此步骤。

## Fix Plan

### 1. 加载 `.env` 到 `crawler.ts`（核心修复）

在 `crawler.ts` 顶部 `import` 之后、`STEAM_PROXY_URL` 读取之前，添加手动 .env 加载逻辑。

**方式**: 复用 `pm2-start.cjs` 的 .env parser（无需新增 `dotenv` 依赖）

```typescript
// Load .env manually (pm2-start.cjs does this, but npm start/dev doesn't)
(function() {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          const val = trimmed.substring(eqIdx + 1).trim();
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
  }
})();
```

### 2. 改进 `fetchSteamDeals()` 错误诊断

在 `fetchSteamDeals()` 外层包裹 try-catch（当前靠上游 `runSteamDealBroadcast` 捕获），输出更清晰的诊断信息：

- 代理是否配置 (`STEAM_PROXY_URL` 值)
- 代理是否创建 `_proxyAgent` 非空
- 错误类型和消息

### 3. 改进 `steamFetch()` 的 fallback 日志

当前代理失败时打印 `[steamFetch] 代理不可用` 错误，但可能在日志中被淹没。改为 `console.error` 级别。

## Files to modify

| File | Changes |
|------|---------|
| `bot-backend/crawler.ts` | 1. 顶部添加 `.env` 手动加载 IIFE | 2. `fetchSteamDeals()` 添加 try-catch + 诊断日志 | 3. 改进 `steamFetch()` 日志级别 |

## Verification

1. `npm run dev` 启动后端
2. 观察日志，确认 `[Steam代理] 已配置: http://127.0.0.1:7890` 出现
3. 在 QQ 中发送「查询促销」，确认返回 Steam 特惠列表而非错误
4. 停掉 Flclash 代理，再次发送「查询促销」，确认提示信息为"代理不可用"而非"fetch failed"
