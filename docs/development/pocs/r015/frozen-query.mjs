import assert from "node:assert/strict";

export const FULL_TEXT_LIMIT = 10;

export function assertFrozenQueries(result) {
  assert.equal(result.exact[0].model, "MR-457WUSPZE");
  assert.equal(result.alias[0].productId, "product:midea:mr-457wuspze");
  assert.equal(result.chinese[0].productId, "product:midea:mr-457wuspze");
  assert.equal(result.numeric[0].model, "BCD-505WGHTD14S8U1");
  assert.equal(result.evidence[0].evidenceId, "evidence:midea:manual:p10");
  assert.deepEqual(result.exceptions.map(({ state }) => state), ["conflict", "unknown"]);
  assert.equal(result.writeBlocked, true);
}
