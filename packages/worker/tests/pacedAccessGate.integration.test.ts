import { createServer, type Server } from "node:http";

import type { SourceAccessPolicy } from "@domain-analysis/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createPacedAccessGate } from "../src/pacedAccessGate";
import { SourceAccessError } from "../src/sourceAccessError";

describe("PacedAccessGate local HTTP fixture", () => {
  let fixture: Awaited<ReturnType<typeof openFixture>> | undefined;

  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it("同时满足滑动窗口、同域间隔和批次冷却", async () => {
    fixture = await openFixture();
    const gate = createPacedAccessGate(policy({
      maxRequestsPerMinute: 3,
      minimumIntervalMs: 30,
      jitterMs: { min: 10, max: 10 },
      batchSize: 2,
      batchCooldownMs: 80,
    }), { rateWindowMs: 180, testOnlyAllowScaledMinute: true, random: () => 0 });

    await Promise.all(Array.from({ length: 5 }, (_, index) => gate.schedule(
      `request-${index}`,
      (signal) => fetch(`${fixture!.origin}/ok/${index}`, { signal }),
    )));
    await gate.onIdle();

    const starts = fixture.timestamps;
    expect(starts).toHaveLength(5);
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index]! - starts[index - 1]!).toBeGreaterThanOrEqual(35);
    }
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(70);
    expect(starts[4]! - starts[3]!).toBeGreaterThanOrEqual(70);
    for (const start of starts) {
      expect(starts.filter((candidate) => candidate >= start && candidate < start + 180).length)
        .toBeLessThanOrEqual(3);
    }
    expect(gate.state).toBe("idle");
  });

  it("第一次限流即打开熔断并终止全部待派发请求", async () => {
    fixture = await openFixture();
    const gate = createPacedAccessGate(policy(), {
      rateWindowMs: 200,
      testOnlyAllowScaledMinute: true,
      random: () => 0,
      shouldBreak: (error) => error instanceof SourceAccessError
        && error.code === "rate_limited",
    });
    const calls = ["limited", "ok/1", "ok/2", "ok/3"].map((path, index) => gate.schedule(
      `request-${index}`,
      async (signal) => {
        const response = await fetch(`${fixture!.origin}/${path}`, { signal });
        if (response.status === 429) throw new SourceAccessError("rate_limited", "fixture 429");
        return response;
      },
    ));

    const results = await Promise.allSettled(calls);
    await gate.onIdle();
    await wait(80);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(fixture.paths).toEqual(["/limited"]);
    expect(gate.state).toBe("open");
    expect(gate.queued).toBe(0);
    expect(gate.pending).toBe(0);
  });

  it("人工取消会中止在途请求并让排队任务全部结算", async () => {
    fixture = await openFixture();
    const gate = createPacedAccessGate(policy(), {
      rateWindowMs: 200,
      testOnlyAllowScaledMinute: true,
      random: () => 0,
    });
    const calls = ["slow", "ok/1", "ok/2"].map((path, index) => gate.schedule(
      `request-${index}`,
      (signal) => fetch(`${fixture!.origin}/${path}`, { signal }),
    ));
    await fixture.waitForCount(1);
    gate.cancel("fixture_manual_cancel");

    const results = await Promise.allSettled(calls);
    await gate.onIdle();
    await wait(80);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(fixture.paths).toEqual(["/slow"]);
    expect(gate.state).toBe("cancelled");
    expect(gate.queued).toBe(0);
    expect(gate.pending).toBe(0);
  });

  it("最长运行窗口到达时会中止在途请求", async () => {
    fixture = await openFixture();
    const gate = createPacedAccessGate(policy({ maximumRunMs: 60 }), {
      rateWindowMs: 200,
      testOnlyAllowScaledMinute: true,
      random: () => 0,
    });

    const result = await gate.schedule(
      "slow-request",
      (signal) => fetch(`${fixture!.origin}/slow`, { signal }),
    ).catch((error) => error);
    await gate.onIdle();
    await wait(80);

    expect(result).toBeInstanceOf(Error);
    expect(gate.state).toBe("expired");
    expect(fixture.paths).toEqual(["/slow"]);
    expect(gate.queued).toBe(0);
    expect(gate.pending).toBe(0);
  });
});

function policy(overrides: Partial<Extract<SourceAccessPolicy, { kind: "paced_http" }>> = {}) {
  return {
    kind: "paced_http" as const,
    version: "fixture-policy-v1",
    maxRequestsPerMinute: 10,
    minimumIntervalMs: 10,
    jitterMs: { min: 0, max: 0 },
    batchSize: 10,
    batchCooldownMs: 10,
    maximumRunMs: 2_000,
    ...overrides,
  };
}

async function openFixture() {
  const timestamps: number[] = [];
  const paths: string[] = [];
  let notify: (() => void) | undefined;
  const server = createServer((request, response) => {
    timestamps.push(Date.now());
    paths.push(request.url ?? "");
    notify?.();
    notify = undefined;
    if (request.url === "/limited") {
      response.writeHead(429).end("limited");
      return;
    }
    if (request.url === "/slow") {
      setTimeout(() => response.writeHead(200).end("slow"), 500);
      return;
    }
    response.writeHead(200).end("ok");
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture 没有 TCP 地址");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    timestamps,
    paths,
    waitForCount: async (count: number) => {
      while (paths.length < count) await new Promise<void>((resolve) => { notify = resolve; });
    },
    close: () => close(server),
  };
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
