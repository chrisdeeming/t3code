import type { PreviewAnnotationPayload } from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { videoMimeType } from "@t3tools/shared/video";
import {
  CircleDashedIcon,
  FilmIcon,
  GitPullRequestIcon,
  ImageIcon,
  MessageCircleIcon,
  MousePointerClickIcon,
} from "lucide-react";
import { createContext, type ReactElement, type ReactNode, use } from "react";

import type { ComposerFileAttachment, ComposerImageAttachment } from "~/composerDraftStore";
import { composerFileNeedsReattach } from "~/composerDraftStore";
import { useTheme } from "~/hooks/useTheme";
import {
  formatAttachmentUploadProgress,
  type AttachmentUploadState,
} from "~/lib/attachmentUploadState";
import { cn } from "~/lib/utils";
import {
  isPullRequestSummaryContext,
  previewAnnotationContextId,
  previewAnnotationContextLabel,
  reviewCommentContextId,
  reviewCommentContextLabel,
} from "~/lib/composerContextRecords";
import type { TerminalContextDraft } from "~/lib/terminalContext";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import { ComposerPendingTerminalContextChip } from "./chat/ComposerPendingTerminalContexts";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";
import {
  createContextPresentationRegistry,
  type ContextPresentationCapability,
} from "./contextPresentationRegistry";
import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
  CONTEXT_INLINE_CHIP_FOCUS_CLASS_NAME,
  CONTEXT_INLINE_CHIP_ICON_TONE_CLASS_NAMES,
  CONTEXT_INLINE_CHIP_INTERACTIVE_CLASS_NAME,
  CONTEXT_INLINE_CHIP_TONE_CLASS_NAMES,
  middleTruncateAttachmentName,
} from "./composerInlineChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "./ui/popover";

/**
 * Draft-side payload behind a context reference chip. Each kind keeps its existing draft
 * shape; the editor only needs a way to look one up by id.
 */
export type ComposerDraftContextRecord =
  | { kind: "terminal"; record: TerminalContextDraft }
  | { kind: "review-comment"; record: ReviewCommentContext }
  | { kind: "preview-annotation"; record: PreviewAnnotationPayload }
  | { kind: "image"; record: ComposerImageAttachment; upload?: AttachmentUploadState | undefined }
  | { kind: "file"; record: ComposerFileAttachment; upload?: AttachmentUploadState | undefined };

/** What a chip can do beyond showing itself; the composer supplies the handlers. */
export interface ComposerContextActions {
  expandImage: (imageId: string) => void;
  expandVideo: (fileId: string) => void;
}

export const ComposerContextActionsContext = createContext<ComposerContextActions>({
  expandImage: () => {},
  expandVideo: () => {},
});

export type ComposerDraftContextRecords = ReadonlyMap<string, ComposerDraftContextRecord>;

export const EMPTY_COMPOSER_CONTEXT_RECORDS: ComposerDraftContextRecords = new Map();

export const ComposerContextRecordsContext = createContext<ComposerDraftContextRecords>(
  EMPTY_COMPOSER_CONTEXT_RECORDS,
);

export function composerContextRecordsFromDraft(input: {
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  reviewComments?: ReadonlyArray<ReviewCommentContext>;
  previewAnnotations?: ReadonlyArray<PreviewAnnotationPayload>;
  images?: ReadonlyArray<ComposerImageAttachment>;
  files?: ReadonlyArray<ComposerFileAttachment>;
  uploadsByImageId?: Readonly<Record<string, AttachmentUploadState>>;
}): ComposerDraftContextRecords {
  const records = new Map<string, ComposerDraftContextRecord>();
  for (const record of input.images ?? []) {
    records.set(record.id, { kind: "image", record, upload: input.uploadsByImageId?.[record.id] });
  }
  for (const record of input.files ?? []) {
    records.set(record.id, { kind: "file", record, upload: input.uploadsByImageId?.[record.id] });
  }
  for (const record of input.terminalContexts) {
    records.set(record.id, { kind: "terminal", record });
  }
  for (const record of input.reviewComments ?? []) {
    records.set(reviewCommentContextId(record.id), { kind: "review-comment", record });
  }
  for (const record of input.previewAnnotations ?? []) {
    records.set(previewAnnotationContextId(record.id), { kind: "preview-annotation", record });
  }
  return records;
}

