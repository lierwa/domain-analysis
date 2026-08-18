import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createPacedAccessGate,
  createPlaywrightCdpJdPageReader,
  SourceAccessError,
  type JdPageObservation,
  type JdPageReader,
} from "@domain-analysis/worker";

const catalogUrl = "https://www.jd.com/brand/737a81dda3769f80aa8.html";
const endpointUrl = process.env.JD_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const reader = createPlaywrightCdpJdPageReader({
  endpointUrl,
  allowedOrigins: ["https://www.jd.com", "https://item.jd.com"],
});
const gate = createPacedAccessGate({
  kind: "paced_http",
  version: "jd-cdp-probe-v1",
  maxRequestsPerMinute: 2,
  minimumIntervalMs: 10_000,
  jitterMs: { min: 0, max: 0 },
  batchSize: 10,
  batchCooldownMs: 60_000,
  maximumRunMs: 3 * 60_000,
}, {
  random: () => 0,
  shouldBreak: (error) => error instanceof SourceAccessError,
});

const startedAt = new Date();
const catalog = await access(reader, catalogUrl, "catalog");
if (catalog.kind !== "catalog" || catalog.state !== "accessible") {
  throw new SourceAccessError("source_abnormal", `京东目录探针失败：${catalog.state}`);
}
const targets = catalog.cards.filter((card) => card.selfOperated).slice(0, 3);
if (targets.length !== 3) throw new SourceAccessError("source_abnormal", "京东目录没有三个自营商品样本");

const details = [];
for (const target of targets) {
  const detail = await access(reader, target.sourceUrl, "detail");
  if (detail.kind !== "detail" || detail.state !== "accessible") {
    throw new SourceAccessError("source_abnormal", `京东详情 ${target.sku} 探针失败：${detail.state}`);
  }
  details.push(detail);
}
await gate.onIdle();

const result = {
  schemaVersion: "jd-cdp-probe-v1",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  policy: {
    maxRequestsPerMinute: 2,
    minimumIntervalMs: 10_000,
    retries: 0,
  },
  catalog: {
    pageNumber: catalog.pageNumber,
    pageCount: catalog.pageCount,
    cardCount: catalog.cards.length,
    selfOperatedCount: catalog.cards.filter((card) => card.selfOperated).length,
  },
  details: details.map((detail) => ({
    sku: detail.sku,
    categoryPath: detail.categoryPath,
    parameterCount: Object.keys(detail.parameters).length,
    parameters: detail.parameters,
  })),
};
const outputDirectory = path.resolve("data/pocs/r035", startedAt.toISOString().replaceAll(":", "-"));
await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "probe.json");
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ outputPath, ...result }, null, 2));
// WHY：生产 API 需要保留 CDP 长连接；一次性探针则在完整结果落盘后主动结束，且绝不关闭用户 Chrome。
process.exit(0);

async function access(
  pageReader: JdPageReader,
  url: string,
  kind: "catalog" | "detail",
): Promise<JdPageObservation> {
  return gate.schedule(`${kind}:${url}`, async (signal) => {
    const observation = await pageReader(url, kind, signal);
    if (observation.state !== "accessible") {
      const code = observation.state === "not_found" ? "evidence_not_found" : observation.state;
      throw new SourceAccessError(code, `京东探针页面状态：${observation.state}`);
    }
    return observation;
  });
}
