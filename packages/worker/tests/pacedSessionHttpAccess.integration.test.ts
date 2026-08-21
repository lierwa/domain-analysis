import { createServer, type Server } from "node:http";

import type { SourceAccessPolicy, SourceRequestAdmissionPort } from "@domain-analysis/shared";
import { chromium, type Browser } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";

import { createPacedSessionHttpAccess } from "../src/pacedSessionHttpAccess";
import { SourceAccessError } from "../src/sourceAccessError";

const describeBrowser = process.env.RUN_BROWSER_RATE_GATE === "1" ? describe : describe.skip;

describeBrowser("PacedSessionHttpAccess local fixture", () => {
  let fixture: Awaited<ReturnType<typeof openFixture>> | undefined;
  let browser: Browser | undefined;

  afterEach(async () => {
    await browser?.close();
    await fixture?.close();
    browser = undefined;
    fixture = undefined;
  });

  it("共享浏览器 Cookie，但只发显式 HTTP 请求且按实际时间戳冷却", async () => {
    fixture = await openFixture();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext();
    await context.addCookies([{ name: "fixture_session", value: "local-only", url: fixture.origin }]);
    const access = createAccess(context.request, fixture.origin, 4);

    const results = await Promise.all(["/one", "/two", "/three", "/four"]
      .map((path) => access.get(`${fixture!.origin}${path}`, work(path))));
    await access.onIdle();

    expect(results.every(({ requests }) => requests.length === 1)).toBe(true);
    expect(fixture.paths).toEqual(["/one", "/two", "/three", "/four"]);
    expect(fixture.cookies.every((value) => value.includes("fixture_session=local-only"))).toBe(true);
    for (let index = 1; index < fixture.timestamps.length; index += 1) {
      expect(fixture.timestamps[index]! - fixture.timestamps[index - 1]!).toBeGreaterThanOrEqual(18);
    }
    expect(fixture.timestamps[2]! - fixture.timestamps[1]!).toBeGreaterThanOrEqual(45);
  }, 20_000);

  it("重定向的每一跳重新进入预算，超限前不派发下一跳", async () => {
    fixture = await openFixture();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext();
    const access = createAccess(context.request, fixture.origin, 1);

    await expect(access.get(`${fixture.origin}/redirect`, work("/redirect")))
      .rejects.toMatchObject({ code: "source_abnormal" });
    await access.onIdle();

    expect(fixture.paths).toEqual(["/redirect"]);
  }, 20_000);

  it("未知 redirect origin 在第二跳出网前持久受限并停止", async () => {
    fixture = await openFixture();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext();
    const access = createAccess(context.request, fixture.origin, 2);

    await expect(access.get(`${fixture.origin}/unknown-redirect`, work("/unknown-redirect")))
      .rejects.toMatchObject({ code: "access_denied" });
    await expect(access.get(`${fixture.origin}/after-unknown`, work("/after-unknown"))).rejects.toBeDefined();
    expect(fixture.paths).toEqual(["/unknown-redirect"]);
  }, 20_000);

  it("首个 429 熔断并取消尚未派发的请求", async () => {
    fixture = await openFixture();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext();
    const access = createAccess(context.request, fixture.origin, 4);

    const results = await Promise.allSettled(["/limited", "/after-one", "/after-two"]
      .map((path) => access.get(`${fixture!.origin}${path}`, work(path))));
    await access.onIdle();
    await wait(80);

    expect(results.every(({ status }) => status === "rejected")).toBe(true);
    expect(fixture.paths).toEqual(["/limited"]);
    expect(access.state).toBe("open");
  }, 20_000);

  it("持久准入不可用时失败关闭且不产生服务端请求", async () => {
    fixture = await openFixture();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext();
    const admission = failingAdmission();
    const access = createPacedSessionHttpAccess(context.request, policy(), {
      maximumBytes: 1_000_000,
      requestTimeoutMs: 1_000,
      allowedOrigins: [fixture.origin],
      admission,
      runId: "run-1",
      gateKey: "fixture@1.0.0",
      providerKey: "fixture",
      providerVersion: "1.0.0",
      rateGateOptions: { rateWindowMs: 120, testOnlyAllowScaledMinute: true, random: () => 0 },
    });

    await expect(access.get(`${fixture.origin}/must-not-send`, work("/must-not-send")))
      .rejects.toThrow("持久请求准入不可用");
    await access.onIdle();
    expect(fixture.paths).toEqual([]);
  }, 20_000);

  it("HTTP 200 的 risk_handler 正文也在结果落账前熔断", async () => {
    fixture = await openFixture();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext();
    const access = createPacedSessionHttpAccess(context.request, policy(), {
      maximumBytes: 1_000_000, requestTimeoutMs: 1_000,
      allowedOrigins: [fixture.origin], admission: testAdmission(2),
      runId: "run-1", gateKey: "fixture@1.0.0", providerKey: "fixture", providerVersion: "1.0.0",
      responseRestriction: ({ body }) => body.includes("risk_handler")
        ? new SourceAccessError("verification_required", "fixture verification") : undefined,
      rateGateOptions: { rateWindowMs: 120, testOnlyAllowScaledMinute: true, random: () => 0 },
    });

    await expect(access.get(`${fixture.origin}/risk-body`, work("/risk-body")))
      .rejects.toMatchObject({ code: "verification_required" });
    await expect(access.get(`${fixture.origin}/after-risk`, work("/after-risk"))).rejects.toBeDefined();
    expect(fixture.paths).toEqual(["/risk-body"]);
  }, 20_000);
});

