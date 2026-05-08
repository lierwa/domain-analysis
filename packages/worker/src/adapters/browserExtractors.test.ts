import { describe, expect, it } from "vitest";
import { extractRedditItemsFromHtml } from "./browser/redditBrowser";
import { extractXItemsFromHtml, isXLoginRequiredHtml, waitForXManualLogin } from "./browser/xBrowser";
import { extractYouTubeItemsFromHtml } from "./browser/youtubeBrowser";

describe("browser HTML extractors", () => {
  it("extracts Reddit search results from rendered HTML", () => {
    const html = `
      <article data-testid="post-container">
        <a data-testid="post-title" href="/r/perfume/comments/abc/woman_perfume/">Woman perfume discussion</a>
        <a href="/user/fragrant_user/">u/fragrant_user</a>
        <a href="/r/fragrance/">r/fragrance</a>
        <time datetime="2026-05-07T08:00:00.000Z"></time>
        <shreddit-score-number>42</shreddit-score-number>
        <span>13 comments</span>
      </article>
    `;

    const items = extractRedditItemsFromHtml(html, ["woman perfume"], []);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      platform: "reddit",
      url: "https://www.reddit.com/r/perfume/comments/abc/woman_perfume/",
      authorHandle: "fragrant_user",
      text: "Woman perfume discussion"
    });
    expect(items[0]?.metricsJson).toMatchObject({ score: 42, comments: 13, subreddit: "fragrance" });
  });

  it("extracts YouTube video results from rendered HTML", () => {
    const html = `
      <ytd-video-renderer>
        <a id="video-title" href="/watch?v=abc123" title="Best perfume review">Best perfume review</a>
        <a class="yt-simple-endpoint style-scope yt-formatted-string" href="/@channel">Perfume Channel</a>
        <span class="inline-metadata-item">12K views</span>
        <span class="inline-metadata-item">2 days ago</span>
        <yt-formatted-string id="description-text">Long lasting fragrance comparison</yt-formatted-string>
      </ytd-video-renderer>
    `;

    const items = extractYouTubeItemsFromHtml(html, ["perfume"], []);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      platform: "youtube",
      externalId: "abc123",
      authorName: "Perfume Channel",
      url: "https://www.youtube.com/watch?v=abc123"
    });
    expect(items[0]?.text).toContain("Best perfume review");
  });

  it("detects X login pages and extracts logged-in search results", () => {
    const loginHtml = `<main><span>Sign in to X</span></main>`;
    expect(isXLoginRequiredHtml(loginHtml)).toBe(true);

    const html = `
      <article data-testid="tweet">
        <div data-testid="User-Name"><span>Market Ops</span><span>@marketops</span></div>
        <div data-testid="tweetText">woman perfume market trend is rising</div>
        <a href="/marketops/status/12345"><time datetime="2026-05-07T09:00:00.000Z"></time></a>
        <div data-testid="reply">5</div>
        <div data-testid="retweet">8</div>
        <div data-testid="like">21</div>
      </article>
    `;

    const items = extractXItemsFromHtml(html, ["woman perfume"], []);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      platform: "x",
      externalId: "12345",
      authorHandle: "marketops",
      url: "https://x.com/marketops/status/12345"
    });
    expect(items[0]?.metricsJson).toMatchObject({ replies: 5, reposts: 8, likes: 21 });
  });

  it("waits for manual X login before continuing", async () => {
    const page = {
      htmlCalls: 0,
      currentUrl: "https://accounts.google.com/signin",
      url() {
        return this.currentUrl;
      },
      async content() {
        this.htmlCalls += 1;
        if (this.htmlCalls === 1) return `<main><span>Sign in to X</span></main>`;
        if (this.htmlCalls === 2) return `<main><span>Google sign in</span></main>`;
        this.currentUrl = "https://x.com/home";
        return `<main><div data-testid="primaryColumn">Home</div></main>`;
      },
      waitForTimeout: async () => undefined,
      goto: async (url: string) => {
        page.currentUrl = url;
      }
    };

    await expect(waitForXManualLogin(page, "https://x.com/search?q=test", 1_000)).resolves.toBe(true);
    expect(page.htmlCalls).toBe(3);
    expect(page.currentUrl).toBe("https://x.com/search?q=test");
  });
});
