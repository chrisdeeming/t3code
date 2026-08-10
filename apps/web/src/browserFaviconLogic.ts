import { FAVICON_CAPTURED_AT_MAX, FAVICON_DATA_URL_MAX_LENGTH } from "@t3tools/contracts";

import { isLocalLoopbackHost, normalizeHostname } from "./browser/browserTargetResolver";

export type BrowserFaviconEntry = { dataUrl: string; capturedAt: number };

export const BROWSER_FAVICON_MAX_ENTRIES = 40;
export const BROWSER_FAVICON_MAX_KEY_LENGTH = 4_096;
const BROWSER_FAVICON_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export function canCanonicalizeFaviconWithoutEnvironment(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = normalizeHostname(parsed.hostname);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (isLocalLoopbackHost(host) || host === "0.0.0.0")
    );
  } catch {
    return false;
  }
}

export function isValidFaviconCapturedAt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= FAVICON_CAPTURED_AT_MAX &&
    value <= Date.now() + BROWSER_FAVICON_MAX_FUTURE_SKEW_MS
  );
}

function isValidPersistedFaviconKey(key: string): boolean {
  if (key.length === 0 || key.length > BROWSER_FAVICON_MAX_KEY_LENGTH) return false;
  const separator = key.indexOf(" ");
  if (separator <= 0) return false;
  const origin = key.slice(separator + 1);
  return origin.startsWith("http://") || origin.startsWith("https://");
}

export function faviconKey(
  projectRefKey: string,
  url: string,
  environmentHostname: string | null,
): string | null {
  if (projectRefKey.length === 0) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = normalizeHostname(parsed.hostname);
    const canonicalHost =
      isLocalLoopbackHost(host) ||
      host === "0.0.0.0" ||
      (environmentHostname !== null && host === normalizeHostname(environmentHostname))
        ? "local"
        : host;
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    return `${projectRefKey} ${parsed.protocol}//${canonicalHost}:${port}`;
  } catch {
    return null;
  }
}

export function isStorableFaviconDataUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value.startsWith("data:image/png;base64,") ||
    value.length > FAVICON_DATA_URL_MAX_LENGTH
  ) {
    return false;
  }
  const payload = value.slice("data:image/png;base64,".length);
  return (
    payload.length > 0 &&
    payload.length % 4 !== 1 &&
    !/[^a-z0-9+/=]/i.test(payload) &&
    /^[a-z0-9+/]*={0,2}$/i.test(payload)
  );
}

export function evictExcessFavicons(
  byKey: Record<string, BrowserFaviconEntry>,
): Record<string, BrowserFaviconEntry> {
  const keys = Object.keys(byKey);
  if (keys.length <= BROWSER_FAVICON_MAX_ENTRIES) return byKey;
  return Object.fromEntries(
    keys
      .toSorted((left, right) => (byKey[right]?.capturedAt ?? 0) - (byKey[left]?.capturedAt ?? 0))
      .slice(0, BROWSER_FAVICON_MAX_ENTRIES)
      .map((key) => [key, byKey[key] as BrowserFaviconEntry]),
  );
}

export function migratePersistedBrowserFaviconState(persistedState: unknown): {
  byKey: Record<string, BrowserFaviconEntry>;
} {
  if (!persistedState || typeof persistedState !== "object") return { byKey: {} };
  const raw = "byKey" in persistedState ? (persistedState as { byKey?: unknown }).byKey : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { byKey: {} };
  const byKey: Record<string, BrowserFaviconEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidPersistedFaviconKey(key)) continue;
    if (!value || typeof value !== "object") continue;
    const { dataUrl, capturedAt } = value as Record<string, unknown>;
    if (!isStorableFaviconDataUrl(dataUrl)) continue;
    if (!isValidFaviconCapturedAt(capturedAt)) continue;
    byKey[key] = { dataUrl, capturedAt };
  }
  return { byKey: evictExcessFavicons(byKey) };
}
