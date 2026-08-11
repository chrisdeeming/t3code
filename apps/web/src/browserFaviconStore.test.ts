import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/state/entities", () => ({ useThreadShell: () => null }));
vi.mock("~/state/session", () => ({ usePreparedConnection: () => ({ _tag: "None" }) }));

import {
  flushPendingFaviconsForThread,
  lookupFavicon,
  mergeBrowserFaviconState,
  recordFaviconForProject,
  recordFaviconForThread,
  registerFaviconProjectForThread,
  resetBrowserFaviconsForTests,
  resolveBrowserFaviconStorage,
  useBrowserFaviconStore,
} from "./browserFaviconStore";

const environmentId = EnvironmentId.make("env-1");
const projectRef = scopeProjectRef(environmentId, ProjectId.make("project-1"));
const threadRef = { environmentId, threadId: ThreadId.make("thread-1") };
const PNG = "data:image/png;base64,AAAA";
const favicon = (pageUrl: string, capturedAt: number, dataUrl = PNG) => ({
  pageUrl,
  capturedAt,
  dataUrl,
});

describe("browser favicon store", () => {
  beforeEach(resetBrowserFaviconsForTests);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the newest capture for an origin and permits an identical later revisit", () => {
    const recordFavicon = vi.spyOn(useBrowserFaviconStore.getState(), "recordFavicon");
    recordFaviconForProject(projectRef, favicon("http://localhost:3000/", 20), null);
    recordFaviconForProject(
      projectRef,
      favicon("http://localhost:3000/old", 10, "data:image/png;base64,QkJCQg=="),
      null,
    );
    recordFaviconForProject(projectRef, favicon("http://localhost:3000/new", 30), null);
    recordFaviconForProject(projectRef, favicon("http://localhost:3000/new", 30), null);
    expect(Object.values(useBrowserFaviconStore.getState().byKey)).toEqual([
      { dataUrl: PNG, capturedAt: 30 },
    ]);
    expect(recordFavicon).toHaveBeenCalledTimes(2);
  });

  it("does not share localhost icons across environments or physical projects", () => {
    const otherEnvironment = scopeProjectRef(
      EnvironmentId.make("env-2"),
      ProjectId.make("project-1"),
    );
    const otherProject = scopeProjectRef(environmentId, ProjectId.make("project-2"));
    recordFaviconForProject(projectRef, favicon("http://localhost:3000/", 1), null);
    recordFaviconForProject(otherEnvironment, favicon("http://localhost:3000/", 2), null);
    recordFaviconForProject(otherProject, favicon("http://localhost:3000/", 3), null);
    expect(Object.keys(useBrowserFaviconStore.getState().byKey)).toEqual([
      "env-1:project-1 http://local:3000",
      "env-2:project-1 http://local:3000",
      "env-1:project-2 http://local:3000",
    ]);
  });

  it("finds a persisted localhost icon after shell hydration without a live connection host", () => {
    recordFaviconForProject(projectRef, favicon("http://192.168.64.2:3000/app", 5), "192.168.64.2");
    const byKey = useBrowserFaviconStore.getState().byKey;
    expect(lookupFavicon(byKey, null, "http://localhost:3000/app", null)).toBeNull();
    expect(lookupFavicon(byKey, projectRef, "http://localhost:3000/app", null)).toBe(PNG);
  });

  it("retains multiple origins until project and connection metadata hydrate", () => {
    expect(
      recordFaviconForThread(threadRef, favicon("http://localhost:3000/", 1), null, undefined),
    ).toBe(false);
    expect(
      recordFaviconForThread(threadRef, favicon("http://localhost:5173/", 2), null, undefined),
    ).toBe(false);
    expect(
      Object.keys(Object.values(useBrowserFaviconStore.getState().pendingByThreadKey)[0] ?? {}),
    ).toHaveLength(2);

    expect(flushPendingFaviconsForThread(threadRef, projectRef, "192.168.64.2")).toBe(true);
    expect(Object.keys(useBrowserFaviconStore.getState().byKey).toSorted()).toEqual([
      "env-1:project-1 http://local:3000",
      "env-1:project-1 http://local:5173",
    ]);
    expect(useBrowserFaviconStore.getState().pendingByThreadKey).toEqual({});
  });

  it("persists unambiguous loopback captures while the environment is offline", () => {
    expect(
      recordFaviconForThread(
        threadRef,
        favicon("http://localhost:3000/", 1),
        projectRef,
        undefined,
      ),
    ).toBe(true);
    expect(useBrowserFaviconStore.getState().byKey).toEqual({
      "env-1:project-1 http://local:3000": { dataUrl: PNG, capturedAt: 1 },
    });

    recordFaviconForThread(
      threadRef,
      favicon("http://192.168.64.2:5173/", 2),
      projectRef,
      undefined,
    );
    expect(flushPendingFaviconsForThread(threadRef, projectRef, undefined)).toBe(false);
    expect(Object.values(useBrowserFaviconStore.getState().pendingByThreadKey)[0]).toBeDefined();
  });

  it("keeps pending captures in store-owned state independent of bridge lifetime", () => {
    recordFaviconForThread(threadRef, favicon("http://localhost:3000/", 10), null, undefined);
    const pendingAfterUnmount = useBrowserFaviconStore.getState().pendingByThreadKey;
    useBrowserFaviconStore.setState({ pendingByThreadKey: pendingAfterUnmount });
    flushPendingFaviconsForThread(threadRef, projectRef, "localhost");
    expect(useBrowserFaviconStore.getState().byKey).toEqual({
      "env-1:project-1 http://local:3000": { dataUrl: PNG, capturedAt: 10 },
    });
  });

  it("flushes and resolves a pending draft-thread favicon after physical project registration", () => {
    recordFaviconForThread(threadRef, favicon("http://localhost:8025/", 10), null, undefined);
    registerFaviconProjectForThread(threadRef, projectRef);
    const registered = useBrowserFaviconStore.getState().projectRefByThreadKey["env-1:thread-1"];
    expect(registered).toEqual(projectRef);
    expect(flushPendingFaviconsForThread(threadRef, registered!, undefined)).toBe(true);
    expect(
      lookupFavicon(
        useBrowserFaviconStore.getState().byKey,
        registered!,
        "http://localhost:8025/",
        null,
      ),
    ).toBe(PNG);
  });

  it("bounds pending memory by origin and thread", () => {
    for (let thread = 0; thread < 22; thread += 1) {
      for (let port = 3000; port < 3012; port += 1) {
        recordFaviconForThread(
          { environmentId, threadId: ThreadId.make(`thread-${thread}`) },
          favicon(`http://localhost:${port}/`, port),
          null,
          undefined,
        );
      }
    }
    const pending = useBrowserFaviconStore.getState().pendingByThreadKey;
    expect(Object.keys(pending)).toHaveLength(20);
    expect(Object.values(pending).every((byOrigin) => Object.keys(byOrigin).length === 10)).toBe(
      true,
    );
  });

  it("sanitizes hydrated state while preserving actions and transient pending data", () => {
    recordFaviconForThread(threadRef, favicon("http://localhost:3000/", 1), null, undefined);
    const current = useBrowserFaviconStore.getState();
    const merged = mergeBrowserFaviconState(
      {
        byKey: {
          "env-1:project-1 http://local:3000": { dataUrl: PNG, capturedAt: 2 },
          "env-1:project-1 http://local:3001": { dataUrl: "bad", capturedAt: 3 },
          "env-1:project-1 http://local:3002": { dataUrl: PNG, capturedAt: 1e308 },
          ["x".repeat(5_000)]: { dataUrl: PNG, capturedAt: 4 },
        },
      },
      current,
    );
    expect(merged.byKey).toEqual({
      "env-1:project-1 http://local:3000": { dataUrl: PNG, capturedAt: 2 },
    });
    expect(merged.pendingByThreadKey).toEqual(current.pendingByThreadKey);
    expect(typeof merged.recordFavicon).toBe("function");
  });

  it("falls back to memory when localStorage access throws", () => {
    vi.stubGlobal(
      "window",
      Object.defineProperty({}, "localStorage", {
        get: () => {
          throw new Error("storage blocked");
        },
      }),
    );
    const storage = resolveBrowserFaviconStorage();
    storage.setItem("key", "value");
    expect(storage.getItem("key")).toBe("value");
  });

  it("falls back to memory when localStorage operations throw", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => {
          throw new Error("read blocked");
        }),
        setItem: vi.fn(() => {
          throw new Error("quota exceeded");
        }),
        removeItem: vi.fn(() => {
          throw new Error("remove blocked");
        }),
      },
    });
    const storage = resolveBrowserFaviconStorage();

    storage.setItem("key", "value");
    expect(storage.getItem("key")).toBe("value");
    storage.removeItem("key");
    expect(storage.getItem("key")).toBeNull();
  });
});
