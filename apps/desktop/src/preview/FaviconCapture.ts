import { FAVICON_DATA_URL_MAX_LENGTH } from "@t3tools/contracts";

export const MAX_FAVICON_RESPONSE_BYTES = 100_000;
export const MAX_FAVICON_CANDIDATES = 8;
export const MAX_FAVICON_HTTP_URL_LENGTH = 2_048;

const MAX_FAVICON_CANDIDATE_INPUT_UNITS = 262_144;
const MIN_FAVICON_CANDIDATE_INPUT_UNITS = 256;
const MAX_FAVICON_SOURCE_PIXELS = 1_048_576;
const MAX_FAVICON_INLINE_URL_LENGTH = Math.ceil((MAX_FAVICON_RESPONSE_BYTES * 4) / 3) + 128;
const FAVICON_CAPTURE_TIMEOUT_MS = 5_000;
const FAVICON_RASTER_WORLD_ID = 1001;
const FAVICON_RASTER_TIMEOUT_MS = 1_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface RasterizationGate {
  generation: number;
  launchAllowed?: Promise<void>;
}

const rasterizationGates = new WeakMap<Electron.WebContents, RasterizationGate>();

async function waitForRasterLaunch(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      signal.removeEventListener("abort", finish);
      resolve();
    };
    signal.addEventListener("abort", finish, { once: true });
    void previous.then(finish);
  });
}

export type FaviconCaptureResult =
  | { readonly kind: "captured"; readonly dataUrl: string }
  | { readonly kind: "none" }
  | { readonly kind: "timed-out" };

type RasterizationResult =
  | { readonly kind: "completed"; readonly value: unknown }
  | { readonly kind: "timed-out" };

