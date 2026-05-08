import { describe, expect, it } from "vitest";
import { createBrowserCollectionAdapter, supportedBrowserPlatforms } from "./browserRegistry";

describe("browser adapter registry", () => {
  it("registers free browser crawlers for Reddit, YouTube, and X", () => {
    expect(supportedBrowserPlatforms).toEqual(["reddit", "youtube", "x"]);
    expect(createBrowserCollectionAdapter("reddit")).toBeTruthy();
    expect(createBrowserCollectionAdapter("youtube")).toBeTruthy();
    expect(createBrowserCollectionAdapter("x")).toBeTruthy();
  });

  it("rejects platforms that do not have a browser crawler yet", () => {
    expect(() => createBrowserCollectionAdapter("tiktok")).toThrow("unsupported_browser_platform_tiktok");
  });
});
