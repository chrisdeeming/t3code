import { decodeHtmlEntities, type Editor, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Fragment } from "@tiptap/pm/model";
import { AllSelection, type EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
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

import type {
  ComposerEditorDebugSnapshot,
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps,
} from "./ComposerPromptEditor";
import {
  composerTerminalContextIds,
  getTiptapComposerMarkdown,
  stampComposerTerminalContextIds,
  tiptapComposerExtensions,
} from "./tiptapComposerExtensions";
import { indentCodeBlock, indentedNewlineInCodeBlock } from "./tiptapComposerCodeBlockIndent";
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

export function shouldConvertTiptapCodeFenceForEnter(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey">,
): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey;
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

/**
 * The inline children of a parsed one-paragraph document, or null when the
 * parse produced anything else — a span replacement can only carry inline
 * content.
 */
function parsedInlineContent(parsed: JSONContent | undefined): JSONContent[] | null {
  const blocks = parsed?.content;
  if (!blocks || blocks.length !== 1) return null;
  const [block] = blocks;
  if (block?.type !== "paragraph") return null;
  return block.content ?? [];
}

/**
 * Applies a controlled value change as an edit to the one span that differs,
 * rather than re-parsing the whole prompt.
 *
 * A full `setContent` runs every character back through the Markdown parser,
 * which rewrites text the change never touched — `fix __init__` arrives as
 * `fix **init**`, a bare URL becomes a link. Autocomplete replaces a single
 * range, so diffing the common prefix and suffix recovers that range and lets
 * the untouched text stay exactly as the user typed it.
 *
 * Returns false when the edit is not a plain substitution inside one text block,
 * leaving the caller to fall back to a full parse.
 */
export function replaceChangedSpan(
  editor: Editor,
  currentValue: string,
  nextValue: string,
): boolean {
  let prefix = 0;
  const maxPrefix = Math.min(currentValue.length, nextValue.length);
  while (prefix < maxPrefix && currentValue[prefix] === nextValue[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (
    suffix < maxSuffix &&
    currentValue[currentValue.length - 1 - suffix] === nextValue[nextValue.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  // Autocomplete often preserves the text already typed: `$pinch` becoming
  // `$pinchtab ` has a minimal changed span of only `tab `. Reparse the whole
  // token in that case so the Markdown tokenizer can promote it to an atom.
  const changedEnd = nextValue.length - suffix;
  const completedToken = collectComposerInlineTokens(nextValue).find(
    (token) => token.start <= prefix && token.start < changedEnd && token.end >= prefix,
  );
  if (completedToken) prefix = completedToken.start;

  const inserted = nextValue.slice(prefix, nextValue.length - suffix);
  // Block-level syntax changes the document's shape, which a span replacement
  // cannot express.
  if (/[\n#>|]/.test(inserted)) return false;

  const from = tiptapComposerPositionForExpandedCursor(editor, prefix);
  const to = tiptapComposerPositionForExpandedCursor(editor, currentValue.length - suffix);
  if (from > to) return false;

  const $from = editor.state.doc.resolve(from);
  const $to = editor.state.doc.resolve(to);
  // A range spanning blocks, or landing in code, is not a simple substitution.
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return false;

  // The inserted span still goes through the parser, so an autocompleted file
  // link becomes a chip; only the untouched text either side is spared.
  const transaction = editor.state.tr;
  if (inserted) {
    const parsed = editor.markdown?.parse(inserted);
    const inline = parsedInlineContent(parsed);
    if (!inline) return false;
    transaction.replaceWith(from, to, Fragment.fromJSON(editor.state.schema, inline));
  } else {
    transaction.delete(from, to);
  }
  transaction.setMeta("addToHistory", false);
  editor.view.dispatch(transaction);

  // The splice is only correct if it actually reproduced the requested value.
  if (getTiptapComposerMarkdown(editor) === nextValue) return true;
  editor.commands.setContent(nextValue, { contentType: "markdown", emitUpdate: false });
  return true;
}

function insertComposerHardBreak(view: EditorView): boolean {
  const hardBreak = view.state.schema.nodes.hardBreak;
  if (!hardBreak) return false;
  view.dispatch(view.state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
  return true;
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
  const emitDebugSnapshot = useEffectEvent((snapshot: ComposerEditorDebugSnapshot) => {
    props.onDebugSnapshotChange?.(snapshot);
  });
  const commandKeyDown = useEffectEvent(
    (
      key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
      event: KeyboardEvent,
      intent?: "default" | "menu-only" | "submit",
    ) => props.onCommandKeyDown?.(key, event, intent) ?? false,
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
    // The trigger runs on the flat prompt text, where a fence's first line and
    // a paragraph look alike, so it would offer commands for a `/` that is
    // simply code. The editor is the only place that still knows the caret is
    // inside a code block.
    const insideCodeBlock = editor.state.selection.$from.parent.type.spec.code === true;
    emitChange(
      snapshot.value,
      snapshot.cursor,
      snapshot.expandedCursor,
      adjacentToToken || insideCodeBlock,
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
        // Tab indents inside a fence, where there is no other way to type one:
        // the browser would move focus out of the editor instead. The command
        // menu gets first refusal so picking a file with Tab still works when
        // the menu is open over a code block.
        if (event.key === "Tab" && view.state.selection.$from.parent.type.spec.code === true) {
          if (commandKeyDown("Tab", event)) {
            event.preventDefault();
            event.stopPropagation();
            return true;
          }
          const indented = indentCodeBlock(
            view.state,
            event.shiftKey ? "out" : "in",
            (transaction) => view.dispatch(transaction),
          );
          if (indented) {
            event.preventDefault();
            event.stopPropagation();
          }
          return indented;
        }
        if (
          shouldConvertTiptapCodeFenceForEnter(event) &&
          convertTiptapCodeFenceOnEnter(view.state, (transaction) => view.dispatch(transaction))
        ) {
          event.preventDefault();
          return true;
        }
        // Match the standard chat-editor convention: Shift+Enter inserts a
        // soft line break inside the current paragraph. Plain Enter remains
        // the structural path for starting paragraphs and Markdown blocks.
        if (event.key === "Enter" && event.shiftKey && !event.metaKey && !event.ctrlKey) {
          const inCode = view.state.selection.$from.parent.type.spec.code === true;
          // In a fence every Enter is a newline: splitting it into two blocks is
          // never wanted, and reaching for a modifier while typing code is not
          // a reasonable ask.
          if (inCode) return false;
          const applied = insertComposerHardBreak(view);
          if (applied) {
            event.preventDefault();
            event.stopPropagation();
          }
          return applied;
        }
        // A plain Enter inside a fence carries the current line's indentation
        // onto the new line. Checked after Mod+Enter below would be too late,
        // so the modifier is excluded here rather than ordered around.
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          indentedNewlineInCodeBlock(view.state, (transaction) => view.dispatch(transaction))
        ) {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        // Structural Enter is contextual, so a list, quote or fence otherwise
        // has no keyboard route to send at all. Mod+Enter always submits, and
        // is checked before the guards below so it works from anywhere.
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          const submitted = commandKeyDown("Enter", event, "submit");
          if (submitted) {
            event.preventDefault();
            event.stopPropagation();
          }
          return submitted;
        }
        // Inside a list, quote or fence Enter belongs to the structure — but
        // the command menu still gets first refusal, so picking a file with
        // Enter works there too. `menuOnly` stops the parent falling through
        // to submitting once the menu declines.
        if (
          event.key === "Enter" &&
          (view.state.selection.$from.parent.type.name === "codeBlock" ||
            view.state.selection.$from.depth > 1)
        ) {
          const handledByMenu = commandKeyDown("Enter", event, "menu-only");
          if (handledByMenu) {
            event.preventDefault();
            event.stopPropagation();
          }
          return handledByMenu;
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
      refreshDebugSnapshot(createdEditor);
    },
    onUpdate({ editor: updatedEditor }) {
      // A paste or autocomplete can introduce a placeholder mid-edit.
      stampComposerTerminalContextIds(updatedEditor, terminalContextsRef.current);
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
    if (isControlledEcho) {
      // A new draft arrives as a props change with the prompt text unchanged,
      // so its placeholder still has to be matched to it.
      stampComposerTerminalContextIds(editor, props.terminalContexts);
      return;
    }
    if (currentValue !== props.value) {
      // Re-parsing the whole prompt rewrites text the change never touched:
      // `__init__` becomes `**init**`, a bare URL becomes a link. Autocomplete
      // edits one span and leaves the rest alone, so splice that span into the
      // live document and only fall back to a full parse when the edit is not a
      // simple substitution.
      if (!replaceChangedSpan(editor, currentValue, props.value)) {
        editor.commands.setContent(props.value, { contentType: "markdown", emitUpdate: false });
      }
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
    refreshDebugSnapshot(editor);
  }, [editor, props.cursor, props.terminalContexts, props.value, refreshDebugSnapshot]);

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
