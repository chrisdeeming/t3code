# Composer coordinates and serialization

The draft store owns Markdown, while Tiptap owns the editing document. The rich-text
setting changes the installed extensions, so toggling it remounts the editor from the
stored draft. Plain mode must leave formatting markers literal. Rich mode preserves
whitespace and chip sources, but canonicalizes supported delimiters (`__` to `**`,
`_` to `*`) and checkbox case (`[X]` to `[x]`).

Store cursors are not ProseMirror positions: collapsed coordinates count a chip as one
character, expanded coordinates count its source text, and ProseMirror also counts
block boundaries. Keep conversion in [the document model](../../apps/web/src/composer-rich-text-doc.ts).
Empty paragraphs need real caret positions even though they contain no text. Markers
shown beside styled text are decorations, so offsets inside them clamp to the text edge.

Only replace editor content when the controlled text changes. Replacing it for a cursor
move creates undo entries and regenerates citation identities. Pending citation popovers
must wait until the requested draft has reached the editor before locating their chip.

Rich tasks split through native editor commands so marks and chips survive. Literal
lists use [store edits](../../apps/web/src/composer-list-continuation.ts). Newlines become
paragraph splits: trailing hard breaks otherwise appear to require two presses.
Programmatic moves must explicitly scroll the caret into view.

Clipboard text must come from the Markdown serializer, not DOM text: chip labels omit
the source and marker decorations are not content. Structured context records accompany
that text when available. Paste completes trailing chip delimiters and adds a leading
boundary when inserting a chip directly after text.

Fenced code blocks are real `codeBlock` nodes rather than literal text. They keep
their exact delimiters in attributes — `fence`, `language` and `close` — so a
fence round-trips byte-identically, including tilde fences, long fences and a
fence the user has not closed yet. Neither delimiter owns a document character,
so fence offsets clamp to the edge of the code the same way checkbox and style
markers do. The end of the code is the one place fences and inline marks differ:
the end of `**bold**` maps after its markers, but the end of a fence stays inside
the block, because its closing fence is a line of its own and "after it" would
move the caret to another line. The one normalization is an empty block written
with a blank line.

Fence delimiters are not marker decorations: the block is drawn as a block. Fence
runs carry `nodeName: "codeBlock"` and the marker plugin skips them. The node view
reuses the chat view's code block markup and class names so a draft looks like the
message it becomes; the shared rules in `index.css` are widened to both surfaces
rather than restated.

Enter reaches the fence before it reaches the send handler. Enter sends by
default, so checking the fence afterwards means a fence never opens and a
newline inside one sends the draft instead. Cmd/Ctrl+Enter still falls through
to send, which is the way out of a fence.

Fence editing lives in [composer-code-block](../../apps/web/src/composer-code-block.ts):
Enter keeps the current indent, Tab shifts whole lines, and two trailing blank
lines exit the block, which is the only way out of a fence at the end of a prompt.
Highlighting is Shiki decorations over the editable text, per block and cached by
content, so a keystroke re-tokenizes only the block that changed.
