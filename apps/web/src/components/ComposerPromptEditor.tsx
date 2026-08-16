import type { ServerProviderSkill } from "@t3tools/contracts";
import type React from "react";

import type { TerminalContextDraft } from "~/lib/terminalContext";

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
    cursorAdjacentToMention: boolean,
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
}

export const ComposerPromptEditor = TiptapComposerPromptEditor;
