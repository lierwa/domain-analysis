import { PlaywrightCrawler, type PlaywrightCrawlerOptions } from "crawlee";
import type { BrowserCollectionContext } from "../adapters/types";
import { getDefaultBrowserProfilePath } from "../config";

export type BrowserCrawlerHandler = NonNullable<PlaywrightCrawlerOptions["requestHandler"]>;

const visibleBrowserArgs = [
  "--window-position=0,0",
  "--window-size=1920,1200",
  "--start-maximized",
  "--start-fullscreen",
  "--force-device-scale-factor=1"
];

export function createBrowserLaunchContext(context: BrowserCollectionContext): PlaywrightCrawlerOptions["launchContext"] {
  const launchContext: PlaywrightCrawlerOptions["launchContext"] = {
    launchOptions: {
      headless: context.browserMode === "headless",
      args:
        context.browserMode === "headless"
          ? ["--window-size=1600,1100"]
          : visibleBrowserArgs,
      viewport: context.browserMode === "headless" ? { width: 1600, height: 1100 } : null,
      screen: { width: 1920, height: 1200 }
    }
  };

  if (context.browserMode === "local_profile") {
    launchContext.userDataDir = context.browserProfilePath ?? getDefaultBrowserProfilePath();
  }

  return launchContext;
}

export class BrowserCrawlerRuntime {
  createCrawler(context: BrowserCollectionContext, requestHandler: BrowserCrawlerHandler) {
    // WHY: 免费浏览器采集优先稳定和可解释，不追求高频；单并发+少重试让失败能及时回写状态。
    return new PlaywrightCrawler({
      maxConcurrency: 1,
      maxRequestRetries: 1,
      requestHandlerTimeoutSecs: context.browserMode === "local_profile" ? 720 : 90,
      launchContext: createBrowserLaunchContext(context),
      requestHandler
    });
  }
}
