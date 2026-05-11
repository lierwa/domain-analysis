import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";

const DEFAULT_X_USER_DATA_DIR = "storage/x-login-profile";
let loginContext: BrowserContext | null = null;

export interface XLoginStatus {
  mode: string;
  profileDir: string;
  profileExists: boolean;
  browserOpen: boolean;
  loggedIn: boolean;
  message: string;
}

export function getXUserDataDir(env: NodeJS.ProcessEnv = process.env) {
  return env.X_BROWSER_USER_DATA_DIR || env.BROWSER_USER_DATA_DIR_X || DEFAULT_X_USER_DATA_DIR;
}

export async function openXLoginBrowser(env: NodeJS.ProcessEnv = process.env) {
  const context = await getOrCreateLoginContext(env);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://x.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  return getXLoginStatus(env);
}

export async function getXLoginStatus(env: NodeJS.ProcessEnv = process.env): Promise<XLoginStatus> {
  const profileDir = getXUserDataDir(env);
  const loggedIn = loginContext ? await hasXAuthCookie(loginContext) : false;
  const profileExists = fs.existsSync(profileDir);

  return {
    mode: getEffectiveXMode(env),
    profileDir: path.resolve(profileDir),
    profileExists,
    browserOpen: Boolean(loginContext),
    loggedIn,
    message: createStatusMessage({ loggedIn, profileExists, browserOpen: Boolean(loginContext) })
  };
}

function getEffectiveXMode(env: NodeJS.ProcessEnv) {
  const mode = env.X_COLLECTION_MODE || "browser_profile";
  if ((mode === "twscrape" || mode === "twikit") && !env.X_COLLECTOR_COMMAND) return "browser_profile";
  return mode;
}

export async function hasXAuthCookie(context: BrowserContext) {
  const cookies = await context.cookies(["https://x.com", "https://twitter.com"]);
  return cookies.some((cookie) => cookie.name === "auth_token" || cookie.name === "ct0");
}

async function getOrCreateLoginContext(env: NodeJS.ProcessEnv) {
  if (loginContext) return loginContext;
  const profileDir = getXUserDataDir(env);
  fs.mkdirSync(profileDir, { recursive: true });
  loginContext = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: false
  });
  loginContext.on("close", () => {
    loginContext = null;
  });
  return loginContext;
}

function createStatusMessage(input: { loggedIn: boolean; profileExists: boolean; browserOpen: boolean }) {
  if (input.loggedIn) return "X login cookie detected in the local browser profile.";
  if (input.browserOpen) return "Login browser is open. Finish X login there, then check status again.";
  if (input.profileExists) return "X browser profile exists, but login is not confirmed in this API process.";
  return "X login profile has not been created yet.";
}
