import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type BrowserContext } from "playwright";

const DEFAULT_X_USER_DATA_DIR = "storage/x-login-profile";
const DEFAULT_X_DEBUG_PORT = 9223;
const DEFAULT_X_DEBUG_WAIT_MS = 15000;
let loginContext: BrowserContext | null = null;
let manualLoginProcess: ChildProcess | null = null;

export class XChromeDevToolsUnavailableError extends Error {
  constructor() {
    super("Close the existing X login browser, then open it again so the dedicated Chrome profile starts with DevTools enabled.");
    this.name = "XChromeDevToolsUnavailableError";
  }
}

export interface XLoginStatus {
  mode: string;
  profileDir: string;
  profileExists: boolean;
  browserOpen: boolean;
  loggedIn: boolean;
  message: string;
}

export interface XCollectionContextLease {
  context: BrowserContext;
  release: () => Promise<void>;
}

export function getXUserDataDir(env: NodeJS.ProcessEnv = process.env) {
  return env.X_BROWSER_USER_DATA_DIR || env.BROWSER_USER_DATA_DIR_X || DEFAULT_X_USER_DATA_DIR;
}

export async function openXLoginBrowser(env: NodeJS.ProcessEnv = process.env) {
  if (loginContext) {
    await loginContext.close();
    loginContext = null;
  }

  await ensureXChromeRunning(env);
  const lease = await acquireXCollectionContext(env);
  try {
    await openXPage(lease.context, "https://x.com/login");
  } finally {
    await lease.release();
  }

  return getXLoginStatus(env);
}

export async function acquireXCollectionContext(env: NodeJS.ProcessEnv = process.env): Promise<XCollectionContextLease> {
  if (loginContext) {
    return { context: loginContext, release: async () => undefined };
  }

  await ensureXChromeRunning(env);
  const browser = await connectXChrome(env);
  const context = getDefaultContext(browser);
  return {
    context,
    release: async () => {
      await browser.close();
    }
  };
}

export async function getXLoginStatus(env: NodeJS.ProcessEnv = process.env): Promise<XLoginStatus> {
  const profileDir = getXUserDataDir(env);
  const profileExists = fs.existsSync(profileDir);
  const browserOpen = await isLoginBrowserOpen(env);
  const loggedIn = await resolveXLoggedIn({ env, profileExists, browserOpen });

  return {
    mode: getEffectiveXMode(env),
    profileDir: path.resolve(profileDir),
    profileExists,
    browserOpen,
    loggedIn,
    message: createStatusMessage({ loggedIn, profileExists, browserOpen })
  };
}

function getEffectiveXMode(env: NodeJS.ProcessEnv) {
  const mode = env.X_COLLECTION_MODE || "browser_profile";
  if ((mode === "twscrape" || mode === "twikit") && !env.X_COLLECTOR_COMMAND) return "browser_profile";
  return mode;
}

function getXDebugPort(env: NodeJS.ProcessEnv) {
  return Number(env.X_CHROME_DEBUG_PORT ?? DEFAULT_X_DEBUG_PORT);
}

function getXDebugEndpoint(env: NodeJS.ProcessEnv) {
  return `http://127.0.0.1:${getXDebugPort(env)}`;
}

function getXDebugWaitMs(env: NodeJS.ProcessEnv) {
  return Number(env.X_CHROME_DEBUG_WAIT_MS ?? DEFAULT_X_DEBUG_WAIT_MS);
}

export async function hasXAuthCookie(context: BrowserContext) {
  const cookies = await context.cookies(["https://x.com", "https://twitter.com"]);
  return cookies.some((cookie) => cookie.name === "auth_token" || cookie.name === "ct0");
}

function launchXPersistentContext(env: NodeJS.ProcessEnv, headless: boolean) {
  const profileDir = getXUserDataDir(env);
  fs.mkdirSync(profileDir, { recursive: true });

  // WHY: Playwright 官方建议用 persistent context 复用登录态；同一 userDataDir 不能并发打开。
  // TRADE-OFF: 采集与登录共用专用 X profile，但不复用用户日常 Chrome profile，减少锁冲突和状态污染。
  return chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless,
    args: getXChromeExtensionArgs(env)
  });
}

async function resolveXLoggedIn(input: { env: NodeJS.ProcessEnv; profileExists: boolean; browserOpen: boolean }) {
  if (loginContext) return hasXAuthCookie(loginContext);
  if (!input.profileExists) return false;
  if (input.browserOpen) {
    // WHY: Chrome 冷启动或 X 重页面加载时 CDP 会短暂阻塞；状态轮询不能因此变成 500。
    // TRADE-OFF: 忙碌窗口暂时按未确认登录展示，下一次轮询会重新确认 cookie。
    const browser = await connectXChrome(input.env).catch(() => null);
    if (!browser) return false;
    try {
      return await hasXAuthCookie(getDefaultContext(browser));
    } finally {
      await browser.close();
    }
  }

  const context = await launchXPersistentContext(input.env, true);
  try {
    return await hasXAuthCookie(context);
  } finally {
    await context.close();
  }
}

