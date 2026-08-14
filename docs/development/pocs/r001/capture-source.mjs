import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "patchright";

import { sourceDefinitions } from "./source-definitions.mjs";
import { sha256, writeImmutableJson } from "../lib/poc-artifact.mjs";

if (Number(process.versions.node.split(".")[0]) !== 22) {
  throw new Error("R-001 必须在 Node 22 下运行");
}

const sourceId = process.argv[2];
const source = sourceDefinitions[sourceId];
if (!source) throw new Error(`不支持的来源：${sourceId ?? "未提供"}`);
const captureRevision =
  sourceId === "public" ? "patchright-public-resume-v3" : "patchright-jd-v5";

const requestedIds = new Set(process.argv.slice(3));
const samples = requestedIds.size
  ? source.samples.filter(({ id }) => requestedIds.has(id))
  : source.samples;
if (!samples.length) throw new Error("没有匹配的样本");

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const localRoot = path.join(projectRoot, "data/pocs/r001");
process.env.CRAWLEE_STORAGE_DIR = path.join(localRoot, "crawlee-patchright");
process.env.CRAWLEE_PURGE_ON_START = "false";

const { PlaywrightCrawler, RequestQueue } = await import("crawlee");
const attemptId = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`;
const attemptDirectory =
  source.privacyClass === "restricted"
    ? "restricted-attempts-patchright"
    : "attempts-patchright";
const outputRoot = path.join(localRoot, attemptDirectory, attemptId);
const profileDir = path.join(localRoot, "profiles", source.profileName);
await Promise.all([mkdir(outputRoot, { recursive: true }), mkdir(profileDir, { recursive: true })]);

const queue = await RequestQueue.open(`r001-${source.profileName}-${captureRevision}`);
for (const { id, url, expectedText } of samples) {
  await queue.addRequest({
    url,
    uniqueKey: `r001:${source.profileName}:${captureRevision}:${id}`,
    userData: { id, expectedText },
  });
}

const results = [];
const crawler = new PlaywrightCrawler({
  requestQueue: queue,
  maxConcurrency: 1,
  maxRequestRetries: 0,
  maxRequestsPerCrawl: Number(process.env.R001_MAX_REQUESTS) || undefined,
  // WHY：官方统计会跨进程恢复；让统计 ID 与队列版本一致，避免旧 POC 的累计值消耗本轮限额。
  statisticsOptions: { id: `r001-${source.profileName}-${captureRevision}` },
  // WHY：Patchright 官方要求使用浏览器原生指纹，关闭 Crawlee 默认的 JS 指纹注入。
  browserPoolOptions: { useFingerprints: false },
  launchContext: {
    launcher: chromium,
    useChrome: true,
    userDataDir: profileDir,
    launchOptions: { headless: false, viewport: null },
  },
  async requestHandler({ page, request, response, infiniteScroll }) {
    const id = request.userData.id;
    const directory = path.join(outputRoot, id);
    await mkdir(directory);
    await page.waitForLoadState("domcontentloaded");
    await page
      .getByText(request.userData.expectedText, { exact: false })
      .first()
      .waitFor({ state: "attached", timeout: 15_000 })
      .catch(() => undefined);
    await prepareRenderedPage(sourceId, page, infiniteScroll);

    const [html, screenshot, title, body, resources] = await Promise.all([
      page.content(),
      page.screenshot({ fullPage: true }),
      page.title(),
      page.locator("body").innerText(),
      page.evaluate(() =>
        performance.getEntriesByType("resource").map(({ name, initiatorType }) => ({
          url: name,
          type: initiatorType,
        })),
      ),
    ]);
    const safeResources = resources.map(({ url, type }) => ({ url: redactUrl(url), type }));
    const resourcesJson = JSON.stringify(safeResources, null, 2);
    const finalUrl = redactUrl(page.url());
    const expectedTextPresent = body.includes(request.userData.expectedText);
    const metadata = {
      id,
      requestedUrl: request.url,
      finalUrl,
      status: response?.status() ?? null,
      title,
      state: classify(finalUrl, body, title, expectedTextPresent),
      expectedTextPresent,
      privacyClass: source.privacyClass,
      capturedAt: new Date().toISOString(),
      files: {
        html: sha256(html),
        text: sha256(body),
        screenshot: sha256(screenshot),
        resources: sha256(resourcesJson),
      },
      resourceCount: safeResources.length,
    };

    await Promise.all([
      writeFile(path.join(directory, "page.html"), html, { flag: "wx" }),
      writeFile(path.join(directory, "page.txt"), body, { flag: "wx" }),
      writeFile(path.join(directory, "page.png"), screenshot, { flag: "wx" }),
      writeFile(path.join(directory, "resources.json"), resourcesJson, { flag: "wx" }),
      writeImmutableJson(path.join(directory, "metadata.json"), metadata),
    ]);
    results.push(metadata);
  },
  async failedRequestHandler({ request }) {
    results.push({
      id: request.userData.id,
      requestedUrl: request.url,
      state: "request_failed",
      errors: request.errorMessages,
    });
  },
});

await crawler.run();
await writeImmutableJson(path.join(outputRoot, "run.json"), results);
console.log(JSON.stringify({ attemptId, results }, null, 2));

async function prepareRenderedPage(currentSourceId, page, infiniteScroll) {
  if (currentSourceId === "jd") {
    await page
      .getByRole("button", { name: "取消", exact: true })
      .click({ timeout: 2_000 })
      .catch(() => undefined);
  }

  // WHY：复用 Crawlee 的成熟滚动器触发页面懒加载，不自写滚动和等待循环。
  await infiniteScroll({ timeoutSecs: 30, waitForSecs: 3 });
}

function classify(url, body, title, expectedTextPresent) {
  const text = `${url}\n${title}\n${body}`;
  if (/pc-frequent-pro|频控页|当前页面异常/.test(text)) return "risk_controlled";
  if (/risk_handler|安全验证|验证码|京东验证/i.test(text)) return "challenge";
  if (/passport\.jd\.com\/.*login|欢迎登录|请登录/i.test(text)) return "login_required";
  if (/已下柜|商品已下架|商品不存在/.test(body)) return "discontinued";
  if (/登录后.{0,20}(查看|图片)/.test(body)) return "anonymous_limited";
  if (!expectedTextPresent) return "unexpected_page";
  return "loaded";
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}
