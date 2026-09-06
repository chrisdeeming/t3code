import {
  type SharedComposerDraft,
  SharedComposerDraftContent,
  type UpdateSharedComposerDraftInput,
  type UpdateSharedComposerDraftResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const sameContent = Schema.toEquivalence(Schema.NullOr(SharedComposerDraftContent));

export interface ComposerDraftSyncCheckpoint {
  readonly revision: number;
  readonly dirty: boolean;
}

export type ComposerDraftSyncStatus = "connecting" | "saved" | "saving" | "offline";

/** One serial, debounced writer per mounted composer. Local persistence remains the offline source. */
export function createComposerDraftSync(options: {
  readonly key: string;
  readonly writerId: string;
  readonly checkpoint?: ComposerDraftSyncCheckpoint | undefined;
  /** Undefined means local attachments are still being prepared, not an empty draft. */
  readonly read: () => SharedComposerDraftContent | null | undefined;
  readonly update: (
    input: UpdateSharedComposerDraftInput,
  ) => Promise<UpdateSharedComposerDraftResult>;
  readonly saveCheckpoint: (checkpoint: ComposerDraftSyncCheckpoint) => void;
  /** Keep the local draft in the client's durable stash before replacing a conflicting edit. */
  readonly preserveConflict: () => Promise<void>;
  /** Recheck immediately before committing an asynchronously materialized remote draft. */
  readonly apply: (
    content: SharedComposerDraftContent | null,
    canCommit: () => boolean,
  ) => Promise<boolean>;
  readonly status: (status: ComposerDraftSyncStatus) => void;
}) {
  let revision = options.checkpoint?.revision ?? 0;
  let dirty = options.checkpoint?.dirty ?? options.read() !== null;
  let generation = 0;
  let connected = false;
  let remote: SharedComposerDraft | null = null;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let closing = false;
  let closingContent: SharedComposerDraftContent | null | undefined;
  const read = () => (closing ? closingContent : options.read());
  const pendingRemote = (): SharedComposerDraft | null => remote;
  const status = (value: ComposerDraftSyncStatus) => options.status(connected ? value : "offline");

  const checkpoint = () => options.saveCheckpoint({ revision, dirty });
  const schedule = (delay = 500) => {
    if (timer !== undefined) clearTimeout(timer);
    if (!disposed && !closing)
      timer = setTimeout(() => {
        timer = undefined;
        void flush();
      }, delay);
  };
  const flush = (): Promise<void> => {
    if (running) return running;
    if (disposed || !connected) return Promise.resolve();
    running = Promise.resolve().then(async () => {
      try {
        const incoming = remote;
        remote = null;
        if (incoming && incoming.revision >= revision) {
          const local = read();
          const same = local !== undefined && sameContent(local, incoming.content);
          if (same) {
            revision = incoming.revision;
            dirty = false;
            checkpoint();
          } else if (!dirty || incoming.revision > revision) {
            const before = generation;
            if (dirty) await options.preserveConflict();
            const applied = await options.apply(
              incoming.content,
              () => !disposed && !closing && generation === before,
            );
            if (!applied || generation !== before) {
              remote = incoming;
              schedule();
              return;
            }
            revision = incoming.revision;
            dirty = false;
            checkpoint();
          }
        }
        const content = read();
        if (!dirty || content === undefined) {
          status(dirty ? "saving" : "saved");
          return;
        }
        const sentGeneration = generation;
        status("saving");
        const result = await options.update({
          key: options.key,
          writerId: options.writerId,
          expectedRevision: revision,
          content,
        });
        if (result.accepted) {
          revision = result.draft.revision;
          dirty = generation !== sentGeneration;
          checkpoint();
          status(dirty ? "saving" : "saved");
          const receivedDuringWrite = pendingRemote();
          if (receivedDuringWrite && receivedDuringWrite.revision <= revision) remote = null;
          if (dirty || remote) schedule();
        } else {
          remote = result.draft;
          schedule(0);
        }
      } catch {
        options.status("offline");
      } finally {
        running = null;
        if (connected && remote) schedule();
      }
    });
    return running;
  };

  return {
    localChanged() {
      generation += 1;
      dirty = true;
      checkpoint();
      options.status(connected ? "saving" : "offline");
      schedule();
    },
    receive(value: SharedComposerDraft) {
      if (disposed || value.key !== options.key || value.revision < revision) return;
      connected = true;
      if (!remote || value.revision >= remote.revision) remote = value;
      schedule(0);
    },
    disconnected() {
      connected = false;
      options.status("offline");
    },
    flush,
    async dispose() {
      closingContent = options.read();
      closing = true;
      if (timer !== undefined) clearTimeout(timer);
      await running;
      // Navigation may follow Send before the debounce fires. Finish its clear after an in-flight save.
      if (dirty && connected && !remote) await flush();
      disposed = true;
    },
  };
}
