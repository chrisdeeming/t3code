import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  SharedComposerDraft,
  SharedComposerDraftContent,
  UpdateSharedComposerDraftInput,
} from "@t3tools/contracts";
import { createComposerDraftSync, type ComposerDraftSyncCheckpoint } from "./composerDraftSync.ts";

const content = (text: string): SharedComposerDraftContent => ({ text, attachments: [] });
function harness(
  local: SharedComposerDraftContent | null | undefined,
  checkpoint?: ComposerDraftSyncCheckpoint,
) {
  let saved = local;
  let remote: SharedComposerDraft = {
    key: "thread:one",
    writerId: "other",
    revision: 0,
    content: null,
  };
  const checkpoints: ComposerDraftSyncCheckpoint[] = [];
  const conflicts: (SharedComposerDraftContent | null | undefined)[] = [];
  const preserveConflict = vi.fn(async () => {
    conflicts.push(saved);
  });
  const apply = vi.fn(
    async (value: SharedComposerDraftContent | null, canCommit: () => boolean) => {
      if (!canCommit()) return false;
      saved = value;
      return true;
    },
  );
  const status = vi.fn();
  const update = vi.fn(async (input: UpdateSharedComposerDraftInput) => {
    if (input.expectedRevision !== remote.revision) return { accepted: false, draft: remote };
    remote = {
      key: input.key,
      writerId: input.writerId,
      revision: remote.revision + 1,
      content: input.content,
    };
    return { accepted: true, draft: remote };
  });
  const sync = createComposerDraftSync({
    key: "thread:one",
    writerId: "local",
    checkpoint,
    read: () => saved,
    saveCheckpoint: (value) => checkpoints.push(value),
    preserveConflict,
    apply,
    update,
    status,
  });
  return {
    sync,
    update,
    checkpoints,
    conflicts,
    preserveConflict,
    apply,
    status,
    read: () => saved,
    edit(value: SharedComposerDraftContent | null | undefined) {
      saved = value;
      sync.localChanged();
    },
    receive(value: SharedComposerDraft) {
      remote = value;
      sync.receive(value);
    },
    remote: () => remote,
  };
}
afterEach(() => vi.useRealTimers());
describe("composer draft synchronization", () => {
  it("does not reapply an unchanged echo whose JSON properties have a different order", async () => {
    vi.useFakeTimers();
    const h = harness(
      { text: "Keep the caret", attachments: [], context: { version: 1, records: [] } },
      { revision: 3, dirty: false },
    );
    h.receive({
      key: "thread:one",
      revision: 3,
      writerId: "web",
      content: { context: { records: [], version: 1 }, attachments: [], text: "Keep the caret" },
    });
    await h.sync.flush();
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.conflicts).toEqual([]);
    await h.sync.dispose();
  });
  it("does not replace local work when preserving a conflict fails", async () => {
    vi.useFakeTimers();
    const h = harness(content("Local work"), { revision: 1, dirty: true });
    h.preserveConflict.mockRejectedValueOnce(new Error("Stash full"));
    h.receive({ key: "thread:one", revision: 2, writerId: "web", content: content("Remote work") });
    await h.sync.flush();
    expect(h.read()).toEqual(content("Local work"));
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.status).toHaveBeenLastCalledWith("offline");
    h.sync.disconnected();
    await h.sync.dispose();
  });
  it("preserves typing that occurs while remote attachments are loading", async () => {
    vi.useFakeTimers();
    const h = harness(null);
    let complete!: () => void;
    const gate = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const original = h.apply.getMockImplementation()!;
    h.apply.mockImplementationOnce(async (value, canCommit) => {
      await gate;
      return original(value, canCommit);
    });
    h.receive({ key: "thread:one", revision: 2, writerId: "web", content: content("Remote work") });
    const loading = h.sync.flush();
    await Promise.resolve();
    h.edit(content("Typed while loading"));
    complete();
    await loading;
    expect(h.read()).toEqual(content("Typed while loading"));
    await h.sync.flush();
    expect(h.conflicts).toEqual([content("Typed while loading")]);
    expect(h.read()).toEqual(content("Remote work"));
    await h.sync.dispose();
  });
  it("waits for attachment uploads without publishing an empty draft", async () => {
    vi.useFakeTimers();
    const h = harness(undefined);
    h.receive(h.remote());
    await h.sync.flush();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.status).toHaveBeenLastCalledWith("saving");
    h.edit(content("Attachment ready"));
    await h.sync.flush();
    expect(h.remote().content).toEqual(content("Attachment ready"));
    await h.sync.dispose();
  });
  it("keeps disconnected edits local and ignores stale revisions", async () => {
    vi.useFakeTimers();
    const h = harness(content("Saved"), { revision: 3, dirty: false });
    h.receive({ key: "thread:one", revision: 3, writerId: "web", content: content("Saved") });
    await h.sync.flush();
    h.sync.disconnected();
    h.edit(content("Offline"));
    h.sync.receive({ key: "thread:one", revision: 2, writerId: "web", content: content("Stale") });
    await h.sync.flush();
    expect(h.read()).toEqual(content("Offline"));
    expect(h.update).not.toHaveBeenCalled();
    expect(h.status).toHaveBeenLastCalledWith("offline");
    await h.sync.dispose();
  });
  it("does not publish a blank new device over the existing shared draft", async () => {
    vi.useFakeTimers();
    const h = harness(null);
    h.receive({ key: "thread:one", revision: 3, writerId: "web", content: content("Keep this") });
    await h.sync.flush();
    expect(h.read()).toEqual(content("Keep this"));
    expect(h.update).not.toHaveBeenCalled();
    expect(h.checkpoints.at(-1)).toEqual({ revision: 3, dirty: false });
    await h.sync.dispose();
  });
  it("debounces typing and sends one final value", async () => {
    vi.useFakeTimers();
    const h = harness(null);
    h.receive(h.remote());
    await h.sync.flush();
    h.edit(content("a"));
    h.edit(content("ab"));
    h.edit(content("abc"));
    await vi.advanceTimersByTimeAsync(499);
    expect(h.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.remote().content).toEqual(content("abc"));
    await h.sync.dispose();
  });
  it("keeps an offline edit in the stash before accepting a newer remote revision", async () => {
    vi.useFakeTimers();
    const h = harness(content("Offline work"), { revision: 1, dirty: true });
    h.receive({ key: "thread:one", revision: 2, writerId: "web", content: content("Newer work") });
    await h.sync.flush();
    expect(h.conflicts).toEqual([content("Offline work")]);
    expect(h.read()).toEqual(content("Newer work"));
    expect(h.update).not.toHaveBeenCalled();
    await h.sync.dispose();
  });
  it("publishes a local edit when reconnecting to the same base revision", async () => {
    vi.useFakeTimers();
    const h = harness(content("Offline work"), { revision: 2, dirty: true });
    h.receive({ key: "thread:one", revision: 2, writerId: "web", content: content("Old work") });
    await h.sync.flush();
    expect(h.remote().content).toEqual(content("Offline work"));
    expect(h.conflicts).toEqual([]);
    await h.sync.dispose();
  });
  it("clears a sent draft during navigation after a save already in flight", async () => {
    vi.useFakeTimers();
    const h = harness(content("Ready to send"));
    h.receive(h.remote());
    let complete: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const original = h.update.getMockImplementation()!;
    h.update.mockImplementationOnce(async (input) => {
      await gate;
      return original(input);
    });
    const saving = h.sync.flush();
    await Promise.resolve();
    h.edit(null);
    const closing = h.sync.dispose();
    complete!();
    await saving;
    await closing;
    expect(h.update).toHaveBeenCalledTimes(2);
    expect(h.remote()).toMatchObject({ revision: 2, content: null });
    expect(h.checkpoints.at(-1)).toEqual({ revision: 2, dirty: false });
  });
});
