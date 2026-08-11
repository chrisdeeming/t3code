import { describe, expect, it, vi } from "vite-plus/test";

import {
  MAX_FAVICON_CANDIDATES,
  MAX_FAVICON_RESPONSE_BYTES,
  captureFavicon,
  selectFaviconCandidates,
} from "./FaviconCapture.ts";

const PNG = "data:image/png;base64,cG5n";
const SOURCE_PNG = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(SOURCE_PNG);
SOURCE_PNG.writeUInt32BE(1, 16);
SOURCE_PNG.writeUInt32BE(1, 20);
const SOURCE_PNG_URL = `data:image/png;base64,${SOURCE_PNG.toString("base64")}`;

function sourceGif(
  width: number,
  height: number,
  frameWidth = width,
  frameHeight = height,
  additionalFrames: ReadonlyArray<{
    readonly left?: number;
    readonly top?: number;
    readonly width: number;
    readonly height: number;
  }> = [],
): Buffer {
  const frames = [{ width: frameWidth, height: frameHeight }, ...additionalFrames];
  const buffer = Buffer.alloc(13 + frames.length * 12 + 1);
  buffer.write("GIF89a", 0, "ascii");
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  let offset = 13;
  for (const frame of frames) {
    buffer[offset] = 0x2c;
    buffer.writeUInt16LE(frame.left ?? 0, offset + 1);
    buffer.writeUInt16LE(frame.top ?? 0, offset + 3);
    buffer.writeUInt16LE(frame.width, offset + 5);
    buffer.writeUInt16LE(frame.height, offset + 7);
    offset += 10;
    buffer[offset] = 2;
    buffer[offset + 1] = 0;
    offset += 2;
  }
  buffer[offset] = 0x3b;
  return buffer;
}

function sourceJpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x07,
    0x08,
    height >>> 8,
    height & 0xff,
    width >>> 8,
    width & 0xff,
  ]);
}