async function ensureXChromeRunning(env: NodeJS.ProcessEnv, startUrl = "about:blank") {
  if (await isXChromeCdpReady(env)) return;

  manualLoginProcess = openChromeWithXProfile(env, startUrl);
  manualLoginProcess.on("exit", () => {
    manualLoginProcess = null;
  });
  manualLoginProcess.on("error", () => {
    manualLoginProcess = null;
  });
  manualLoginProcess.unref();
  if (!(await waitForXChromeCdpReady(env))) throw new XChromeDevToolsUnavailableError();
}

async function connectXChrome(env: NodeJS.ProcessEnv) {
  try {
    return await chromium.connectOverCDP(await getXWebSocketEndpoint(env), { timeout: 30000 });
  } catch (error) {
    // WHY: 旧专用 Chrome 可能已经用带扩展参数启动，CDP 端口可用但 Playwright 无法接管。
    // TRADE-OFF: 不在后台强杀用户窗口，先返回可恢复错误，让用户关闭旧窗口后用新参数重开。
    throw Object.assign(new XChromeDevToolsUnavailableError(), { cause: error });
  }
}

async function getXWebSocketEndpoint(env: NodeJS.ProcessEnv) {
  const response = await fetch(`${getXDebugEndpoint(env)}/json/version`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new XChromeDevToolsUnavailableError();
  const payload = await response.json() as { webSocketDebuggerUrl?: string };
  if (!payload.webSocketDebuggerUrl) throw new XChromeDevToolsUnavailableError();
  return payload.webSocketDebuggerUrl;
}

function getDefaultContext(browser: Browser) {
  const context = browser.contexts()[0];
  if (!context) throw new Error("x_chrome_default_context_missing");
  return context;
}

async function openXPage(context: BrowserContext, url: string) {
  const page = context.pages().find((item) => item.url().startsWith("https://x.com/")) ?? await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
}

function openChromeWithXProfile(env: NodeJS.ProcessEnv, startUrl: string) {
  const profileDir = path.resolve(getXUserDataDir(env));
  fs.mkdirSync(profileDir, { recursive: true });
  const chromePath = resolveChromeExecutablePath(env);
  const debugPort = getXDebugPort(env);

  // WHY: Chrome 136+ 限制默认 profile 的远程调试；专用 profile 避免污染用户日常浏览器状态。
  // TRADE-OFF: 用户需要在独立窗口登录一次，但之后采集通过 CDP 复用同一个普通 Chrome 登录态。
  return spawn(chromePath, [
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debugPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
    ...getXChromeExtensionArgs(env),
    "--new-window",
    startUrl
  ], {
    detached: true,
    stdio: "ignore"
  });
}

function getXChromeExtensionArgs(env: NodeJS.ProcessEnv) {
  if (env.X_CHROME_ENABLE_EXTENSIONS === "1") return [];

  // WHY: Chrome 会把日常 profile 同步来的翻译、DevTools 等扩展带进专用 profile；
  // 这些扩展会注入 X/Reddit 这类重页面，实测可把 DOMContentLoaded 从约 2s 拉到 20s+。
  // TRADE-OFF: 默认牺牲扩展能力换稳定采集性能；确实依赖扩展代理时可显式设置 X_CHROME_ENABLE_EXTENSIONS=1。
  return ["--disable-extensions"];
}

function resolveChromeExecutablePath(env: NodeJS.ProcessEnv) {
  if (env.X_CHROME_EXECUTABLE_PATH) return env.X_CHROME_EXECUTABLE_PATH;
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform === "win32") return "chrome.exe";
  return "google-chrome";
}

async function isLoginBrowserOpen(env: NodeJS.ProcessEnv) {
  return Boolean(loginContext)
    || Boolean(manualLoginProcess && manualLoginProcess.exitCode === null && !manualLoginProcess.killed)
    || await isXChromeCdpReady(env);
}

async function isXChromeCdpReady(env: NodeJS.ProcessEnv) {
  try {
    const response = await fetch(`${getXDebugEndpoint(env)}/json/version`, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForXChromeCdpReady(env: NodeJS.ProcessEnv) {
  const deadline = Date.now() + getXDebugWaitMs(env);
  while (Date.now() < deadline) {
    if (await isXChromeCdpReady(env)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function createStatusMessage(input: { loggedIn: boolean; profileExists: boolean; browserOpen: boolean }) {
  if (input.loggedIn) return "X login cookie detected in the local browser profile.";
  if (input.browserOpen) return "Normal Chrome login browser is open. Complete X login there, then continue this run.";
  if (input.profileExists) return "X browser profile exists, but login is not confirmed in this API process.";
  return "X login profile has not been created yet.";
}
