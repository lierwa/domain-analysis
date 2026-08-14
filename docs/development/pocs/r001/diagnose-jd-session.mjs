import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "patchright";

import { sourceDefinitions } from "./source-definitions.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const profileDir = path.join(projectRoot, "data/pocs/r001/profiles/jd");
const targets = new Map([
  ["home", { url: "https://www.jd.com/", expectedText: "京东" }],
  ...sourceDefinitions.jd.samples.map(({ id, url, expectedText }) => [
    id,
    { url, expectedText },
  ]),
]);
const targetId = process.argv[2] ?? "home";
const target = targets.get(targetId);
if (!target) throw new Error(`不支持的诊断目标：${targetId}`);
const context = await chromium.launchPersistentContext(profileDir, {
  channel: "chrome",
  headless: false,
  viewport: null,
});

try {
  const page = context.pages()[0] ?? (await context.newPage());
  const response = await page.goto(target.url, { waitUntil: "domcontentloaded" });
  await page
    .getByText(target.expectedText, { exact: false })
    .first()
    .waitFor({ state: "attached", timeout: 10_000 })
    .catch(() => undefined);
  const body = await page.locator("body").innerText();
  const current = new URL(page.url());
  const title = await page.title();
  const abnormal = body.includes("当前页面异常") && body.includes("切换账号");
  const challenge = current.pathname.includes("/risk_handler/") || body.includes("京东验证");
  const loginRequired = current.hostname === "passport.jd.com";
  const riskControlled = current.hostname === "pc-frequent-pro.pf.jd.com" || title.includes("频控页");
  let state = "loaded";
  if (loginRequired) state = "login_required";
  if (challenge) state = "challenge";
  if (riskControlled) state = "risk_controlled";
  if (abnormal) state = "page_abnormal";
  const expectedTextPresent = body.includes(target.expectedText);
  if (state === "loaded" && !expectedTextPresent) state = "unexpected_page";

  // WHY：诊断输出只保留页面分类，避免 SSO 查询参数或认证材料进入日志。
  console.log(
    JSON.stringify({
      targetId,
      origin: current.origin,
      pathname: current.pathname,
      title,
      httpStatus: response?.status() ?? null,
      state,
      expectedTextPresent,
    }),
  );
  process.exitCode = state === "loaded" ? 0 : 2;
} finally {
  await context.close();
}