export function safeHttpOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function selectFaviconCandidates(candidates: ReadonlyArray<string>): ReadonlyArray<string> {
  const selected: string[] = [];
  const seen = new Set<string>();
  let inputUnits = 0;
  for (const candidate of candidates) {
    // Charge a minimum per entry so a large array of tiny malformed values is bounded too.
    inputUnits += Math.max(MIN_FAVICON_CANDIDATE_INPUT_UNITS, candidate.length);
    if (inputUnits > MAX_FAVICON_CANDIDATE_INPUT_UNITS) break;
    if (!isSupportedFaviconUrl(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    selected.push(candidate);
    if (selected.length === MAX_FAVICON_CANDIDATES) break;
  }
  return selected;
}

export async function captureFavicon(input: {
  readonly webContents: Electron.WebContents;
  readonly pageUrl: string;
  readonly candidates: ReadonlyArray<string>;
  readonly signal: AbortSignal;
}): Promise<FaviconCaptureResult> {
  const pageOrigin = safeHttpOrigin(input.pageUrl);
  if (!pageOrigin) return { kind: "none" };

  for (const candidate of selectFaviconCandidates(input.candidates)) {
    if (input.signal.aborted) return { kind: "none" };
    const captured = await captureCandidate({
      webContents: input.webContents,
      pageOrigin,
      candidate,
      signal: input.signal,
    });
    if (captured.kind === "captured" || captured.kind === "timed-out") return captured;
  }

  return { kind: "none" };
}

async function captureCandidate(input: {
  readonly webContents: Electron.WebContents;
  readonly pageOrigin: string;
  readonly candidate: string;
  readonly signal: AbortSignal;
}): Promise<FaviconCaptureResult> {
  try {
    const inline = parseInlineFavicon(input.candidate);
    if (inline) {
      return await normalizeFaviconBuffer(
        input.webContents,
        inline.mime,
        inline.buffer,
        input.signal,
      );
    }

    const candidateOrigin = safeHttpOrigin(input.candidate);
    if (!candidateOrigin) return { kind: "none" };
    const response = await input.webContents.session.fetch(input.candidate, {
      credentials: candidateOrigin === input.pageOrigin ? "include" : "omit",
      redirect: "error",
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(FAVICON_CAPTURE_TIMEOUT_MS)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { kind: "none" };
    }
    const buffer = await readFaviconResponse(response);
    if (!buffer || input.signal.aborted) return { kind: "none" };
    const mime = response.headers.get("content-type")?.split(";", 1)[0] ?? null;
    return await normalizeFaviconBuffer(input.webContents, mime, buffer, input.signal);
  } catch {
    return { kind: "none" };
  }
}

async function readFaviconResponse(response: Response): Promise<Buffer | null> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_FAVICON_RESPONSE_BYTES) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.byteLength <= MAX_FAVICON_RESPONSE_BYTES ? buffer : null;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return Buffer.concat(chunks, byteLength);
      byteLength += next.value.byteLength;
      if (byteLength > MAX_FAVICON_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
}

function isSupportedFaviconUrl(url: string): boolean {
  if (url.length > MAX_FAVICON_INLINE_URL_LENGTH) return false;
  if (/^data:/i.test(url)) return /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(url);
  try {
    const protocol = new URL(url).protocol;
    return (
      (protocol === "http:" || protocol === "https:") && url.length <= MAX_FAVICON_HTTP_URL_LENGTH
    );
  } catch {
    return false;
  }
}

function decodeInlineFaviconPayload(payload: string): Buffer | null {
  const decoded = Buffer.allocUnsafe(Buffer.byteLength(payload));
  let inputOffset = 0;
  let outputOffset = 0;
  while (inputOffset < payload.length) {
    const escapeOffset = payload.indexOf("%", inputOffset);
    const literalEnd = escapeOffset === -1 ? payload.length : escapeOffset;
    outputOffset += decoded.write(payload.slice(inputOffset, literalEnd), outputOffset, "utf8");
    if (escapeOffset === -1) break;
    const hex = payload.slice(escapeOffset + 1, escapeOffset + 3);
    if (!/^[0-9a-f]{2}$/i.test(hex)) return null;
    decoded[outputOffset] = Number.parseInt(hex, 16);
    outputOffset += 1;
    inputOffset = escapeOffset + 3;
  }
  return decoded.subarray(0, outputOffset);
}

function parseInlineFavicon(
  url: string,
): { readonly buffer: Buffer; readonly mime: string } | null {
  if (url.length > MAX_FAVICON_INLINE_URL_LENGTH) return null;
  const match = /^data:(image\/[a-z0-9.+-]+)((?:;[^,]*)?),(.*)$/is.exec(url);
  if (!match) return null;
  const mime = match[1]?.toLowerCase();
  const parameters = match[2]
    ?.split(";")
    .filter(Boolean)
    .map((parameter) => parameter.toLowerCase());
  const payload = match[3];
  if (!mime || !parameters || !payload) return null;
  const base64 = parameters.at(-1) === "base64";
  if (parameters.includes("base64") && !base64) return null;

  let buffer: Buffer;
  try {
    if (base64) {
      if (!/^[a-z0-9+/]*={0,2}$/i.test(payload) || payload.length % 4 === 1) return null;
      buffer = Buffer.from(payload, "base64");
      if (buffer.toString("base64").replace(/=+$/, "") !== payload.replace(/=+$/, "")) {
        return null;
      }
    } else {
      const decoded = decodeInlineFaviconPayload(payload);
      if (!decoded) return null;
      buffer = decoded;
    }
  } catch {
    return null;
  }

  return buffer.byteLength > 0 && buffer.byteLength <= MAX_FAVICON_RESPONSE_BYTES
    ? { buffer, mime }
    : null;
}

interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

function safeDimensions(dimensions: ImageDimensions | null): dimensions is ImageDimensions {
  return (
    dimensions !== null &&
    Number.isSafeInteger(dimensions.width) &&
    Number.isSafeInteger(dimensions.height) &&
    dimensions.width > 0 &&
    dimensions.height > 0 &&
    dimensions.width * dimensions.height <= MAX_FAVICON_SOURCE_PIXELS
  );
}

function pngDimensions(buffer: Buffer): ImageDimensions | null {
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) || buffer.byteLength < 24) {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function skipGifSubBlocks(buffer: Buffer, startOffset: number): number | null {
  let offset = startOffset;
  while (offset < buffer.byteLength) {
    const blockLength = buffer[offset]!;
    offset += 1;
    if (blockLength === 0) return offset;
    if (offset + blockLength > buffer.byteLength) return null;
    offset += blockLength;
  }
  return null;
}

function gifDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.byteLength < 13 || !/^GIF8[79]a$/u.test(buffer.subarray(0, 6).toString("ascii"))) {
    return null;
  }
  const logicalWidth = buffer.readUInt16LE(6);
  const logicalHeight = buffer.readUInt16LE(8);
  if (!safeDimensions({ width: logicalWidth, height: logicalHeight })) return null;
  const packed = buffer[10]!;
  let offset = 13 + ((packed & 0x80) === 0 ? 0 : 3 * 2 ** ((packed & 0x07) + 1));
  if (offset > buffer.byteLength) return null;
  let width = logicalWidth;
  let height = logicalHeight;
  let frameCount = 0;
  let framePixels = 0;
  while (offset < buffer.byteLength) {
    const marker = buffer[offset];
    if (marker === 0x3b) return frameCount > 0 ? { width, height } : null;
    if (marker === 0x2c) {
      if (offset + 10 > buffer.byteLength) return null;
      const left = buffer.readUInt16LE(offset + 1);
      const top = buffer.readUInt16LE(offset + 3);
      const frameWidth = buffer.readUInt16LE(offset + 5);
      const frameHeight = buffer.readUInt16LE(offset + 7);
      if (frameWidth === 0 || frameHeight === 0) return null;
      framePixels += frameWidth * frameHeight;
      if (framePixels > MAX_FAVICON_SOURCE_PIXELS) return null;
      width = Math.max(width, left + frameWidth);
      height = Math.max(height, top + frameHeight);
      if (!safeDimensions({ width, height })) return null;
      const framePacked = buffer[offset + 9]!;
      offset += 10;
      if ((framePacked & 0x80) !== 0) {
        offset += 3 * 2 ** ((framePacked & 0x07) + 1);
      }
      if (offset >= buffer.byteLength) return null;
      const minimumCodeSize = buffer[offset]!;
      if (minimumCodeSize < 2 || minimumCodeSize > 8) return null;
      offset += 1;
      const nextOffset = skipGifSubBlocks(buffer, offset);
      if (nextOffset === null) return null;
      offset = nextOffset;
      frameCount += 1;
      continue;
    }
    if (marker !== 0x21 || offset + 2 > buffer.byteLength) return null;
    const nextOffset = skipGifSubBlocks(buffer, offset + 2);
    if (nextOffset === null) return null;
    offset = nextOffset;
  }
  return null;
}