function failingAdmission(): SourceRequestAdmissionPort {
  return {
    async ensureCaptureWorkItem() { throw new Error("not used"); },
    async startCaptureWorkItem() { throw new Error("not used"); },
    async finishCaptureWorkItem() { throw new Error("not used"); },
    async reserveRequest() { throw new Error("database unavailable"); },
    async finishRequest() { throw new Error("not used"); },
    async getAccessGate() { return null; },
  };
}

function createAccess(request: Parameters<typeof createPacedSessionHttpAccess>[0], origin: string, requestBudget: number) {
  return createPacedSessionHttpAccess(request, policy(), {
    maximumBytes: 1_000_000,
    requestTimeoutMs: 1_000,
    allowedOrigins: [origin],
    admission: testAdmission(requestBudget),
    runId: "run-1",
    gateKey: "fixture@1.0.0",
    providerKey: "fixture",
    providerVersion: "1.0.0",
    rateGateOptions: { rateWindowMs: 120, testOnlyAllowScaledMinute: true, random: () => 0 },
  });
}

function testAdmission(requestBudget: number): SourceRequestAdmissionPort {
  let attemptCount = 0;
  const attempts = new Map<string, Awaited<ReturnType<SourceRequestAdmissionPort["finishRequest"]>>>();
  return {
    async ensureCaptureWorkItem() { throw new Error("not used"); },
    async startCaptureWorkItem() { throw new Error("not used"); },
    async finishCaptureWorkItem() { throw new Error("not used"); },
    async reserveRequest(input) {
      if (attemptCount >= requestBudget) {
        return { status: "blocked" as const, reason: "request_budget_exhausted", manualResumeRequired: false };
      }
      attemptCount += 1;
      const attempt = { id: `attempt-${attemptCount}`, runId: input.runId, targetKey: input.targetKey,
        workKey: input.workKey, gateKey: input.gateKey, requestedUrl: input.requestedUrl,
        origin: new URL(input.requestedUrl).origin, redirectParentAttemptId: input.redirectParentAttemptId,
        startedAt: new Date().toISOString(), state: "started" as const };
      attempts.set(attempt.id, attempt);
      return { status: "admitted" as const, attempt };
    },
    async finishRequest(input) {
      const attempt = attempts.get(input.attemptId);
      if (!attempt) throw new Error("attempt missing");
      const finished = { ...attempt, ...input, finishedAt: new Date().toISOString() };
      attempts.set(input.attemptId, finished);
      return finished;
    },
    async getAccessGate() { return null; },
  };
}

function work(path: string) {
  return { targetKey: "fixture", workKey: `fixture:${path}` };
}

function policy(): Extract<SourceAccessPolicy, { kind: "paced_http" }> {
  return {
    kind: "paced_http",
    version: "session-http-fixture-v1",
    maxRequestsPerMinute: 10,
    minimumIntervalMs: 20,
    jitterMs: { min: 0, max: 0 },
    batchSize: 2,
    batchCooldownMs: 50,
    maximumRunMs: 2_000,
  };
}

async function openFixture() {
  const timestamps: number[] = [];
  const paths: string[] = [];
  const cookies: string[] = [];
  const server = createServer((request, response) => {
    timestamps.push(Date.now());
    paths.push(request.url ?? "");
    cookies.push(request.headers.cookie ?? "");
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/after-redirect" }).end();
      return;
    }
    if (request.url === "/unknown-redirect") {
      response.writeHead(302, { location: "https://example.com/blocked" }).end();
      return;
    }
    if (request.url === "/limited") {
      response.writeHead(429).end("limited");
      return;
    }
    if (request.url === "/risk-body") {
      response.writeHead(200, { "content-type": "text/html" }).end("<div>risk_handler</div>");
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }).end(`<p>${request.url}</p>`);
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture 没有 TCP 地址");
  return { origin: `http://127.0.0.1:${address.port}`, timestamps, paths, cookies, close: () => close(server) };
}

function listen(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
