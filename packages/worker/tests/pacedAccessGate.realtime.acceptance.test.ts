import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createPacedAccessGate } from "../src/pacedAccessGate";

const describeRealtime = process.env.RUN_REALTIME_RATE_GATE === "1"
  ? describe
  : describe.skip;

describeRealtime("PacedAccessGate 真实一分钟窗口验收", () => {
  let fixture: Awaited<ReturnType<typeof openFixture>> | undefined;

  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it("任意真实 60 秒窗口最多派发策略允许的请求数", async () => {
    fixture = await openFixture();
    const gate = createPacedAccessGate({
      kind: "paced_http",
      version: "realtime-acceptance-v1",
      maxRequestsPerMinute: 2,
      minimumIntervalMs: 10,
      jitterMs: { min: 0, max: 0 },
      batchSize: 100,
      batchCooldownMs: 10,
      maximumRunMs: 70_000,
    }, { random: () => 0 });

    await Promise.all(Array.from({ length: 3 }, (_, index) => gate.schedule(
      `request-${index}`,
      (signal) => fetch(`${fixture!.origin}/ok/${index}`, { signal }),
    )));
    await gate.onIdle();

    expect(fixture.timestamps).toHaveLength(3);
    expect(fixture.timestamps[2]! - fixture.timestamps[0]!).toBeGreaterThanOrEqual(60_000);
    for (const start of fixture.timestamps) {
      const count = fixture.timestamps.filter(
        (candidate) => candidate >= start && candidate < start + 60_000,
      ).length;
      expect(count).toBeLessThanOrEqual(2);
    }
  }, 75_000);
});

async function openFixture() {
  const timestamps: number[] = [];
  const server = createServer((_request, response) => {
    timestamps.push(Date.now());
    response.writeHead(200).end("ok");
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture 没有 TCP 地址");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    timestamps,
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
