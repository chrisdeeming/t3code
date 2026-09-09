import { describe, expect, it } from "vite-plus/test";

import { PendingDraftWork } from "./pendingDraftWork";

describe("PendingDraftWork", () => {
  it("holds a draft until every transfer it started has finished", async () => {
    const pending = new PendingDraftWork();
    // Two pasted attachments downloading at once, the second slower than the first.
    const defer = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((settle) => {
        resolve = settle;
      });
      return { promise, resolve };
    };
    const fast = defer();
    const slow = defer();
    const transfer = async (done: Promise<void>) => {
      pending.begin("thread-1");
      try {
        await done;
      } finally {
        pending.end("thread-1");
      }
    };
    const both = Promise.all([transfer(fast.promise), transfer(slow.promise)]);

    expect(pending.has("thread-1")).toBe(true);
    fast.resolve();
    await fast.promise;
    // The first finishing must not release the draft while the second is still downloading.
    expect(pending.has("thread-1")).toBe(true);
    slow.resolve();
    await both;
    expect(pending.has("thread-1")).toBe(false);
  });

  it("keeps one draft's work from blocking another", () => {
    const pending = new PendingDraftWork();
    pending.begin("thread-1");
    expect(pending.has("thread-2")).toBe(false);
    pending.end("thread-1");
    expect(pending.has("thread-1")).toBe(false);
  });

  it("does not go negative when a transfer ends twice", () => {
    const pending = new PendingDraftWork();
    pending.begin("thread-1");
    pending.end("thread-1");
    pending.end("thread-1");
    pending.begin("thread-1");
    // A stray extra `end` must not leave the counter below zero, or this begin would read false.
    expect(pending.has("thread-1")).toBe(true);
  });
});
