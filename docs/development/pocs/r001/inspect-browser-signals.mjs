import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium as patchrightChromium } from "patchright";
import { chromium as playwrightChromium } from "playwright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const profileRoot = path.join(projectRoot, "data/pocs/r001/profiles");
await mkdir(profileRoot, { recursive: true });

async function inspect(name, chromium) {
  const context = await chromium.launchPersistentContext(path.join(profileRoot, `signal-${name}`), {
    channel: "chrome",
    headless: false,
    viewport: null,
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setContent("<!doctype html><title>local browser signal probe</title>");
    const signals = await page.evaluate(() => ({
      webdriver: navigator.webdriver,
      headlessUserAgent: navigator.userAgent.includes("HeadlessChrome"),
      chromeObjectPresent: typeof window.chrome === "object",
      pluginCount: navigator.plugins.length,
      languageCount: navigator.languages.length,
    }));
    return { runtime: name, mode: "headed-persistent-chrome", ...signals };
  } finally {
    await context.close();
  }
}

// WHY：只在空白本地页面比较原版 Playwright 与开源 Patchright，不为探针请求外部网站。
console.log(
  JSON.stringify(
    [
      await inspect("playwright", playwrightChromium),
      await inspect("patchright", patchrightChromium),
    ],
    null,
    2,
  ),
);