function jpegExifOrientation(segment: Buffer): number | null {
  if (segment.byteLength < 14 || segment.subarray(0, 6).toString("binary") !== "Exif\0\0") {
    return null;
  }
  const tiffOffset = 6;
  const byteOrder = segment.subarray(tiffOffset, tiffOffset + 2).toString("ascii");
  if (byteOrder !== "II" && byteOrder !== "MM") return null;
  const littleEndian = byteOrder === "II";
  const readUInt16 = (offset: number): number | null => {
    if (offset < 0 || offset + 2 > segment.byteLength) return null;
    return littleEndian ? segment.readUInt16LE(offset) : segment.readUInt16BE(offset);
  };
  const readUInt32 = (offset: number): number | null => {
    if (offset < 0 || offset + 4 > segment.byteLength) return null;
    return littleEndian ? segment.readUInt32LE(offset) : segment.readUInt32BE(offset);
  };
  if (readUInt16(tiffOffset + 2) !== 42) return null;
  const relativeIfdOffset = readUInt32(tiffOffset + 4);
  if (relativeIfdOffset === null) return null;
  const ifdOffset = tiffOffset + relativeIfdOffset;
  const entryCount = readUInt16(ifdOffset);
  if (entryCount === null) return null;
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (entryOffset + 12 > segment.byteLength) return null;
    if (
      readUInt16(entryOffset) !== 0x0112 ||
      readUInt16(entryOffset + 2) !== 3 ||
      readUInt32(entryOffset + 4) !== 1
    ) {
      continue;
    }
    const orientation = readUInt16(entryOffset + 8);
    if (orientation !== null && orientation >= 1 && orientation <= 8) return orientation;
  }
  return null;
}

function jpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.byteLength < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  let dimensions: ImageDimensions | null = null;
  let orientation: number | null = null;
  while (offset + 3 < buffer.byteLength) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= buffer.byteLength) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.byteLength) return null;
    if (marker === 0xe1 && orientation === null) {
      orientation = jpegExifOrientation(buffer.subarray(offset + 2, offset + length));
    }
    if (startOfFrameMarkers.has(marker)) {
      if (length < 7) return null;
      if (dimensions !== null) return null;
      dimensions = {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  if (!dimensions) return null;
  return orientation !== null && orientation >= 5 && orientation <= 8
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions;
}

function webpDimensions(buffer: Buffer): ImageDimensions | null {
  if (
    buffer.byteLength < 30 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return null;
  }
  const kind = buffer.subarray(12, 16).toString("ascii");
  if (kind === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (kind === "VP8 " && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (kind === "VP8L" && buffer[20] === 0x2f) {
    return {
      width: 1 + buffer[21]! + ((buffer[22]! & 0x3f) << 8),
      height: 1 + (buffer[22]! >> 6) + (buffer[23]! << 2) + ((buffer[24]! & 0x0f) << 10),
    };
  }
  return null;
}

function dibDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.byteLength < 12) return null;
  const headerSize = buffer.readUInt32LE(0);
  if (headerSize === 12) {
    return {
      width: buffer.readUInt16LE(4),
      height: buffer.readUInt16LE(6),
    };
  }
  if (headerSize < 40 || buffer.byteLength < 12) return null;
  return {
    width: Math.abs(buffer.readInt32LE(4)),
    height: Math.abs(buffer.readInt32LE(8)),
  };
}

function icoDimensions(buffer: Buffer): ImageDimensions | null {
  if (
    buffer.byteLength < 22 ||
    buffer.readUInt16LE(0) !== 0 ||
    (buffer.readUInt16LE(2) !== 1 && buffer.readUInt16LE(2) !== 2)
  ) {
    return null;
  }
  const count = buffer.readUInt16LE(4);
  if (count === 0 || count > 256 || buffer.byteLength < 6 + count * 16) return null;
  let width = 0;
  let height = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    width = Math.max(width, buffer[offset] === 0 ? 256 : buffer[offset]!);
    height = Math.max(height, buffer[offset + 1] === 0 ? 256 : buffer[offset + 1]!);
    if (!safeDimensions({ width, height })) return null;
    const byteLength = buffer.readUInt32LE(offset + 8);
    const imageOffset = buffer.readUInt32LE(offset + 12);
    if (
      byteLength === 0 ||
      imageOffset < 6 + count * 16 ||
      imageOffset > buffer.byteLength ||
      byteLength > buffer.byteLength - imageOffset
    )
      return null;
    const embedded = buffer.subarray(imageOffset, imageOffset + byteLength);
    const embeddedDimensions = pngDimensions(embedded) ?? dibDimensions(embedded);
    if (!safeDimensions(embeddedDimensions)) return null;
  }
  return { width, height };
}

function sourceDimensions(buffer: Buffer): ImageDimensions | null {
  return (
    pngDimensions(buffer) ??
    gifDimensions(buffer) ??
    jpegDimensions(buffer) ??
    webpDimensions(buffer) ??
    icoDimensions(buffer)
  );
}

async function normalizeFaviconBuffer(
  webContents: Electron.WebContents,
  mime: string | null,
  buffer: Buffer,
  signal: AbortSignal,
): Promise<FaviconCaptureResult> {
  const declaredMime = mime?.trim().toLowerCase() || null;
  const normalizedMime =
    declaredMime === "application/x-icon"
      ? "image/x-icon"
      : declaredMime === "application/octet-stream" || declaredMime === "binary/octet-stream"
        ? null
        : declaredMime;
  const dimensions = sourceDimensions(buffer);
  if (
    (normalizedMime !== null && !/^image\/[a-z0-9.+-]+$/i.test(normalizedMime)) ||
    normalizedMime === "image/svg+xml" ||
    buffer.byteLength > MAX_FAVICON_RESPONSE_BYTES ||
    !safeDimensions(dimensions)
  ) {
    return { kind: "none" };
  }

  const rasterized = await rasterizeFavicon(
    webContents,
    normalizedMime,
    buffer,
    dimensions,
    signal,
  );
  if (rasterized.kind === "timed-out") return rasterized;
  return typeof rasterized.value === "string" &&
    rasterized.value.startsWith("data:image/png;base64,") &&
    rasterized.value.length <= FAVICON_DATA_URL_MAX_LENGTH
    ? { kind: "captured", dataUrl: rasterized.value }
    : { kind: "none" };
}

