import { describe, expect, it } from "vitest";
import { createBrowserLaunchContext } from "./browserCrawlerRuntime";

describe("browser crawler runtime", () => {
  it("uses native visible window sizing for local profile login", () => {
    const launchContext = createBrowserLaunchContext({
      browserMode: "local_profile",
      browserProfilePath: "/tmp/domain-browser-profile",
      maxItems: 5,
      maxScrolls: 1
    });

    expect(launchContext?.userDataDir).toBe("/tmp/domain-browser-profile");
    expect(launchContext?.launchOptions?.headless).toBe(false);
    expect(launchContext?.launchOptions?.viewport).toBeNull();
    expect(launchContext?.launchOptions?.args).toEqual(
      expect.arrayContaining(["--start-fullscreen", "--start-maximized", "--force-device-scale-factor=1"])
    );
  });

  it("keeps deterministic viewport for headless crawling", () => {
    const launchContext = createBrowserLaunchContext({
      browserMode: "headless",
      maxItems: 5,
      maxScrolls: 1
    });

    expect(launchContext?.userDataDir).toBeUndefined();
    expect(launchContext?.launchOptions?.headless).toBe(true);
    expect(launchContext?.launchOptions?.viewport).toEqual({ width: 1600, height: 1100 });
  });
});
