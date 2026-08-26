import type { ServerProviderSkill } from "@t3tools/contracts";
import type React from "react";

import type { TerminalContextDraft } from "~/lib/terminalContext";

import { LexicalComposerPromptEditor } from "./LegacyLexicalComposerPromptEditor";
import { TiptapComposerPromptEditor } from "./TiptapComposerPromptEditor";

export interface ComposerPromptEditorHandle {
  focus: () => void;
  focusAt: (cursor: number) => void;
  focusAtEnd: () => void;
  readSnapshot: () => {
    value: string;
    cursor: number;
    expandedCursor: number;
    terminalContextIds: string[];
  };
}

export type ComposerEditorDebugSnapshot = {
  dom: string;
  json: string;
  markdown: string;
};

export interface ComposerPromptEditorProps {
  value: string;
  cursor: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  skills: ReadonlyArray<ServerProviderSkill>;
  disabled: boolean;
  placeholder: string;
  className?: string;
  onRemoveTerminalContext: (contextId: string) => void;
  onChange: (
    nextValue: string,
    nextCursor: number,
    expandedCursor: number,
    /**
     * Whether the composer should skip opening a trigger menu for this change.
     * Set when the caret sits somewhere a menu would be wrong: beside a mention
     * chip, where the `@` belongs to the chip rather than a new query, or inside
     * a code fence, where every character is content.
     */
    suppressTrigger: boolean,
    terminalContextIds: string[],
  ) => void;
  onCommandKeyDown?: (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
    /**
     * What Enter should be allowed to do here. The editor knows the cursor's
     * structural context; the composer owns the menu and the submit decision.
     * `"menu-only"` means a list, quote or fence, where Enter belongs to the
     * structure once the menu has declined it. `"submit"` is the Mod+Enter
     * escape hatch, which sends from anywhere.
     */
    intent?: "default" | "menu-only" | "submit",
  ) => boolean;
  onPaste: React.ClipboardEventHandler<HTMLElement>;
  onDebugSnapshotChange?: (snapshot: ComposerEditorDebugSnapshot) => void;
  editorRef: React.RefObject<ComposerPromptEditorHandle | null>;
  /** Settings → Beta → Tiptap composer. Off keeps the Lexical editor. */
  useTiptapComposer?: boolean;
}

/**
 * Picks the prompt editor implementation behind the beta flag.
 *
 * Both editors take the same props and speak the same Markdown value, so the
 * switch is seamless: a draft written in one opens in the other. Keyed on the
 * flag so flipping it remounts rather than trying to reconcile two very
 * different editor trees.
 */
export function ComposerPromptEditor(props: ComposerPromptEditorProps) {
  const { useTiptapComposer = false, ...editorProps } = props;
  return useTiptapComposer ? (
    <TiptapComposerPromptEditor key="tiptap" {...editorProps} />
  ) : (
    <LexicalComposerPromptEditor key="lexical" {...editorProps} />
  );
}
