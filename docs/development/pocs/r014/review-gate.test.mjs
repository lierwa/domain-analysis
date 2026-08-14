import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPublishManifest, detectExactConflicts } from "./review-gate.mjs";

const evidence = {
  sourceObjectId: "fixture:source-a",
  snapshotSha256: "a".repeat(64),
  locator: "fixture:row=1",
};

test("受控双值 fixture 生成待审核冲突", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/conflict-case.json", import.meta.url), "utf8"));
  const conflicts = detectExactConflicts(
    fixture.facts.map((fact) => ({ ...fact, subjectKey: fixture.subjectKey })),
  );
  assert.deepEqual(conflicts.map(({ conflictId, subjectKey, propertyKey, status }) => ({
    conflictId,
    subjectKey,
    propertyKey,
    status,
  })), [{
    conflictId: "X001",
    subjectKey: "TEST:PRODUCT-001",
    propertyKey: "spec.powerConsumption",
    status: "review_required",
  }]);
});

test("真实候选没有审核记录时禁止发布", () => {
  assert.throws(() => createPublishManifest(candidateOutput(), []), /未经审核，禁止发布：claim:C001/);
});

test("接受拒绝、冲突解决和 unknown 确认齐全后才生成发布清单", () => {
  const decidedAt = "2026-08-14T10:00:00.000Z";
  const common = { reviewer: "fixture-reviewer", decidedAt, reason: "受控审核 fixture" };
  const manifest = createPublishManifest(candidateOutput(), [
    { targetType: "claim", targetId: "C001", decision: "accept", ...common },
    { targetType: "claim", targetId: "C002", decision: "reject", ...common },
    { targetType: "conflict", targetId: "X001", decision: "resolve", selectedValue: "A", ...common },
    { targetType: "unknown", targetId: "U001", decision: "acknowledge", ...common },
  ]);
  assert.deepEqual({
    accepted: manifest.acceptedClaimIds,
    rejected: manifest.rejectedClaimIds,
    resolved: manifest.resolvedConflictIds,
    acknowledged: manifest.acknowledgedUnknownIds,
  }, { accepted: ["C001"], rejected: ["C002"], resolved: ["X001"], acknowledged: ["U001"] });
});

function candidateOutput() {
  const claim = (claimId) => ({
    claimId,
    knowledgeLayer: "specification",
    propertyKey: `spec.${claimId}`,
    value: claimId,
    meaning: "受控测试候选",
    evidence: [evidence],
    limitations: [],
    derivation: "codex",
    status: "review_required",
  });
  return {
    schemaVersion: "r014-codex-candidates-v2",
    subject: { manufacturer: "美的", model: "MR-457WUSPZE" },
    claims: [claim("C001"), claim("C002")],
    conflicts: [{
      conflictId: "X001",
      propertyKey: "spec.conflict",
      values: [{ value: "A", evidence: [evidence] }, { value: "B", evidence: [evidence] }],
      status: "review_required",
    }],
    unknowns: [{ unknownId: "U001", question: "未知项？", reason: "缺少证据", status: "unknown" }],
  };
}