async function rasterizeFavicon(
  webContents: Electron.WebContents,
  mime: string | null,
  buffer: Buffer,
  dimensions: ImageDimensions,
  signal: AbortSignal,
): Promise<RasterizationResult> {
  const gate = rasterizationGates.get(webContents) ?? { generation: 0 };
  rasterizationGates.set(webContents, gate);
  const generation = ++gate.generation;
  const previousLaunchAllowed = gate.launchAllowed;
  if (previousLaunchAllowed) {
    await waitForRasterLaunch(previousLaunchAllowed, signal);
  }
  if (signal.aborted || generation !== gate.generation) {
    return { kind: "completed", value: null };
  }

  const payload = buffer.toString("base64");
  const blobType = mime ?? "";
  const scale = Math.min(32 / dimensions.width, 32 / dimensions.height);
  const decodeWidth = Math.max(1, Math.round(dimensions.width * scale));
  const decodeHeight = Math.max(1, Math.round(dimensions.height * scale));
  const drawX = (32 - decodeWidth) / 2;
  const drawY = (32 - decodeHeight) / 2;
  const code = `
    (() => {
      const rasterize = async () => {
        try {
          const source = Uint8Array.from(atob("${payload}"), (char) => char.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([source], { type: "${blobType}" }), {
            resizeWidth: ${decodeWidth},
            resizeHeight: ${decodeHeight},
            resizeQuality: "high",
          });
          try {
            if (bitmap.width <= 0 || bitmap.height <= 0 || bitmap.width * bitmap.height > ${MAX_FAVICON_SOURCE_PIXELS}) {
              return null;
            }
            const canvas = new OffscreenCanvas(32, 32);
            const context = canvas.getContext("2d");
            if (!context) return null;
            context.drawImage(bitmap, ${drawX}, ${drawY}, ${decodeWidth}, ${decodeHeight});
            const blob = await canvas.convertToBlob({ type: "image/png" });
            const output = new Uint8Array(await blob.arrayBuffer());
            let binary = "";
            for (const byte of output) binary += String.fromCharCode(byte);
            return "data:image/png;base64," + btoa(binary);
          } finally {
            bitmap.close();
          }
        } catch {
          return null;
        }
      };
      return rasterize();
    })()
  `;

  const execution = webContents.executeJavaScriptInIsolatedWorld(FAVICON_RASTER_WORLD_ID, [
    { code },
  ]);

  const result = new Promise<RasterizationResult>((resolve, reject) => {
    // Electron cannot cancel isolated-world execution. This timeout ends only
    // the logical attempt; renderer work may finish after a newer attempt starts.
    const timeout = AbortSignal.timeout(FAVICON_RASTER_TIMEOUT_MS);
    const onTimeout = () => {
      resolve({ kind: "timed-out" });
    };
    timeout.addEventListener("abort", onTimeout, { once: true });
    void execution.then(
      (value) => {
        timeout.removeEventListener("abort", onTimeout);
        resolve({ kind: "completed", value });
      },
      (cause: unknown) => {
        timeout.removeEventListener("abort", onTimeout);
        reject(cause);
      },
    );
  });
  // The logical timeout does not cancel Electron's renderer work. Keep the
  // gate closed until that physical execution actually settles.
  const launchAllowed = execution.then(
    () => undefined,
    () => undefined,
  );
  gate.launchAllowed = launchAllowed;
  void launchAllowed.then(() => {
    if (gate.launchAllowed === launchAllowed) delete gate.launchAllowed;
  });
  return await result;
}