function ContextChip(props: {
  icon: ReactElement;
  label: string;
  kindLabel: string;
  details: ReactNode;
  detailsMode: ContextPresentationCapability["details"];
  toneClassName: string;
}) {
  const content = (
    <span
      className={cn(
        COMPOSER_INLINE_CHIP_CLASS_NAME,
        props.toneClassName,
        props.detailsMode === "popover" && CONTEXT_INLINE_CHIP_INTERACTIVE_CLASS_NAME,
      )}
      aria-hidden={props.detailsMode === "popover" ? true : undefined}
    >
      {props.icon}
      <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{props.label}</span>
    </span>
  );
  if (props.detailsMode === "popover") {
    return (
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                "inline-flex max-w-full cursor-pointer rounded-[0.5em] align-baseline",
                CONTEXT_INLINE_CHIP_FOCUS_CLASS_NAME,
              )}
              aria-label={`${props.kindLabel}, ${props.label}. Show details`}
            />
          }
        >
          {content}
        </PopoverTrigger>
        <PopoverPopup
          side="top"
          className="w-[min(36rem,calc(100vw-2rem))]"
          viewportClassName="overflow-x-auto p-2"
        >
          <PopoverTitle className="sr-only">
            {props.kindLabel}, {props.label}
          </PopoverTitle>
          {props.details}
        </PopoverPopup>
      </Popover>
    );
  }
  if (props.detailsMode === "none") return content;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              COMPOSER_INLINE_CHIP_CLASS_NAME,
              props.toneClassName,
              CONTEXT_INLINE_CHIP_FOCUS_CLASS_NAME,
            )}
            aria-label={`${props.kindLabel}, ${props.label}`}
            tabIndex={0}
          >
            {props.icon}
            <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{props.label}</span>
          </span>
        }
      />
      <TooltipPopup side="top" className="max-w-96 whitespace-pre-wrap leading-tight">
        {props.details}
      </TooltipPopup>
    </Tooltip>
  );
}

function uploadStatusSuffix(upload: AttachmentUploadState | undefined): string | null {
  if (upload?.status === "uploading") return formatAttachmentUploadProgress(upload.progress);
  if (upload?.status === "failed") return "upload failed";
  return null;
}

function attachmentTooltip(
  attachment: ComposerImageAttachment | ComposerFileAttachment,
  upload: AttachmentUploadState | undefined,
): string {
  const lines = [attachment.name, formatAttachmentSize(attachment.sizeBytes)];
  if (upload?.status === "failed") lines.push("", upload.reason);
  return lines.join("\n");
}

function ImageContextChip(props: {
  record: ComposerImageAttachment;
  upload: AttachmentUploadState | undefined;
}) {
  const actions = use(ComposerContextActionsContext);
  const suffix = uploadStatusSuffix(props.upload);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              COMPOSER_INLINE_CHIP_CLASS_NAME,
              CONTEXT_INLINE_CHIP_TONE_CLASS_NAMES.image,
              CONTEXT_INLINE_CHIP_INTERACTIVE_CLASS_NAME,
              "cursor-zoom-in",
            )}
            aria-label={`Image attachment, ${props.record.name}`}
            onClick={() => actions.expandImage(props.record.id)}
          >
            {props.record.previewUrl ? (
              <img
                src={props.record.previewUrl}
                alt=""
                className="size-3.5 shrink-0 rounded-sm object-cover"
              />
            ) : (
              <ImageIcon
                className={cn(
                  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
                  CONTEXT_INLINE_CHIP_ICON_TONE_CLASS_NAMES.image,
                  "size-3.5",
                )}
              />
            )}
            <span className={cn(COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME, "max-w-72")}>
              {middleTruncateAttachmentName(props.record.name)}
            </span>
            {suffix ? <span className="text-[10px] text-current">{suffix}</span> : null}
          </button>
        }
      />
      <TooltipPopup side="top" className="max-w-80 whitespace-pre-wrap leading-tight">
        {attachmentTooltip(props.record, props.upload)}
      </TooltipPopup>
    </Tooltip>
  );
}

