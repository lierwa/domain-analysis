import type { BrowserMode } from "../adapters/types";
import path from "node:path";

const DEFAULT_CRAWLER_USER_DATA_DIR = "storage/crawler-chrome-profile";
const RESERVED_APP_PROFILE_DIR = "storage/chrome-profile";

export interface BrowserRuntimeConfig {
  mode: Exclude<BrowserMode, "none">;
  userDataDir: string;
  allowChallengeAutomation: false;
}

export function createBrowserRuntimeConfig(env: NodeJS.ProcessEnv): BrowserRuntimeConfig {
  const mode = env.BROWSER_MODE === "headless" ? "headless" : "local_profile";
  const userDataDir = normalizeCrawlerUserDataDir(env.BROWSER_USER_DATA_DIR);

  return {
    mode,
    userDataDir,
    // WHY: 默认使用独立本地 profile，免费网页采集需要可见浏览器，但不能污染用户日常 Chrome。
    // TRADE-OFF: 首次运行会创建一个新 profile；如需复用登录状态，用户只在这个隔离窗口内手动登录。
    allowChallengeAutomation: false
  };
}

function normalizeCrawlerUserDataDir(userDataDir?: string) {
  if (!userDataDir) return DEFAULT_CRAWLER_USER_DATA_DIR;

  // WHY: `storage/chrome-profile` 是本地查看 UI 时常用的可见 Chrome profile；Playwright 的持久 profile
  // 不能被两个 Chrome 实例同时打开，否则采集浏览器会秒退。
  // TRADE-OFF: 如果用户确实想复用登录态，需要放到专用 crawler profile，避免和日常/调试窗口抢锁。
  if (isReservedAppProfileDir(userDataDir)) return DEFAULT_CRAWLER_USER_DATA_DIR;
  return userDataDir;
}

function isReservedAppProfileDir(userDataDir: string) {
  return path.resolve(userDataDir) === path.resolve(RESERVED_APP_PROFILE_DIR);
}
