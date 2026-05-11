import { describe, expect, it } from "vitest";
import { createBrowserRuntimeConfig } from "./browserRuntime";

describe("browser runtime config", () => {
  it("defaults to a visible local profile runtime without stealth behavior", () => {
    const config = createBrowserRuntimeConfig({});

    expect(config.mode).toBe("local_profile");
    expect(config.userDataDir).toContain("crawler-chrome-profile");
    expect(config.allowChallengeAutomation).toBe(false);
  });

  it("supports local profile mode when userDataDir is provided", () => {
    const config = createBrowserRuntimeConfig({
      BROWSER_MODE: "local_profile",
      BROWSER_USER_DATA_DIR: "/tmp/domain-analysis-browser"
    });

    expect(config.mode).toBe("local_profile");
    expect(config.userDataDir).toBe("/tmp/domain-analysis-browser");
  });

  it("keeps the app viewing profile separate from the crawler profile", () => {
    const config = createBrowserRuntimeConfig({
      BROWSER_USER_DATA_DIR: "storage/chrome-profile"
    });

    expect(config.userDataDir).toBe("storage/crawler-chrome-profile");
  });
});