function FileContextChip(props: {
  record: ComposerFileAttachment;
  upload: AttachmentUploadState | undefined;
}) {
  const actions = use(ComposerContextActionsContext);
  const { resolvedTheme } = useTheme();
  const needsReattach = composerFileNeedsReattach(props.record);
  const suffix = needsReattach ? "attach again" : uploadStatusSuffix(props.upload);
  const size = formatAttachmentSize(props.record.sizeBytes);
  const isVideo = videoMimeType(props.record) !== null;
  const chipClassName = cn(
    COMPOSER_INLINE_CHIP_CLASS_NAME,
    isVideo
      ? CONTEXT_INLINE_CHIP_TONE_CLASS_NAMES.video
      : CONTEXT_INLINE_CHIP_TONE_CLASS_NAMES.file,
    isVideo && !needsReattach && CONTEXT_INLINE_CHIP_INTERACTIVE_CLASS_NAME,
    isVideo && !needsReattach && "cursor-zoom-in",
    needsReattach && "border-dashed text-foreground",
    props.upload?.status === "failed" && "border-destructive/35 bg-destructive/8 text-destructive",
  );
  const icon = isVideo ? (
    <FilmIcon
      className={cn(
        COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
        CONTEXT_INLINE_CHIP_ICON_TONE_CLASS_NAMES.video,
        "size-3.5",
      )}
    />
  ) : (
    <PierreEntryIcon
      pathValue={props.record.name}
      kind="file"
      theme={resolvedTheme}
      className="size-3.5"
    />
  );
  const content = (
    <>
      {icon}
      <span className={cn(COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME, "max-w-72")}>
        {middleTruncateAttachmentName(props.record.name)}
      </span>
      <span className="shrink-0 text-[10px] text-current">{size}</span>
      {suffix ? <span className="text-[10px] text-current">{suffix}</span> : null}
    </>
  );
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          isVideo && !needsReattach ? (
            <button
              type="button"
              className={chipClassName}
              aria-label={`Preview video attachment, ${props.record.name}, ${size}`}
              onClick={() => actions.expandVideo(props.record.id)}
            >
              {content}
            </button>
          ) : (
            <span
              className={chipClassName}
              aria-label={`File attachment, ${props.record.name}, ${size}`}
              data-context-unresolved={needsReattach ? "true" : undefined}
            >
              {content}
            </span>
          )
        }
      />
      <TooltipPopup side="top" className="max-w-80 whitespace-pre-wrap leading-tight">
        {needsReattach
          ? `${props.record.name} was not saved with this draft. Attach it again to send it.`
          : attachmentTooltip(props.record, props.upload)}
      </TooltipPopup>
    </Tooltip>
  );
}

function previewAnnotationTooltip(annotation: PreviewAnnotationPayload): string {
  const lines = [annotation.pageTitle?.trim() || annotation.pageUrl];
  if (annotation.comment.trim()) lines.push("", annotation.comment.trim());
  const targets: string[] = [];
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  if (annotation.elements.length > 0) targets.push(plural(annotation.elements.length, "element"));
  if (annotation.regions.length > 0) targets.push(plural(annotation.regions.length, "region"));
  if (annotation.strokes.length > 0) targets.push(plural(annotation.strokes.length, "drawing"));
  if (annotation.styleChanges.length > 0) {
    targets.push(plural(annotation.styleChanges.length, "style change"));
  }
  if (targets.length > 0) lines.push("", targets.join(", "));
  return lines.join("\n");
}

function ComposerReviewCommentDetails({ comment }: { comment: ReviewCommentContext }) {
  return (
    <div className="space-y-2 overflow-hidden rounded-lg border border-border/70 bg-background/70 p-3">
      <div className="space-y-1">
        <div className="truncate text-xs font-medium text-foreground">{comment.filePath}</div>
        <div className="text-secondary-label text-[11px]">
          {comment.sectionTitle} · {comment.rangeLabel}
        </div>
      </div>
      {comment.text.trim() ? (
        <div className="whitespace-pre-wrap wrap-break-word text-sm text-foreground">
          {comment.text.trim()}
        </div>
      ) : null}
      {comment.diff.trim() ? (
        <pre className="max-h-64 overflow-auto whitespace-pre rounded-md bg-muted/50 p-2 font-mono text-[11px] text-foreground leading-relaxed">
          {comment.diff.trim()}
        </pre>
      ) : null}
    </div>
  );
}

function ComposerPreviewAnnotationDetails({
  annotation,
}: {
  annotation: PreviewAnnotationPayload;
}) {
  const summary = previewAnnotationTooltip(annotation);
  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-background/70">
      {annotation.screenshot ? (
        <img
          src={annotation.screenshot.dataUrl}
          alt="Annotated preview crop"
          className="max-h-64 w-full border-border/70 border-b bg-muted object-contain"
        />
      ) : (
        <div className="border-border/70 border-b bg-muted/40 px-3 py-2 text-secondary-label text-xs">
          Screenshot unavailable
        </div>
      )}
      <div className="whitespace-pre-wrap wrap-break-word px-3 py-2.5 text-sm text-foreground">
        {summary}
      </div>
    </div>
  );
}

