import { decodeHtmlEntities, type Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { AllSelection, type EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { useCallback, useEffect, useEffectEvent, useImperativeHandle, useRef } from "react";

import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  expandCollapsedComposerCursor,
  isCollapsedCursorAdjacentToInlineToken,
} from "~/composer-logic";
import { cn } from "~/lib/utils";
import { basenameOfPath } from "~/pierre-icons";
import { formatProviderSkillDisplayName } from "~/providerSkillPresentation";

import type {
  ComposerEditorDebugSnapshot,
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps,
} from "./ComposerPromptEditor";
import { getTiptapComposerMarkdown, tiptapComposerExtensions } from "./tiptapComposerExtensions";

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

function terminalContextIds(editor: Editor): string[] {
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "composerToken" || node.attrs.kind !== "terminal-context") return;
    if (typeof node.attrs.contextId === "string" && node.attrs.contextId) {
      ids.push(node.attrs.contextId);
    }
  });
  return ids;
}

function syncTokenMetadata(
  editor: Editor,
  terminalContexts: ComposerPromptEditorProps["terminalContexts"],
  skills: ComposerPromptEditorProps["skills"],
): void {
  const skillLabels = new Map(
    skills.map((skill) => [skill.name, formatProviderSkillDisplayName(skill)]),
  );
  let terminalIndex = 0;
  let transaction = editor.state.tr;

  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== "composerToken") return;
    let contextId: string | null = null;
    let label: string | null = null;
    if (node.attrs.kind === "terminal-context") {
      const context = terminalContexts[terminalIndex];
      terminalIndex += 1;
      contextId = context?.id ?? null;
      label = context?.terminalLabel ?? "Terminal context";
    } else if (node.attrs.kind === "mention") {
      label = basenameOfPath(String(node.attrs.value));
    } else if (node.attrs.kind === "skill") {
      label = skillLabels.get(String(node.attrs.value)) ?? `$${String(node.attrs.value)}`;
    }
    if (node.attrs.contextId === contextId && node.attrs.label === label) return;
    transaction = transaction.setNodeMarkup(position, undefined, {
      ...node.attrs,
      contextId,
      label,
    });
  });

  if (transaction.steps.length > 0) {
    transaction.setMeta("addToHistory", false);
    editor.view.dispatch(transaction);
  }
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
    terminalContextIds: terminalContextIds(editor),
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
  const emitDebugSnapshot = useEffectEvent((snapshot: ComposerEditorDebugSnapshot) => {
    props.onDebugSnapshotChange?.(snapshot);
  });
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
  const refreshDebugSnapshot = useCallback((editor: Editor) => {
    if (!props.onDebugSnapshotChange) return;
    emitDebugSnapshot({
      dom: editor.view.dom.outerHTML,
      json: JSON.stringify(editor.getJSON(), null, 2),
      markdown: getTiptapComposerMarkdown(editor),
    });
  }, []);

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
    extensions: tiptapComposerExtensions({ placeholder: props.placeholder }),
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
      syncTokenMetadata(createdEditor, props.terminalContexts, props.skills);
      refreshDebugSnapshot(createdEditor);
    },
    onUpdate({ editor: updatedEditor }) {
      publishSnapshot(updatedEditor);
      refreshDebugSnapshot(updatedEditor);
    },
    onSelectionUpdate({ editor: updatedEditor }) {
      publishSnapshot(updatedEditor);
      refreshDebugSnapshot(updatedEditor);
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
    syncTokenMetadata(editor, props.terminalContexts, props.skills);
    if (isControlledEcho) return;
    if (currentValue !== props.value) {
      editor.commands.setContent(props.value, { contentType: "markdown", emitUpdate: false });
      syncTokenMetadata(editor, props.terminalContexts, props.skills);
    }
    const expandedCursor = expandCollapsedComposerCursor(props.value, normalizedCursor);
    const position = tiptapComposerPositionForExpandedCursor(editor, expandedCursor);
    if (editor.state.selection.anchor !== position) {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)),
      );
    }
    snapshotRef.current = snapshotAtSelection(editor);
    refreshDebugSnapshot(editor);
  }, [
    editor,
    props.cursor,
    props.skills,
    props.terminalContexts,
    props.value,
    refreshDebugSnapshot,
  ]);

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
        if (editor) snapshotRef.current = snapshotAtSelection(editor);
        return snapshotRef.current;
      },
    }),
    [editor, focusAt],
  );

  return (
    <div className="composer-tiptap relative [font-family:var(--font-composer,var(--font-sans))] [font-size:var(--font-size-prompt,0.875rem)] [@media(max-width:39.999rem)_and_(pointer:coarse)]:[font-size:max(var(--font-size-prompt,1rem),16px)]">
      <EditorContent editor={editor} onPaste={props.onPaste} />
    </div>
  );
}
