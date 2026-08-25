import type { ComponentProps } from "react";
import { ChevronDownIcon, type LucideIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { SelectTrigger } from "../ui/select";

const composerControlClassName =
  "rounded-[var(--control-radius)] text-secondary-label transition-none hover:text-foreground [&_svg[data-composer-control-chevron]]:-mx-0.5 [&_svg[data-composer-control-icon]]:mx-0";
const expandedComposerControlClassName = "h-7 min-h-7 gap-1.5 px-2.5";
const restingComposerControlClassName =
  "font-normal text-muted-foreground/70 hover:text-foreground/80 [&_svg[data-composer-control-chevron]]:-me-1 [&_svg[data-composer-control-chevron]]:ms-0";

export function ComposerControl({
  className,
  size = "sm",
  variant = "ghost",
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(
        composerControlClassName,
        size === "xs" ? restingComposerControlClassName : expandedComposerControlClassName,
        className,
      )}
      size={size}
      variant={variant}
      {...props}
    />
  );
}

export function ComposerControlIcon({
  icon: Icon,
  className,
  opticalSize = "default",
  size = "sm",
}: {
  icon: LucideIcon;
  className?: string | undefined;
  opticalSize?: "default" | "large";
  size?: ComponentProps<typeof Button>["size"];
}) {
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "shrink-0",
        size === "xs" ? "size-3" : opticalSize === "large" ? "size-4.5" : "size-4",
        className,
      )}
      data-composer-control-icon
    />
  );
}

export function ComposerControlChevron({
  className,
  size = "sm",
}: {
  className?: string;
  size?: ComponentProps<typeof Button>["size"];
} = {}) {
  return (
    <ChevronDownIcon
      aria-hidden="true"
      className={cn(
        "shrink-0",
        size === "xs" ? "size-3 text-current opacity-50" : "size-3.5 text-icon-muted",
        className,
      )}
      data-composer-control-chevron
      strokeWidth={2.25}
    />
  );
}

export function ComposerSelectControl({
  className,
  size = "sm",
  variant = "ghost",
  ...props
}: ComponentProps<typeof SelectTrigger>) {
  return (
    <SelectTrigger
      className={cn(
        composerControlClassName,
        size === "xs" ? restingComposerControlClassName : expandedComposerControlClassName,
        className,
      )}
      icon={<ComposerControlChevron size={size} />}
      size={size}
      variant={variant}
      {...props}
    />
  );
}
