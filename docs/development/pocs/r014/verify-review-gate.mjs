import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeImmutableJson } from "../lib/poc-artifact.mjs";
import { codexOutputSchema } from "./candidate-schema.mjs";
import { createPublishManifest, detectExactConflicts } from "./review-gate.mjs";

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) await main();

async function main() {
  const projectRoot = path.resolve(path.dirname(scriptPath), "../../../..");
  const dataRoot = await realpath(path.join(projectRoot, "data/pocs/r014"));
  const candidatePath = await realpath(requireArgument(process.argv[2]));
  if (!candidatePath.startsWith(`${dataRoot}${path.sep}`)) throw new Error("候选路径越界");
  const candidateArtifact = JSON.parse(await readFile(candidatePath, "utf8"));
  const candidates = codexOutputSchema.parse(candidateArtifact.candidates);
  const fixture = JSON.parse(await readFile(new URL("./fixtures/conflict-case.json", import.meta.url), "utf8"));
  const controlledConflicts = detectExactConflicts(
    fixture.facts.map((fact) => ({ ...fact, subjectKey: fixture.subjectKey })),
  );
  let blockedReason = "";
  try {
    createPublishManifest(candidates, []);
  } catch (error) {
    blockedReason = error instanceof Error ? error.message : String(error);
  }
  if (!blockedReason.includes("未经审核，禁止发布")) throw new Error("真实候选未被发布门拦截");

  const attemptId = new Date().toISOString().replaceAll(":", "-");
  const outputRoot = path.join(dataRoot, "review-gate", attemptId);
  await mkdir(outputRoot, { recursive: true });
  const artifact = await writeImmutableJson(path.join(outputRoot, "verification.json"), {
    schemaVersion: "r014-review-gate-verification-v1",
    createdAt: new Date().toISOString(),
    candidateThreadId: candidateArtifact.threadId,
    controlledFixture: fixture.schemaVersion,
    controlledConflicts,
    realCandidatePublishBlocked: true,
    blockedReason,
  });
  console.log(JSON.stringify({ attemptId, conflicts: controlledConflicts.length, artifact }, null, 2));
}

function requireArgument(value) {
  if (!value) throw new Error("缺少 candidates.json 路径");
  return value;
}
