import { createRequire as __snowlumaCreateRequire } from "node:module";
__snowlumaCreateRequire(import.meta.url);
import { t as __exportAll } from "./rolldown-runtime-DpvAeRoy.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
//#region ../protocol/src/highway/utils.ts
var utils_exports = /* @__PURE__ */ __exportAll({
	FILE_UPLOAD_MAX_BYTES: () => FILE_UPLOAD_MAX_BYTES,
	computeHashes: () => computeHashes,
	computeMd5: () => computeMd5,
	detectImageFormat: () => detectImageFormat,
	loadBinarySource: () => loadBinarySource,
	packHighwayFrame: () => packHighwayFrame,
	resolveLocalFilePath: () => resolveLocalFilePath,
	unpackHighwayFrame: () => unpackHighwayFrame
});
/**
* Default cap on a single binary load issued through this helper. Callers
* that route here (image / voice via base64+HTTP, group/private file
* uploads, avatar) get bounded reads. Not all callers route through here
* — in particular `video-upload.stageVideoSource` reads local-video files
* directly and enforces its own cap via `MAX_VIDEO_SIZE`. Group/private
* file uploads override this via `FILE_UPLOAD_MAX_BYTES` because QQ's
* file protocol legitimately supports up to 4 GiB.
*/
var DEFAULT_MAX_BINARY_SIZE = 1024 * 1024 * 1024;
/** Hard ceiling QQ's file protocol supports — used by group/private files. */
var FILE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024 * 1024;
var FETCH_TIMEOUT_MS = 6e4;
/**
* Browser-like User-Agent for remote media downloads. Many image / CDN
* hosts (and anti-hotlink front-ends) reject or RST a header-less,
* non-browser request — which surfaces as undici `TypeError: fetch
* failed` rather than a clean 403. Sending a normal browser UA on every
* request (and retrying with a Referer when the first try is refused) is
* what lets NapCat fetch sources our bare `fetch(source)` couldn't.
* Cross-checked against
* `dev/napcatQQInside/packages/napcat-common/src/file.ts:101-142,359-369`.
*/
var DOWNLOAD_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
function resolveLocalFilePath(source) {
	if (!source) return null;
	if (/^base64:\/\//i.test(source)) return null;
	if (/^https?:\/\//i.test(source)) return null;
	let filePath = source;
	if (/^file:\/\//i.test(source)) {
		try {
			filePath = fileURLToPath(source);
		} catch {
			filePath = source.replace(/^file:\/+/i, "/");
			try {
				filePath = decodeURIComponent(filePath);
			} catch {}
		}
		if (process.platform !== "win32" && filePath.startsWith("//")) filePath = filePath.replace(/^\/+/, "/");
	}
	if (/^\/[a-zA-Z]:/.test(filePath)) filePath = filePath.slice(1);
	return filePath;
}
/**
* Tag a size-limit error so the HTTP retry path leaves it alone — retrying
* a too-large response just re-downloads the same oversized body.
*/
function tooLarge(message) {
	return Object.assign(new Error(message), { noRetry: true });
}
async function loadBinarySource(source, resourceName, maxBytes = DEFAULT_MAX_BINARY_SIZE) {
	if (!source) throw new Error(`${resourceName} source is empty`);
	if (/^base64:\/\//i.test(source)) {
		const bytes = Buffer.from(source.slice(9), "base64");
		if (bytes.length > maxBytes) throw new Error(`${resourceName} too large: ${bytes.length} > ${maxBytes}`);
		return {
			bytes,
			fileName: ""
		};
	}
	if (/^https?:\/\//i.test(source)) {
		const fileName = guessFileNameFromUrl(source);
		const attempt = async (headers) => {
			const resp = await fetch(source, {
				headers,
				redirect: "follow",
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
			});
			if (!resp.ok) throw new Error(`HTTP download failed: ${resp.status}`);
			const declared = Number(resp.headers.get("content-length") ?? "0");
			if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(`${resourceName} too large: ${declared} > ${maxBytes}`);
			const reader = resp.body?.getReader();
			if (!reader) {
				const bytes = new Uint8Array(await resp.arrayBuffer());
				if (bytes.length > maxBytes) throw tooLarge(`${resourceName} too large: ${bytes.length} > ${maxBytes}`);
				return {
					bytes,
					fileName
				};
			}
			const chunks = [];
			let total = 0;
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (!value) continue;
					total += value.byteLength;
					if (total > maxBytes) {
						await reader.cancel().catch(() => {});
						throw tooLarge(`${resourceName} too large: > ${maxBytes}`);
					}
					chunks.push(value);
				}
			} finally {
				reader.releaseLock();
			}
			const bytes = new Uint8Array(total);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return {
				bytes,
				fileName
			};
		};
		const baseHeaders = {
			"User-Agent": DOWNLOAD_USER_AGENT,
			Accept: "*/*"
		};
		try {
			return await attempt(baseHeaders);
		} catch (err) {
			if (err?.noRetry) throw err;
			try {
				return await attempt({
					...baseHeaders,
					Referer: source
				});
			} catch {
				throw err;
			}
		}
	}
	const filePath = resolveLocalFilePath(source);
	if (!filePath) throw new Error(`${resourceName} source is not a local file`);
	const stat = fs.statSync(filePath);
	if (stat.size > maxBytes) throw new Error(`${resourceName} too large: ${stat.size} > ${maxBytes}`);
	return {
		bytes: fs.readFileSync(filePath),
		fileName: path.basename(filePath)
	};
}
function guessFileNameFromUrl(url) {
	const queryPos = url.search(/[?#]/);
	const pathPart = queryPos >= 0 ? url.slice(0, queryPos) : url;
	const lastSlash = pathPart.lastIndexOf("/");
	return lastSlash >= 0 ? pathPart.slice(lastSlash + 1) : "";
}
function computeHashes(data) {
	const md5 = createHash("md5").update(data).digest();
	const sha1 = createHash("sha1").update(data).digest();
	return {
		md5: new Uint8Array(md5),
		sha1: new Uint8Array(sha1),
		md5Hex: md5.toString("hex"),
		sha1Hex: sha1.toString("hex")
	};
}
function computeMd5(data) {
	return new Uint8Array(createHash("md5").update(data).digest());
}
function readBE16(data, offset) {
	return data[offset] << 8 | data[offset + 1];
}
function readBE32(data, offset) {
	return (data[offset] << 24 | data[offset + 1] << 16 | data[offset + 2] << 8 | data[offset + 3]) >>> 0;
}
function readLE16(data, offset) {
	return data[offset] | data[offset + 1] << 8;
}
function readLE32(data, offset) {
	return (data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24) >>> 0;
}
function readBE24(data, offset) {
	return data[offset] << 16 | data[offset + 1] << 8 | data[offset + 2];
}
function detectImageFormat(bytes) {
	let width = 0;
	let height = 0;
	if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
		width = readBE32(bytes, 16);
		height = readBE32(bytes, 20);
		return {
			format: 1001,
			width,
			height
		};
	}
	if (bytes.length >= 10 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56 && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97) {
		width = readLE16(bytes, 6);
		height = readLE16(bytes, 8);
		return {
			format: 2e3,
			width,
			height
		};
	}
	if (bytes.length >= 26 && bytes[0] === 66 && bytes[1] === 77) {
		width = readLE32(bytes, 18);
		height = readLE32(bytes, 22);
		return {
			format: 1005,
			width,
			height
		};
	}
	if (bytes.length >= 30 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) {
		if (bytes[12] === 86 && bytes[13] === 80 && bytes[14] === 56 && bytes[15] === 32) {
			width = readLE16(bytes, 26);
			height = readLE16(bytes, 28);
			return {
				format: 1002,
				width,
				height
			};
		}
		if (bytes[12] === 86 && bytes[13] === 80 && bytes[14] === 56 && bytes[15] === 76) {
			const bits = readLE32(bytes, 21);
			width = (bits & 16383) + 1;
			height = (bits >> 14 & 16383) + 1;
			return {
				format: 1002,
				width,
				height
			};
		}
		if (bytes[12] === 86 && bytes[13] === 80 && bytes[14] === 56 && bytes[15] === 88) {
			width = readBE24(bytes, 24) + 1;
			height = readBE24(bytes, 27) + 1;
			return {
				format: 1002,
				width,
				height
			};
		}
	}
	if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
		let offset = 2;
		while (offset + 9 <= bytes.length) {
			if (bytes[offset] !== 255) {
				offset++;
				continue;
			}
			const marker = bytes[offset + 1];
			if (marker === 216 || marker === 217) {
				offset += 2;
				continue;
			}
			if (offset + 4 > bytes.length) break;
			const segLen = readBE16(bytes, offset + 2);
			if (segLen < 2 || offset + 2 + segLen > bytes.length) break;
			if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204 && segLen >= 7 && offset + 9 <= bytes.length) {
				height = readBE16(bytes, offset + 5);
				width = readBE16(bytes, offset + 7);
				return {
					format: 1e3,
					width,
					height
				};
			}
			offset += 2 + segLen;
		}
		return {
			format: 1e3,
			width: 0,
			height: 0
		};
	}
	return {
		format: 1e3,
		width: 0,
		height: 0
	};
}
function packHighwayFrame(head, body) {
	const frame = new Uint8Array(9 + head.length + body.length + 1);
	frame[0] = 40;
	const dv = new DataView(frame.buffer, frame.byteOffset);
	dv.setUint32(1, head.length, false);
	dv.setUint32(5, body.length, false);
	frame.set(head, 9);
	frame.set(body, 9 + head.length);
	frame[frame.length - 1] = 41;
	return frame;
}
function unpackHighwayFrame(frame) {
	if (frame.length < 10 || frame[0] !== 40 || frame[frame.length - 1] !== 41) throw new Error("invalid highway response frame");
	const dv = new DataView(frame.buffer, frame.byteOffset);
	const headLen = dv.getUint32(1, false);
	const bodyLen = dv.getUint32(5, false);
	return {
		head: frame.subarray(9, 9 + headLen),
		body: frame.subarray(9 + headLen, 9 + headLen + bodyLen)
	};
}
//#endregion
export { loadBinarySource as a, unpackHighwayFrame as c, detectImageFormat as i, utils_exports as l, computeHashes as n, packHighwayFrame as o, computeMd5 as r, resolveLocalFilePath as s, FILE_UPLOAD_MAX_BYTES as t };
