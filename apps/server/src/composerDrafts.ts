import {
  SharedComposerDraftContent,
  SharedComposerDraftError,
  type SharedComposerDraft,
  type UpdateSharedComposerDraftInput,
  type UpdateSharedComposerDraftResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const jsonSchema = Schema.fromJsonString(SharedComposerDraftContent);
const decodeContent = Schema.decodeUnknownEffect(jsonSchema);
const encodeContent = Schema.encodeEffect(jsonSchema);
const draftError = (cause: unknown) =>
  new SharedComposerDraftError({ message: "Could not synchronize the composer draft", cause });

export class ComposerDrafts extends Context.Service<
  ComposerDrafts,
  {
    readonly get: (key: string) => Effect.Effect<SharedComposerDraft, SharedComposerDraftError>;
    readonly update: (
      input: UpdateSharedComposerDraftInput,
    ) => Effect.Effect<UpdateSharedComposerDraftResult, SharedComposerDraftError>;
    readonly subscribe: (
      key: string,
    ) => Stream.Stream<SharedComposerDraft, SharedComposerDraftError>;
    readonly retainsAttachment: (id: string) => Effect.Effect<boolean, SharedComposerDraftError>;
    readonly retainedAttachmentIds: Effect.Effect<ReadonlySet<string>, SharedComposerDraftError>;
  }
>()("t3/composerDrafts") {}

/** Mutable drafts do not belong in the conversation event log. Revisions prevent stale writes. */
export const layer = Layer.effect(
  ComposerDrafts,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const writes = yield* Semaphore.make(1);
    const changes = yield* PubSub.unbounded<string>();
    const get = Effect.fn("ComposerDrafts.get")(function* (key: string) {
      const rows = yield* sql<{
        revision: number;
        writer_id: string;
        content_json: string | null;
      }>`SELECT revision, writer_id, content_json FROM shared_composer_drafts WHERE draft_key = ${key}`;
      const row = rows[0];
      return {
        key,
        revision: row?.revision ?? 0,
        writerId: row?.writer_id ?? "",
        content: row?.content_json ? yield* decodeContent(row.content_json) : null,
      } satisfies SharedComposerDraft;
    }, Effect.mapError(draftError));

    const update = Effect.fn("ComposerDrafts.update")(function* (
      input: UpdateSharedComposerDraftInput,
    ) {
      return yield* writes
        .withPermit(
          Effect.gen(function* () {
            const current = yield* get(input.key);
            if (current.revision !== input.expectedRevision)
              return { accepted: false, draft: current };
            const contentJson = input.content === null ? null : yield* encodeContent(input.content);
            if (contentJson !== null && contentJson.length > 2_000_000)
              return yield* new SharedComposerDraftError({
                message: "The draft is too large to synchronize",
              });
            const draft = {
              key: input.key,
              revision: current.revision + 1,
              writerId: input.writerId,
              content: input.content,
            };
            yield* sql`
          INSERT INTO shared_composer_drafts (draft_key, revision, writer_id, content_json)
          VALUES (${draft.key}, ${draft.revision}, ${draft.writerId}, ${contentJson})
          ON CONFLICT(draft_key) DO UPDATE SET
            revision = excluded.revision, writer_id = excluded.writer_id,
            content_json = excluded.content_json
        `;
            yield* PubSub.publish(changes, input.key);
            return { accepted: true, draft };
          }),
        )
        .pipe(Effect.uninterruptible);
    }, Effect.mapError(draftError));

    const subscribe = (key: string) =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Subscribe before reading so a write between the initial snapshot and live stream is retained.
          const queue = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(get(key)),
            Stream.fromSubscription(queue).pipe(
              Stream.filter((changedKey) => changedKey === key),
              Stream.mapEffect(() => get(key)),
            ),
          ).pipe(Stream.changesWith((left, right) => left.revision === right.revision));
        }),
      );

    const retainsAttachment = Effect.fn("ComposerDrafts.retainsAttachment")(function* (id: string) {
      const rows = yield* sql`
        SELECT 1 FROM shared_composer_drafts,
          json_each(shared_composer_drafts.content_json, '$.attachments') AS attachment
        WHERE json_extract(attachment.value, '$.id') = ${id} LIMIT 1
      `;
      return rows.length > 0;
    }, Effect.mapError(draftError));

    const retainedAttachmentIds = sql<{ id: string }>`
      SELECT DISTINCT json_extract(attachment.value, '$.id') AS id
      FROM shared_composer_drafts,
        json_each(shared_composer_drafts.content_json, '$.attachments') AS attachment
    `.pipe(
      Effect.map((rows) => new Set(rows.map((row) => row.id))),
      Effect.mapError(draftError),
    );
    return ComposerDrafts.of({ get, update, subscribe, retainsAttachment, retainedAttachmentIds });
  }),
);
