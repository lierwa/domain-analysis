import { describe, expect, it } from "vitest";
import { buildBingSearchUrl, extractReadableText, isBlockedPage } from "./web";

describe("web collection adapter helpers", () => {
  it("builds a free public search url from include and exclude keywords", () => {
    const url = buildBingSearchUrl(["tattoo design", "minimal tattoo"], ["jobs"]);

    expect(url.origin).toBe("https://www.bing.com");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe('"tattoo design" OR "minimal tattoo" -"jobs"');
  });

  it("extracts readable page text without script and style content", () => {
    const text = extractReadableText(`
      <html>
        <head><style>.hidden { display: none; }</style><script>window.x = 1;</script></head>
        <body>
          <h1>Tattoo design inspiration</h1>
          <p>Fine line tattoo examples and placement ideas.</p>
        </body>
      </html>
    `);

    expect(text).toContain("Tattoo design inspiration");
    expect(text).toContain("Fine line tattoo examples");
    expect(text).not.toContain("window.x");
    expect(text).not.toContain("display: none");
  });

  it("detects captcha and login interception pages", () => {
    expect(isBlockedPage("https://example.com/captcha", "Please complete captcha")).toBe(true);
    expect(isBlockedPage("https://example.com/article", "Sign in to continue")).toBe(true);
    expect(isBlockedPage("https://example.com/article", "Tattoo design inspiration")).toBe(false);
  });
});
