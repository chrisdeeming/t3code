import type { ComponentProps } from "react";
import { ChevronDownIcon, type LucideIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { SelectTrigger } from "../ui/select";

const composerControlClassName =
  "rounded-[var(--control-radius)] text-secondary-label transition-none hover:text-foreground [&_svg[data-composer-control-icon]]:mx-0 [&_svg[data-composer-control-chevron]]:-mx-0.5";

export function ComposerControl({
  className,
  size = "sm",
  variant = "ghost",
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(composerControlClassName, className)}
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
}: {
  icon: LucideIcon;
  className?: string | undefined;
  opticalSize?: "default" | "large";
}) {
  return (
    <Icon
      aria-hidden="true"
      className={cn("shrink-0", opticalSize === "large" ? "size-4.5" : "size-4", className)}
      data-composer-control-icon
    />
  );
}

export function ComposerControlChevron({ className }: { className?: string } = {}) {
  return (
    <ChevronDownIcon
      aria-hidden="true"
      className={cn("-mx-0.5 size-3 shrink-0 opacity-50", className)}
      data-composer-control-chevron
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
      className={cn(composerControlClassName, className)}
      icon={<ComposerControlChevron />}
      size={size}
      variant={variant}
      {...props}
    />
  );
}
