import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { sourceDefinitions } from "../r001/source-definitions.mjs";
import { loadKnowledgePackage } from "../r015/package-fixture.mjs";
import { buildSqlitePackage, withSqliteRuntime } from "../r015/sqlite-candidate.mjs";

const manifestUrl = new URL("./baseline-manifest.json", import.meta.url);
const packageUrl = new URL("./tcl-65t7g-official-knowledge.json", import.meta.url);

test("电视只增加来源与品类数据，不修改通用采集、Schema、Runtime 或切换代码", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    const fileUrl = new URL(relativePath, manifestUrl);
    assert.equal(sha256(await readFile(fileUrl)), expectedHash, `${relativePath} 不再是冻结基线`);
    assert.doesNotMatch(await readFile(fileUrl, "utf8"), /television|65T7G|TCL/);
  }
  const sample = sourceDefinitions.public.samples.find(({ id }) => id === "S07");
  assert.deepEqual(sample, {
    id: "S07",
    url: "https://www.tcl.com/cn/zh/tvs/65-inch-t7g",
    expectedText: "65T7G",
  });
});

test("同一知识包 Schema 和 SQLite Runtime 覆盖电视五层知识与证据", async () => {
  const knowledgePackage = await loadKnowledgePackage(packageUrl);
  const directory = await mkdtemp(path.join(tmpdir(), "r016-television-"));
  const filePath = path.join(directory, "knowledge.sqlite");
  await buildSqlitePackage(knowledgePackage, filePath);
  const result = await withSqliteRuntime(filePath, async (runtime) => ({
    exact: await runtime.findProductByModel("65T7G"),
    search: await runtime.search("分区控光"),
    highRefresh: await runtime.filterNumericClaims({
      categoryCode: "television",
      propertyKey: "television.refresh_rate_hz",
      minNumericValue: 120,
      state: "published",
    }),
    claims: await runtime.getProductClaims("product:tcl:65t7g"),
    evidence: await runtime.getClaimEvidence("claim:tcl:65t7g:local-dimming"),
    exceptions: await runtime.listClaimsByStates(["unknown"]),
    writeBlocked: await runtime.verifyReadOnly(),
  }));

  assert.equal(result.exact[0].model, "65T7G");
  assert.equal(result.search[0].productId, "product:tcl:65t7g");
  assert.equal(result.highRefresh[0].numericValue, 144);
  assert.deepEqual(new Set(result.claims.map(({ knowledgeLayer }) => knowledgeLayer)),
    new Set(["identity", "specification", "function", "mechanism", "decision"]));
  assert.match(result.evidence[0].locator, /capture-text-sha256=/);
  assert.equal(result.exceptions[0].claimId, "claim:tcl:65t7g:source-model-anomaly");
  assert.equal(result.writeBlocked, true);
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
