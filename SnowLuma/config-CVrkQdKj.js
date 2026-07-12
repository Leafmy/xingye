import { createRequire as __snowlumaCreateRequire } from "node:module";
__snowlumaCreateRequire(import.meta.url);
import { format } from "util";
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "async_hooks";
import fs$1 from "fs";
import path$1 from "path";
import { randomBytes } from "crypto";
//#region ../common/src/log-file-transport.ts
var DEFAULT_DIR = "logs";
var DEFAULT_MAX_MB = 50;
var DEFAULT_RETAIN_DAYS = 7;
var FILE_PREFIX = "snowluma-";
var FILE_SUFFIX = ".log";
var FILE_RE = /^snowluma-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;
var ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
var CTRL_RE = /[\x00-\x08\x0B-\x1A\x1C-\x1F\x7F]/g;
function parsePositiveInt(v, dflt) {
	if (!v) return dflt;
	const n = Number.parseInt(v, 10);
	return Number.isFinite(n) && n > 0 ? n : dflt;
}
function todayString(d = /* @__PURE__ */ new Date()) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateOf(s) {
	const [y, m, d] = s.split("-").map((v) => Number.parseInt(v, 10));
	return new Date(y, m - 1, d);
}
function stripAnsi(line) {
	return line.replace(ANSI_RE, "").replace(CTRL_RE, "");
}
/**
* Owns one output directory: keeps at most one open WriteStream, handles
* daily rollover, per-file size cap, and retention cleanup. The shared
* top-level dir uses one of these; each per-UIN sub-dir gets its own.
*/
var FileWriter = class {
	disabled = false;
	file = null;
	constructor(dir, maxBytes, retainDays) {
		this.dir = dir;
		this.maxBytes = maxBytes;
		this.retainDays = retainDays;
		try {
			fs.mkdirSync(dir, { recursive: true });
		} catch (err) {
			this.disabled = true;
			console.error(`[logger] failed to create log dir ${dir}: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}
		this.cleanup();
	}
	get isDisabled() {
		return this.disabled;
	}
	get currentPath() {
		return this.file?.path ?? null;
	}
	write(data, bytes) {
		if (this.disabled) return;
		const today = todayString();
		this.ensureForToday(today);
		if (!this.file) return;
		if (this.file.bytes + bytes > this.maxBytes && this.file.bytes > 0) {
			this.rotateBySize();
			if (!this.file) return;
		}
		this.file.stream.write(data);
		this.file.bytes += bytes;
	}
	close() {
		const f = this.file;
		this.file = null;
		if (!f) return Promise.resolve();
		return new Promise((resolve) => {
			try {
				f.stream.end(() => resolve());
			} catch {
				resolve();
			}
		});
	}
	ensureForToday(today) {
		if (this.file && this.file.date === today) return;
		if (this.file) {
			try {
				this.file.stream.end();
			} catch {}
			this.file = null;
			this.cleanup();
		}
		let idx = 0;
		while (fs.existsSync(this.pathFor(today, idx + 1))) idx++;
		this.file = this.openFile(today, idx);
	}
	rotateBySize() {
		if (!this.file) return;
		const date = this.file.date;
		try {
			this.file.stream.end();
		} catch {}
		let next = this.file.splitIndex + 1;
		while (fs.existsSync(this.pathFor(date, next))) next++;
		this.file = this.openFile(date, next);
	}
	openFile(date, splitIndex) {
		const p = this.pathFor(date, splitIndex);
		try {
			let bytes = 0;
			try {
				bytes = fs.statSync(p).size;
			} catch {}
			const stream = fs.createWriteStream(p, { flags: "a" });
			stream.on("error", (err) => {
				console.error(`[logger] file write error on ${p}: ${err.message}`);
			});
			return {
				stream,
				bytes,
				date,
				splitIndex,
				path: p
			};
		} catch (err) {
			console.error(`[logger] failed to open log file ${p}: ${err instanceof Error ? err.message : String(err)}`);
			return null;
		}
	}
	pathFor(date, splitIndex) {
		const tail = splitIndex > 0 ? `.${splitIndex}` : "";
		return path.join(this.dir, `${FILE_PREFIX}${date}${tail}${FILE_SUFFIX}`);
	}
	cleanup() {
		let entries;
		try {
			entries = fs.readdirSync(this.dir);
		} catch {
			return;
		}
		const retainMs = this.retainDays * 24 * 60 * 60 * 1e3;
		const cutoff = Date.now() - retainMs;
		for (const name of entries) {
			const m = FILE_RE.exec(name);
			if (!m) continue;
			const dateStr = m[1];
			if (dateOf(dateStr).getTime() < cutoff) try {
				fs.unlinkSync(path.join(this.dir, name));
			} catch {}
		}
	}
};
var FileTransport = class {
	dir;
	maxBytes;
	retainDays;
	enabled;
	perUinEnabled;
	shared = null;
	perUin = /* @__PURE__ */ new Map();
	constructor() {
		this.dir = process.env.SNOWLUMA_LOG_DIR || DEFAULT_DIR;
		this.maxBytes = parsePositiveInt(process.env.SNOWLUMA_LOG_MAX_MB, DEFAULT_MAX_MB) * 1024 * 1024;
		this.retainDays = parsePositiveInt(process.env.SNOWLUMA_LOG_RETAIN_DAYS, DEFAULT_RETAIN_DAYS);
		this.enabled = process.env.SNOWLUMA_LOG_FILE !== "0";
		this.perUinEnabled = process.env.SNOWLUMA_LOG_PER_UIN !== "0";
		if (this.enabled) {
			const w = new FileWriter(this.dir, this.maxBytes, this.retainDays);
			this.shared = w.isDisabled ? null : w;
		}
	}
	/** True when no file output will happen (env disable or init failure). */
	get isDisabled() {
		return !this.shared;
	}
	/** Current shared-file path (or null if disabled / not yet opened). */
	get currentPath() {
		return this.shared?.currentPath ?? null;
	}
	/** Path of the per-UIN file for the given UIN, if open. */
	perUinPath(uin) {
		return this.perUin.get(uin)?.currentPath ?? null;
	}
	write(line, uin) {
		if (!this.shared) return;
		const data = stripAnsi(line) + "\n";
		const bytes = Buffer.byteLength(data, "utf8");
		this.shared.write(data, bytes);
		if (uin !== void 0 && this.perUinEnabled) {
			let w = this.perUin.get(uin);
			if (!w) {
				w = new FileWriter(path.join(this.dir, String(uin)), this.maxBytes, this.retainDays);
				if (w.isDisabled) return;
				this.perUin.set(uin, w);
			}
			w.write(data, bytes);
		}
	}
	async close() {
		const closes = [];
		if (this.shared) closes.push(this.shared.close());
		for (const w of this.perUin.values()) closes.push(w.close());
		this.shared = null;
		this.perUin.clear();
		await Promise.all(closes);
	}
};
var singleton = null;
function getFileTransport() {
	if (!singleton) singleton = new FileTransport();
	return singleton;
}
//#endregion
//#region ../common/src/request-context.ts
var storage = new AsyncLocalStorage();
var counter = 0;
/**
* Allocate the next per-process request id (monotonic). Wraps via uint32 so
* it never overflows to a non-integer; `0` is skipped so "no id" stays
* unambiguous.
*/
function nextRequestId() {
	counter = counter + 1 >>> 0;
	if (counter === 0) counter = 1;
	return counter;
}
/**
* Run `fn` with `id` bound as the ambient request id for the entire async
* chain it spawns. Any logger call anywhere in that chain — across packages,
* across awaits — picks it up via {@link currentRequestId} with no signature
* threading. Used by the OneBot action handler to correlate a request's whole
* journey (entry → outbound packets → exit) under one `[req#N]` tag.
*/
function runWithRequestId(id, fn) {
	return storage.run({ id }, fn);
}
/** The request id bound to the current async context, or undefined outside one. */
function currentRequestId() {
	return storage.getStore()?.id;
}
//#endregion
//#region ../common/src/logger.ts
var UIN_SLOT_WIDTH = 12;
var LEVEL_WEIGHT = {
	trace: 5,
	debug: 10,
	info: 20,
	success: 25,
	warn: 30,
	error: 40
};
var LEVEL_LABEL = {
	trace: "TRACE",
	debug: "DEBUG",
	info: "INFO",
	success: "OK",
	warn: "WARN",
	error: "ERROR"
};
var COLOR_CODE = {
	trace: 90,
	debug: 90,
	info: 36,
	success: 32,
	warn: 33,
	error: 31
};
var COLOR_SCOPE = 35;
var COLOR_DIM = 2;
var COLOR_RESET = "\x1B[0m";
var MAX_LOG_ENTRIES = 1e3;
/** Trace ring cap — env-tunable since trace is the high-volume stream. */
function resolveTraceBufferMax() {
	const raw = Number.parseInt(process.env.SNOWLUMA_TRACE_BUFFER ?? "", 10);
	return Number.isFinite(raw) && raw >= 100 ? raw : 5e3;
}
var TRACE_BUFFER_MAX = resolveTraceBufferMax();
/**
* Fixed-capacity circular buffer. O(1) push + eviction (no array `.shift()`),
* so the high-throughput trace stream never pays an O(n) shift per overflow.
*/
var RingBuffer = class {
	buf;
	start = 0;
	count = 0;
	constructor(cap) {
		this.cap = cap;
		this.buf = new Array(cap);
	}
	push(item) {
		const end = (this.start + this.count) % this.cap;
		this.buf[end] = item;
		if (this.count < this.cap) this.count += 1;
		else this.start = (this.start + 1) % this.cap;
	}
	/** Most recent `n` items, oldest→newest. */
	recent(n) {
		const take = Math.max(0, Math.min(Math.trunc(n), this.count));
		const out = new Array(take);
		const first = this.start + (this.count - take);
		for (let i = 0; i < take; i += 1) out[i] = this.buf[(first + i) % this.cap];
		return out;
	}
	toArray() {
		return this.recent(this.count);
	}
	get size() {
		return this.count;
	}
};
var logRing = new RingBuffer(MAX_LOG_ENTRIES);
var traceRing = new RingBuffer(TRACE_BUFFER_MAX);
var logSubscribers = /* @__PURE__ */ new Set();
var nextLogId = 1;
function resolveMinLevel() {
	const raw = (process.env.SNOWLUMA_LOG_LEVEL ?? "info").toLowerCase();
	if (raw === "trace" || raw === "debug" || raw === "info" || raw === "success" || raw === "warn" || raw === "error") return raw;
	return "info";
}
var currentLevel = resolveMinLevel();
function shouldLog(level) {
	return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[currentLevel];
}
var LOG_LEVELS = [
	"trace",
	"debug",
	"info",
	"success",
	"warn",
	"error"
];
function getLogLevel() {
	return currentLevel;
}
/**
* Change the console / subscriber level at runtime. Invalid input is
* a no-op (returns false). File transport is unaffected — it always
* sees every level so post-mortems remain useful.
*/
function setLogLevel(level) {
	const lower = String(level).toLowerCase();
	if (!LOG_LEVELS.includes(lower)) return false;
	currentLevel = lower;
	return true;
}
function useColor() {
	if (process.env.NO_COLOR === "1") return false;
	return Boolean(process.stdout.isTTY);
}
function ansi(code, text) {
	return `\x1b[${code}m${text}${COLOR_RESET}`;
}
function currentTime() {
	const d = /* @__PURE__ */ new Date();
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
function render(level, options, args, reqId) {
	const message = format(...args);
	const ts = currentTime();
	const label = LEVEL_LABEL[level].padEnd(5, " ");
	const uinTag = options.uin !== void 0 ? `[${options.uin}]` : "";
	const uinSlot = uinTag.padEnd(UIN_SLOT_WIDTH);
	const reqTag = reqId !== void 0 ? `[req#${reqId}]` : "";
	if (!useColor()) return `${ts} ${label} ${uinSlot} [${options.scope}] ${reqTag ? `${reqTag} ` : ""}${message}`;
	return `${ansi(COLOR_DIM, ts)} ${ansi(COLOR_CODE[level], label)} ${uinTag ? ansi(COLOR_DIM, uinTag) + " ".repeat(UIN_SLOT_WIDTH - uinTag.length) : " ".repeat(UIN_SLOT_WIDTH)} ${ansi(COLOR_SCOPE, `[${options.scope}]`)} ${reqTag ? `${ansi(COLOR_DIM, reqTag)} ` : ""}${message}`;
}
function emit(level, options, args) {
	const passesConsole = shouldLog(level);
	if (level === "trace" && !passesConsole) return;
	let realArgs = args;
	if (level === "trace" && args.length === 1 && typeof args[0] === "function") realArgs = args[0]();
	const reqId = currentRequestId();
	const message = format(...realArgs);
	const line = render(level, options, realArgs, reqId);
	const entry = {
		id: nextLogId++,
		time: (/* @__PURE__ */ new Date()).toISOString(),
		level,
		scope: options.scope,
		...options.uin !== void 0 ? { uin: options.uin } : {},
		...reqId !== void 0 ? { req: reqId } : {},
		message,
		line
	};
	if (passesConsole) {
		(level === "trace" ? traceRing : logRing).push(entry);
		for (const subscriber of logSubscribers) subscriber(entry);
		(level === "warn" || level === "error" ? process.stderr : process.stdout).write(line.replace(/[\x00-\x08\x0B-\x1A\x1C-\x1F\x7F]/g, "") + "\n");
	}
	if (level !== "trace") getFileTransport().write(line, options.uin);
}
/**
* Flush and close the underlying log file. Call from shutdown hooks
* (SIGINT / SIGTERM / uncaughtException) so the WriteStream's internal
* buffer makes it to disk. Returns a promise that resolves once the OS
* has finalized the write.
*/
function closeLogger() {
	return getFileTransport().close();
}
function getRecentLogs(limit = 300) {
	const n = Math.max(1, Math.trunc(limit));
	return (traceRing.size > 0 ? [...logRing.toArray(), ...traceRing.toArray()].sort((a, b) => a.id - b.id) : logRing.toArray()).slice(-n);
}
function subscribeLogs(callback) {
	logSubscribers.add(callback);
	return () => {
		logSubscribers.delete(callback);
	};
}
function makeLogger(opts) {
	return {
		trace: (...args) => emit("trace", opts, args),
		debug: (...args) => emit("debug", opts, args),
		info: (...args) => emit("info", opts, args),
		success: (...args) => emit("success", opts, args),
		warn: (...args) => emit("warn", opts, args),
		error: (...args) => emit("error", opts, args),
		child: (meta) => {
			const nextUin = typeof meta.uin === "number" ? meta.uin : opts.uin;
			return makeLogger({
				scope: opts.scope,
				uin: nextUin,
				meta: {
					...opts.meta ?? {},
					...meta
				}
			});
		}
	};
}
function createLogger(scope) {
	return makeLogger({ scope });
}
//#endregion
//#region ../onebot/src/config.ts
var log = createLogger("OneBot.Config");
var CONFIG_DIR = "config";
var DEFAULT_CONFIG_PATH = path$1.join(CONFIG_DIR, "onebot.json");
var DEFAULT_ACCESS_TOKEN_BYTES = 32;
var DEFAULT_STATUS_COMMAND = {
	enabled: true,
	swallow: false,
	cooldownSeconds: 5
};
/** Upper bound on the `#sl` reply cooldown — a year is effectively "off but sane". */
var STATUS_COMMAND_COOLDOWN_MAX = 31536e3;
function makeDefaultStatusCommand() {
	return { ...DEFAULT_STATUS_COMMAND };
}
function makeDefaultOneBotConfig() {
	return {
		networks: {
			httpServers: [{
				name: "http-default",
				host: "0.0.0.0",
				port: 3e3,
				path: "/",
				accessToken: generateAccessToken(),
				messageFormat: "array",
				reportSelfMessage: false
			}],
			httpClients: [],
			wsServers: [{
				name: "ws-default",
				host: "0.0.0.0",
				port: 3001,
				path: "/",
				role: "Universal",
				accessToken: generateAccessToken(),
				messageFormat: "array",
				reportSelfMessage: false
			}],
			wsClients: []
		},
		musicSignUrl: "",
		statusCommand: makeDefaultStatusCommand()
	};
}
function generateAccessToken() {
	return randomBytes(DEFAULT_ACCESS_TOKEN_BYTES).toString("base64url");
}
function loadOneBotConfig(uin, options = {}) {
	ensureConfigDir();
	const perUinPath = path$1.join(CONFIG_DIR, `onebot_${uin}.json`);
	const globalRaw = tryLoadJson(DEFAULT_CONFIG_PATH);
	const perUinRaw = tryLoadJson(perUinPath);
	const legacy = !!perUinRaw && hasLegacyTopLevel(perUinRaw);
	const sources = [];
	if (globalRaw) sources.push(globalRaw);
	if (perUinRaw) sources.push(perUinRaw);
	const config = fromJson(sources, !perUinRaw && !globalRaw);
	if (options.persistDefaults && (!perUinRaw || legacy)) saveOneBotConfig(uin, config);
	return config;
}
function saveOneBotConfig(uin, config) {
	ensureConfigDir();
	saveJson(path$1.join(CONFIG_DIR, `onebot_${uin}.json`), toJsonObject(config));
}
function ensureConfigDir() {
	fs$1.mkdirSync(CONFIG_DIR, { recursive: true });
}
function toJsonObject(config) {
	const nets = config.networks;
	return {
		networks: {
			httpServers: nets.httpServers.map(httpServerToJson),
			httpClients: nets.httpClients.map(httpClientToJson),
			wsServers: nets.wsServers.map(wsServerToJson),
			wsClients: nets.wsClients.map(wsClientToJson)
		},
		musicSignUrl: config.musicSignUrl ?? "",
		statusCommand: {
			enabled: config.statusCommand.enabled,
			swallow: config.statusCommand.swallow,
			cooldownSeconds: config.statusCommand.cooldownSeconds
		}
	};
}
function applyBase(out, n) {
	out.name = n.name;
	if (n.enabled === false) out.enabled = false;
	if (n.accessToken) out.accessToken = n.accessToken;
	out.messageFormat = n.messageFormat;
	out.reportSelfMessage = n.reportSelfMessage;
}
function httpServerToJson(n) {
	const out = {};
	applyBase(out, n);
	out.host = n.host ?? "0.0.0.0";
	out.port = n.port;
	out.path = n.path ?? "/";
	return out;
}
function httpClientToJson(n) {
	const out = {};
	applyBase(out, n);
	out.url = n.url;
	if (typeof n.timeoutMs === "number" && n.timeoutMs > 0) out.timeoutMs = n.timeoutMs;
	return out;
}
function wsServerToJson(n) {
	const out = {};
	applyBase(out, n);
	out.host = n.host ?? "0.0.0.0";
	out.port = n.port;
	out.path = n.path ?? "/";
	out.role = n.role ?? "Universal";
	return out;
}
function wsClientToJson(n) {
	const out = {};
	applyBase(out, n);
	out.url = n.url;
	out.role = n.role ?? "Universal";
	out.reconnectIntervalMs = typeof n.reconnectIntervalMs === "number" && Number.isFinite(n.reconnectIntervalMs) ? Math.max(1e3, Math.trunc(n.reconnectIntervalMs)) : 5e3;
	return out;
}
function fromJson(sources, freshInstall) {
	let legacyFormat;
	let legacyReport;
	let musicSignUrl = "";
	for (const src of sources) {
		const mf = parseMessageFormat(src.messageFormat);
		if (mf) legacyFormat = mf;
		if (typeof src.reportSelfMessage === "boolean") legacyReport = src.reportSelfMessage;
		if (typeof src.musicSignUrl === "string") musicSignUrl = src.musicSignUrl;
	}
	const adapterDefaults = {
		messageFormat: legacyFormat ?? "array",
		reportSelfMessage: legacyReport ?? false
	};
	const httpServers = collectByName(sources, "httpServers", (raw) => parseHttpServer(raw, adapterDefaults));
	const httpClients = collectByName(sources, "httpClients", (raw) => parseHttpClient(raw, adapterDefaults), "httpPostEndpoints");
	const wsServers = collectByName(sources, "wsServers", (raw) => parseWsServer(raw, adapterDefaults));
	const wsClients = collectByName(sources, "wsClients", (raw) => parseWsClient(raw, adapterDefaults));
	if (freshInstall && httpServers.length === 0 && httpClients.length === 0 && wsServers.length === 0 && wsClients.length === 0) {
		const defaults = makeDefaultOneBotConfig().networks;
		httpServers.push(...defaults.httpServers);
		wsServers.push(...defaults.wsServers);
	}
	return {
		networks: {
			httpServers,
			httpClients,
			wsServers,
			wsClients
		},
		musicSignUrl,
		statusCommand: parseStatusCommand(sources)
	};
}
/** Last-write-wins merge of `statusCommand` across config sources, with
*  defaults filled and the cooldown clamped to a sane non-negative range. */
function parseStatusCommand(sources) {
	const out = makeDefaultStatusCommand();
	for (const src of sources) {
		const raw = src.statusCommand;
		if (!isObject(raw)) continue;
		if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
		if (typeof raw.swallow === "boolean") out.swallow = raw.swallow;
		if (raw.cooldownSeconds !== void 0) out.cooldownSeconds = Math.min(STATUS_COMMAND_COOLDOWN_MAX, asNumber(raw.cooldownSeconds, DEFAULT_STATUS_COMMAND.cooldownSeconds));
	}
	return out;
}
function collectByName(sources, kind, parse, legacyKey) {
	const byName = /* @__PURE__ */ new Map();
	const order = [];
	let counter = 0;
	const ingest = (rawArr) => {
		if (!Array.isArray(rawArr)) return;
		for (const raw of rawArr) {
			if (!isObject(raw)) continue;
			const parsed = parse(raw);
			if (!parsed) continue;
			const name = parsed.name && parsed.name.trim() ? parsed.name.trim() : pickAutoName(kind, byName, ++counter);
			parsed.name = name;
			if (!byName.has(name)) order.push(name);
			byName.set(name, parsed);
		}
	};
	for (const src of sources) {
		ingest(isObject(src.networks) ? src.networks[kind] : void 0);
		if (legacyKey) ingest(src[legacyKey]);
		ingest(src[kind]);
	}
	return order.map((n) => byName.get(n));
}
function pickAutoName(kind, used, counter) {
	const prefix = kind === "httpServers" ? "http" : kind === "httpClients" ? "httppost" : kind === "wsServers" ? "ws" : "wsclient";
	let candidate = `${prefix}-${counter}`;
	while (used.has(candidate)) {
		counter += 1;
		candidate = `${prefix}-${counter}`;
	}
	return candidate;
}
function parseBase(value, defaults) {
	return {
		name: asString(value.name),
		enabled: typeof value.enabled === "boolean" ? value.enabled : void 0,
		accessToken: asString(value.accessToken) || void 0,
		messageFormat: parseMessageFormat(value.messageFormat) ?? defaults.messageFormat,
		reportSelfMessage: typeof value.reportSelfMessage === "boolean" ? value.reportSelfMessage : defaults.reportSelfMessage
	};
}
function parseHttpServer(value, defaults) {
	const port = asNumber(value.port, 0);
	if (port <= 0) return null;
	return clean({
		...parseBase(value, defaults),
		host: asString(value.host, "0.0.0.0"),
		port,
		path: asString(value.path, "/")
	});
}
function parseHttpClient(value, defaults) {
	const url = asString(value.url);
	if (!url) return null;
	const timeout = asNumber(value.timeoutMs, 0);
	return clean({
		...parseBase(value, defaults),
		url,
		timeoutMs: timeout > 0 ? timeout : void 0
	});
}
function parseWsServer(value, defaults) {
	const port = asNumber(value.port, 0);
	if (port <= 0) return null;
	return clean({
		...parseBase(value, defaults),
		host: asString(value.host, "0.0.0.0"),
		port,
		path: asString(value.path, "/"),
		role: asRole(value.role, "Universal")
	});
}
function parseWsClient(value, defaults) {
	const url = asString(value.url);
	if (!url) return null;
	const reconnectIntervalMs = asNumber(value.reconnectIntervalMs, 5e3);
	return clean({
		...parseBase(value, defaults),
		url,
		role: asRole(value.role, "Universal"),
		reconnectIntervalMs: Math.max(1e3, reconnectIntervalMs)
	});
}
function hasLegacyTopLevel(raw) {
	return Array.isArray(raw.httpServers) || Array.isArray(raw.httpPostEndpoints) || Array.isArray(raw.wsServers) || Array.isArray(raw.wsClients) || typeof raw.messageFormat === "string" || typeof raw.reportSelfMessage === "boolean";
}
function parseMessageFormat(value) {
	if (value === "array" || value === "string") return value;
}
function clean(obj) {
	for (const key of Object.keys(obj)) if (obj[key] === void 0) delete obj[key];
	return obj;
}
function asRole(value, fallback) {
	const text = asString(value, fallback).toLowerCase();
	if (text === "api") return "Api";
	if (text === "event") return "Event";
	if (text === "universal") return "Universal";
	return fallback;
}
function asString(value, fallback = "") {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return fallback;
}
function asNumber(value, fallback = 0) {
	if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
	if (typeof value === "string" && value.trim()) {
		const n = Number(value);
		if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
	}
	return fallback;
}
function tryLoadJson(filePath) {
	if (!fs$1.existsSync(filePath)) return null;
	try {
		const raw = fs$1.readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw);
		return isObject(parsed) ? parsed : null;
	} catch (err) {
		log.warn("config file %s is corrupt and will be ignored: %s", filePath, err instanceof Error ? err.message : String(err));
		return null;
	}
}
function saveJson(filePath, json) {
	fs$1.mkdirSync(path$1.dirname(filePath), { recursive: true });
	fs$1.writeFileSync(filePath, JSON.stringify(json, null, 2), "utf8");
}
function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
export { createLogger as a, setLogLevel as c, runWithRequestId as d, closeLogger as i, subscribeLogs as l, saveOneBotConfig as n, getLogLevel as o, LOG_LEVELS as r, getRecentLogs as s, loadOneBotConfig as t, nextRequestId as u };
