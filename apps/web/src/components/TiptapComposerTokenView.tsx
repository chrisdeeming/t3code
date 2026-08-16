import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type { ServerProviderSkill } from "@t3tools/contracts";
import { createContext, use, useMemo } from "react";

import type { TerminalContextDraft } from "~/lib/terminalContext";
import { basenameOfPath } from "~/pierre-icons";
import { formatProviderSkillDisplayName } from "~/providerSkillPresentation";

import {
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME,
  COMPOSER_INLINE_SKILL_CHIP_LABEL_CLASS_NAME,
  SKILL_CHIP_ICON_SVG,
} from "./composerInlineChip";
import { ComposerPendingTerminalContextChip } from "./chat/ComposerPendingTerminalContexts";
import { FILE_TAG_CHIP_CLASS_NAME, FileTagChipContent } from "./chat/FileTagChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * Token nodes carry only what Markdown round-trips (kind + value). Presentation
 * metadata — skill labels, terminal-context drafts — lives here so a props
 * change repaints the chips without dispatching a document transaction.
 */
export interface ComposerTokenMetadata {
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  skills: ReadonlyArray<ServerProviderSkill>;
}

const ComposerTokenMetadataContext = createContext<ComposerTokenMetadata>({
  terminalContexts: [],
  skills: [],
});

export const ComposerTokenMetadataProvider = ComposerTokenMetadataContext;

function resolveSkillDescription(
  skill: Pick<ServerProviderSkill, "shortDescription" | "description">,
): string | null {
  const shortDescription = skill.shortDescription?.trim();
  if (shortDescription) return shortDescription;
  const description = skill.description?.trim();
  return description || null;
}

function resolvedThemeFromDocument(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function ComposerMentionChip(props: { path: string }) {
  const chip = (
    <span className={FILE_TAG_CHIP_CLASS_NAME} spellCheck={false} data-composer-mention-chip="true">
      <FileTagChipContent
        path={props.path}
        label={basenameOfPath(props.path)}
        theme={resolvedThemeFromDocument()}
      />
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top" className="max-w-120 whitespace-normal leading-tight wrap-anywhere">
        {props.path}
      </TooltipPopup>
    </Tooltip>
  );
}

function ComposerSkillChip(props: { name: string }) {
  const { skills } = use(ComposerTokenMetadataContext);
  const skill = useMemo(
    () => skills.find((candidate) => candidate.name === props.name),
    [props.name, skills],
  );
  const label = skill
    ? formatProviderSkillDisplayName(skill)
    : formatProviderSkillDisplayName({ name: props.name });
  const description = skill ? resolveSkillDescription(skill) : null;

  const chip = (
    <span
      className={COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME}
      spellCheck={false}
      data-composer-skill-chip="true"
    >
      <span
        aria-hidden="true"
        className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME}
        dangerouslySetInnerHTML={{ __html: SKILL_CHIP_ICON_SVG }}
      />
      <span className={COMPOSER_INLINE_SKILL_CHIP_LABEL_CLASS_NAME}>{label}</span>
    </span>
  );

  if (!description) return chip;

  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top" className="max-w-120 whitespace-normal leading-tight">
        {description}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * Terminal-context tokens are positional: the nth placeholder in the prompt
 * maps to the nth pending draft, matching how the prompt text is assembled.
 */
function ComposerTerminalContextChip(props: { index: number }) {
  const { terminalContexts } = use(ComposerTokenMetadataContext);
  const context = terminalContexts[props.index];
  if (!context) return null;
  return <ComposerPendingTerminalContextChip context={context} />;
}

export function TiptapComposerTokenView(props: ReactNodeViewProps) {
  const kind = props.node.attrs.kind as string;
  const value = String(props.node.attrs.value ?? "");
  const terminalIndex = terminalContextIndexBefore(props.getPos(), props.editor.state.doc);

  return (
    <NodeViewWrapper
      as="span"
      className="composer-inline-chip relative inline-flex align-[-0.125em] leading-none"
      contentEditable={false}
      data-composer-token={kind}
      data-composer-token-value={value}
    >
      {kind === "mention" ? <ComposerMentionChip path={value} /> : null}
      {kind === "skill" ? <ComposerSkillChip name={value} /> : null}
      {kind === "terminal-context" ? <ComposerTerminalContextChip index={terminalIndex} /> : null}
    </NodeViewWrapper>
  );
}

function terminalContextIndexBefore(
  position: number | undefined,
  doc: ReactNodeViewProps["editor"]["state"]["doc"],
): number {
  if (position === undefined) return 0;
  let index = 0;
  doc.descendants((node, nodePosition) => {
    if (nodePosition >= position) return false;
    if (node.type.name === "composerToken" && node.attrs.kind === "terminal-context") index += 1;
    return true;
  });
  return index;
}
