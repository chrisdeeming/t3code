import type { PullRequestContextMetadata } from "@t3tools/contracts";
import { CircleDashedIcon, FilmIcon, GitPullRequestIcon, ImageIcon } from "lucide-react";
import type { ComponentProps, MouseEvent, ReactNode } from "react";

import { cn } from "~/lib/utils";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";
import {
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  CONTEXT_INLINE_CHIP_FOCUS_CLASS_NAME,
  CONTEXT_INLINE_CHIP_ICON_TONE_CLASS_NAMES,
  CONTEXT_INLINE_CHIP_INTERACTIVE_CLASS_NAME,
  CONTEXT_INLINE_CHIP_TONE_CLASS_NAMES,
  middleTruncateAttachmentName,
} from "./composerInlineChip";
import { PullRequestContextDetails } from "./PullRequestContextDetails";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** Shared visual slots; each surface keeps ownership of payload lookup and actions. */
export function ContextChipPopover(props: {
  copyMarkdown?: string;
  accessibleLabel: string;
  chip: ReactNode;
  children: ReactNode;
  triggerClassName?: string;
  popupClassName?: string;
  viewportClassName?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex max-w-full cursor-pointer items-center rounded-[0.5em] align-middle",
              CONTEXT_INLINE_CHIP_FOCUS_CLASS_NAME,
              props.triggerClassName,
            )}
            aria-label={`${props.accessibleLabel}. Show details`}
            data-markdown-copy={props.copyMarkdown}
          />
        }
      >
        {props.chip}
      </PopoverTrigger>
      <PopoverPopup
        side="top"
        className={cn("w-[min(36rem,calc(100vw-2rem))]", props.popupClassName)}
        viewportClassName={cn("overflow-x-auto p-2", props.viewportClassName)}
      >
        <PopoverTitle className="sr-only">{props.accessibleLabel}</PopoverTitle>
        {props.children}
      </PopoverPopup>
    </Popover>
  );
}

export function PullRequestChip(props: {
  metadata: PullRequestContextMetadata;
  label: string;
  kindLabel: string;
  className: string;
  labelClassName: string;
  copyMarkdown?: string;
  onOpen: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              props.className,
              CONTEXT_INLINE_CHIP_INTERACTIVE_CLASS_NAME,
              "cursor-pointer",
            )}
            aria-label={`${props.kindLabel} ${props.label}: ${props.metadata.title}. Open in pull request panel.`}
            data-markdown-copy={props.copyMarkdown}
            onClick={(event) => props.onOpen(event, props.metadata.url)}
          >
            <GitPullRequestIcon
              className={cn(
                COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
                CONTEXT_INLINE_CHIP_ICON_TONE_CLASS_NAMES["pull-request"],
                "size-3.5",
              )}
            />
            <span className={props.labelClassName}>{props.label}</span>
          </button>
        }
      />
      <TooltipPopup side="top" className="max-w-96 leading-tight">
        <PullRequestContextDetails metadata={props.metadata} />
      </TooltipPopup>
    </Tooltip>
  );
}

export function ImageChipButton({
  name,
  previewUrl,
  className,
  labelClassName,
  suffix,
  ...props
}: ComponentProps<"button"> & {
  name: string;
  previewUrl: string | undefined;
  labelClassName: string;
  suffix?: string | null;
}) {
  return (
    <button
      type="button"
      className={cn(
        className,
        CONTEXT_INLINE_CHIP_TONE_CLASS_NAMES.image,
        CONTEXT_INLINE_CHIP_INTERACTIVE_CLASS_NAME,
        "cursor-zoom-in",
      )}
      aria-label={`Image attachment, ${name}`}
      {...props}
    >
      {previewUrl ? (
        <img src={previewUrl} alt="" className="size-3.5 shrink-0 rounded-sm object-cover" />
      ) : (
        <ImageIcon
          className={cn(
            COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
            CONTEXT_INLINE_CHIP_ICON_TONE_CLASS_NAMES.image,
            "size-3.5",
          )}
        />
      )}
      <span className={cn(labelClassName, "max-w-72")}>{middleTruncateAttachmentName(name)}</span>
      {suffix ? <span className="text-[10px] text-current">{suffix}</span> : null}
    </button>
  );
}

export function FileChipContent(props: {
  name: string;
  size: string;
  isVideo: boolean;
  theme: "light" | "dark";
  labelClassName: string;
  suffix?: string | null;
}) {
  return (
    <>
      {props.isVideo ? (
        <FilmIcon
          className={cn(
            COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
            CONTEXT_INLINE_CHIP_ICON_TONE_CLASS_NAMES.video,
            "size-3.5",
          )}
        />
      ) : (
        <PierreEntryIcon
          pathValue={props.name}
          kind="file"
          theme={props.theme}
          className="size-3.5"
        />
      )}
      <span className={cn(props.labelClassName, "max-w-72")}>
        {middleTruncateAttachmentName(props.name)}
      </span>
      <span className="shrink-0 text-[10px] text-current">{props.size}</span>
      {props.suffix ? <span className="text-[10px] text-current">{props.suffix}</span> : null}
    </>
  );
}

export function UnresolvedChip(props: {
  label: string;
  className: string;
  labelClassName: string;
  tooltip: string;
  tooltipClassName: string;
  copyMarkdown?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              props.className,
              CONTEXT_INLINE_CHIP_FOCUS_CLASS_NAME,
              "border-dashed text-foreground",
            )}
            aria-label={`Unavailable context, ${props.label}`}
            data-context-unresolved="true"
            data-markdown-copy={props.copyMarkdown}
            tabIndex={0}
          >
            <CircleDashedIcon className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")} />
            <span className={props.labelClassName}>{props.label}</span>
          </span>
        }
      />
      <TooltipPopup side="top" className={props.tooltipClassName}>
        {props.tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}