function UnresolvedContextChip(props: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              COMPOSER_INLINE_CHIP_CLASS_NAME,
              CONTEXT_INLINE_CHIP_FOCUS_CLASS_NAME,
              "border-dashed text-foreground",
            )}
            aria-label={`Unavailable context, ${props.label}`}
            data-context-unresolved="true"
            tabIndex={0}
          >
            <CircleDashedIcon className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")} />
            <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{props.label}</span>
          </span>
        }
      />
      <TooltipPopup side="top" className="max-w-80 leading-tight">
        This context is no longer available. Remove it or attach it again.
      </TooltipPopup>
    </Tooltip>
  );
}

interface ComposerContextRenderContext {
  label: string;
}

const composerContextPresentationRegistry = createContextPresentationRegistry<
  ComposerDraftContextRecord,
  ComposerContextRenderContext,
  ReactElement
>({
  requiredKinds: ["image", "file", "terminal", "review-comment", "preview-annotation"],
  handlers: [
    {
      kind: "terminal",
      canRender: (entry) => entry.kind === "terminal",
      render: (entry, context, definition) =>
        entry.kind === "terminal" ? (
          <ComposerPendingTerminalContextChip
            context={entry.record}
            detailsMode={definition.capabilities.details}
          />
        ) : (
          <UnresolvedContextChip label={context.label} />
        ),
    },
    {
      kind: "image",
      canRender: (entry) => entry.kind === "image",
      render: (entry, context) =>
        entry.kind === "image" ? (
          <ImageContextChip record={entry.record} upload={entry.upload} />
        ) : (
          <UnresolvedContextChip label={context.label} />
        ),
    },
    {
      kind: "file",
      canRender: (entry) => entry.kind === "file",
      render: (entry, context) =>
        entry.kind === "file" ? (
          <FileContextChip record={entry.record} upload={entry.upload} />
        ) : (
          <UnresolvedContextChip label={context.label} />
        ),
    },
    {
      kind: "review-comment",
      canRender: (entry) => entry.kind === "review-comment",
      render: (entry, context, definition) => {
        if (entry.kind !== "review-comment") {
          return <UnresolvedContextChip label={context.label} />;
        }
        const isPullRequest = isPullRequestSummaryContext(entry.record);
        return (
          <ContextChip
            icon={
              isPullRequest ? (
                <GitPullRequestIcon
                  className={cn(
                    COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
                    CONTEXT_INLINE_CHIP_ICON_TONE_CLASS_NAMES["pull-request"],
                    "size-3.5",
                  )}
                />
              ) : (
                <MessageCircleIcon
                  className={cn(
                    COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
                    CONTEXT_INLINE_CHIP_ICON_TONE_CLASS_NAMES["review-comment"],
                    "size-3.5",
                  )}
                />
              )
            }
            label={reviewCommentContextLabel(entry.record)}
            kindLabel={isPullRequest ? "Pull request" : "Review comment"}
            details={<ComposerReviewCommentDetails comment={entry.record} />}
            detailsMode={definition.capabilities.details}
            toneClassName={
              CONTEXT_INLINE_CHIP_TONE_CLASS_NAMES[
                isPullRequest ? "pull-request" : "review-comment"
              ]
            }
          />
        );
      },
    },
    {
      kind: "preview-annotation",
      canRender: (entry) => entry.kind === "preview-annotation",
      render: (entry, context, definition) =>
        entry.kind === "preview-annotation" ? (
          <ContextChip
            icon={
              <MousePointerClickIcon
                className={cn(
                  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
                  CONTEXT_INLINE_CHIP_ICON_TONE_CLASS_NAMES["preview-annotation"],
                  "size-3.5",
                )}
              />
            }
            label={previewAnnotationContextLabel(entry.record)}
            kindLabel="Preview annotation"
            details={<ComposerPreviewAnnotationDetails annotation={entry.record} />}
            detailsMode={definition.capabilities.details}
            toneClassName={CONTEXT_INLINE_CHIP_TONE_CLASS_NAMES["preview-annotation"]}
          />
        ) : (
          <UnresolvedContextChip label={context.label} />
        ),
    },
  ],
  fallback: (_kind, _entry, context) => <UnresolvedContextChip label={context.label} />,
});

/** Compact chip for one reference. Unknown kinds and missing records use the registry fallback. */
export function ComposerContextReferenceChip(props: {
  kind: string;
  contextId: string;
  label: string;
}): ReactElement {
  const records = use(ComposerContextRecordsContext);
  return composerContextPresentationRegistry.render(props.kind, records.get(props.contextId), {
    label: props.label,
  });
}
