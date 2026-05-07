import type { BrowserMode } from "../adapters/types";

export interface BrowserRuntimeConfig {
  mode: Exclude<BrowserMode, "none">;
  userDataDir?: string;
  allowChallengeAutomation: false;
}

export function createBrowserRuntimeConfig(env: NodeJS.ProcessEnv): BrowserRuntimeConfig {
  const mode = env.BROWSER_MODE === "local_profile" ? "local_profile" : "headless";
  const userDataDir = mode === "local_profile" ? env.BROWSER_USER_DATA_DIR : undefined;

  if (mode === "local_profile" && !userDataDir) {
    throw new Error("missing_BROWSER_USER_DATA_DIR");
  }

  return {
    mode,
    userDataDir,
    // WHY: 登录、验证码、二次验证必须由用户人工完成；系统只复用明确授权的本地 profile。
    allowChallengeAutomation: false
  };
}
