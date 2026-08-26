import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerSourceEditor, ComposerSourceToggle } from "./ComposerSourceView";

describe("ComposerSourceToggle", () => {
  it("advertises the shortcut and its pressed state when open", () => {
    const markup = renderToStaticMarkup(
      <ComposerSourceToggle open shortcutLabel="⌘/" onToggle={() => {}} />,
    );

    expect(markup).toContain('data-composer-source-toggle="open"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-label="Hide Markdown source"');
  });

  it("reads as closed and offers to show the source", () => {
    const markup = renderToStaticMarkup(
      <ComposerSourceToggle open={false} onToggle={() => {}} />,
    );

    expect(markup).toContain('data-composer-source-toggle="closed"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('aria-label="Show Markdown source"');
  });

  /** An unbound command has no label, which must not render as "(null)". */
  it("omits the shortcut when the command is unbound", () => {
    const markup = renderToStaticMarkup(
      <ComposerSourceToggle open={false} shortcutLabel={null} onToggle={() => {}} />,
    );

    expect(markup).not.toContain("null");
  });
});

describe("ComposerSourceEditor", () => {
  it("shows the prompt as raw monospace Markdown", () => {
    const markup = renderToStaticMarkup(
      <ComposerSourceEditor
        value={"Fix `__init__` in [notes.md](notes.md)"}
        placeholder="Markdown source"
        disabled={false}
        onChange={() => {}}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain('data-composer-source-editor="true"');
    expect(markup).toContain("font-mono");
    expect(markup).toContain('aria-label="Markdown source"');
    // The chip's Markdown is shown literally rather than rendered as a chip.
    expect(markup).toContain("[notes.md](notes.md)");
  });

  /**
   * A textarea keeps its rows height, so the growth is driven from JS. The
   * class still has to cap it, or a long prompt would push the footer away.
   */
  it("caps its height so a long prompt scrolls instead of growing forever", () => {
    const markup = renderToStaticMarkup(
      <ComposerSourceEditor
        value={"a\n".repeat(40)}
        placeholder="Markdown source"
        disabled={false}
        onChange={() => {}}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("max-h-50");
    expect(markup).toContain("overflow-y-auto");
    expect(markup).toContain("resize-none");
  });

  /**
   * Autocorrect and spellcheck fight raw Markdown, turning quotes into smart
   * quotes and underlining identifiers.
   */
  it("turns off the text corrections that would rewrite source", () => {
    const markup = renderToStaticMarkup(
      <ComposerSourceEditor
        value="x"
        placeholder="Markdown source"
        disabled={false}
        onChange={() => {}}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain('spellCheck="false"');
    expect(markup).toContain('autoCorrect="off"');
    expect(markup).toContain('autoCapitalize="off"');
  });
});
