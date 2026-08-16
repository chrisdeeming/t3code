import { decodeHtmlEntities, type Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { AllSelection, type EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
  isCollapsedCursorAdjacentToInlineToken,
} from "~/composer-logic";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";

import type { ComposerPromptEditorHandle, ComposerPromptEditorProps } from "./ComposerPromptEditor";
import {
  composerTerminalContextIds,
  getTiptapComposerMarkdown,
  stampComposerTerminalContextIds,
  tiptapComposerExtensions,
} from "./tiptapComposerExtensions";
import { composerTokenNodeView } from "./tiptapComposerNodeViews";
import { ComposerTokenMetadataProvider } from "./TiptapComposerTokenView";

const CURSOR_SENTINEL = "\uE000";

type ComposerSnapshot = ReturnType<ComposerPromptEditorHandle["readSnapshot"]>;

function markdownManager(editor: Editor) {
  if (!editor.markdown) throw new Error("Tiptap Markdown manager is unavailable");
  return editor.markdown;
}

export function convertTiptapCodeFenceOnEnter(
  state: EditorState,
  dispatch: (transaction: Transaction) => void,
): boolean {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== "paragraph") return false;
  if ($from.parentOffset !== $from.parent.content.size) return false;
  const match = /^```([A-Za-z0-9_+#.-]*)$/.exec($from.parent.textContent);
  const codeBlock = state.schema.nodes.codeBlock;
  if (!match || !codeBlock) return false;

  const blockStart = $from.before();
  const language = match[1] || null;
  const transaction = state.tr.replaceWith(
    blockStart,
    blockStart + $from.parent.nodeSize,
    codeBlock.create({ language }),
  );
  transaction.setSelection(TextSelection.create(transaction.doc, blockStart + 1));
  transaction.scrollIntoView();
  dispatch(transaction);
  return true;
}

export function serializeTiptapComposerWithCursor(
  editor: Editor,
  position: number,
): {
  value: string;
  expandedCursor: number;
} {
  const value = getTiptapComposerMarkdown(editor);
  if (position <= 0) {
    return { value, expandedCursor: 0 };
  }
  if (position >= editor.state.doc.content.size) {
    return { value, expandedCursor: value.length };
  }
  const transaction = editor.state.tr.insertText(CURSOR_SENTINEL, position);
  const marked = decodeHtmlEntities(markdownManager(editor).serialize(transaction.doc.toJSON()));
  const expandedCursor = marked.indexOf(CURSOR_SENTINEL);
  if (expandedCursor < 0) {
    return { value, expandedCursor: 0 };
  }
  return { value, expandedCursor: Math.min(expandedCursor, value.length) };
}

export function tiptapComposerPositionForExpandedCursor(
  editor: Editor,
  expandedCursor: number,
): number {
  const document = editor.getJSON();
  const trailingNode = document.content?.at(-1);
  if (
    expandedCursor >= getTiptapComposerMarkdown(editor).length &&
    trailingNode?.type === "paragraph" &&
    !trailingNode.content?.length
  ) {
    return editor.state.doc.content.size - 1;
  }

  const maxPosition = Math.max(1, editor.state.doc.content.size - 1);
  let bestPosition = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let low = 1;
  let high = maxPosition;

  while (low <= high) {
    const position = Math.floor((low + high) / 2);
    const mappedCursor = serializeTiptapComposerWithCursor(editor, position).expandedCursor;
    const distance = Math.abs(mappedCursor - expandedCursor);
    if (distance < bestDistance) {
      bestPosition = position;
      bestDistance = distance;
    }
    if (distance === 0) break;
    if (mappedCursor < expandedCursor) {
      low = position + 1;
    } else {
      high = position - 1;
    }
  }

  return bestPosition;
}

function snapshotAtSelection(editor: Editor): ComposerSnapshot {
  const { value, expandedCursor } = serializeTiptapComposerWithCursor(
    editor,
    editor.state.selection.anchor,
  );
  const cursor = collapseExpandedComposerCursor(value, expandedCursor);
  return {
    value,
    cursor,
    expandedCursor,
    terminalContextIds: composerTerminalContextIds(editor.state.doc),
  };
}

function snapshotEquals(left: ComposerSnapshot, right: ComposerSnapshot): boolean {
  return (
    left.value === right.value &&
    left.cursor === right.cursor &&
    left.expandedCursor === right.expandedCursor &&
    left.terminalContextIds.length === right.terminalContextIds.length &&
    left.terminalContextIds.every((id, index) => id === right.terminalContextIds[index])
  );
}

/** Tiptap implementation of the existing composer editor contract. */
export function TiptapComposerPromptEditor(props: ComposerPromptEditorProps) {
  const emitChange = useEffectEvent(props.onChange);
  const commandKeyDown = useEffectEvent(
    (key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab", event: KeyboardEvent) =>
      props.onCommandKeyDown?.(key, event) ?? false,
  );
  const snapshotRef = useRef<ComposerSnapshot>({
    value: props.value,
    cursor: clampCollapsedComposerCursor(props.value, props.cursor),
    expandedCursor: expandCollapsedComposerCursor(props.value, props.cursor),
    terminalContextIds: props.terminalContexts.map((context) => context.id),
  });
  // Read by editor callbacks that must stay stable across renders.
  const terminalContextsRef = useRef(props.terminalContexts);
  terminalContextsRef.current = props.terminalContexts;
  const tokenMetadata = useMemo(
    () => ({ terminalContexts: props.terminalContexts, skills: props.skills }),
    [props.skills, props.terminalContexts],
  );

  const publishSnapshot = useCallback((editor: Editor) => {
    const snapshot = snapshotAtSelection(editor);
    if (snapshotEquals(snapshotRef.current, snapshot)) return;
    snapshotRef.current = snapshot;
    const adjacentToToken =
      isCollapsedCursorAdjacentToInlineToken(snapshot.value, snapshot.cursor, "left") ||
      isCollapsedCursorAdjacentToInlineToken(snapshot.value, snapshot.cursor, "right");
    emitChange(
      snapshot.value,
      snapshot.cursor,
      snapshot.expandedCursor,
      adjacentToToken,
      snapshot.terminalContextIds,
    );
  }, []);

  const editor = useEditor({
    extensions: tiptapComposerExtensions({
      placeholder: props.placeholder,
      tokenNodeView: composerTokenNodeView(),
      codeBlockTheme: () =>
        resolveDiffThemeName(
          document.documentElement.classList.contains("dark") ? "dark" : "light",
        ),
    }),
    content: props.value,
    contentType: "markdown",
    editable: !props.disabled,
    injectCSS: false,
    editorProps: {
      attributes: {
        "aria-label": props.placeholder,
        "data-placeholder": props.placeholder,
        "data-testid": "composer-editor",
        class: cn(
          "block max-h-50 min-h-17.5 w-full overflow-y-auto whitespace-pre-wrap wrap-break-word bg-transparent leading-relaxed text-foreground focus:outline-none",
          props.className,
        ),
      },
      handleKeyDown(view, event) {
        if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "a") {
          event.preventDefault();
          view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
          return true;
        }
        if (
          event.key !== "ArrowDown" &&
          event.key !== "ArrowUp" &&
          event.key !== "Enter" &&
          event.key !== "Tab"
        ) {
          return false;
        }
        if (event.key === "Enter" && (event.isComposing || event.keyCode === 229)) {
          event.preventDefault();
          return true;
        }
        if (
          event.key === "Enter" &&
          convertTiptapCodeFenceOnEnter(view.state, (transaction) => view.dispatch(transaction))
        ) {
          event.preventDefault();
          return true;
        }
        if (
          event.key === "Enter" &&
          (view.state.selection.$from.parent.type.name === "codeBlock" ||
            view.state.selection.$from.depth > 1)
        ) {
          return false;
        }
        const handled = commandKeyDown(event.key, event);
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
        }
        return handled;
      },
    },
    onCreate({ editor: createdEditor }) {
      stampComposerTerminalContextIds(createdEditor, terminalContextsRef.current);
    },
    onUpdate({ editor: updatedEditor }) {
      // A paste or autocomplete can introduce a placeholder mid-edit.
      stampComposerTerminalContextIds(updatedEditor, terminalContextsRef.current);
      publishSnapshot(updatedEditor);
    },
    onSelectionUpdate({ editor: updatedEditor }) {
      publishSnapshot(updatedEditor);
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!props.disabled);
  }, [editor, props.disabled]);

  useEffect(() => {
    if (!editor) return;
    const currentValue = getTiptapComposerMarkdown(editor);
    const normalizedCursor = clampCollapsedComposerCursor(props.value, props.cursor);
    const isControlledEcho =
      currentValue === props.value &&
      snapshotRef.current.value === props.value &&
      snapshotRef.current.cursor === normalizedCursor;
    if (isControlledEcho) {
      // A new draft arrives as a props change with the prompt text unchanged,
      // so its placeholder still has to be matched to it.
      stampComposerTerminalContextIds(editor, props.terminalContexts);
      return;
    }
    if (currentValue !== props.value) {
      editor.commands.setContent(props.value, { contentType: "markdown", emitUpdate: false });
    }
    stampComposerTerminalContextIds(editor, props.terminalContexts);
    const expandedCursor = expandCollapsedComposerCursor(props.value, normalizedCursor);
    const position = tiptapComposerPositionForExpandedCursor(editor, expandedCursor);
    if (editor.state.selection.anchor !== position) {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)),
      );
    }
    snapshotRef.current = snapshotAtSelection(editor);
  }, [editor, props.cursor, props.terminalContexts, props.value]);

  const focusAt = useCallback(
    (cursor: number) => {
      if (!editor) return;
      const value = getTiptapComposerMarkdown(editor);
      const collapsedCursor = clampCollapsedComposerCursor(value, cursor);
      const position = tiptapComposerPositionForExpandedCursor(
        editor,
        expandCollapsedComposerCursor(value, collapsedCursor),
      );
      editor.commands.focus(position, { scrollIntoView: false });
      snapshotRef.current = snapshotAtSelection(editor);
    },
    [editor],
  );

  useImperativeHandle(
    props.editorRef,
    () => ({
      focus: () => focusAt(snapshotRef.current.cursor),
      focusAt,
      focusAtEnd: () => {
        if (!editor) return;
        focusAt(
          collapseExpandedComposerCursor(
            getTiptapComposerMarkdown(editor),
            Number.MAX_SAFE_INTEGER,
          ),
        );
      },
      readSnapshot: () => {
        if (editor) {
          snapshotRef.current = snapshotAtSelection(editor);
        }
        return snapshotRef.current;
      },
    }),
    [editor, focusAt],
  );

  return (
    <ComposerTokenMetadataProvider value={tokenMetadata}>
      <div className="composer-tiptap relative [font-family:var(--font-composer,var(--font-sans))] [font-size:var(--font-size-prompt,0.875rem)] [@media(max-width:39.999rem)_and_(pointer:coarse)]:[font-size:max(var(--font-size-prompt,1rem),16px)]">
        <EditorContent editor={editor} onPaste={props.onPaste} />
      </div>
    </ComposerTokenMetadataProvider>
  );
}
