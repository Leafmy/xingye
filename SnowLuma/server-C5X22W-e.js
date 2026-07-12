import { createRequire as __snowlumaCreateRequire } from "node:module";
__snowlumaCreateRequire(import.meta.url);
import { a as createLogger, c as setLogLevel, l as subscribeLogs, n as saveOneBotConfig, o as getLogLevel, r as LOG_LEVELS$1, s as getRecentLogs, t as loadOneBotConfig } from "./config-CVrkQdKj.js";
import fs, { createReadStream, existsSync, readFileSync, statSync } from "fs";
import path, { join } from "path";
import { fileURLToPath } from "url";
import net from "net";
import os from "os";
import crypto, { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { createServer } from "http";
import { Http2ServerRequest, constants } from "http2";
import { Readable } from "stream";
import { versions } from "process";
//#region ../../node_modules/.pnpm/@hono+node-server@1.19.14_hono@4.12.24/node_modules/@hono/node-server/dist/index.mjs
var RequestError = class extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = "RequestError";
	}
};
var toRequestError = (e) => {
	if (e instanceof RequestError) return e;
	return new RequestError(e.message, { cause: e });
};
var GlobalRequest = global.Request;
var Request$1 = class extends GlobalRequest {
	constructor(input, options) {
		if (typeof input === "object" && getRequestCache in input) input = input[getRequestCache]();
		if (typeof options?.body?.getReader !== "undefined") options.duplex ??= "half";
		super(input, options);
	}
};
var newHeadersFromIncoming = (incoming) => {
	const headerRecord = [];
	const rawHeaders = incoming.rawHeaders;
	for (let i = 0; i < rawHeaders.length; i += 2) {
		const { [i]: key, [i + 1]: value } = rawHeaders;
		if (key.charCodeAt(0) !== 58) headerRecord.push([key, value]);
	}
	return new Headers(headerRecord);
};
var wrapBodyStream = Symbol("wrapBodyStream");
var newRequestFromIncoming = (method, url, headers, incoming, abortController) => {
	const init = {
		method,
		headers,
		signal: abortController.signal
	};
	if (method === "TRACE") {
		init.method = "GET";
		const req = new Request$1(url, init);
		Object.defineProperty(req, "method", { get() {
			return "TRACE";
		} });
		return req;
	}
	if (!(method === "GET" || method === "HEAD")) if ("rawBody" in incoming && incoming.rawBody instanceof Buffer) init.body = new ReadableStream({ start(controller) {
		controller.enqueue(incoming.rawBody);
		controller.close();
	} });
	else if (incoming[wrapBodyStream]) {
		let reader;
		init.body = new ReadableStream({ async pull(controller) {
			try {
				reader ||= Readable.toWeb(incoming).getReader();
				const { done, value } = await reader.read();
				if (done) controller.close();
				else controller.enqueue(value);
			} catch (error) {
				controller.error(error);
			}
		} });
	} else init.body = Readable.toWeb(incoming);
	return new Request$1(url, init);
};
var getRequestCache = Symbol("getRequestCache");
var requestCache = Symbol("requestCache");
var incomingKey = Symbol("incomingKey");
var urlKey = Symbol("urlKey");
var headersKey = Symbol("headersKey");
var abortControllerKey = Symbol("abortControllerKey");
var requestPrototype = {
	get method() {
		return this[incomingKey].method || "GET";
	},
	get url() {
		return this[urlKey];
	},
	get headers() {
		return this[headersKey] ||= newHeadersFromIncoming(this[incomingKey]);
	},
	[Symbol("getAbortController")]() {
		this[getRequestCache]();
		return this[abortControllerKey];
	},
	[getRequestCache]() {
		this[abortControllerKey] ||= new AbortController();
		return this[requestCache] ||= newRequestFromIncoming(this.method, this[urlKey], this.headers, this[incomingKey], this[abortControllerKey]);
	}
};
[
	"body",
	"bodyUsed",
	"cache",
	"credentials",
	"destination",
	"integrity",
	"mode",
	"redirect",
	"referrer",
	"referrerPolicy",
	"signal",
	"keepalive"
].forEach((k) => {
	Object.defineProperty(requestPrototype, k, { get() {
		return this[getRequestCache]()[k];
	} });
});
[
	"arrayBuffer",
	"blob",
	"clone",
	"formData",
	"json",
	"text"
].forEach((k) => {
	Object.defineProperty(requestPrototype, k, { value: function() {
		return this[getRequestCache]()[k]();
	} });
});
Object.defineProperty(requestPrototype, Symbol.for("nodejs.util.inspect.custom"), { value: function(depth, options, inspectFn) {
	return `Request (lightweight) ${inspectFn({
		method: this.method,
		url: this.url,
		headers: this.headers,
		nativeRequest: this[requestCache]
	}, {
		...options,
		depth: depth == null ? null : depth - 1
	})}`;
} });
Object.setPrototypeOf(requestPrototype, Request$1.prototype);
var newRequest = (incoming, defaultHostname) => {
	const req = Object.create(requestPrototype);
	req[incomingKey] = incoming;
	const incomingUrl = incoming.url || "";
	if (incomingUrl[0] !== "/" && (incomingUrl.startsWith("http://") || incomingUrl.startsWith("https://"))) {
		if (incoming instanceof Http2ServerRequest) throw new RequestError("Absolute URL for :path is not allowed in HTTP/2");
		try {
			req[urlKey] = new URL(incomingUrl).href;
		} catch (e) {
			throw new RequestError("Invalid absolute URL", { cause: e });
		}
		return req;
	}
	const host = (incoming instanceof Http2ServerRequest ? incoming.authority : incoming.headers.host) || defaultHostname;
	if (!host) throw new RequestError("Missing host header");
	let scheme;
	if (incoming instanceof Http2ServerRequest) {
		scheme = incoming.scheme;
		if (!(scheme === "http" || scheme === "https")) throw new RequestError("Unsupported scheme");
	} else scheme = incoming.socket && incoming.socket.encrypted ? "https" : "http";
	const url = new URL(`${scheme}://${host}${incomingUrl}`);
	if (url.hostname.length !== host.length && url.hostname !== host.replace(/:\d+$/, "")) throw new RequestError("Invalid host header");
	req[urlKey] = url.href;
	return req;
};
var responseCache = Symbol("responseCache");
var getResponseCache = Symbol("getResponseCache");
var cacheKey = Symbol("cache");
var GlobalResponse = global.Response;
var Response2 = class _Response {
	#body;
	#init;
	[getResponseCache]() {
		delete this[cacheKey];
		return this[responseCache] ||= new GlobalResponse(this.#body, this.#init);
	}
	constructor(body, init) {
		let headers;
		this.#body = body;
		if (init instanceof _Response) {
			const cachedGlobalResponse = init[responseCache];
			if (cachedGlobalResponse) {
				this.#init = cachedGlobalResponse;
				this[getResponseCache]();
				return;
			} else {
				this.#init = init.#init;
				headers = new Headers(init.#init.headers);
			}
		} else this.#init = init;
		if (typeof body === "string" || typeof body?.getReader !== "undefined" || body instanceof Blob || body instanceof Uint8Array) this[cacheKey] = [
			init?.status || 200,
			body,
			headers || init?.headers
		];
	}
	get headers() {
		const cache = this[cacheKey];
		if (cache) {
			if (!(cache[2] instanceof Headers)) cache[2] = new Headers(cache[2] || { "content-type": "text/plain; charset=UTF-8" });
			return cache[2];
		}
		return this[getResponseCache]().headers;
	}
	get status() {
		return this[cacheKey]?.[0] ?? this[getResponseCache]().status;
	}
	get ok() {
		const status = this.status;
		return status >= 200 && status < 300;
	}
};
[
	"body",
	"bodyUsed",
	"redirected",
	"statusText",
	"trailers",
	"type",
	"url"
].forEach((k) => {
	Object.defineProperty(Response2.prototype, k, { get() {
		return this[getResponseCache]()[k];
	} });
});
[
	"arrayBuffer",
	"blob",
	"clone",
	"formData",
	"json",
	"text"
].forEach((k) => {
	Object.defineProperty(Response2.prototype, k, { value: function() {
		return this[getResponseCache]()[k]();
	} });
});
Object.defineProperty(Response2.prototype, Symbol.for("nodejs.util.inspect.custom"), { value: function(depth, options, inspectFn) {
	return `Response (lightweight) ${inspectFn({
		status: this.status,
		headers: this.headers,
		ok: this.ok,
		nativeResponse: this[responseCache]
	}, {
		...options,
		depth: depth == null ? null : depth - 1
	})}`;
} });
Object.setPrototypeOf(Response2, GlobalResponse);
Object.setPrototypeOf(Response2.prototype, GlobalResponse.prototype);
async function readWithoutBlocking(readPromise) {
	return Promise.race([readPromise, Promise.resolve().then(() => Promise.resolve(void 0))]);
}
function writeFromReadableStreamDefaultReader(reader, writable, currentReadPromise) {
	const cancel = (error) => {
		reader.cancel(error).catch(() => {});
	};
	writable.on("close", cancel);
	writable.on("error", cancel);
	(currentReadPromise ?? reader.read()).then(flow, handleStreamError);
	return reader.closed.finally(() => {
		writable.off("close", cancel);
		writable.off("error", cancel);
	});
	function handleStreamError(error) {
		if (error) writable.destroy(error);
	}
	function onDrain() {
		reader.read().then(flow, handleStreamError);
	}
	function flow({ done, value }) {
		try {
			if (done) writable.end();
			else if (!writable.write(value)) writable.once("drain", onDrain);
			else return reader.read().then(flow, handleStreamError);
		} catch (e) {
			handleStreamError(e);
		}
	}
}
function writeFromReadableStream(stream, writable) {
	if (stream.locked) throw new TypeError("ReadableStream is locked.");
	else if (writable.destroyed) return;
	return writeFromReadableStreamDefaultReader(stream.getReader(), writable);
}
var buildOutgoingHttpHeaders = (headers) => {
	const res = {};
	if (!(headers instanceof Headers)) headers = new Headers(headers ?? void 0);
	const cookies = [];
	for (const [k, v] of headers) if (k === "set-cookie") cookies.push(v);
	else res[k] = v;
	if (cookies.length > 0) res["set-cookie"] = cookies;
	res["content-type"] ??= "text/plain; charset=UTF-8";
	return res;
};
var X_ALREADY_SENT = "x-hono-already-sent";
if (typeof global.crypto === "undefined") global.crypto = crypto;
var outgoingEnded = Symbol("outgoingEnded");
var incomingDraining = Symbol("incomingDraining");
var DRAIN_TIMEOUT_MS = 500;
var MAX_DRAIN_BYTES = 64 * 1024 * 1024;
var drainIncoming = (incoming) => {
	const incomingWithDrainState = incoming;
	if (incoming.destroyed || incomingWithDrainState[incomingDraining]) return;
	incomingWithDrainState[incomingDraining] = true;
	if (incoming instanceof Http2ServerRequest) {
		try {
			incoming.stream?.close?.(constants.NGHTTP2_NO_ERROR);
		} catch {}
		return;
	}
	let bytesRead = 0;
	const cleanup = () => {
		clearTimeout(timer);
		incoming.off("data", onData);
		incoming.off("end", cleanup);
		incoming.off("error", cleanup);
	};
	const forceClose = () => {
		cleanup();
		const socket = incoming.socket;
		if (socket && !socket.destroyed) socket.destroySoon();
	};
	const timer = setTimeout(forceClose, DRAIN_TIMEOUT_MS);
	timer.unref?.();
	const onData = (chunk) => {
		bytesRead += chunk.length;
		if (bytesRead > MAX_DRAIN_BYTES) forceClose();
	};
	incoming.on("data", onData);
	incoming.on("end", cleanup);
	incoming.on("error", cleanup);
	incoming.resume();
};
var handleRequestError = () => new Response(null, { status: 400 });
var handleFetchError = (e) => new Response(null, { status: e instanceof Error && (e.name === "TimeoutError" || e.constructor.name === "TimeoutError") ? 504 : 500 });
var handleResponseError = (e, outgoing) => {
	const err = e instanceof Error ? e : new Error("unknown error", { cause: e });
	if (err.code === "ERR_STREAM_PREMATURE_CLOSE") console.info("The user aborted a request.");
	else {
		console.error(e);
		if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "text/plain" });
		outgoing.end(`Error: ${err.message}`);
		outgoing.destroy(err);
	}
};
var flushHeaders = (outgoing) => {
	if ("flushHeaders" in outgoing && outgoing.writable) outgoing.flushHeaders();
};
var responseViaCache = async (res, outgoing) => {
	let [status, body, header] = res[cacheKey];
	let hasContentLength = false;
	if (!header) header = { "content-type": "text/plain; charset=UTF-8" };
	else if (header instanceof Headers) {
		hasContentLength = header.has("content-length");
		header = buildOutgoingHttpHeaders(header);
	} else if (Array.isArray(header)) {
		const headerObj = new Headers(header);
		hasContentLength = headerObj.has("content-length");
		header = buildOutgoingHttpHeaders(headerObj);
	} else for (const key in header) if (key.length === 14 && key.toLowerCase() === "content-length") {
		hasContentLength = true;
		break;
	}
	if (!hasContentLength) {
		if (typeof body === "string") header["Content-Length"] = Buffer.byteLength(body);
		else if (body instanceof Uint8Array) header["Content-Length"] = body.byteLength;
		else if (body instanceof Blob) header["Content-Length"] = body.size;
	}
	outgoing.writeHead(status, header);
	if (typeof body === "string" || body instanceof Uint8Array) outgoing.end(body);
	else if (body instanceof Blob) outgoing.end(new Uint8Array(await body.arrayBuffer()));
	else {
		flushHeaders(outgoing);
		await writeFromReadableStream(body, outgoing)?.catch((e) => handleResponseError(e, outgoing));
	}
	outgoing[outgoingEnded]?.();
};
var isPromise = (res) => typeof res.then === "function";
var responseViaResponseObject = async (res, outgoing, options = {}) => {
	if (isPromise(res)) if (options.errorHandler) try {
		res = await res;
	} catch (err) {
		const errRes = await options.errorHandler(err);
		if (!errRes) return;
		res = errRes;
	}
	else res = await res.catch(handleFetchError);
	if (cacheKey in res) return responseViaCache(res, outgoing);
	const resHeaderRecord = buildOutgoingHttpHeaders(res.headers);
	if (res.body) {
		const reader = res.body.getReader();
		const values = [];
		let done = false;
		let currentReadPromise = void 0;
		if (resHeaderRecord["transfer-encoding"] !== "chunked") {
			let maxReadCount = 2;
			for (let i = 0; i < maxReadCount; i++) {
				currentReadPromise ||= reader.read();
				const chunk = await readWithoutBlocking(currentReadPromise).catch((e) => {
					console.error(e);
					done = true;
				});
				if (!chunk) {
					if (i === 1) {
						await new Promise((resolve) => setTimeout(resolve));
						maxReadCount = 3;
						continue;
					}
					break;
				}
				currentReadPromise = void 0;
				if (chunk.value) values.push(chunk.value);
				if (chunk.done) {
					done = true;
					break;
				}
			}
			if (done && !("content-length" in resHeaderRecord)) resHeaderRecord["content-length"] = values.reduce((acc, value) => acc + value.length, 0);
		}
		outgoing.writeHead(res.status, resHeaderRecord);
		values.forEach((value) => {
			outgoing.write(value);
		});
		if (done) outgoing.end();
		else {
			if (values.length === 0) flushHeaders(outgoing);
			await writeFromReadableStreamDefaultReader(reader, outgoing, currentReadPromise);
		}
	} else if (resHeaderRecord[X_ALREADY_SENT]) {} else {
		outgoing.writeHead(res.status, resHeaderRecord);
		outgoing.end();
	}
	outgoing[outgoingEnded]?.();
};
var getRequestListener = (fetchCallback, options = {}) => {
	const autoCleanupIncoming = options.autoCleanupIncoming ?? true;
	if (options.overrideGlobalObjects !== false && global.Request !== Request$1) {
		Object.defineProperty(global, "Request", { value: Request$1 });
		Object.defineProperty(global, "Response", { value: Response2 });
	}
	return async (incoming, outgoing) => {
		let res, req;
		try {
			req = newRequest(incoming, options.hostname);
			let incomingEnded = !autoCleanupIncoming || incoming.method === "GET" || incoming.method === "HEAD";
			if (!incomingEnded) {
				incoming[wrapBodyStream] = true;
				incoming.on("end", () => {
					incomingEnded = true;
				});
				if (incoming instanceof Http2ServerRequest) outgoing[outgoingEnded] = () => {
					if (!incomingEnded) setTimeout(() => {
						if (!incomingEnded) setTimeout(() => {
							drainIncoming(incoming);
						});
					});
				};
				outgoing.on("finish", () => {
					if (!incomingEnded) drainIncoming(incoming);
				});
			}
			outgoing.on("close", () => {
				if (req[abortControllerKey]) {
					if (incoming.errored) req[abortControllerKey].abort(incoming.errored.toString());
					else if (!outgoing.writableFinished) req[abortControllerKey].abort("Client connection prematurely closed.");
				}
				if (!incomingEnded) setTimeout(() => {
					if (!incomingEnded) setTimeout(() => {
						drainIncoming(incoming);
					});
				});
			});
			res = fetchCallback(req, {
				incoming,
				outgoing
			});
			if (cacheKey in res) return responseViaCache(res, outgoing);
		} catch (e) {
			if (!res) if (options.errorHandler) {
				res = await options.errorHandler(req ? e : toRequestError(e));
				if (!res) return;
			} else if (!req) res = handleRequestError();
			else res = handleFetchError(e);
			else return handleResponseError(e, outgoing);
		}
		try {
			return await responseViaResponseObject(res, outgoing, options);
		} catch (e) {
			return handleResponseError(e, outgoing);
		}
	};
};
var createAdaptorServer = (options) => {
	const fetchCallback = options.fetch;
	const requestListener = getRequestListener(fetchCallback, {
		hostname: options.hostname,
		overrideGlobalObjects: options.overrideGlobalObjects,
		autoCleanupIncoming: options.autoCleanupIncoming
	});
	return (options.createServer || createServer)(options.serverOptions || {}, requestListener);
};
var serve = (options, listeningListener) => {
	const server = createAdaptorServer(options);
	server.listen(options?.port ?? 3e3, options.hostname, () => {
		const serverInfo = server.address();
		listeningListener && listeningListener(serverInfo);
	});
	return server;
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/utils/mime.js
var getMimeType = (filename, mimes = baseMimes) => {
	const match = filename.match(/\.([a-zA-Z0-9]+?)$/);
	if (!match) return;
	return mimes[match[1].toLowerCase()];
};
var baseMimes = {
	aac: "audio/aac",
	avi: "video/x-msvideo",
	avif: "image/avif",
	av1: "video/av1",
	bin: "application/octet-stream",
	bmp: "image/bmp",
	css: "text/css; charset=utf-8",
	csv: "text/csv; charset=utf-8",
	eot: "application/vnd.ms-fontobject",
	epub: "application/epub+zip",
	gif: "image/gif",
	gz: "application/gzip",
	htm: "text/html; charset=utf-8",
	html: "text/html; charset=utf-8",
	ico: "image/x-icon",
	ics: "text/calendar; charset=utf-8",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	js: "text/javascript; charset=utf-8",
	json: "application/json",
	jsonld: "application/ld+json",
	map: "application/json",
	mid: "audio/x-midi",
	midi: "audio/x-midi",
	mjs: "text/javascript; charset=utf-8",
	mp3: "audio/mpeg",
	mp4: "video/mp4",
	mpeg: "video/mpeg",
	oga: "audio/ogg",
	ogv: "video/ogg",
	ogx: "application/ogg",
	opus: "audio/opus",
	otf: "font/otf",
	pdf: "application/pdf",
	png: "image/png",
	rtf: "application/rtf",
	svg: "image/svg+xml; charset=utf-8",
	tif: "image/tiff",
	tiff: "image/tiff",
	ts: "video/mp2t",
	ttf: "font/ttf",
	txt: "text/plain; charset=utf-8",
	wasm: "application/wasm",
	webm: "video/webm",
	weba: "audio/webm",
	webmanifest: "application/manifest+json",
	webp: "image/webp",
	woff: "font/woff",
	woff2: "font/woff2",
	xhtml: "application/xhtml+xml; charset=utf-8",
	xml: "application/xml; charset=utf-8",
	zip: "application/zip",
	"3gp": "video/3gpp",
	"3g2": "video/3gpp2",
	gltf: "model/gltf+json",
	glb: "model/gltf-binary"
};
//#endregion
//#region ../../node_modules/.pnpm/@hono+node-server@1.19.14_hono@4.12.24/node_modules/@hono/node-server/dist/serve-static.mjs
var COMPRESSIBLE_CONTENT_TYPE_REGEX = /^\s*(?:text\/[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i;
var ENCODINGS = {
	br: ".br",
	zstd: ".zst",
	gzip: ".gz"
};
var ENCODINGS_ORDERED_KEYS = Object.keys(ENCODINGS);
var pr54206Applied = () => {
	const [major, minor] = versions.node.split(".").map((component) => parseInt(component));
	return major >= 23 || major === 22 && minor >= 7 || major === 20 && minor >= 18;
};
var useReadableToWeb = pr54206Applied();
var createStreamBody = (stream) => {
	if (useReadableToWeb) return Readable.toWeb(stream);
	return new ReadableStream({
		start(controller) {
			stream.on("data", (chunk) => {
				controller.enqueue(chunk);
			});
			stream.on("error", (err) => {
				controller.error(err);
			});
			stream.on("end", () => {
				controller.close();
			});
		},
		cancel() {
			stream.destroy();
		}
	});
};
var getStats = (path) => {
	let stats;
	try {
		stats = statSync(path);
	} catch {}
	return stats;
};
var tryDecode$1 = (str, decoder) => {
	try {
		return decoder(str);
	} catch {
		return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match) => {
			try {
				return decoder(match);
			} catch {
				return match;
			}
		});
	}
};
var tryDecodeURI$1 = (str) => tryDecode$1(str, decodeURI);
var serveStatic = (options = { root: "" }) => {
	const root = options.root || "";
	const optionPath = options.path;
	if (root !== "" && !existsSync(root)) console.error(`serveStatic: root path '${root}' is not found, are you sure it's correct?`);
	return async (c, next) => {
		if (c.finalized) return next();
		let filename;
		if (optionPath) filename = optionPath;
		else try {
			filename = tryDecodeURI$1(c.req.path);
			if (/(?:^|[\/\\])\.{1,2}(?:$|[\/\\])|[\/\\]{2,}/.test(filename)) throw new Error();
		} catch {
			await options.onNotFound?.(c.req.path, c);
			return next();
		}
		let path = join(root, !optionPath && options.rewriteRequestPath ? options.rewriteRequestPath(filename, c) : filename);
		let stats = getStats(path);
		if (stats && stats.isDirectory()) {
			const indexFile = options.index ?? "index.html";
			path = join(path, indexFile);
			stats = getStats(path);
		}
		if (!stats) {
			await options.onNotFound?.(path, c);
			return next();
		}
		const mimeType = getMimeType(path);
		c.header("Content-Type", mimeType || "application/octet-stream");
		if (options.precompressed && (!mimeType || COMPRESSIBLE_CONTENT_TYPE_REGEX.test(mimeType))) {
			const acceptEncodingSet = new Set(c.req.header("Accept-Encoding")?.split(",").map((encoding) => encoding.trim()));
			for (const encoding of ENCODINGS_ORDERED_KEYS) {
				if (!acceptEncodingSet.has(encoding)) continue;
				const precompressedStats = getStats(path + ENCODINGS[encoding]);
				if (precompressedStats) {
					c.header("Content-Encoding", encoding);
					c.header("Vary", "Accept-Encoding", { append: true });
					stats = precompressedStats;
					path = path + ENCODINGS[encoding];
					break;
				}
			}
		}
		let result;
		const size = stats.size;
		const range = c.req.header("range") || "";
		if (c.req.method == "HEAD" || c.req.method == "OPTIONS") {
			c.header("Content-Length", size.toString());
			c.status(200);
			result = c.body(null);
		} else if (!range) {
			c.header("Content-Length", size.toString());
			result = c.body(createStreamBody(createReadStream(path)), 200);
		} else {
			c.header("Accept-Ranges", "bytes");
			c.header("Date", stats.birthtime.toUTCString());
			const parts = range.replace(/bytes=/, "").split("-", 2);
			const start = parseInt(parts[0], 10) || 0;
			let end = parseInt(parts[1], 10) || size - 1;
			if (size < end - start + 1) end = size - 1;
			const chunksize = end - start + 1;
			const stream = createReadStream(path, {
				start,
				end
			});
			c.header("Content-Length", chunksize.toString());
			c.header("Content-Range", `bytes ${start}-${end}/${stats.size}`);
			result = c.body(createStreamBody(stream), 206);
		}
		await options.onFound?.(path, c);
		return result;
	};
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/compose.js
var compose = (middleware, onError, onNotFound) => {
	return (context, next) => {
		let index = -1;
		return dispatch(0);
		async function dispatch(i) {
			if (i <= index) throw new Error("next() called multiple times");
			index = i;
			let res;
			let isError = false;
			let handler;
			if (middleware[i]) {
				handler = middleware[i][0][0];
				context.req.routeIndex = i;
			} else handler = i === middleware.length && next || void 0;
			if (handler) try {
				res = await handler(context, () => dispatch(i + 1));
			} catch (err) {
				if (err instanceof Error && onError) {
					context.error = err;
					res = await onError(err, context);
					isError = true;
				} else throw err;
			}
			else if (context.finalized === false && onNotFound) res = await onNotFound(context);
			if (res && (context.finalized === false || isError)) context.res = res;
			return context;
		}
	};
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/utils/body.js
var parseBody = async (request, options = /* @__PURE__ */ Object.create(null)) => {
	const { all = false, dot = false } = options;
	const contentType = (request instanceof HonoRequest ? request.raw.headers : request.headers).get("Content-Type");
	if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) return parseFormData(request, {
		all,
		dot
	});
	return {};
};
async function parseFormData(request, options) {
	const formData = await request.formData();
	if (formData) return convertFormDataToBodyData(formData, options);
	return {};
}
function convertFormDataToBodyData(formData, options) {
	const form = /* @__PURE__ */ Object.create(null);
	formData.forEach((value, key) => {
		if (!(options.all || key.endsWith("[]"))) form[key] = value;
		else handleParsingAllValues(form, key, value);
	});
	if (options.dot) Object.entries(form).forEach(([key, value]) => {
		if (key.includes(".")) {
			handleParsingNestedValues(form, key, value);
			delete form[key];
		}
	});
	return form;
}
var handleParsingAllValues = (form, key, value) => {
	if (form[key] !== void 0) if (Array.isArray(form[key])) form[key].push(value);
	else form[key] = [form[key], value];
	else if (!key.endsWith("[]")) form[key] = value;
	else form[key] = [value];
};
var handleParsingNestedValues = (form, key, value) => {
	if (/(?:^|\.)__proto__\./.test(key)) return;
	let nestedForm = form;
	const keys = key.split(".");
	keys.forEach((key2, index) => {
		if (index === keys.length - 1) nestedForm[key2] = value;
		else {
			if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) nestedForm[key2] = /* @__PURE__ */ Object.create(null);
			nestedForm = nestedForm[key2];
		}
	});
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/utils/url.js
var splitPath = (path) => {
	const paths = path.split("/");
	if (paths[0] === "") paths.shift();
	return paths;
};
var splitRoutingPath = (routePath) => {
	const { groups, path } = extractGroupsFromPath(routePath);
	return replaceGroupMarks(splitPath(path), groups);
};
var extractGroupsFromPath = (path) => {
	const groups = [];
	path = path.replace(/\{[^}]+\}/g, (match, index) => {
		const mark = `@${index}`;
		groups.push([mark, match]);
		return mark;
	});
	return {
		groups,
		path
	};
};
var replaceGroupMarks = (paths, groups) => {
	for (let i = groups.length - 1; i >= 0; i--) {
		const [mark] = groups[i];
		for (let j = paths.length - 1; j >= 0; j--) if (paths[j].includes(mark)) {
			paths[j] = paths[j].replace(mark, groups[i][1]);
			break;
		}
	}
	return paths;
};
var patternCache = {};
var getPattern = (label, next) => {
	if (label === "*") return "*";
	const match = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
	if (match) {
		const cacheKey = `${label}#${next}`;
		if (!patternCache[cacheKey]) if (match[2]) patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [
			cacheKey,
			match[1],
			new RegExp(`^${match[2]}(?=/${next})`)
		] : [
			label,
			match[1],
			new RegExp(`^${match[2]}$`)
		];
		else patternCache[cacheKey] = [
			label,
			match[1],
			true
		];
		return patternCache[cacheKey];
	}
	return null;
};
var tryDecode = (str, decoder) => {
	try {
		return decoder(str);
	} catch {
		return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match) => {
			try {
				return decoder(match);
			} catch {
				return match;
			}
		});
	}
};
var tryDecodeURI = (str) => tryDecode(str, decodeURI);
var getPath = (request) => {
	const url = request.url;
	const start = url.indexOf("/", url.indexOf(":") + 4);
	let i = start;
	for (; i < url.length; i++) {
		const charCode = url.charCodeAt(i);
		if (charCode === 37) {
			const queryIndex = url.indexOf("?", i);
			const hashIndex = url.indexOf("#", i);
			const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
			const path = url.slice(start, end);
			return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
		} else if (charCode === 63 || charCode === 35) break;
	}
	return url.slice(start, i);
};
var getPathNoStrict = (request) => {
	const result = getPath(request);
	return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
};
var mergePath = (base, sub, ...rest) => {
	if (rest.length) sub = mergePath(sub, ...rest);
	return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
};
var checkOptionalParameter = (path) => {
	if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) return null;
	const segments = path.split("/");
	const results = [];
	let basePath = "";
	segments.forEach((segment) => {
		if (segment !== "" && !/\:/.test(segment)) basePath += "/" + segment;
		else if (/\:/.test(segment)) if (/\?/.test(segment)) {
			if (results.length === 0 && basePath === "") results.push("/");
			else results.push(basePath);
			const optionalSegment = segment.replace("?", "");
			basePath += "/" + optionalSegment;
			results.push(basePath);
		} else basePath += "/" + segment;
	});
	return results.filter((v, i, a) => a.indexOf(v) === i);
};
var _decodeURI = (value) => {
	if (!/[%+]/.test(value)) return value;
	if (value.indexOf("+") !== -1) value = value.replace(/\+/g, " ");
	return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
};
var _getQueryParam = (url, key, multiple) => {
	let encoded;
	if (!multiple && key && !/[%+]/.test(key)) {
		let keyIndex2 = url.indexOf("?", 8);
		if (keyIndex2 === -1) return;
		if (!url.startsWith(key, keyIndex2 + 1)) keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
		while (keyIndex2 !== -1) {
			const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
			if (trailingKeyCode === 61) {
				const valueIndex = keyIndex2 + key.length + 2;
				const endIndex = url.indexOf("&", valueIndex);
				return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
			} else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) return "";
			keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
		}
		encoded = /[%+]/.test(url);
		if (!encoded) return;
	}
	const results = {};
	encoded ??= /[%+]/.test(url);
	let keyIndex = url.indexOf("?", 8);
	while (keyIndex !== -1) {
		const nextKeyIndex = url.indexOf("&", keyIndex + 1);
		let valueIndex = url.indexOf("=", keyIndex);
		if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) valueIndex = -1;
		let name = url.slice(keyIndex + 1, valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex);
		if (encoded) name = _decodeURI(name);
		keyIndex = nextKeyIndex;
		if (name === "") continue;
		let value;
		if (valueIndex === -1) value = "";
		else {
			value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
			if (encoded) value = _decodeURI(value);
		}
		if (multiple) {
			if (!(results[name] && Array.isArray(results[name]))) results[name] = [];
			results[name].push(value);
		} else results[name] ??= value;
	}
	return key ? results[key] : results;
};
var getQueryParam = _getQueryParam;
var getQueryParams = (url, key) => {
	return _getQueryParam(url, key, true);
};
var decodeURIComponent_ = decodeURIComponent;
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/request.js
var tryDecodeURIComponent = (str) => tryDecode(str, decodeURIComponent_);
var HonoRequest = class {
	/**
	* `.raw` can get the raw Request object.
	*
	* @see {@link https://hono.dev/docs/api/request#raw}
	*
	* @example
	* ```ts
	* // For Cloudflare Workers
	* app.post('/', async (c) => {
	*   const metadata = c.req.raw.cf?.hostMetadata?
	*   ...
	* })
	* ```
	*/
	raw;
	#validatedData;
	#matchResult;
	routeIndex = 0;
	/**
	* `.path` can get the pathname of the request.
	*
	* @see {@link https://hono.dev/docs/api/request#path}
	*
	* @example
	* ```ts
	* app.get('/about/me', (c) => {
	*   const pathname = c.req.path // `/about/me`
	* })
	* ```
	*/
	path;
	bodyCache = {};
	constructor(request, path = "/", matchResult = [[]]) {
		this.raw = request;
		this.path = path;
		this.#matchResult = matchResult;
		this.#validatedData = {};
	}
	param(key) {
		return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
	}
	#getDecodedParam(key) {
		const paramKey = this.#matchResult[0][this.routeIndex][1][key];
		const param = this.#getParamValue(paramKey);
		return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
	}
	#getAllDecodedParams() {
		const decoded = {};
		const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
		for (const key of keys) {
			const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
			if (value !== void 0) decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
		}
		return decoded;
	}
	#getParamValue(paramKey) {
		return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
	}
	query(key) {
		return getQueryParam(this.url, key);
	}
	queries(key) {
		return getQueryParams(this.url, key);
	}
	header(name) {
		if (name) return this.raw.headers.get(name) ?? void 0;
		const headerData = {};
		this.raw.headers.forEach((value, key) => {
			headerData[key] = value;
		});
		return headerData;
	}
	async parseBody(options) {
		return parseBody(this, options);
	}
	#cachedBody = (key) => {
		const { bodyCache, raw } = this;
		const cachedBody = bodyCache[key];
		if (cachedBody) return cachedBody;
		const anyCachedKey = Object.keys(bodyCache)[0];
		if (anyCachedKey) return bodyCache[anyCachedKey].then((body) => {
			if (anyCachedKey === "json") body = JSON.stringify(body);
			return new Response(body)[key]();
		});
		return bodyCache[key] = raw[key]();
	};
	/**
	* `.json()` can parse Request body of type `application/json`
	*
	* @see {@link https://hono.dev/docs/api/request#json}
	*
	* @example
	* ```ts
	* app.post('/entry', async (c) => {
	*   const body = await c.req.json()
	* })
	* ```
	*/
	json() {
		return this.#cachedBody("text").then((text) => JSON.parse(text));
	}
	/**
	* `.text()` can parse Request body of type `text/plain`
	*
	* @see {@link https://hono.dev/docs/api/request#text}
	*
	* @example
	* ```ts
	* app.post('/entry', async (c) => {
	*   const body = await c.req.text()
	* })
	* ```
	*/
	text() {
		return this.#cachedBody("text");
	}
	/**
	* `.arrayBuffer()` parse Request body as an `ArrayBuffer`
	*
	* @see {@link https://hono.dev/docs/api/request#arraybuffer}
	*
	* @example
	* ```ts
	* app.post('/entry', async (c) => {
	*   const body = await c.req.arrayBuffer()
	* })
	* ```
	*/
	arrayBuffer() {
		return this.#cachedBody("arrayBuffer");
	}
	/**
	* `.bytes()` parses the request body as a `Uint8Array`.
	*
	* @see {@link https://hono.dev/docs/api/request#bytes}
	*
	* @example
	* ```ts
	* app.post('/entry', async (c) => {
	*   const body = await c.req.bytes()
	* })
	* ```
	*/
	bytes() {
		return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
	}
	/**
	* Parses the request body as a `Blob`.
	* @example
	* ```ts
	* app.post('/entry', async (c) => {
	*   const body = await c.req.blob();
	* });
	* ```
	* @see https://hono.dev/docs/api/request#blob
	*/
	blob() {
		return this.#cachedBody("blob");
	}
	/**
	* Parses the request body as `FormData`.
	* @example
	* ```ts
	* app.post('/entry', async (c) => {
	*   const body = await c.req.formData();
	* });
	* ```
	* @see https://hono.dev/docs/api/request#formdata
	*/
	formData() {
		return this.#cachedBody("formData");
	}
	/**
	* Adds validated data to the request.
	*
	* @param target - The target of the validation.
	* @param data - The validated data to add.
	*/
	addValidatedData(target, data) {
		this.#validatedData[target] = data;
	}
	valid(target) {
		return this.#validatedData[target];
	}
	/**
	* `.url()` can get the request url strings.
	*
	* @see {@link https://hono.dev/docs/api/request#url}
	*
	* @example
	* ```ts
	* app.get('/about/me', (c) => {
	*   const url = c.req.url // `http://localhost:8787/about/me`
	*   ...
	* })
	* ```
	*/
	get url() {
		return this.raw.url;
	}
	/**
	* `.method()` can get the method name of the request.
	*
	* @see {@link https://hono.dev/docs/api/request#method}
	*
	* @example
	* ```ts
	* app.get('/about/me', (c) => {
	*   const method = c.req.method // `GET`
	* })
	* ```
	*/
	get method() {
		return this.raw.method;
	}
	get [GET_MATCH_RESULT]() {
		return this.#matchResult;
	}
	/**
	* `.matchedRoutes()` can return a matched route in the handler
	*
	* @deprecated
	*
	* Use matchedRoutes helper defined in "hono/route" instead.
	*
	* @see {@link https://hono.dev/docs/api/request#matchedroutes}
	*
	* @example
	* ```ts
	* app.use('*', async function logger(c, next) {
	*   await next()
	*   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
	*     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
	*     console.log(
	*       method,
	*       ' ',
	*       path,
	*       ' '.repeat(Math.max(10 - path.length, 0)),
	*       name,
	*       i === c.req.routeIndex ? '<- respond from here' : ''
	*     )
	*   })
	* })
	* ```
	*/
	get matchedRoutes() {
		return this.#matchResult[0].map(([[, route]]) => route);
	}
	/**
	* `routePath()` can retrieve the path registered within the handler
	*
	* @deprecated
	*
	* Use routePath helper defined in "hono/route" instead.
	*
	* @see {@link https://hono.dev/docs/api/request#routepath}
	*
	* @example
	* ```ts
	* app.get('/posts/:id', (c) => {
	*   return c.json({ path: c.req.routePath })
	* })
	* ```
	*/
	get routePath() {
		return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
	}
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
	Stringify: 1,
	BeforeStream: 2,
	Stream: 3
};
var raw = (value, callbacks) => {
	const escapedString = new String(value);
	escapedString.isEscaped = true;
	escapedString.callbacks = callbacks;
	return escapedString;
};
var resolveCallback = async (str, phase, preserveCallbacks, context, buffer) => {
	if (typeof str === "object" && !(str instanceof String)) {
		if (!(str instanceof Promise)) str = str.toString();
		if (str instanceof Promise) str = await str;
	}
	const callbacks = str.callbacks;
	if (!callbacks?.length) return Promise.resolve(str);
	if (buffer) buffer[0] += str;
	else buffer = [str];
	const resStr = Promise.all(callbacks.map((c) => c({
		phase,
		buffer,
		context
	}))).then((res) => Promise.all(res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))).then(() => buffer[0]));
	if (preserveCallbacks) return raw(await resStr, callbacks);
	else return resStr;
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = (contentType, headers) => {
	return {
		"Content-Type": contentType,
		...headers
	};
};
var createResponseInstance = (body, init) => new Response(body, init);
var Context = class {
	#rawRequest;
	#req;
	/**
	* `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
	*
	* @see {@link https://hono.dev/docs/api/context#env}
	*
	* @example
	* ```ts
	* // Environment object for Cloudflare Workers
	* app.get('*', async c => {
	*   const counter = c.env.COUNTER
	* })
	* ```
	*/
	env = {};
	#var;
	finalized = false;
	/**
	* `.error` can get the error object from the middleware if the Handler throws an error.
	*
	* @see {@link https://hono.dev/docs/api/context#error}
	*
	* @example
	* ```ts
	* app.use('*', async (c, next) => {
	*   await next()
	*   if (c.error) {
	*     // do something...
	*   }
	* })
	* ```
	*/
	error;
	#status;
	#executionCtx;
	#res;
	#layout;
	#renderer;
	#notFoundHandler;
	#preparedHeaders;
	#matchResult;
	#path;
	/**
	* Creates an instance of the Context class.
	*
	* @param req - The Request object.
	* @param options - Optional configuration options for the context.
	*/
	constructor(req, options) {
		this.#rawRequest = req;
		if (options) {
			this.#executionCtx = options.executionCtx;
			this.env = options.env;
			this.#notFoundHandler = options.notFoundHandler;
			this.#path = options.path;
			this.#matchResult = options.matchResult;
		}
	}
	/**
	* `.req` is the instance of {@link HonoRequest}.
	*/
	get req() {
		this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
		return this.#req;
	}
	/**
	* @see {@link https://hono.dev/docs/api/context#event}
	* The FetchEvent associated with the current request.
	*
	* @throws Will throw an error if the context does not have a FetchEvent.
	*/
	get event() {
		if (this.#executionCtx && "respondWith" in this.#executionCtx) return this.#executionCtx;
		else throw Error("This context has no FetchEvent");
	}
	/**
	* @see {@link https://hono.dev/docs/api/context#executionctx}
	* The ExecutionContext associated with the current request.
	*
	* @throws Will throw an error if the context does not have an ExecutionContext.
	*/
	get executionCtx() {
		if (this.#executionCtx) return this.#executionCtx;
		else throw Error("This context has no ExecutionContext");
	}
	/**
	* @see {@link https://hono.dev/docs/api/context#res}
	* The Response object for the current request.
	*/
	get res() {
		return this.#res ||= createResponseInstance(null, { headers: this.#preparedHeaders ??= new Headers() });
	}
	/**
	* Sets the Response object for the current request.
	*
	* @param _res - The Response object to set.
	*/
	set res(_res) {
		if (this.#res && _res) {
			_res = createResponseInstance(_res.body, _res);
			for (const [k, v] of this.#res.headers.entries()) {
				if (k === "content-type") continue;
				if (k === "set-cookie") {
					const cookies = this.#res.headers.getSetCookie();
					_res.headers.delete("set-cookie");
					for (const cookie of cookies) _res.headers.append("set-cookie", cookie);
				} else _res.headers.set(k, v);
			}
		}
		this.#res = _res;
		this.finalized = true;
	}
	/**
	* `.render()` can create a response within a layout.
	*
	* @see {@link https://hono.dev/docs/api/context#render-setrenderer}
	*
	* @example
	* ```ts
	* app.get('/', (c) => {
	*   return c.render('Hello!')
	* })
	* ```
	*/
	render = (...args) => {
		this.#renderer ??= (content) => this.html(content);
		return this.#renderer(...args);
	};
	/**
	* Sets the layout for the response.
	*
	* @param layout - The layout to set.
	* @returns The layout function.
	*/
	setLayout = (layout) => this.#layout = layout;
	/**
	* Gets the current layout for the response.
	*
	* @returns The current layout function.
	*/
	getLayout = () => this.#layout;
	/**
	* `.setRenderer()` can set the layout in the custom middleware.
	*
	* @see {@link https://hono.dev/docs/api/context#render-setrenderer}
	*
	* @example
	* ```tsx
	* app.use('*', async (c, next) => {
	*   c.setRenderer((content) => {
	*     return c.html(
	*       <html>
	*         <body>
	*           <p>{content}</p>
	*         </body>
	*       </html>
	*     )
	*   })
	*   await next()
	* })
	* ```
	*/
	setRenderer = (renderer) => {
		this.#renderer = renderer;
	};
	/**
	* `.header()` can set headers.
	*
	* @see {@link https://hono.dev/docs/api/context#header}
	*
	* @example
	* ```ts
	* app.get('/welcome', (c) => {
	*   // Set headers
	*   c.header('X-Message', 'Hello!')
	*   c.header('Content-Type', 'text/plain')
	*
	*   return c.body('Thank you for coming')
	* })
	* ```
	*/
	header = (name, value, options) => {
		if (this.finalized) this.#res = createResponseInstance(this.#res.body, this.#res);
		const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
		if (value === void 0) headers.delete(name);
		else if (options?.append) headers.append(name, value);
		else headers.set(name, value);
	};
	status = (status) => {
		this.#status = status;
	};
	/**
	* `.set()` can set the value specified by the key.
	*
	* @see {@link https://hono.dev/docs/api/context#set-get}
	*
	* @example
	* ```ts
	* app.use('*', async (c, next) => {
	*   c.set('message', 'Hono is hot!!')
	*   await next()
	* })
	* ```
	*/
	set = (key, value) => {
		this.#var ??= /* @__PURE__ */ new Map();
		this.#var.set(key, value);
	};
	/**
	* `.get()` can use the value specified by the key.
	*
	* @see {@link https://hono.dev/docs/api/context#set-get}
	*
	* @example
	* ```ts
	* app.get('/', (c) => {
	*   const message = c.get('message')
	*   return c.text(`The message is "${message}"`)
	* })
	* ```
	*/
	get = (key) => {
		return this.#var ? this.#var.get(key) : void 0;
	};
	/**
	* `.var` can access the value of a variable.
	*
	* @see {@link https://hono.dev/docs/api/context#var}
	*
	* @example
	* ```ts
	* const result = c.var.client.oneMethod()
	* ```
	*/
	get var() {
		if (!this.#var) return {};
		return Object.fromEntries(this.#var);
	}
	#newResponse(data, arg, headers) {
		const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
		if (typeof arg === "object" && "headers" in arg) {
			const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
			for (const [key, value] of argHeaders) if (key.toLowerCase() === "set-cookie") responseHeaders.append(key, value);
			else responseHeaders.set(key, value);
		}
		if (headers) for (const [k, v] of Object.entries(headers)) if (typeof v === "string") responseHeaders.set(k, v);
		else {
			responseHeaders.delete(k);
			for (const v2 of v) responseHeaders.append(k, v2);
		}
		return createResponseInstance(data, {
			status: typeof arg === "number" ? arg : arg?.status ?? this.#status,
			headers: responseHeaders
		});
	}
	newResponse = (...args) => this.#newResponse(...args);
	/**
	* `.body()` can return the HTTP response.
	* You can set headers with `.header()` and set HTTP status code with `.status`.
	* This can also be set in `.text()`, `.json()` and so on.
	*
	* @see {@link https://hono.dev/docs/api/context#body}
	*
	* @example
	* ```ts
	* app.get('/welcome', (c) => {
	*   // Set headers
	*   c.header('X-Message', 'Hello!')
	*   c.header('Content-Type', 'text/plain')
	*   // Set HTTP status code
	*   c.status(201)
	*
	*   // Return the response body
	*   return c.body('Thank you for coming')
	* })
	* ```
	*/
	body = (data, arg, headers) => this.#newResponse(data, arg, headers);
	/**
	* `.text()` can render text as `Content-Type:text/plain`.
	*
	* @see {@link https://hono.dev/docs/api/context#text}
	*
	* @example
	* ```ts
	* app.get('/say', (c) => {
	*   return c.text('Hello!')
	* })
	* ```
	*/
	text = (text, arg, headers) => {
		return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(text, arg, setDefaultContentType(TEXT_PLAIN, headers));
	};
	/**
	* `.json()` can render JSON as `Content-Type:application/json`.
	*
	* @see {@link https://hono.dev/docs/api/context#json}
	*
	* @example
	* ```ts
	* app.get('/api', (c) => {
	*   return c.json({ message: 'Hello!' })
	* })
	* ```
	*/
	json = (object, arg, headers) => {
		return this.#newResponse(JSON.stringify(object), arg, setDefaultContentType("application/json", headers));
	};
	html = (html, arg, headers) => {
		const res = (html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers));
		return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
	};
	/**
	* `.redirect()` can Redirect, default status code is 302.
	*
	* @see {@link https://hono.dev/docs/api/context#redirect}
	*
	* @example
	* ```ts
	* app.get('/redirect', (c) => {
	*   return c.redirect('/')
	* })
	* app.get('/redirect-permanently', (c) => {
	*   return c.redirect('/', 301)
	* })
	* ```
	*/
	redirect = (location, status) => {
		const locationString = String(location);
		this.header("Location", !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString));
		return this.newResponse(null, status ?? 302);
	};
	/**
	* `.notFound()` can return the Not Found Response.
	*
	* @see {@link https://hono.dev/docs/api/context#notfound}
	*
	* @example
	* ```ts
	* app.get('/notfound', (c) => {
	*   return c.notFound()
	* })
	* ```
	*/
	notFound = () => {
		this.#notFoundHandler ??= () => createResponseInstance();
		return this.#notFoundHandler(this);
	};
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/router.js
var METHODS = [
	"get",
	"post",
	"put",
	"delete",
	"options",
	"patch"
];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/hono-base.js
var notFoundHandler = (c) => {
	return c.text("404 Not Found", 404);
};
var errorHandler = (err, c) => {
	if ("getResponse" in err) {
		const res = err.getResponse();
		return c.newResponse(res.body, res);
	}
	console.error(err);
	return c.text("Internal Server Error", 500);
};
var Hono$1 = class _Hono {
	get;
	post;
	put;
	delete;
	options;
	patch;
	all;
	on;
	use;
	router;
	getPath;
	_basePath = "/";
	#path = "/";
	routes = [];
	constructor(options = {}) {
		[...METHODS, "all"].forEach((method) => {
			this[method] = (args1, ...args) => {
				if (typeof args1 === "string") this.#path = args1;
				else this.#addRoute(method, this.#path, args1);
				args.forEach((handler) => {
					this.#addRoute(method, this.#path, handler);
				});
				return this;
			};
		});
		this.on = (method, path, ...handlers) => {
			for (const p of [path].flat()) {
				this.#path = p;
				for (const m of [method].flat()) handlers.map((handler) => {
					this.#addRoute(m.toUpperCase(), this.#path, handler);
				});
			}
			return this;
		};
		this.use = (arg1, ...handlers) => {
			if (typeof arg1 === "string") this.#path = arg1;
			else {
				this.#path = "*";
				handlers.unshift(arg1);
			}
			handlers.forEach((handler) => {
				this.#addRoute("ALL", this.#path, handler);
			});
			return this;
		};
		const { strict, ...optionsWithoutStrict } = options;
		Object.assign(this, optionsWithoutStrict);
		this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
	}
	#clone() {
		const clone = new _Hono({
			router: this.router,
			getPath: this.getPath
		});
		clone.errorHandler = this.errorHandler;
		clone.#notFoundHandler = this.#notFoundHandler;
		clone.routes = this.routes;
		return clone;
	}
	#notFoundHandler = notFoundHandler;
	errorHandler = errorHandler;
	/**
	* `.route()` allows grouping other Hono instance in routes.
	*
	* @see {@link https://hono.dev/docs/api/routing#grouping}
	*
	* @param {string} path - base Path
	* @param {Hono} app - other Hono instance
	* @returns {Hono} routed Hono instance
	*
	* @example
	* ```ts
	* const app = new Hono()
	* const app2 = new Hono()
	*
	* app2.get("/user", (c) => c.text("user"))
	* app.route("/api", app2) // GET /api/user
	* ```
	*/
	route(path, app) {
		const subApp = this.basePath(path);
		app.routes.map((r) => {
			let handler;
			if (app.errorHandler === errorHandler) handler = r.handler;
			else {
				handler = async (c, next) => (await compose([], app.errorHandler)(c, () => r.handler(c, next))).res;
				handler[COMPOSED_HANDLER] = r.handler;
			}
			subApp.#addRoute(r.method, r.path, handler, r.basePath);
		});
		return this;
	}
	/**
	* `.basePath()` allows base paths to be specified.
	*
	* @see {@link https://hono.dev/docs/api/routing#base-path}
	*
	* @param {string} path - base Path
	* @returns {Hono} changed Hono instance
	*
	* @example
	* ```ts
	* const api = new Hono().basePath('/api')
	* ```
	*/
	basePath(path) {
		const subApp = this.#clone();
		subApp._basePath = mergePath(this._basePath, path);
		return subApp;
	}
	/**
	* `.onError()` handles an error and returns a customized Response.
	*
	* @see {@link https://hono.dev/docs/api/hono#error-handling}
	*
	* @param {ErrorHandler} handler - request Handler for error
	* @returns {Hono} changed Hono instance
	*
	* @example
	* ```ts
	* app.onError((err, c) => {
	*   console.error(`${err}`)
	*   return c.text('Custom Error Message', 500)
	* })
	* ```
	*/
	onError = (handler) => {
		this.errorHandler = handler;
		return this;
	};
	/**
	* `.notFound()` allows you to customize a Not Found Response.
	*
	* @see {@link https://hono.dev/docs/api/hono#not-found}
	*
	* @param {NotFoundHandler} handler - request handler for not-found
	* @returns {Hono} changed Hono instance
	*
	* @example
	* ```ts
	* app.notFound((c) => {
	*   return c.text('Custom 404 Message', 404)
	* })
	* ```
	*/
	notFound = (handler) => {
		this.#notFoundHandler = handler;
		return this;
	};
	/**
	* `.mount()` allows you to mount applications built with other frameworks into your Hono application.
	*
	* @see {@link https://hono.dev/docs/api/hono#mount}
	*
	* @param {string} path - base Path
	* @param {Function} applicationHandler - other Request Handler
	* @param {MountOptions} [options] - options of `.mount()`
	* @returns {Hono} mounted Hono instance
	*
	* @example
	* ```ts
	* import { Router as IttyRouter } from 'itty-router'
	* import { Hono } from 'hono'
	* // Create itty-router application
	* const ittyRouter = IttyRouter()
	* // GET /itty-router/hello
	* ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
	*
	* const app = new Hono()
	* app.mount('/itty-router', ittyRouter.handle)
	* ```
	*
	* @example
	* ```ts
	* const app = new Hono()
	* // Send the request to another application without modification.
	* app.mount('/app', anotherApp, {
	*   replaceRequest: (req) => req,
	* })
	* ```
	*/
	mount(path, applicationHandler, options) {
		let replaceRequest;
		let optionHandler;
		if (options) if (typeof options === "function") optionHandler = options;
		else {
			optionHandler = options.optionHandler;
			if (options.replaceRequest === false) replaceRequest = (request) => request;
			else replaceRequest = options.replaceRequest;
		}
		const getOptions = optionHandler ? (c) => {
			const options2 = optionHandler(c);
			return Array.isArray(options2) ? options2 : [options2];
		} : (c) => {
			let executionContext = void 0;
			try {
				executionContext = c.executionCtx;
			} catch {}
			return [c.env, executionContext];
		};
		replaceRequest ||= (() => {
			const mergedPath = mergePath(this._basePath, path);
			const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
			return (request) => {
				const url = new URL(request.url);
				url.pathname = this.getPath(request).slice(pathPrefixLength) || "/";
				return new Request(url, request);
			};
		})();
		const handler = async (c, next) => {
			const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
			if (res) return res;
			await next();
		};
		this.#addRoute("ALL", mergePath(path, "*"), handler);
		return this;
	}
	#addRoute(method, path, handler, baseRoutePath) {
		method = method.toUpperCase();
		path = mergePath(this._basePath, path);
		const r = {
			basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
			path,
			method,
			handler
		};
		this.router.add(method, path, [handler, r]);
		this.routes.push(r);
	}
	#handleError(err, c) {
		if (err instanceof Error) return this.errorHandler(err, c);
		throw err;
	}
	#dispatch(request, executionCtx, env, method) {
		if (method === "HEAD") return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
		const path = this.getPath(request, { env });
		const matchResult = this.router.match(method, path);
		const c = new Context(request, {
			path,
			matchResult,
			env,
			executionCtx,
			notFoundHandler: this.#notFoundHandler
		});
		if (matchResult[0].length === 1) {
			let res;
			try {
				res = matchResult[0][0][0][0](c, async () => {
					c.res = await this.#notFoundHandler(c);
				});
			} catch (err) {
				return this.#handleError(err, c);
			}
			return res instanceof Promise ? res.then((resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
		}
		const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
		return (async () => {
			try {
				const context = await composed(c);
				if (!context.finalized) throw new Error("Context is not finalized. Did you forget to return a Response object or `await next()`?");
				return context.res;
			} catch (err) {
				return this.#handleError(err, c);
			}
		})();
	}
	/**
	* `.fetch()` will be entry point of your app.
	*
	* @see {@link https://hono.dev/docs/api/hono#fetch}
	*
	* @param {Request} request - request Object of request
	* @param {Env} Env - env Object
	* @param {ExecutionContext} - context of execution
	* @returns {Response | Promise<Response>} response of request
	*
	*/
	fetch = (request, ...rest) => {
		return this.#dispatch(request, rest[1], rest[0], request.method);
	};
	/**
	* `.request()` is a useful method for testing.
	* You can pass a URL or pathname to send a GET request.
	* app will return a Response object.
	* ```ts
	* test('GET /hello is ok', async () => {
	*   const res = await app.request('/hello')
	*   expect(res.status).toBe(200)
	* })
	* ```
	* @see https://hono.dev/docs/api/hono#request
	*/
	request = (input, requestInit, Env, executionCtx) => {
		if (input instanceof Request) return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
		input = input.toString();
		return this.fetch(new Request(/^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`, requestInit), Env, executionCtx);
	};
	/**
	* `.fire()` automatically adds a global fetch event listener.
	* This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
	* @deprecated
	* Use `fire` from `hono/service-worker` instead.
	* ```ts
	* import { Hono } from 'hono'
	* import { fire } from 'hono/service-worker'
	*
	* const app = new Hono()
	* // ...
	* fire(app)
	* ```
	* @see https://hono.dev/docs/api/hono#fire
	* @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
	* @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
	*/
	fire = () => {
		addEventListener("fetch", (event) => {
			event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
		});
	};
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
	const matchers = this.buildAllMatchers();
	const match2 = ((method2, path2) => {
		const matcher = matchers[method2] || matchers["ALL"];
		const staticMatch = matcher[2][path2];
		if (staticMatch) return staticMatch;
		const match3 = path2.match(matcher[0]);
		if (!match3) return [[], emptyParam];
		const index = match3.indexOf("", 1);
		return [matcher[1][index], match3];
	});
	this.match = match2;
	return match2(method, path);
}
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = /* @__PURE__ */ new Set(".\\+*[^]$()");
function compareKey(a, b) {
	if (a.length === 1) return b.length === 1 ? a < b ? -1 : 1 : -1;
	if (b.length === 1) return 1;
	if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) return 1;
	else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) return -1;
	if (a === LABEL_REG_EXP_STR) return 1;
	else if (b === LABEL_REG_EXP_STR) return -1;
	return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
var Node$1 = class _Node {
	#index;
	#varIndex;
	#children = /* @__PURE__ */ Object.create(null);
	insert(tokens, index, paramMap, context, pathErrorCheckOnly) {
		if (tokens.length === 0) {
			if (this.#index !== void 0) throw PATH_ERROR;
			if (pathErrorCheckOnly) return;
			this.#index = index;
			return;
		}
		const [token, ...restTokens] = tokens;
		const pattern = token === "*" ? restTokens.length === 0 ? [
			"",
			"",
			ONLY_WILDCARD_REG_EXP_STR
		] : [
			"",
			"",
			LABEL_REG_EXP_STR
		] : token === "/*" ? [
			"",
			"",
			TAIL_WILDCARD_REG_EXP_STR
		] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
		let node;
		if (pattern) {
			const name = pattern[1];
			let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
			if (name && pattern[2]) {
				if (regexpStr === ".*") throw PATH_ERROR;
				regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
				if (/\((?!\?:)/.test(regexpStr)) throw PATH_ERROR;
			}
			node = this.#children[regexpStr];
			if (!node) {
				if (Object.keys(this.#children).some((k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR)) throw PATH_ERROR;
				if (pathErrorCheckOnly) return;
				node = this.#children[regexpStr] = new _Node();
				if (name !== "") node.#varIndex = context.varIndex++;
			}
			if (!pathErrorCheckOnly && name !== "") paramMap.push([name, node.#varIndex]);
		} else {
			node = this.#children[token];
			if (!node) {
				if (Object.keys(this.#children).some((k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR)) throw PATH_ERROR;
				if (pathErrorCheckOnly) return;
				node = this.#children[token] = new _Node();
			}
		}
		node.insert(restTokens, index, paramMap, context, pathErrorCheckOnly);
	}
	buildRegExpStr() {
		const strList = Object.keys(this.#children).sort(compareKey).map((k) => {
			const c = this.#children[k];
			return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
		});
		if (typeof this.#index === "number") strList.unshift(`#${this.#index}`);
		if (strList.length === 0) return "";
		if (strList.length === 1) return strList[0];
		return "(?:" + strList.join("|") + ")";
	}
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
	#context = { varIndex: 0 };
	#root = new Node$1();
	insert(path, index, pathErrorCheckOnly) {
		const paramAssoc = [];
		const groups = [];
		for (let i = 0;;) {
			let replaced = false;
			path = path.replace(/\{[^}]+\}/g, (m) => {
				const mark = `@\\${i}`;
				groups[i] = [mark, m];
				i++;
				replaced = true;
				return mark;
			});
			if (!replaced) break;
		}
		const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
		for (let i = groups.length - 1; i >= 0; i--) {
			const [mark] = groups[i];
			for (let j = tokens.length - 1; j >= 0; j--) if (tokens[j].indexOf(mark) !== -1) {
				tokens[j] = tokens[j].replace(mark, groups[i][1]);
				break;
			}
		}
		this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
		return paramAssoc;
	}
	buildRegExp() {
		let regexp = this.#root.buildRegExpStr();
		if (regexp === "") return [
			/^$/,
			[],
			[]
		];
		let captureIndex = 0;
		const indexReplacementMap = [];
		const paramReplacementMap = [];
		regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
			if (handlerIndex !== void 0) {
				indexReplacementMap[++captureIndex] = Number(handlerIndex);
				return "$()";
			}
			if (paramIndex !== void 0) {
				paramReplacementMap[Number(paramIndex)] = ++captureIndex;
				return "";
			}
			return "";
		});
		return [
			new RegExp(`^${regexp}`),
			indexReplacementMap,
			paramReplacementMap
		];
	}
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/router/reg-exp-router/router.js
var nullMatcher = [
	/^$/,
	[],
	/* @__PURE__ */ Object.create(null)
];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
	return wildcardRegExpCache[path] ??= new RegExp(path === "*" ? "" : `^${path.replace(/\/\*$|([.\\+*[^\]$()])/g, (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)")}$`);
}
function clearWildcardRegExpCache() {
	wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
function buildMatcherFromPreprocessedRoutes(routes) {
	const trie = new Trie();
	const handlerData = [];
	if (routes.length === 0) return nullMatcher;
	const routesWithStaticPathFlag = routes.map((route) => [!/\*|\/:/.test(route[0]), ...route]).sort(([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length);
	const staticMap = /* @__PURE__ */ Object.create(null);
	for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
		const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
		if (pathErrorCheckOnly) staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
		else j++;
		let paramAssoc;
		try {
			paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
		} catch (e) {
			throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
		}
		if (pathErrorCheckOnly) continue;
		handlerData[j] = handlers.map(([h, paramCount]) => {
			const paramIndexMap = /* @__PURE__ */ Object.create(null);
			paramCount -= 1;
			for (; paramCount >= 0; paramCount--) {
				const [key, value] = paramAssoc[paramCount];
				paramIndexMap[key] = value;
			}
			return [h, paramIndexMap];
		});
	}
	const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
	for (let i = 0, len = handlerData.length; i < len; i++) for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
		const map = handlerData[i][j]?.[1];
		if (!map) continue;
		const keys = Object.keys(map);
		for (let k = 0, len3 = keys.length; k < len3; k++) map[keys[k]] = paramReplacementMap[map[keys[k]]];
	}
	const handlerMap = [];
	for (const i in indexReplacementMap) handlerMap[i] = handlerData[indexReplacementMap[i]];
	return [
		regexp,
		handlerMap,
		staticMap
	];
}
function findMiddleware(middleware, path) {
	if (!middleware) return;
	for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) if (buildWildcardRegExp(k).test(path)) return [...middleware[k]];
}
var RegExpRouter = class {
	name = "RegExpRouter";
	#middleware;
	#routes;
	constructor() {
		this.#middleware = { ["ALL"]: /* @__PURE__ */ Object.create(null) };
		this.#routes = { ["ALL"]: /* @__PURE__ */ Object.create(null) };
	}
	add(method, path, handler) {
		const middleware = this.#middleware;
		const routes = this.#routes;
		if (!middleware || !routes) throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
		if (!middleware[method]) [middleware, routes].forEach((handlerMap) => {
			handlerMap[method] = /* @__PURE__ */ Object.create(null);
			Object.keys(handlerMap["ALL"]).forEach((p) => {
				handlerMap[method][p] = [...handlerMap["ALL"][p]];
			});
		});
		if (path === "/*") path = "*";
		const paramCount = (path.match(/\/:/g) || []).length;
		if (/\*$/.test(path)) {
			const re = buildWildcardRegExp(path);
			if (method === "ALL") Object.keys(middleware).forEach((m) => {
				middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware["ALL"], path) || [];
			});
			else middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware["ALL"], path) || [];
			Object.keys(middleware).forEach((m) => {
				if (method === "ALL" || method === m) Object.keys(middleware[m]).forEach((p) => {
					re.test(p) && middleware[m][p].push([handler, paramCount]);
				});
			});
			Object.keys(routes).forEach((m) => {
				if (method === "ALL" || method === m) Object.keys(routes[m]).forEach((p) => re.test(p) && routes[m][p].push([handler, paramCount]));
			});
			return;
		}
		const paths = checkOptionalParameter(path) || [path];
		for (let i = 0, len = paths.length; i < len; i++) {
			const path2 = paths[i];
			Object.keys(routes).forEach((m) => {
				if (method === "ALL" || method === m) {
					routes[m][path2] ||= [...findMiddleware(middleware[m], path2) || findMiddleware(middleware["ALL"], path2) || []];
					routes[m][path2].push([handler, paramCount - len + i + 1]);
				}
			});
		}
	}
	match = match;
	buildAllMatchers() {
		const matchers = /* @__PURE__ */ Object.create(null);
		Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
			matchers[method] ||= this.#buildMatcher(method);
		});
		this.#middleware = this.#routes = void 0;
		clearWildcardRegExpCache();
		return matchers;
	}
	#buildMatcher(method) {
		const routes = [];
		let hasOwnRoute = method === "ALL";
		[this.#middleware, this.#routes].forEach((r) => {
			const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
			if (ownRoute.length !== 0) {
				hasOwnRoute ||= true;
				routes.push(...ownRoute);
			} else if (method !== "ALL") routes.push(...Object.keys(r["ALL"]).map((path) => [path, r["ALL"][path]]));
		});
		if (!hasOwnRoute) return null;
		else return buildMatcherFromPreprocessedRoutes(routes);
	}
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
	name = "SmartRouter";
	#routers = [];
	#routes = [];
	constructor(init) {
		this.#routers = init.routers;
	}
	add(method, path, handler) {
		if (!this.#routes) throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
		this.#routes.push([
			method,
			path,
			handler
		]);
	}
	match(method, path) {
		if (!this.#routes) throw new Error("Fatal error");
		const routers = this.#routers;
		const routes = this.#routes;
		const len = routers.length;
		let i = 0;
		let res;
		for (; i < len; i++) {
			const router = routers[i];
			try {
				for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) router.add(...routes[i2]);
				res = router.match(method, path);
			} catch (e) {
				if (e instanceof UnsupportedPathError) continue;
				throw e;
			}
			this.match = router.match.bind(router);
			this.#routers = [router];
			this.#routes = void 0;
			break;
		}
		if (i === len) throw new Error("Fatal error");
		this.name = `SmartRouter + ${this.activeRouter.name}`;
		return res;
	}
	get activeRouter() {
		if (this.#routes || this.#routers.length !== 1) throw new Error("No active router has been determined yet.");
		return this.#routers[0];
	}
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var hasChildren = (children) => {
	for (const _ in children) return true;
	return false;
};
var Node = class _Node {
	#methods;
	#children;
	#patterns;
	#order = 0;
	#params = emptyParams;
	constructor(method, handler, children) {
		this.#children = children || /* @__PURE__ */ Object.create(null);
		this.#methods = [];
		if (method && handler) {
			const m = /* @__PURE__ */ Object.create(null);
			m[method] = {
				handler,
				possibleKeys: [],
				score: 0
			};
			this.#methods = [m];
		}
		this.#patterns = [];
	}
	insert(method, path, handler) {
		this.#order = ++this.#order;
		let curNode = this;
		const parts = splitRoutingPath(path);
		const possibleKeys = [];
		for (let i = 0, len = parts.length; i < len; i++) {
			const p = parts[i];
			const nextP = parts[i + 1];
			const pattern = getPattern(p, nextP);
			const key = Array.isArray(pattern) ? pattern[0] : p;
			if (key in curNode.#children) {
				curNode = curNode.#children[key];
				if (pattern) possibleKeys.push(pattern[1]);
				continue;
			}
			curNode.#children[key] = new _Node();
			if (pattern) {
				curNode.#patterns.push(pattern);
				possibleKeys.push(pattern[1]);
			}
			curNode = curNode.#children[key];
		}
		curNode.#methods.push({ [method]: {
			handler,
			possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
			score: this.#order
		} });
		return curNode;
	}
	#pushHandlerSets(handlerSets, node, method, nodeParams, params) {
		for (let i = 0, len = node.#methods.length; i < len; i++) {
			const m = node.#methods[i];
			const handlerSet = m[method] || m["ALL"];
			const processedSet = {};
			if (handlerSet !== void 0) {
				handlerSet.params = /* @__PURE__ */ Object.create(null);
				handlerSets.push(handlerSet);
				if (nodeParams !== emptyParams || params && params !== emptyParams) for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
					const key = handlerSet.possibleKeys[i2];
					const processed = processedSet[handlerSet.score];
					handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
					processedSet[handlerSet.score] = true;
				}
			}
		}
	}
	search(method, path) {
		const handlerSets = [];
		this.#params = emptyParams;
		let curNodes = [this];
		const parts = splitPath(path);
		const curNodesQueue = [];
		const len = parts.length;
		let partOffsets = null;
		for (let i = 0; i < len; i++) {
			const part = parts[i];
			const isLast = i === len - 1;
			const tempNodes = [];
			for (let j = 0, len2 = curNodes.length; j < len2; j++) {
				const node = curNodes[j];
				const nextNode = node.#children[part];
				if (nextNode) {
					nextNode.#params = node.#params;
					if (isLast) {
						if (nextNode.#children["*"]) this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
						this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
					} else tempNodes.push(nextNode);
				}
				for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
					const pattern = node.#patterns[k];
					const params = node.#params === emptyParams ? {} : { ...node.#params };
					if (pattern === "*") {
						const astNode = node.#children["*"];
						if (astNode) {
							this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
							astNode.#params = params;
							tempNodes.push(astNode);
						}
						continue;
					}
					const [key, name, matcher] = pattern;
					if (!part && !(matcher instanceof RegExp)) continue;
					const child = node.#children[key];
					if (matcher instanceof RegExp) {
						if (partOffsets === null) {
							partOffsets = new Array(len);
							let offset = path[0] === "/" ? 1 : 0;
							for (let p = 0; p < len; p++) {
								partOffsets[p] = offset;
								offset += parts[p].length + 1;
							}
						}
						const restPathString = path.substring(partOffsets[i]);
						const m = matcher.exec(restPathString);
						if (m) {
							params[name] = m[0];
							this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
							if (hasChildren(child.#children)) {
								child.#params = params;
								const componentCount = m[0].match(/\//)?.length ?? 0;
								(curNodesQueue[componentCount] ||= []).push(child);
							}
							continue;
						}
					}
					if (matcher === true || matcher.test(part)) {
						params[name] = part;
						if (isLast) {
							this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
							if (child.#children["*"]) this.#pushHandlerSets(handlerSets, child.#children["*"], method, params, node.#params);
						} else {
							child.#params = params;
							tempNodes.push(child);
						}
					}
				}
			}
			const shifted = curNodesQueue.shift();
			curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
		}
		if (handlerSets.length > 1) handlerSets.sort((a, b) => {
			return a.score - b.score;
		});
		return [handlerSets.map(({ handler, params }) => [handler, params])];
	}
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
	name = "TrieRouter";
	#node;
	constructor() {
		this.#node = new Node();
	}
	add(method, path, handler) {
		const results = checkOptionalParameter(path);
		if (results) {
			for (let i = 0, len = results.length; i < len; i++) this.#node.insert(method, results[i], handler);
			return;
		}
		this.#node.insert(method, path, handler);
	}
	match(method, path) {
		return this.#node.search(method, path);
	}
};
//#endregion
//#region ../../node_modules/.pnpm/hono@4.12.24/node_modules/hono/dist/hono.js
var Hono = class extends Hono$1 {
	/**
	* Creates an instance of the Hono class.
	*
	* @param options - Optional configuration options for the Hono instance.
	*/
	constructor(options = {}) {
		super(options);
		this.router = options.router ?? new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] });
	}
};
//#endregion
//#region src/webui/auth.ts
var log$3 = createLogger("WebUI.Auth");
var CONFIG_DIR$1 = "config";
var WEBUI_CONFIG_PATH = path.join(CONFIG_DIR$1, "webui.json");
var SCRYPT_KEYLEN = 64;
var SCRYPT_N = 16384;
var SCRYPT_R = 8;
var SCRYPT_P = 1;
var DEV_PASSWORD = "snowluma-dev";
function isDevAuthMode() {
	return process.env.SNOWLUMA_DEV_MODE === "1";
}
function envBootstrapPassword() {
	const raw = process.env.SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD;
	if (!raw || typeof raw !== "string") return null;
	if (raw.length < 8) return null;
	return raw;
}
var PASSWORD_RULES = [
	{
		id: "length",
		label: "长度不少于 10 位",
		test: (p) => p.length >= 10
	},
	{
		id: "lower",
		label: "包含小写字母",
		test: (p) => /[a-z]/.test(p)
	},
	{
		id: "upper",
		label: "包含大写字母",
		test: (p) => /[A-Z]/.test(p)
	},
	{
		id: "special",
		label: "包含特殊符号 (!@#$%…)",
		test: (p) => /[^A-Za-z0-9\s]/.test(p)
	},
	{
		id: "no-space",
		label: "不包含空格",
		test: (p) => !/\s/.test(p) && p.length > 0
	}
];
function evaluatePasswordRules(password) {
	return PASSWORD_RULES.map((r) => ({
		id: r.id,
		label: r.label,
		ok: r.test(password)
	}));
}
function isStrongPassword(password) {
	return PASSWORD_RULES.every((r) => r.test(password));
}
function hashPassword(password, salt) {
	return scryptSync(password, salt, SCRYPT_KEYLEN, {
		N: SCRYPT_N,
		r: SCRYPT_R,
		p: SCRYPT_P
	});
}
function ensureConfigDir$1() {
	fs.mkdirSync(CONFIG_DIR$1, { recursive: true });
}
function isValidState(value) {
	if (!value || typeof value !== "object") return false;
	const v = value;
	return typeof v.passwordHash === "string" && typeof v.passwordSalt === "string" && typeof v.mustChangePassword === "boolean" && /^[0-9a-f]+$/i.test(v.passwordHash) && /^[0-9a-f]+$/i.test(v.passwordSalt);
}
function generateInitialState(initialPassword) {
	const salt = randomBytes(16);
	const hash = hashPassword(initialPassword, salt);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	return {
		passwordHash: hash.toString("hex"),
		passwordSalt: salt.toString("hex"),
		mustChangePassword: true,
		generatedAt: now,
		updatedAt: now
	};
}
function backupCorruptConfig() {
	try {
		const dest = `${WEBUI_CONFIG_PATH}.bak.${Date.now()}`;
		fs.renameSync(WEBUI_CONFIG_PATH, dest);
		log$3.warn("previous webui.json moved to %s", dest);
	} catch (err) {
		log$3.warn("failed to back up corrupt webui.json: %s", err instanceof Error ? err.message : String(err));
	}
}
function atomicWrite$1(state) {
	ensureConfigDir$1();
	const tmp = WEBUI_CONFIG_PATH + ".tmp";
	fs.writeFileSync(tmp, JSON.stringify(state, null, 2), {
		encoding: "utf8",
		mode: 384
	});
	try {
		fs.chmodSync(tmp, 384);
	} catch {}
	fs.renameSync(tmp, WEBUI_CONFIG_PATH);
}
var WebuiAuth = class WebuiAuth {
	state;
	initialPlain;
	devMode;
	constructor(state, initialPlain, devMode) {
		this.state = state;
		this.initialPlain = initialPlain;
		this.devMode = devMode;
	}
	static load() {
		if (isDevAuthMode()) {
			const salt = randomBytes(16);
			const hash = hashPassword(DEV_PASSWORD, salt);
			const now = (/* @__PURE__ */ new Date()).toISOString();
			return new WebuiAuth({
				passwordHash: hash.toString("hex"),
				passwordSalt: salt.toString("hex"),
				mustChangePassword: false,
				generatedAt: now,
				updatedAt: now
			}, null, true);
		}
		ensureConfigDir$1();
		if (fs.existsSync(WEBUI_CONFIG_PATH)) try {
			const raw = fs.readFileSync(WEBUI_CONFIG_PATH, "utf8");
			const parsed = JSON.parse(raw);
			if (isValidState(parsed)) {
				if (parsed.mustChangePassword) {
					const initialPassword = randomBytes(8).toString("hex");
					const state = generateInitialState(initialPassword);
					atomicWrite$1(state);
					log$3.warn("previous bootstrap password was never rotated; regenerated a new one");
					return new WebuiAuth(state, initialPassword, false);
				}
				return new WebuiAuth(parsed, null, false);
			}
			log$3.error("webui.json schema invalid; backing up and regenerating credentials");
			backupCorruptConfig();
		} catch (err) {
			log$3.error("webui.json is corrupt and will be regenerated; the previous file is backed up: %s", err instanceof Error ? err.message : String(err));
			backupCorruptConfig();
		}
		const envPassword = envBootstrapPassword();
		if (envPassword !== null) {
			const salt = randomBytes(16);
			const hash = hashPassword(envPassword, salt);
			const now = (/* @__PURE__ */ new Date()).toISOString();
			const state = {
				passwordHash: hash.toString("hex"),
				passwordSalt: salt.toString("hex"),
				mustChangePassword: false,
				generatedAt: now,
				updatedAt: now
			};
			atomicWrite$1(state);
			log$3.info("webui credentials seeded from SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD");
			return new WebuiAuth(state, null, false);
		}
		const initialPassword = randomBytes(8).toString("hex");
		const state = generateInitialState(initialPassword);
		atomicWrite$1(state);
		return new WebuiAuth(state, initialPassword, false);
	}
	/** True when SNOWLUMA_DEV_MODE was active at load time. */
	isDevMode() {
		return this.devMode;
	}
	/** Fixed dev password (only meaningful when {@link isDevMode} is true). */
	static get devPassword() {
		return DEV_PASSWORD;
	}
	/** Returns the auto-generated initial password if this is a fresh install, else null. */
	takeInitialPassword() {
		const p = this.initialPlain;
		this.initialPlain = null;
		return p;
	}
	mustChangePassword() {
		return this.state.mustChangePassword;
	}
	verify(password) {
		if (typeof password !== "string" || password.length === 0) return false;
		try {
			const salt = Buffer.from(this.state.passwordSalt, "hex");
			const expected = Buffer.from(this.state.passwordHash, "hex");
			const got = hashPassword(password, salt);
			if (got.length !== expected.length) return false;
			return timingSafeEqual(got, expected);
		} catch {
			return false;
		}
	}
	setPassword(newPassword) {
		if (this.devMode) throw new Error("开发模式 (SNOWLUMA_DEV_MODE=1) 已禁用密码修改");
		if (!isStrongPassword(newPassword)) throw new Error("密码不符合强度要求");
		const salt = randomBytes(16);
		const next = {
			passwordHash: hashPassword(newPassword, salt).toString("hex"),
			passwordSalt: salt.toString("hex"),
			mustChangePassword: false,
			generatedAt: this.state.generatedAt,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		atomicWrite$1(next);
		this.state = next;
	}
};
//#endregion
//#region ../../node_modules/.pnpm/@hono+node-server@1.19.14_hono@4.12.24/node_modules/@hono/node-server/dist/conninfo.mjs
var getConnInfo = (c) => {
	const bindings = c.env.server ? c.env.server : c.env;
	const address = bindings.incoming.socket.remoteAddress;
	const port = bindings.incoming.socket.remotePort;
	const family = bindings.incoming.socket.remoteFamily;
	return { remote: {
		address,
		port,
		addressType: family === "IPv4" ? "IPv4" : family === "IPv6" ? "IPv6" : void 0
	} };
};
//#endregion
//#region src/webui/client-ip.ts
function parseTrustProxy(raw) {
	const value = raw?.trim().toLowerCase() ?? "";
	if (!value) return { kind: "none" };
	if (value === "1" || value === "true" || value === "all") return { kind: "all" };
	if (value === "loopback") return { kind: "loopback" };
	const ips = new Set(value.split(",").map((s) => s.trim()).filter(Boolean));
	if (ips.size === 0) return { kind: "none" };
	return {
		kind: "ip-list",
		ips
	};
}
function describeTrustProxy(mode) {
	switch (mode.kind) {
		case "none": return "socket peer (default)";
		case "all": return "X-Real-IP / X-Forwarded-For from any peer";
		case "loopback": return "X-Real-IP / X-Forwarded-For when socket peer is loopback";
		case "ip-list": return `X-Real-IP / X-Forwarded-For when socket peer is in [${[...mode.ips].join(",")}]`;
	}
}
function isLoopback(ip) {
	return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}
function shouldTrustHeaders(mode, socketIp) {
	switch (mode.kind) {
		case "none": return false;
		case "all": return true;
		case "loopback": return isLoopback(socketIp);
		case "ip-list": return mode.ips.has(socketIp);
	}
}
function pickClientIp(c, mode, getSocketIp) {
	const socketIp = (() => {
		try {
			return getSocketIp() || "127.0.0.1";
		} catch {
			return "127.0.0.1";
		}
	})();
	if (!shouldTrustHeaders(mode, socketIp)) return socketIp;
	const realIp = c.req.header("x-real-ip")?.trim();
	if (realIp) return realIp;
	const xff = c.req.header("x-forwarded-for");
	if (xff) {
		const first = xff.split(",")[0].trim();
		if (first) return first;
	}
	return socketIp;
}
/** Convenience binding for the live server: read socket via getConnInfo. */
function makeClientIpResolver(mode) {
	return (c) => pickClientIp(c, mode, () => {
		try {
			return getConnInfo(c).remote.address ?? "127.0.0.1";
		} catch {
			return "127.0.0.1";
		}
	});
}
//#endregion
//#region src/webui/port.ts
function isPortAvailable(port, host = "0.0.0.0") {
	return new Promise((resolve) => {
		const server = net.createServer();
		let settled = false;
		const finalize = (ok) => {
			if (settled) return;
			settled = true;
			try {
				server.close(() => resolve(ok));
			} catch {
				resolve(ok);
			}
		};
		server.once("error", () => finalize(false));
		server.once("listening", () => finalize(true));
		try {
			server.listen(port, host);
		} catch {
			finalize(false);
		}
	});
}
/**
* Find an available TCP port starting from `start`, advancing by 1 up to `maxTries` attempts.
* Skips reserved/invalid port numbers.
*/
async function findAvailablePort(start, maxTries = 50) {
	let port = Math.max(1, Math.min(65535, Math.trunc(start)));
	for (let i = 0; i < maxTries; i++) {
		if (port > 65535) break;
		if (await isPortAvailable(port)) return port;
		port += 1;
	}
	throw new Error(`No available TCP port found near ${start}`);
}
//#endregion
//#region src/webui/ui-config.ts
var log$2 = createLogger("WebUI.UiConfig");
var CONFIG_DIR = "config";
var UI_CONFIG_PATH = path.join(CONFIG_DIR, "ui.json");
/** Directory for operator-uploaded UI assets (currently just the background). */
var UI_ASSETS_DIR = path.join(CONFIG_DIR, "ui-assets");
/** Fixed path of the single background image (overwrite-on-upload). */
var BACKGROUND_IMAGE_PATH = path.join(UI_ASSETS_DIR, "background");
var DEFAULT_BACKGROUND = {
	type: "none",
	color: "#0ea5e9",
	gradient: "none",
	imageOpacity: .15,
	imageBlur: 0,
	hasImage: false,
	imageMime: "",
	imageVersion: 0
};
var DEFAULT_APPEARANCE = {
	mode: "system",
	accentMode: "preset",
	accentPreset: "sky",
	accentCustom: "#38bdf8",
	accentScope: "global",
	darkIntensity: "soft",
	palette: "default",
	sidebarStyle: "follow",
	background: DEFAULT_BACKGROUND,
	fontSans: "default",
	fontMono: "default",
	uiScale: 1,
	radius: .75,
	density: "cozy",
	reduceMotion: false,
	disableMotion: false,
	highContrast: false,
	sidebarDefaultCollapsed: false,
	timeFormat: "24h",
	pollInterval: 3e3,
	customCss: ""
};
var DEFAULT_OVERVIEW_BLOCKS = [
	{
		id: "stats",
		visible: true
	},
	{
		id: "connections",
		visible: true
	},
	{
		id: "alerts",
		visible: true
	},
	{
		id: "host",
		visible: true
	},
	{
		id: "sessions",
		visible: true
	}
];
var DEFAULT_NAV_ITEMS = [
	{
		id: "/",
		visible: true
	},
	{
		id: "/processes",
		visible: true
	},
	{
		id: "/config",
		visible: true
	},
	{
		id: "/logs",
		visible: true
	},
	{
		id: "/settings",
		visible: true
	}
];
var LOG_LEVELS = [
	"trace",
	"debug",
	"info",
	"success",
	"warn",
	"error"
];
var DEFAULT_PAGES = {
	defaultRoute: "/",
	logs: {
		visibleLevels: [...LOG_LEVELS],
		maxLines: 1e3,
		autoScroll: true,
		wrap: true,
		highlightRules: []
	},
	processesSort: "pid",
	configTab: ""
};
function defaultUiConfig() {
	return {
		version: 1,
		appearance: {
			...DEFAULT_APPEARANCE,
			background: { ...DEFAULT_BACKGROUND }
		},
		layout: {
			overviewBlocks: DEFAULT_OVERVIEW_BLOCKS.map((b) => ({ ...b })),
			navItems: DEFAULT_NAV_ITEMS.map((b) => ({ ...b }))
		},
		pages: defaultPages()
	};
}
function defaultPages() {
	return {
		...DEFAULT_PAGES,
		logs: {
			...DEFAULT_PAGES.logs,
			visibleLevels: [...LOG_LEVELS],
			highlightRules: []
		}
	};
}
function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function oneOf(value, allowed, fallback) {
	return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
function clampNum(value, min, max, fallback) {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}
function clampInt(value, min, max, fallback) {
	return Math.trunc(clampNum(value, min, max, fallback));
}
function isFiniteNum(value) {
	if (typeof value === "number") return Number.isFinite(value);
	return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}
function boolOr(value, fallback) {
	return typeof value === "boolean" ? value : fallback;
}
var HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
function hexOr(value, fallback) {
	return typeof value === "string" && HEX_RE.test(value.trim()) ? value.trim() : fallback;
}
/** Bounded free-form id (frontend owns the actual catalogue). */
function idOr(value, fallback, maxLen = 64) {
	if (typeof value !== "string") return fallback;
	const v = value.trim();
	if (v.length === 0 || v.length > maxLen) return fallback;
	if (!/^[\w./:-]+$/.test(v)) return fallback;
	return v;
}
function normalizeLayoutItems(value, fallback) {
	if (!Array.isArray(value)) return fallback.map((i) => ({ ...i }));
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const raw of value) {
		if (!isObject(raw)) continue;
		const id = idOr(raw.id, "");
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const item = {
			id,
			visible: boolOr(raw.visible, true)
		};
		if (isFiniteNum(raw.x) || isFiniteNum(raw.y) || isFiniteNum(raw.w) || isFiniteNum(raw.h)) {
			item.x = clampInt(raw.x, 0, 50, 0);
			item.y = clampInt(raw.y, 0, 1e3, 0);
			item.w = clampInt(raw.w, 1, 12, 1);
			item.h = clampInt(raw.h, 1, 100, 1);
		}
		if (isObject(raw.config)) try {
			if (JSON.stringify(raw.config).length <= 4096) item.config = raw.config;
		} catch {}
		out.push(item);
	}
	return out.length > 0 ? out : fallback.map((i) => ({ ...i }));
}
var DEFAULT_IMAGE_STATE = {
	hasImage: false,
	imageMime: "",
	imageVersion: 0
};
var KNOWN_IMAGE_MIMES = [
	"image/png",
	"image/jpeg",
	"image/webp"
];
/** Coerce a raw background-ish object into a coherent, trusted image state. */
function sanitizeImageState(value) {
	const v = isObject(value) ? value : {};
	const version = Math.trunc(clampNum(v.imageVersion, 0, Number.MAX_SAFE_INTEGER, 0));
	if (!boolOr(v.hasImage, false)) return {
		hasImage: false,
		imageMime: "",
		imageVersion: version
	};
	const mime = typeof v.imageMime === "string" && KNOWN_IMAGE_MIMES.includes(v.imageMime) ? v.imageMime : "";
	if (!mime) return {
		hasImage: false,
		imageMime: "",
		imageVersion: version
	};
	return {
		hasImage: true,
		imageMime: mime,
		imageVersion: version
	};
}
/** Trusted image state read FROM a parsed-from-disk config blob. */
function imageStateFromParsed(parsed) {
	if (!isObject(parsed) || !isObject(parsed.appearance)) return DEFAULT_IMAGE_STATE;
	return sanitizeImageState(parsed.appearance.background);
}
function normalizeBackground(value, imageState) {
	const v = isObject(value) ? value : {};
	let type = oneOf(v.type, [
		"none",
		"solid",
		"gradient",
		"image"
	], DEFAULT_BACKGROUND.type);
	if (type === "image" && !imageState.hasImage) type = "none";
	return {
		type,
		color: hexOr(v.color, DEFAULT_BACKGROUND.color),
		gradient: idOr(v.gradient, DEFAULT_BACKGROUND.gradient),
		imageOpacity: clampNum(v.imageOpacity, 0, 1, DEFAULT_BACKGROUND.imageOpacity),
		imageBlur: clampNum(v.imageBlur, 0, 40, DEFAULT_BACKGROUND.imageBlur),
		hasImage: imageState.hasImage,
		imageMime: imageState.imageMime,
		imageVersion: imageState.imageVersion
	};
}
function normalizeAppearance(value, imageState = DEFAULT_IMAGE_STATE) {
	const v = isObject(value) ? value : {};
	return {
		mode: oneOf(v.mode, [
			"light",
			"dark",
			"system"
		], DEFAULT_APPEARANCE.mode),
		accentMode: oneOf(v.accentMode, ["preset", "custom"], DEFAULT_APPEARANCE.accentMode),
		accentPreset: idOr(v.accentPreset, DEFAULT_APPEARANCE.accentPreset, 32),
		accentCustom: hexOr(v.accentCustom, DEFAULT_APPEARANCE.accentCustom),
		accentScope: oneOf(v.accentScope, ["sidebar", "global"], DEFAULT_APPEARANCE.accentScope),
		darkIntensity: oneOf(v.darkIntensity, ["soft", "black"], DEFAULT_APPEARANCE.darkIntensity),
		palette: oneOf(v.palette, [
			"default",
			"catppuccin-latte",
			"catppuccin-frappe",
			"catppuccin-macchiato",
			"catppuccin-mocha",
			"rose-pine",
			"rose-pine-moon",
			"rose-pine-dawn",
			"nord",
			"everforest-dark",
			"everforest-light"
		], DEFAULT_APPEARANCE.palette),
		sidebarStyle: oneOf(v.sidebarStyle, [
			"follow",
			"panel",
			"accent"
		], DEFAULT_APPEARANCE.sidebarStyle),
		background: normalizeBackground(v.background, imageState),
		fontSans: idOr(v.fontSans, DEFAULT_APPEARANCE.fontSans),
		fontMono: idOr(v.fontMono, DEFAULT_APPEARANCE.fontMono),
		uiScale: clampNum(v.uiScale, .9, 1.2, DEFAULT_APPEARANCE.uiScale),
		radius: clampNum(v.radius, 0, 2, DEFAULT_APPEARANCE.radius),
		density: oneOf(v.density, ["cozy", "compact"], DEFAULT_APPEARANCE.density),
		reduceMotion: boolOr(v.reduceMotion, DEFAULT_APPEARANCE.reduceMotion),
		disableMotion: boolOr(v.disableMotion, DEFAULT_APPEARANCE.disableMotion),
		highContrast: boolOr(v.highContrast, DEFAULT_APPEARANCE.highContrast),
		sidebarDefaultCollapsed: boolOr(v.sidebarDefaultCollapsed, DEFAULT_APPEARANCE.sidebarDefaultCollapsed),
		timeFormat: oneOf(v.timeFormat, ["12h", "24h"], DEFAULT_APPEARANCE.timeFormat),
		pollInterval: clampNum(v.pollInterval, 0, 6e4, DEFAULT_APPEARANCE.pollInterval),
		customCss: typeof v.customCss === "string" ? v.customCss.slice(0, 5e4) : DEFAULT_APPEARANCE.customCss
	};
}
function normalizeLayout(value) {
	const layout = isObject(value) ? value : {};
	return {
		overviewBlocks: normalizeLayoutItems(layout.overviewBlocks, DEFAULT_OVERVIEW_BLOCKS),
		navItems: normalizeLayoutItems(layout.navItems, DEFAULT_NAV_ITEMS)
	};
}
function normalizeHighlightRules(value) {
	if (!Array.isArray(value)) return [];
	const out = [];
	for (const raw of value) {
		if (!isObject(raw) || typeof raw.keyword !== "string") continue;
		const keyword = raw.keyword.trim().slice(0, 50);
		if (!keyword) continue;
		const color = typeof raw.color === "string" ? raw.color.slice(0, 32) : "";
		out.push({
			keyword,
			color
		});
		if (out.length >= 20) break;
	}
	return out;
}
function normalizePages(value) {
	const v = isObject(value) ? value : {};
	const logs = isObject(v.logs) ? v.logs : {};
	const levels = Array.isArray(logs.visibleLevels) ? LOG_LEVELS.filter((l) => logs.visibleLevels.includes(l)) : DEFAULT_PAGES.logs.visibleLevels;
	return {
		defaultRoute: idOr(v.defaultRoute, DEFAULT_PAGES.defaultRoute),
		logs: {
			visibleLevels: levels.length > 0 ? levels : [...LOG_LEVELS],
			maxLines: clampInt(logs.maxLines, 100, 5e3, DEFAULT_PAGES.logs.maxLines),
			autoScroll: boolOr(logs.autoScroll, DEFAULT_PAGES.logs.autoScroll),
			wrap: boolOr(logs.wrap, DEFAULT_PAGES.logs.wrap),
			highlightRules: normalizeHighlightRules(logs.highlightRules)
		},
		processesSort: idOr(v.processesSort, DEFAULT_PAGES.processesSort),
		configTab: typeof v.configTab === "string" ? v.configTab.slice(0, 64) : DEFAULT_PAGES.configTab
	};
}
function normalizeUiConfig(value, imageState = DEFAULT_IMAGE_STATE) {
	const v = isObject(value) ? value : {};
	return {
		version: 1,
		appearance: normalizeAppearance(v.appearance, imageState),
		layout: normalizeLayout(v.layout),
		pages: normalizePages(v.pages)
	};
}
function ensureConfigDir() {
	fs.mkdirSync(CONFIG_DIR, { recursive: true });
}
function atomicWrite(config) {
	ensureConfigDir();
	const tmp = UI_CONFIG_PATH + ".tmp";
	fs.writeFileSync(tmp, JSON.stringify(config, null, 2), "utf8");
	fs.renameSync(tmp, UI_CONFIG_PATH);
}
var cached = null;
/** Load + normalize the UI config, creating it from defaults if absent. */
function loadUiConfig() {
	if (cached) return cached;
	ensureConfigDir();
	if (!fs.existsSync(UI_CONFIG_PATH)) {
		const fresh = defaultUiConfig();
		try {
			atomicWrite(fresh);
		} catch (err) {
			log$2.warn("failed to write initial ui.json: %s", err instanceof Error ? err.message : String(err));
		}
		cached = fresh;
		return fresh;
	}
	try {
		const raw = fs.readFileSync(UI_CONFIG_PATH, "utf8");
		const parsed = JSON.parse(raw);
		const normalized = normalizeUiConfig(parsed, imageStateFromParsed(parsed));
		if (JSON.stringify(parsed) !== JSON.stringify(normalized)) try {
			atomicWrite(normalized);
		} catch {}
		cached = normalized;
		return normalized;
	} catch (err) {
		log$2.warn("ui.json unreadable; using defaults: %s", err instanceof Error ? err.message : String(err));
		const fresh = defaultUiConfig();
		cached = fresh;
		return fresh;
	}
}
/**
* Persist a client-supplied config. The incoming appearance is normalized and
* its server-managed background-image fields are forced to the current on-disk
* truth (the client cannot fake `hasImage`). Returns the stored config.
*/
function saveUiConfig(incoming) {
	const current = loadUiConfig();
	const v = isObject(incoming) ? incoming : {};
	const next = {
		version: 1,
		appearance: isObject(v.appearance) ? normalizeAppearance(v.appearance, current.appearance.background) : current.appearance,
		layout: isObject(v.layout) ? normalizeLayout(v.layout) : current.layout,
		pages: isObject(v.pages) ? normalizePages(v.pages) : current.pages ?? defaultPages()
	};
	atomicWrite(next);
	cached = next;
	return next;
}
/** The appearance subset served unauthenticated to the login page. Strips
*  `customCss` so a broken/hostile rule can never reach the pre-auth page
*  (and so the operator can always log in to fix it). */
function publicAppearance() {
	return {
		...loadUiConfig().appearance,
		customCss: ""
	};
}
var IMAGE_MIME = {
	png: "image/png",
	jpeg: "image/jpeg",
	webp: "image/webp"
};
/**
* Identify an image by its magic bytes (never by a client-supplied filename or
* Content-Type). Returns the canonical MIME, or null if it isn't a supported
* image. Supported: PNG, JPEG, WebP.
*/
function sniffImageMime(bytes) {
	if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return IMAGE_MIME.png;
	if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return IMAGE_MIME.jpeg;
	if (bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return IMAGE_MIME.webp;
	return null;
}
/** Write the uploaded image to disk and record its metadata. Returns the config. */
function writeBackgroundImage(bytes, mime) {
	fs.mkdirSync(UI_ASSETS_DIR, { recursive: true });
	const tmp = BACKGROUND_IMAGE_PATH + ".tmp";
	fs.writeFileSync(tmp, bytes);
	fs.renameSync(tmp, BACKGROUND_IMAGE_PATH);
	const current = loadUiConfig();
	const next = {
		...current,
		appearance: {
			...current.appearance,
			background: {
				...current.appearance.background,
				type: "image",
				hasImage: true,
				imageMime: mime,
				imageVersion: current.appearance.background.imageVersion + 1
			}
		}
	};
	atomicWrite(next);
	cached = next;
	return next;
}
/** Remove the background image (if any) and clear its metadata. Returns the config. */
function clearBackgroundImage() {
	try {
		if (fs.existsSync(BACKGROUND_IMAGE_PATH)) fs.unlinkSync(BACKGROUND_IMAGE_PATH);
	} catch (err) {
		log$2.warn("failed to remove background image: %s", err instanceof Error ? err.message : String(err));
	}
	const current = loadUiConfig();
	const next = {
		...current,
		appearance: {
			...current.appearance,
			background: {
				...current.appearance.background,
				type: current.appearance.background.type === "image" ? "none" : current.appearance.background.type,
				hasImage: false,
				imageMime: ""
			}
		}
	};
	atomicWrite(next);
	cached = next;
	return next;
}
/** Read the background image bytes + MIME, or null if none is stored. */
function readBackgroundImage() {
	const { background } = loadUiConfig().appearance;
	if (!background.hasImage) return null;
	try {
		return {
			bytes: fs.readFileSync(BACKGROUND_IMAGE_PATH),
			mime: background.imageMime || "application/octet-stream"
		};
	} catch {
		return null;
	}
}
//#endregion
//#region src/webui/update-check.ts
var log$1 = createLogger("Update");
var LATEST_RELEASE_URL = "https://api.github.com/repos/SnowLuma/SnowLuma/releases/latest";
var CACHE_TTL_MS = 360 * 60 * 1e3;
var FETCH_TIMEOUT_MS = 8e3;
var NOTES_MAX = 4e3;
function currentVersion() {
	return "1.9.11";
}
function isEnabled() {
	const v = (process.env.SNOWLUMA_UPDATE_CHECK ?? "").trim().toLowerCase();
	return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}
/**
* Compare two dotted versions. Returns >0 if `a` is newer than `b`, <0 if
* older, 0 if equal. The numeric core (major.minor.patch) compares
* numerically; a prerelease (`-rc.1`) ranks below its release. Good enough
* for "is the latest stable strictly newer than what we run" — and avoids
* pulling in a `semver` runtime dependency (the dist bundle ships none).
*/
function compareVersions(a, b) {
	const parse = (v) => {
		const [core = "", pre = ""] = v.replace(/^v/, "").split("-", 2);
		const nums = core.split(".").map((n) => parseInt(n, 10) || 0);
		while (nums.length < 3) nums.push(0);
		return {
			nums,
			pre
		};
	};
	const pa = parse(a);
	const pb = parse(b);
	for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
	if (pa.pre === pb.pre) return 0;
	if (!pa.pre) return 1;
	if (!pb.pre) return -1;
	return pa.pre < pb.pre ? -1 : 1;
}
var cache = null;
var inflight = null;
async function fetchLatest(current) {
	const base = {
		current,
		latest: null,
		hasUpdate: false,
		htmlUrl: null,
		notes: null,
		publishedAt: null,
		checkedAt: Date.now()
	};
	try {
		const res = await fetch(LATEST_RELEASE_URL, {
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": `SnowLuma/${current}`,
				"X-GitHub-Api-Version": "2022-11-28"
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		if (!res.ok) return {
			...base,
			error: `github ${res.status}`
		};
		const rel = await res.json();
		const tag = (rel.tag_name ?? "").trim();
		if (!tag) return {
			...base,
			error: "no tag"
		};
		const latest = tag.replace(/^v/, "");
		return {
			current,
			latest,
			hasUpdate: compareVersions(latest, current) > 0,
			htmlUrl: rel.html_url ?? null,
			notes: rel.body ? rel.body.slice(0, NOTES_MAX) : null,
			publishedAt: rel.published_at ?? null,
			checkedAt: Date.now()
		};
	} catch (e) {
		return {
			...base,
			error: e instanceof Error ? e.message : "network error"
		};
	}
}
/**
* Get the update-availability result. Cached for {@link CACHE_TTL_MS}; pass
* `force` to bypass the cache (the WebUI's "立即检查" button). Never throws —
* failures come back as a result with `error` set and `hasUpdate: false`, and
* are not cached so the next check retries.
*/
async function getUpdateInfo(force = false) {
	const current = currentVersion();
	if (!isEnabled()) return {
		...emptyResult(current),
		error: "disabled"
	};
	if (!force && cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) return cache;
	if (inflight) return inflight;
	inflight = (async () => {
		const result = await fetchLatest(current);
		if (result.error) log$1.debug("update check failed: %s", result.error);
		else {
			cache = result;
			if (result.hasUpdate) log$1.info("a newer release is available: v%s (running v%s)", result.latest, current);
		}
		return result;
	})().finally(() => {
		inflight = null;
	});
	return inflight;
}
function emptyResult(current) {
	return {
		current,
		latest: null,
		hasUpdate: false,
		htmlUrl: null,
		notes: null,
		publishedAt: null,
		checkedAt: Date.now()
	};
}
//#endregion
//#region src/webui/server.ts
var log = createLogger("WebUI");
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var sessionTokens = /* @__PURE__ */ new Map();
var loginAttempts = /* @__PURE__ */ new Map();
var LOGIN_MAX_ATTEMPTS = 5;
var LOGIN_LOCKOUT_MS = 900 * 1e3;
var TOKEN_TTL_MS = 1440 * 60 * 1e3;
var AVATAR_CACHE_TTL_MS = 720 * 60 * 60 * 1e3;
var AVATAR_BROWSER_CACHE_SECONDS = 720 * 60 * 60;
var MUST_CHANGE_ALLOWLIST = new Set([
	"/api/status",
	"/api/auth/state",
	"/api/auth/check-strength",
	"/api/auth/change-password",
	"/api/logout"
]);
var TOKEN_QUERY_ALLOWLIST = new Set(["/api/logs/stream"]);
var UIN_REGEX = /^\d{5,12}$/;
var avatarCache = /* @__PURE__ */ new Map();
function purgeExpiredTokens() {
	const now = Date.now();
	for (const [token, info] of sessionTokens) if (now > info.expiresAt) sessionTokens.delete(token);
	for (const [ip, attempt] of loginAttempts) if (now > attempt.resetAt) loginAttempts.delete(ip);
}
/**
* Resolve the client IP for per-IP rate limiting. Default is the TCP
* socket peer (cannot be spoofed by the client). Operators behind a
* reverse proxy must opt in via the `SNOWLUMA_WEBUI_TRUST_PROXY` env
* var; see `./client-ip.ts` for the accepted values.
*/
var trustProxyMode = parseTrustProxy(process.env.SNOWLUMA_WEBUI_TRUST_PROXY);
var getClientIp = makeClientIpResolver(trustProxyMode);
async function fetchQqAvatar(uin) {
	const response = await fetch(`https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(uin)}&s=100`, { headers: {
		"User-Agent": "SnowLuma WebUI",
		Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
	} });
	if (!response.ok) throw new Error(`avatar upstream responded with ${response.status}`);
	const contentType = response.headers.get("content-type") || "image/jpeg";
	return {
		body: new Uint8Array(await response.arrayBuffer()),
		contentType
	};
}
async function initWebUI(desiredPort = 5099, oneBotManager, hookManager) {
	const auth = WebuiAuth.load();
	const initialPassword = auth.takeInitialPassword();
	if (auth.isDevMode()) {
		log.warn("dev mode enabled: password=%s", WebuiAuth.devPassword);
		log.warn("dev mode skips config/webui.json and password rotation");
	} else if (initialPassword) {
		log.info("════════════════════════════════════════════════════════════════");
		log.info("  ★ WebUI 初始登录凭据 / Initial WebUI Credentials ★");
		log.info("  请立即登录并修改密码 —— 关闭程序后此密码无法找回。");
		log.info("  若跳过初始改密，下次启动将自动生成新的随机密码。");
		log.info("  Log in and change the password now; it will not be shown again.");
		log.info("────────────────────────────────────────────────────────────────");
		log.info("initial credentials: user=admin password=%s", initialPassword);
		log.info("════════════════════════════════════════════════════════════════");
	} else if (auth.mustChangePassword()) log.warn("password change is still required");
	log.info("login rate-limit keyed by: %s", describeTrustProxy(trustProxyMode));
	if (trustProxyMode.kind === "all") log.warn("SNOWLUMA_WEBUI_TRUST_PROXY=1 — only safe behind a reverse proxy that strips client-set X-Real-IP / X-Forwarded-For");
	const app = new Hono();
	app.use("*", async (c, next) => {
		await next();
		c.res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");
	});
	app.get("/robots.txt", (c) => {
		c.res.headers.set("Content-Type", "text/plain; charset=utf-8");
		return c.body("User-agent: *\nDisallow: /\n");
	});
	app.use("/api/*", async (c, next) => {
		const reqPath = c.req.path;
		if (reqPath === "/api/login" || reqPath === "/api/ui/public") return next();
		const authHeader = c.req.header("Authorization");
		const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
		const queryToken = TOKEN_QUERY_ALLOWLIST.has(reqPath) ? c.req.query("token") ?? "" : "";
		const token = bearerToken || queryToken;
		if (!token) return c.json({
			status: "failed",
			message: "Unauthorized"
		}, 401);
		const info = sessionTokens.get(token);
		if (!info || Date.now() > info.expiresAt) return c.json({
			status: "failed",
			message: "Token expired or invalid"
		}, 401);
		if (info.mustChangePassword && !MUST_CHANGE_ALLOWLIST.has(reqPath)) return c.json({
			status: "failed",
			message: "请先修改密码",
			mustChangePassword: true
		}, 403);
		c.set("sessionToken", token);
		await next();
	});
	setInterval(purgeExpiredTokens, 6e4).unref?.();
	app.post("/api/login", async (c) => {
		const ip = getClientIp(c);
		const now = Date.now();
		const attempt = loginAttempts.get(ip);
		if (attempt && attempt.count >= LOGIN_MAX_ATTEMPTS && now < attempt.resetAt) {
			const waitSec = Math.ceil((attempt.resetAt - now) / 1e3);
			return c.json({
				success: false,
				message: `登录尝试过多，请 ${waitSec} 秒后重试`
			}, 429);
		}
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		const password = typeof body.password === "string" ? body.password : "";
		if (!auth.verify(password)) {
			const current = loginAttempts.get(ip) ?? {
				count: 0,
				resetAt: now + LOGIN_LOCKOUT_MS
			};
			current.count += 1;
			if (current.count === 1) current.resetAt = now + LOGIN_LOCKOUT_MS;
			loginAttempts.set(ip, current);
			return c.json({
				success: false,
				message: "密码错误"
			}, 401);
		}
		loginAttempts.delete(ip);
		const token = randomBytes(32).toString("hex");
		const mustChange = auth.mustChangePassword();
		sessionTokens.set(token, {
			expiresAt: now + TOKEN_TTL_MS,
			mustChangePassword: mustChange
		});
		return c.json({
			success: true,
			token,
			mustChangePassword: mustChange
		});
	});
	app.post("/api/logout", (c) => {
		const token = c.get("sessionToken");
		if (token) sessionTokens.delete(token);
		return c.json({ success: true });
	});
	app.get("/api/auth/state", (c) => {
		const token = c.get("sessionToken");
		const info = token ? sessionTokens.get(token) : void 0;
		return c.json({ mustChangePassword: info?.mustChangePassword ?? auth.mustChangePassword() });
	});
	app.post("/api/auth/check-strength", async (c) => {
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				rules: evaluatePasswordRules(""),
				valid: false
			});
		}
		const pwd = typeof body.password === "string" ? body.password : "";
		return c.json({
			rules: evaluatePasswordRules(pwd),
			valid: isStrongPassword(pwd)
		});
	});
	app.post("/api/auth/change-password", async (c) => {
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		const oldPassword = typeof body.oldPassword === "string" ? body.oldPassword : "";
		const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
		if (!auth.verify(oldPassword)) return c.json({
			success: false,
			message: "当前密码不正确"
		}, 401);
		if (!isStrongPassword(newPassword)) return c.json({
			success: false,
			message: "新密码不符合强度要求",
			rules: evaluatePasswordRules(newPassword)
		}, 400);
		if (oldPassword === newPassword) return c.json({
			success: false,
			message: "新密码不得与旧密码相同"
		}, 400);
		try {
			auth.setPassword(newPassword);
		} catch (err) {
			log.warn("change password failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "密码修改失败"
			}, 400);
		}
		sessionTokens.clear();
		log.info("password updated; all sessions invalidated");
		return c.json({
			success: true,
			requireRelogin: true
		});
	});
	app.get("/avatar/:uin", async (c) => {
		const uin = c.req.param("uin");
		if (!UIN_REGEX.test(uin)) return c.text("invalid uin", 400);
		const now = Date.now();
		let cached = avatarCache.get(uin);
		if (!cached || cached.expiresAt <= now) try {
			cached = {
				...await fetchQqAvatar(uin),
				expiresAt: now + AVATAR_CACHE_TTL_MS
			};
			avatarCache.set(uin, cached);
		} catch (err) {
			log.warn("failed to proxy avatar for UIN %s: %s", uin, err instanceof Error ? err.message : String(err));
			if (!cached) return c.text("avatar unavailable", 502);
		}
		return new Response(cached.body, { headers: {
			"Content-Type": cached.contentType,
			"Cache-Control": `public, max-age=${AVATAR_BROWSER_CACHE_SECONDS}, immutable`
		} });
	});
	app.get("/ui-asset/background", (c) => {
		const asset = readBackgroundImage();
		if (!asset) return c.text("no background", 404);
		return new Response(new Uint8Array(asset.bytes), { headers: {
			"Content-Type": asset.mime,
			"Cache-Control": "public, max-age=31536000, immutable",
			"X-Content-Type-Options": "nosniff"
		} });
	});
	app.get("/api/status", (c) => c.json({ status: "running" }));
	app.get("/api/update/check", async (c) => {
		const force = c.req.query("force") === "true" || c.req.query("force") === "1";
		return c.json(await getUpdateInfo(force));
	});
	let lastCpuTimes = null;
	function sampleCpuLoad() {
		const current = os.cpus().map((cpu) => {
			const t = cpu.times;
			const total = t.user + t.nice + t.sys + t.idle + t.irq;
			return {
				idle: t.idle,
				total
			};
		});
		if (!lastCpuTimes || lastCpuTimes.length !== current.length) {
			lastCpuTimes = current;
			return current.map(() => 0);
		}
		const usage = current.map((cur, i) => {
			const prev = lastCpuTimes[i];
			const totalDiff = cur.total - prev.total;
			const idleDiff = cur.idle - prev.idle;
			if (totalDiff <= 0) return 0;
			return Math.max(0, Math.min(100, (totalDiff - idleDiff) / totalDiff * 100));
		});
		lastCpuTimes = current;
		return usage;
	}
	app.get("/api/system", (c) => {
		const cpus = os.cpus();
		const usage = sampleCpuLoad();
		const totalMem = os.totalmem();
		const freeMem = os.freemem();
		const usedMem = totalMem - freeMem;
		const runtimeMemory = process.memoryUsage();
		return c.json({
			hostname: os.hostname(),
			platform: os.platform(),
			arch: os.arch(),
			release: os.release(),
			uptime: os.uptime(),
			processUptime: process.uptime(),
			nodeVersion: process.version,
			cpu: {
				model: cpus[0]?.model ?? "unknown",
				cores: cpus.length,
				speedMHz: cpus[0]?.speed ?? 0,
				loadAvg: os.loadavg(),
				perCore: usage,
				average: usage.length ? usage.reduce((s, v) => s + v, 0) / usage.length : 0
			},
			memory: {
				total: totalMem,
				free: freeMem,
				used: usedMem,
				usagePercent: totalMem ? usedMem / totalMem * 100 : 0
			},
			runtime: {
				pid: process.pid,
				rss: runtimeMemory.rss,
				heapTotal: runtimeMemory.heapTotal,
				heapUsed: runtimeMemory.heapUsed,
				external: runtimeMemory.external,
				arrayBuffers: runtimeMemory.arrayBuffers
			}
		});
	});
	app.get("/api/qq-list", (c) => {
		const list = oneBotManager.getInstances().map((inst) => ({
			uin: inst.uin,
			nickname: inst.nickname
		}));
		return c.json({ list });
	});
	app.get("/api/connections", (c) => {
		return c.json({ list: oneBotManager.getConnectionStatuses() });
	});
	app.get("/api/logs", (c) => {
		const limit = Number(c.req.query("limit") ?? 300);
		return c.json({ list: getRecentLogs(limit) });
	});
	app.get("/api/logs/level", (c) => {
		return c.json({
			level: getLogLevel(),
			levels: [...LOG_LEVELS$1]
		});
	});
	app.post("/api/logs/level", async (c) => {
		const body = await c.req.json().catch(() => null);
		const next = typeof body?.level === "string" ? body.level : "";
		if (!setLogLevel(next)) return c.json({
			message: `invalid level: ${next}`,
			levels: [...LOG_LEVELS$1]
		}, 400);
		log.info("console log level set to %s via WebUI", getLogLevel());
		return c.json({
			level: getLogLevel(),
			levels: [...LOG_LEVELS$1]
		});
	});
	app.get("/api/logs/stream", (c) => {
		const stream = new ReadableStream({ start(controller) {
			const encoder = new TextEncoder();
			let closed = false;
			let unsubscribe;
			let heartbeat;
			const teardown = () => {
				if (closed) return;
				closed = true;
				if (heartbeat) clearInterval(heartbeat);
				unsubscribe?.();
				try {
					controller.close();
				} catch {}
			};
			const safeEnqueue = (chunk) => {
				if (closed) return;
				try {
					controller.enqueue(chunk);
				} catch {
					teardown();
				}
			};
			const send = (event) => {
				safeEnqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
			};
			send({ type: "ready" });
			unsubscribe = subscribeLogs((entry) => send(entry));
			heartbeat = setInterval(() => {
				safeEnqueue(encoder.encode(": heartbeat\n\n"));
			}, 15e3);
			c.req.raw.signal.addEventListener("abort", teardown);
		} });
		return new Response(stream, { headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive"
		} });
	});
	app.get("/api/processes", async (c) => {
		if (!hookManager) return c.json({ list: [] });
		try {
			return c.json({ list: await hookManager.listProcesses() });
		} catch (err) {
			return c.json({
				list: [],
				message: err instanceof Error ? err.message : String(err)
			}, 500);
		}
	});
	const MAX_PID = 4194304;
	function processAction(label, action) {
		return async (c) => {
			if (!hookManager) return c.json({
				success: false,
				message: "hook manager is not available"
			}, 503);
			const pid = Number(c.req.param("pid"));
			if (!Number.isInteger(pid) || pid <= 0 || pid > MAX_PID) return c.json({
				success: false,
				message: "invalid pid"
			}, 400);
			try {
				const processInfo = await action(pid);
				return c.json({
					success: processInfo.status !== "error",
					process: processInfo
				});
			} catch (err) {
				log.warn("%s pid=%d failed: %s", label, pid, err instanceof Error ? err.message : String(err));
				return c.json({
					success: false,
					message: "操作失败，请检查服务器日志"
				}, 500);
			}
		};
	}
	app.post("/api/processes/:pid/load", processAction("load", (pid) => hookManager.loadProcess(pid)));
	app.post("/api/processes/:pid/unload", processAction("unload", (pid) => hookManager.unloadProcess(pid)));
	app.post("/api/processes/:pid/refresh", processAction("refresh", (pid) => hookManager.refreshProcess(pid)));
	app.get("/api/processes/:pid/probe-login", async (c) => {
		if (!hookManager) return c.json({
			info: null,
			message: "hook manager is not available"
		}, 503);
		const pid = Number(c.req.param("pid"));
		if (!Number.isInteger(pid) || pid <= 0 || pid > MAX_PID) return c.json({
			info: null,
			message: "invalid pid"
		}, 400);
		try {
			const info = await hookManager.probeProcessLoginInfo(pid);
			return c.json({ info });
		} catch (err) {
			log.warn("probe-login pid=%d failed: %s", pid, err instanceof Error ? err.message : String(err));
			return c.json({
				info: null,
				message: "探测失败"
			}, 500);
		}
	});
	app.get("/api/config/:uin", (c) => {
		const uin = c.req.param("uin");
		if (!UIN_REGEX.test(uin)) return c.json({ message: "invalid uin" }, 400);
		const config = loadOneBotConfig(uin);
		return c.json({ config });
	});
	app.post("/api/config/:uin", async (c) => {
		const uin = c.req.param("uin");
		if (!UIN_REGEX.test(uin)) return c.json({
			success: false,
			message: "invalid uin"
		}, 400);
		try {
			saveOneBotConfig(uin, await c.req.json());
			const reloaded = oneBotManager.reloadConfig(uin);
			log.info("Updated OneBot config for UIN: %s%s", uin, reloaded ? " and reloaded" : "");
			return c.json({
				success: true,
				reloaded,
				message: reloaded ? "配置保存成功，已热重载当前会话。" : "配置保存成功，当前会话未在线，将在下次连接时生效。"
			});
		} catch (err) {
			log.warn("save config for uin=%s failed: %s", uin, err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "配置保存失败，请检查服务器日志"
			}, 400);
		}
	});
	app.get("/api/ui", (c) => c.json({ config: loadUiConfig() }));
	app.get("/api/ui/public", (c) => c.json({ appearance: publicAppearance() }));
	app.post("/api/ui", async (c) => {
		const declaredLen = Number(c.req.header("content-length"));
		if (Number.isFinite(declaredLen) && declaredLen > 256 * 1024) return c.json({
			success: false,
			message: "配置过大"
		}, 413);
		let body;
		try {
			body = await c.req.json();
		} catch {
			return c.json({
				success: false,
				message: "请求格式错误"
			}, 400);
		}
		try {
			const config = saveUiConfig(body);
			return c.json({
				success: true,
				config
			});
		} catch (err) {
			log.warn("save ui.json failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "保存失败，请检查服务器日志"
			}, 400);
		}
	});
	app.post("/api/ui/background", async (c) => {
		const declaredLen = Number(c.req.header("content-length"));
		if (Number.isFinite(declaredLen) && declaredLen > 6291456) return c.json({
			success: false,
			message: "图片过大（上限 5MB）"
		}, 413);
		let file;
		try {
			file = (await c.req.parseBody())["file"];
		} catch {
			return c.json({
				success: false,
				message: "上传解析失败"
			}, 400);
		}
		if (!(file instanceof File)) return c.json({
			success: false,
			message: "缺少图片文件"
		}, 400);
		if (file.size > 5242880) return c.json({
			success: false,
			message: "图片过大（上限 5MB）"
		}, 413);
		const bytes = new Uint8Array(await file.arrayBuffer());
		const mime = sniffImageMime(bytes);
		if (!mime) return c.json({
			success: false,
			message: "仅支持 PNG / JPEG / WebP 图片"
		}, 415);
		try {
			const config = writeBackgroundImage(bytes, mime);
			return c.json({
				success: true,
				config
			});
		} catch (err) {
			log.warn("write background image failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "保存图片失败，请检查服务器日志"
			}, 500);
		}
	});
	app.delete("/api/ui/background", (c) => {
		try {
			const config = clearBackgroundImage();
			return c.json({
				success: true,
				config
			});
		} catch (err) {
			log.warn("clear background image failed: %s", err instanceof Error ? err.message : String(err));
			return c.json({
				success: false,
				message: "删除图片失败"
			}, 500);
		}
	});
	const staticRoot = path.resolve(__dirname, "client");
	app.use("/*", serveStatic({ root: staticRoot }));
	const indexHtmlPath = path.join(staticRoot, "index.html");
	app.get("*", (c) => {
		if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/avatar/") || c.req.path.startsWith("/ui-asset/")) return c.text("not found", 404);
		if (existsSync(indexHtmlPath)) {
			const html = readFileSync(indexHtmlPath, "utf8");
			return c.html(html);
		}
		return c.text("WebUI client bundle not found. Run `pnpm --filter webui build` (or use the dev server on :5178).", 404);
	});
	const finalPort = await findAvailablePort(desiredPort);
	if (finalPort !== desiredPort) log.warn("port %d is in use, using %d instead", desiredPort, finalPort);
	await new Promise((resolve) => {
		serve({
			fetch: app.fetch,
			port: finalPort
		}, (info) => {
			log.info(`listening http://localhost:${info.port}`);
			resolve();
		});
	});
	return { port: finalPort };
}
//#endregion
export { initWebUI };
