import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vite-plus/test";
import ChatMarkdown from "./components/ChatMarkdown";

describe("composer file link markdown", () => {
  it("keeps markdown syntax in a filename as plain link text", () => {
    const markdown = serializeComposerFileLink("/custom/*draft* &amp;");
    const markup = renderToStaticMarkup(<ReactMarkdown>{markdown}</ReactMarkdown>);

    expect(markup).toContain('href="/custom/*draft*%20%26amp;"');
    expect(markup).toContain(">*draft* &amp;amp;</a>");
    expect(markup).not.toContain("<em>");
  });

  it("renders a chip when the label carries inline formatting", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdown text="[*data*](/custom/mount/data)" cwd="/repo" canonicalFileLinks />,
    );

    expect(markup).toContain("chat-markdown-file-link");
  });

  it("matches canonical labels using rendered character references", () => {
    const entityMarkup = renderToStaticMarkup(
      <ChatMarkdown text="[a&amp;b](/tmp/a%26b)" cwd="/repo" canonicalFileLinks />,
    );
    const escapedEntityMarkup = renderToStaticMarkup(
      <ChatMarkdown
        text={serializeComposerFileLink("/tmp/a&amp;b")}
        cwd="/repo"
        canonicalFileLinks
      />,
    );

    expect(entityMarkup).toContain("chat-markdown-file-link");
    expect(escapedEntityMarkup).toContain("chat-markdown-file-link");
  });

  it("does not promote route-shaped links in composer messages", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdown text="[settings](/chat/settings)" cwd="/repo" canonicalFileLinks />,
    );

    expect(markup).not.toContain("chat-markdown-file-link");
    expect(markup).toContain('href="/chat/settings"');
  });

  it("keeps pipes in filenames inside GFM table cells", () => {
    const markdown = `| File |\n| --- |\n| ${serializeComposerFileLink("/tmp/a|b")} |`;
    const markup = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>,
    );

    expect(markup).toContain('href="/tmp/a%7Cb"');
    expect(markup).toContain(">a|b</a>");
  });
});