function sourceWebp(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

function sourceIco(embedded: Buffer): Buffer {
  const buffer = Buffer.alloc(22 + embedded.byteLength);
  buffer.writeUInt16LE(1, 2);
  buffer.writeUInt16LE(1, 4);
  buffer.writeUInt32LE(embedded.byteLength, 14);
  buffer.writeUInt32LE(22, 18);
  embedded.copy(buffer, 22);
  return buffer;
}

function makeUnsafePng(): Buffer {
  const buffer = Buffer.from(SOURCE_PNG);
  buffer.writeUInt32BE(4096, 16);
  buffer.writeUInt32BE(4096, 20);
  return buffer;
}

function makeUnsafeDib(): Buffer {
  const buffer = Buffer.alloc(40);
  buffer.writeUInt32LE(40, 0);
  buffer.writeInt32LE(4096, 4);
  buffer.writeInt32LE(4096, 8);
  return buffer;
}

function makeWebContents(options?: {
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  readonly rasterize?: (code: string) => Promise<unknown>;
}) {
  const fetch = vi.fn(
    options?.fetch ??
      (async () =>
        new Response(new Uint8Array(SOURCE_PNG), {
          headers: { "content-type": "image/png" },
        })),
  );
  const executeJavaScriptInIsolatedWorld = vi.fn(
    async (_worldId: number, scripts: ReadonlyArray<{ readonly code: string }>) =>
      options?.rasterize ? options.rasterize(scripts[0]?.code ?? "") : PNG,
  );
  return {
    webContents: {
      session: { fetch },
      executeJavaScriptInIsolatedWorld,
    } as never,
    executeJavaScriptInIsolatedWorld,
    fetch,
  };
}

describe("selectFaviconCandidates", () => {
  it("filters and deduplicates before applying the candidate cap", () => {
    const valid = Array.from(
      { length: MAX_FAVICON_CANDIDATES + 2 },
      (_, index) => `https://example.com/favicon-${index}.png`,
    );
    expect(
      selectFaviconCandidates([
        ...Array.from({ length: 64 }, () => "javascript:alert(1)"),
        valid[0]!,
        valid[0]!,
        ...valid.slice(1),
      ]),
    ).toEqual(valid.slice(0, MAX_FAVICON_CANDIDATES));
  });

  it("bounds raw candidate scanning independently of the usable-candidate cap", () => {
    const oversizedInvalid = `javascript:${"x".repeat(2_048)}`;
    expect(
      selectFaviconCandidates([
        ...Array.from({ length: 128 }, () => oversizedInvalid),
        "https://example.com/too-late.png",
      ]),
    ).toEqual([]);
  });
});

describe("captureFavicon", () => {
  it.each([
    {
      label: "same-origin",
      pageUrl: "https://example.com/page",
      faviconUrl: "https://example.com/favicon.png",
      credentials: "include",
    },
    {
      label: "cross-origin",
      pageUrl: "https://example.com/page",
      faviconUrl: "https://cdn.example.net/favicon.png",
      credentials: "omit",
    },
  ])("uses the explicit credential policy for $label requests", async (testCase) => {
    const { webContents, fetch } = makeWebContents();
    const result = await captureFavicon({
      webContents,
      pageUrl: testCase.pageUrl,
      candidates: [testCase.faviconUrl],
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ kind: "captured", dataUrl: PNG });
    expect(fetch).toHaveBeenCalledWith(
      testCase.faviconUrl,
      expect.objectContaining({ credentials: testCase.credentials, redirect: "error" }),
    );
  });

  it("decodes base64 and percent-encoded inline images without fetching", async () => {
    const { webContents, fetch, executeJavaScriptInIsolatedWorld } = makeWebContents();
    const percentEncodedPng = [...SOURCE_PNG]
      .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
      .join("");

    for (const candidate of [SOURCE_PNG_URL, `data:image/png,${percentEncodedPng}`]) {
      expect(
        await captureFavicon({
          webContents,
          pageUrl: "https://example.com/page",
          candidates: [candidate],
          signal: new AbortController().signal,
        }),
      ).toEqual({ kind: "captured", dataUrl: PNG });
    }

    expect(fetch).not.toHaveBeenCalled();
    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(2);
  });

  it("tries the next candidate after an ordinary rejection", async () => {
    const { webContents, fetch } = makeWebContents({
      fetch: async (url) =>
        url.endsWith("first.png")
          ? new Response(null, { status: 404 })
          : new Response(new Uint8Array(SOURCE_PNG), {
              headers: { "content-type": "image/png" },
            }),
    });

    expect(
      await captureFavicon({
        webContents,
        pageUrl: "https://example.com/page",
        candidates: ["https://example.com/first.png", "https://example.com/second.png"],
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "captured", dataUrl: PNG });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cancels a rejected response body before trying the next candidate", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    const { webContents, fetch } = makeWebContents({
      fetch: async (url) =>
        url.endsWith("first.png")
          ? new Response(body, { status: 404 })
          : new Response(new Uint8Array(SOURCE_PNG), {
              headers: { "content-type": "image/png" },
            }),
    });

    expect(
      await captureFavicon({
        webContents,
        pageUrl: "https://example.com/page",
        candidates: ["https://example.com/first.png", "https://example.com/second.png"],
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "captured", dataUrl: PNG });
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops a pending fetch when its capture is aborted", async () => {
    const controller = new AbortController();
    const { webContents } = makeWebContents({
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    });
    const capture = captureFavicon({
      webContents,
      pageUrl: "https://example.com/page",
      candidates: ["https://example.com/favicon.png"],
      signal: controller.signal,
    });
    controller.abort();
    expect(await capture).toEqual({ kind: "none" });
  });

  it("rejects and cancels an oversized streamed response", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_FAVICON_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    const { webContents, executeJavaScriptInIsolatedWorld } = makeWebContents({
      fetch: async () => new Response(body, { headers: { "content-type": "image/png" } }),
    });

    expect(
      await captureFavicon({
        webContents,
        pageUrl: "https://example.com/page",
        candidates: ["https://example.com/favicon.png"],
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "none" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
  });

  it("retains bounded compatibility with common favicon formats", async () => {
    const { webContents, executeJavaScriptInIsolatedWorld } = makeWebContents();
    for (const [mime, buffer] of [
      ["image/gif", sourceGif(32, 32)],
      ["image/jpeg", sourceJpeg(32, 32)],
      ["image/webp", sourceWebp(32, 32)],
      ["image/x-icon", sourceIco(SOURCE_PNG)],
    ] as const) {
      expect(
        await captureFavicon({
          webContents,
          pageUrl: "https://example.com/page",
          candidates: [`data:${mime};base64,${buffer.toString("base64")}`],
          signal: new AbortController().signal,
        }),
      ).toEqual({ kind: "captured", dataUrl: PNG });
    }
    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(4);
  });

  it("requests a 32x32 bitmap decode before drawing the normalized icon", async () => {
    const { webContents } = makeWebContents({
      rasterize: async (code) => {
        expect(code).toContain("resizeWidth: 32");
        expect(code).toContain("resizeHeight: 32");
        expect(code).toContain('resizeQuality: "high"');
        return PNG;
      },
    });

    expect(
      await captureFavicon({
        webContents,
        pageUrl: "https://example.com/page",
        candidates: [SOURCE_PNG_URL],
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "captured", dataUrl: PNG });
  });

  it("rejects an unsafe PNG size before rasterization", async () => {
    const buffer = makeUnsafePng();
    const { webContents, executeJavaScriptInIsolatedWorld } = makeWebContents({
      fetch: async () =>
        new Response(new Uint8Array(buffer), {
          headers: { "content-type": "image/png" },
        }),
    });

    expect(
      await captureFavicon({
        webContents,
        pageUrl: "https://example.com/page",
        candidates: ["https://example.com/favicon.png"],
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "none" });
    expect(executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
  });

  it.each([
    ["GIF", "image/gif", sourceGif(4096, 4096)],
    ["GIF frame", "image/gif", sourceGif(1, 1, 4096, 4096)],
    ["GIF later frame", "image/gif", sourceGif(1, 1, 1, 1, [{ width: 4096, height: 4096 }])],
    [
      "GIF cumulative frames",
      "image/gif",
      sourceGif(
        64,
        64,
        64,
        64,
        Array.from({ length: 256 }, () => ({ width: 64, height: 64 })),
      ),
    ],
    ["JPEG", "image/jpeg", sourceJpeg(4096, 4096)],
    ["WebP", "image/webp", sourceWebp(4096, 4096)],
    ["ICO with PNG", "image/x-icon", sourceIco(makeUnsafePng())],
    ["ICO with DIB", "image/x-icon", sourceIco(makeUnsafeDib())],
    ["SVG", "image/svg+xml", Buffer.from('<svg width="1" height="1"/>')],
    [
      "SVG with embedded bitmap",
      "image/svg+xml",
      Buffer.from(
        `<svg width="1" height="1"><image href="data:image/png;base64,${makeUnsafePng().toString("base64")}"/></svg>`,
      ),
    ],
    [
      "ICO invalid payload span",
      "image/x-icon",
      (() => {
        const buffer = Buffer.alloc(22);
        buffer.writeUInt16LE(1, 2);
        buffer.writeUInt16LE(1, 4);
        buffer.writeUInt32LE(100, 14);
        buffer.writeUInt32LE(22, 18);
        return buffer;
      })(),
    ],
  ])("rejects unsafe or unsupported %s before rasterization", async (_label, mime, buffer) => {
    const { webContents, executeJavaScriptInIsolatedWorld } = makeWebContents();
    const candidate = `data:${mime};base64,${buffer.toString("base64")}`;
    expect(
      await captureFavicon({
        webContents,
        pageUrl: "https://example.com/page",
        candidates: [candidate],
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "none" });
    expect(executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
  });

  it("ignores output that is not a bounded PNG data URL", async () => {
    const { webContents } = makeWebContents({
      rasterize: async () => "data:image/svg+xml;base64,c3Zn",
    });

    expect(
      await captureFavicon({
        webContents,
        pageUrl: "https://example.com/page",
        candidates: [SOURCE_PNG_URL],
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: "none" });
  });

  it("waits for physical rasterization settlement after a logical timeout", async () => {
    vi.useFakeTimers();
    try {
      let resolveOld!: (value: unknown) => void;
      let executions = 0;
      const { webContents } = makeWebContents({
        rasterize: () => {
          executions += 1;
          return executions === 1
            ? new Promise((resolve) => {
                resolveOld = resolve;
              })
            : Promise.resolve(PNG);
        },
      });
      const input = {
        webContents,
        pageUrl: "https://example.com/page",
        candidates: [SOURCE_PNG_URL],
        signal: new AbortController().signal,
      };
      const timedOut = captureFavicon(input);
      await vi.advanceTimersByTimeAsync(1_001);
      expect(await timedOut).toEqual({ kind: "timed-out" });

      const newer = captureFavicon(input);
      await Promise.resolve();
      expect(executions).toBe(1);
      resolveOld(PNG);
      expect(await newer).toEqual({ kind: "captured", dataUrl: PNG });
      expect(executions).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends candidate fallback after a rasterization timeout", async () => {
    vi.useFakeTimers();
    try {
      let resolveRasterization!: (value: unknown) => void;
      const { webContents, fetch, executeJavaScriptInIsolatedWorld } = makeWebContents({
        rasterize: () =>
          new Promise((resolve) => {
            resolveRasterization = resolve;
          }),
      });
      const capture = captureFavicon({
        webContents,
        pageUrl: "https://example.com/page",
        candidates: ["https://example.com/first.png", "https://example.com/second.png"],
        signal: new AbortController().signal,
      });

      await vi.advanceTimersByTimeAsync(1_001);

      expect(await capture).toEqual({ kind: "timed-out" });
      expect(fetch).toHaveBeenCalledOnce();
      expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce();
      resolveRasterization(PNG);
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces queued rasterizations so only the latest pending capture launches", async () => {
    let resolveFirst!: (value: unknown) => void;
    let executions = 0;
    const { webContents } = makeWebContents({
      rasterize: () => {
        executions += 1;
        return executions === 1
          ? new Promise((resolve) => {
              resolveFirst = resolve;
            })
          : Promise.resolve(PNG);
      },
    });
    const input = {
      webContents,
      pageUrl: "https://example.com/page",
      candidates: [SOURCE_PNG_URL],
      signal: new AbortController().signal,
    };
    const first = captureFavicon(input);
    const superseded = captureFavicon(input);
    const newest = captureFavicon(input);

    expect(executions).toBe(1);
    resolveFirst(PNG);
    expect(await first).toEqual({ kind: "captured", dataUrl: PNG });
    expect(await superseded).toEqual({ kind: "none" });
    expect(await newest).toEqual({ kind: "captured", dataUrl: PNG });
    expect(executions).toBe(2);
  });
});
