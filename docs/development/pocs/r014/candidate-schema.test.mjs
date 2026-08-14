import assert from "node:assert/strict";
import test from "node:test";

import { assertKnownEvidenceReferences, buildCodexJsonSchema } from "./candidate-schema.mjs";
import { assertNoBlockingErrorItems, buildPrimaryCandidateInput } from "./run-codex-candidates.mjs";

const reference = { sourceObjectId: "source-1", snapshotSha256: "a".repeat(64), locator: "page:1" };
const baseOutput = {
  claims: [{ evidence: [reference] }],
  conflicts: [],
};

test("Codex 只引用输入中存在的证据时通过", () => {
  assert.doesNotThrow(() => assertKnownEvidenceReferences(baseOutput, [reference]));
});

test("Codex 伪造证据定位时失败关闭", () => {
  const forged = structuredClone(baseOutput);
  forged.claims[0].evidence[0].locator = "page:99";
  assert.throws(() => assertKnownEvidenceReferences(forged, [reference]), /未知证据/);
});

test("Codex JSON Schema 不包含嵌套引用", () => {
  assert.doesNotMatch(JSON.stringify(buildCodexJsonSchema()), /\"\$ref\"/);
});

test("Codex 本轮含未知错误条目时拒收", () => {
  assert.throws(
    () => assertNoBlockingErrorItems([{ type: "error", message: "图片读取失败" }, { type: "agent_message" }]),
    /图片读取失败/,
  );
});

test("Codex 旧 connectors 配置警告只记录不阻断", () => {
  const message = "`[features].connectors` is deprecated. Use `[features].apps` instead.";
  assert.deepEqual(assertNoBlockingErrorItems([{ type: "error", message }]), [message]);
});

test("Codex 输入只包含主型号证据，不携带其他京东主体", () => {
  const source = {
    schemaVersion: "v3",
    modelKey: "MIDEA:MR-457WUSPZE",
    variants: [],
    evidence: [],
    comparison: {},
    marketplaceSubjects: [{ modelKey: "HAIER:BCD-505WGHTD14S8U1" }],
  };
  assert.deepEqual(buildPrimaryCandidateInput(source), {
    schemaVersion: "v3",
    modelKey: "MIDEA:MR-457WUSPZE",
    variants: [],
    evidence: [],
    comparison: {},
  });
});
