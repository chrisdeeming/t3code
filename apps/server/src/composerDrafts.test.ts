import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { ComposerDrafts, layer } from "./composerDrafts.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";

const testLayer = layer.pipe(Layer.provide(SqlitePersistenceMemory));
const content = { text: "Continue this work", attachments: [] };
describe("shared composer drafts", () => {
  it.effect("rejects stale writes and retains a tombstone after clearing", () =>
    Effect.gen(function* () {
      const drafts = yield* ComposerDrafts;
      const first = yield* drafts.update({
        key: "thread:one",
        expectedRevision: 0,
        writerId: "web",
        content,
      });
      expect(first.accepted).toBe(true);
      const stale = yield* drafts.update({
        key: "thread:one",
        expectedRevision: 0,
        writerId: "mobile",
        content: { ...content, text: "Offline edit" },
      });
      expect(stale).toEqual({ accepted: false, draft: first.draft });
      const cleared = yield* drafts.update({
        key: "thread:one",
        expectedRevision: 1,
        writerId: "web",
        content: null,
      });
      expect(cleared.draft).toMatchObject({ revision: 2, content: null });
      expect(
        (yield* drafts.update({
          key: "thread:one",
          expectedRevision: 1,
          writerId: "mobile",
          content,
        })).accepted,
      ).toBe(false);
      expect((yield* drafts.get("project:one")).revision).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("streams only the selected draft and replays its latest revision on reconnect", () =>
    Effect.gen(function* () {
      const drafts = yield* ComposerDrafts;
      const ready = yield* Deferred.make<void>();
      const fiber = yield* drafts.subscribe("thread:one").pipe(
        Stream.tap((draft) =>
          draft.revision === 0 ? Deferred.succeed(ready, undefined) : Effect.void,
        ),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkScoped,
      );
      yield* Deferred.await(ready);
      yield* drafts.update({ key: "thread:other", expectedRevision: 0, writerId: "web", content });
      yield* drafts.update({ key: "thread:one", expectedRevision: 0, writerId: "web", content });
      const values = yield* Fiber.join(fiber);
      expect(values.map((value) => value.revision)).toEqual([0, 1]);
      const replay = yield* drafts.subscribe("thread:one").pipe(Stream.take(1), Stream.runCollect);
      expect(replay[0]?.content).toEqual(content);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps uploads referenced by another device's draft", () =>
    Effect.gen(function* () {
      const drafts = yield* ComposerDrafts;
      yield* drafts.update({
        key: "thread:one",
        expectedRevision: 0,
        writerId: "web",
        content: {
          ...content,
          attachments: [
            {
              type: "file",
              id: "pending-file",
              name: "notes.txt",
              mimeType: "text/plain",
              sizeBytes: 4,
            },
          ],
        },
      });
      expect(yield* drafts.retainsAttachment("pending-file")).toBe(true);
      expect(yield* drafts.retainsAttachment("different-file")).toBe(false);
      yield* drafts.update({
        key: "thread:one",
        expectedRevision: 1,
        writerId: "web",
        content: null,
      });
      expect(yield* drafts.retainsAttachment("pending-file")).toBe(false);
    }).pipe(Effect.provide(testLayer)),
  );
});
