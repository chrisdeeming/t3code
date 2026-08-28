# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

On web and desktop, **Settings → General → Beta features** includes an optional rich Markdown
composer. It formats headings, lists, quotes, and code fences while you type and highlights fenced
code. Drafts remain compatible with the standard composer, but switching editors may normalize
equivalent Markdown syntax, such as emphasis delimiters or backslash escapes. The mobile composer
continues to edit the same draft as plain text and does not currently render the rich editor.

When the rich composer is enabled, use the source button or `Cmd+/` on macOS and `Ctrl+/` on
Windows and Linux to edit its Markdown directly. Enter inserts a line break in source view;
`Cmd+Enter` or `Ctrl+Enter` sends. Terminal-context markers shown in source are tied to their
captured contexts: deleting one removes that context, and copied markers do not create contexts.

The **Enter key behavior** setting chooses whether Enter sends or inserts a new paragraph. In the
latter mode, use `Cmd+Enter` or `Ctrl+Enter` to send. Inside lists, quotes, and code fences, Enter
continues the current structure; the modifier shortcut sends from anywhere.

On servers that support direct uploads, images upload as soon as you add them. The send button
becomes available after every upload finishes. Failed uploads can be retried or removed.

On web and desktop, HEIC and HEIF photos are automatically converted to JPEG when you drag them into
the composer or paste them into a message.

## Commands and skills

Type `/` to open the command menu. Type `$` to find and add a skill. Skill rows show their source,
such as System, Personal, Project, or App.

By default, the `/` menu includes skills. To keep this menu command-only, turn off **Show skills in
slash menu** in **Settings → General**. Skill results use the `/skill:Skill Name` label and add the
same `$name` skill token to your message. The original skill name remains searchable. If the provider
also reports that skill as a native slash command, T3 Code hides the duplicate native entry and keeps
the `/skill:Skill Name` label.

On desktop, press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to
start it in the background. T3 Code opens another new thread and shows an **Open** action for the
thread that started. The new thread keeps the selected workspace mode and base branch. If **New
worktree** is selected, each background thread creates its own worktree.
