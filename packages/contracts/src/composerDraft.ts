import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { OrchestrationMessageContext } from "./composerContext.ts";
import { ChatAttachment, PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "./orchestration.ts";

/** Keys are environment-local: an existing thread, or the current new-task draft for a project. */
export const SharedComposerDraftKey = TrimmedNonEmptyString.check(
  Schema.isMaxLength(512),
  Schema.isPattern(/^(?:thread|project):.+$/),
);
export const SharedComposerDraftContent = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(1_000_000)),
  context: Schema.optional(OrchestrationMessageContext),
  attachments: Schema.Array(ChatAttachment).check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS),
  ),
});
export type SharedComposerDraftContent = typeof SharedComposerDraftContent.Type;

export const SharedComposerDraft = Schema.Struct({
  key: SharedComposerDraftKey,
  revision: NonNegativeInt,
  writerId: Schema.String,
  content: Schema.NullOr(SharedComposerDraftContent),
});
export type SharedComposerDraft = typeof SharedComposerDraft.Type;

export const UpdateSharedComposerDraftInput = Schema.Struct({
  key: SharedComposerDraftKey,
  expectedRevision: NonNegativeInt,
  writerId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  content: Schema.NullOr(SharedComposerDraftContent),
});
export type UpdateSharedComposerDraftInput = typeof UpdateSharedComposerDraftInput.Type;

export const UpdateSharedComposerDraftResult = Schema.Struct({
  accepted: Schema.Boolean,
  draft: SharedComposerDraft,
});
export type UpdateSharedComposerDraftResult = typeof UpdateSharedComposerDraftResult.Type;

export class SharedComposerDraftError extends Schema.TaggedErrorClass<SharedComposerDraftError>()(
  "SharedComposerDraftError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}
