import type { PullRequestContextMetadata } from "@t3tools/contracts";
import { ArrowRightIcon, GitPullRequestIcon } from "lucide-react";

import { cn } from "~/lib/utils";

type PullRequestDisplayState = "open" | "draft" | "merged" | "closed";

function displayState(metadata: PullRequestContextMetadata): PullRequestDisplayState {
  return metadata.state === "open" && metadata.isDraft ? "draft" : metadata.state;
}

const STATE_PRESENTATION = {
  open: {
    label: "Open",
    className: "text-emerald-600 dark:text-emerald-300/90",
  },
  draft: {
    label: "Draft",
    className: "text-slate-600 dark:text-slate-300/90",
  },
  merged: {
    label: "Merged",
    className: "text-violet-600 dark:text-violet-300/90",
  },
  closed: {
    label: "Closed",
    className: "text-red-600 dark:text-red-300/90",
  },
} as const satisfies Record<
  PullRequestDisplayState,
  { readonly label: string; readonly className: string }
>;

export function PullRequestContextDetails({ metadata }: { metadata: PullRequestContextMetadata }) {
  const state = STATE_PRESENTATION[displayState(metadata)];
  return (
    <div className="max-w-80 space-y-1 overflow-hidden py-0.5 text-left">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <GitPullRequestIcon className={cn("size-3.5 shrink-0", state.className)} />
        <span className="text-foreground">Pull request #{metadata.number}</span>
        <span className={state.className}>{state.label}</span>
      </div>
      <div className="wrap-break-word text-foreground">{metadata.title}</div>
      <div className="flex min-w-0 items-center gap-1 text-secondary-label text-[10px]">
        <code className="truncate">{metadata.headBranch}</code>
        <ArrowRightIcon className="size-3 shrink-0" aria-hidden="true" />
        <code className="truncate">{metadata.baseBranch}</code>
      </div>
    </div>
  );
}
