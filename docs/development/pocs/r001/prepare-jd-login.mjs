import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "patchright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const profileDir = path.join(projectRoot, "data/pocs/r001/profiles/jd");
await mkdir(profileDir, { recursive: true });

// WHY：只复用本机 Chrome 程序；账号、Cookie 和 Profile 留在 Git 忽略的专用目录。
const context = await chromium.launchPersistentContext(profileDir, {
  channel: "chrome",
  headless: false,
  viewport: null,
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto("https://passport.jd.com/new/login.aspx");

console.log("请在专用 Chrome 窗口完成京东登录，完成后直接关闭该窗口。");
await new Promise((resolve) => context.once("close", resolve));
