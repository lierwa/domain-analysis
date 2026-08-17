import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCodexKnowledgeCandidateModel } from "../src/codexKnowledgeCandidateModel";
import type { KnowledgeCandidateModelInput } from "../src/knowledgeFactoryModule";

describe("Codex batch knowledge candidate model", () => {
  let root: string | undefined;
  const previousTrace = process.env.DOMAIN_ANALYSIS_MODEL_TRACE;
  const previousInvalidEvidence = process.env.DOMAIN_ANALYSIS_MODEL_INVALID_EVIDENCE;

  afterEach(async () => {
    restoreEnvironment("DOMAIN_ANALYSIS_MODEL_TRACE", previousTrace);
    restoreEnvironment("DOMAIN_ANALYSIS_MODEL_INVALID_EVIDENCE", previousInvalidEvidence);
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("禁网、无 Session、空工作目录执行，并把原理拆成证据绑定候选", async () => {
    root = await mkdtemp(path.join(tmpdir(), "candidate-model-test-"));
    const executable = path.join(root, "fake-codex.mjs");
    const tracePath = path.join(root, "trace.json");
    process.env.DOMAIN_ANALYSIS_MODEL_TRACE = tracePath;
    await writeFakeCodex(executable);
    const model = createCodexKnowledgeCandidateModel({
      repositoryRoot: path.resolve("."),
      model: "gpt-5.3-codex-spark",
      reasoningEffort: "low",
      executable,
    });

    const candidates = await model.propose(modelInput());
    expect(candidates).toMatchObject([{
      knowledgeNeedId: "need:display-mechanism",
      subject: { key: "concept:light-modulation", kind: "foundational_concept" },
      predicate: "mechanism.light_modulation",
      value: { kind: "text" },
      evidenceIds: ["evidence:doe"],
      derivation: {
        kind: "model",
        modelId: "gpt-5.3-codex-spark",
        reasoningEffort: "low",
      },
      status: "review_required",
    }, {
      subject: { key: "category:television" },
      predicate: "uses.display_mechanism",
      value: {
        kind: "subject_ref",
        subject: { key: "concept:light-modulation", kind: "foundational_concept" },
      },
      evidenceIds: ["evidence:doe"],
    }]);
    const trace = JSON.parse(await readFile(tracePath, "utf8")) as { args: string[]; cwd: string };
    expect(trace.args).toContain("--ephemeral");
    expect(trace.args).toContain("--skip-git-repo-check");
    expect(trace.args).not.toContain("--search");
    await expect(stat(trace.cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("拒绝模型引用输入批次外证据", async () => {
    root = await mkdtemp(path.join(tmpdir(), "candidate-model-test-"));
    const executable = path.join(root, "fake-codex.mjs");
    process.env.DOMAIN_ANALYSIS_MODEL_TRACE = path.join(root, "trace.json");
    process.env.DOMAIN_ANALYSIS_MODEL_INVALID_EVIDENCE = "1";
    await writeFakeCodex(executable);
    const model = createCodexKnowledgeCandidateModel({
      repositoryRoot: path.resolve("."),
      model: "gpt-5.3-codex-spark",
      reasoningEffort: "low",
      executable,
    });

    await expect(model.propose(modelInput())).rejects.toThrow("批次外证据");
  });
});

function modelInput(): KnowledgeCandidateModelInput {
  return {
    projectId: "project:tv",
    categoryDefinitionVersionId: "definition:tv:v1",
    recipeVersion: "factory:model:v1",
    category: { code: "television", label: "电视" },
    materials: [{
      knowledgeNeedId: "need:display-mechanism",
      question: "显示面板如何形成图像？",
      knowledgeLayer: "mechanism",
      subjects: [
        { key: "category:television", kind: "category", label: "电视" },
        { key: "concept:light-modulation", kind: "foundational_concept", label: "光调制成像" },
      ],
      evidence: [{
        id: "evidence:doe",
        content: "背光经过液晶层调制后形成图像。",
        sourceIdentity: "doe-display-research",
        sourceAuthorityType: "government_research",
      }],
    }],
  };
}

async function writeFakeCodex(executable: string) {
  const source = `#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
if (args.includes("--search") || !args.includes("--ephemeral") || !prompt.includes("evidenceIds")) process.exit(7);
const output = {
  claims: [{
    knowledgeNeedId: "need:display-mechanism",
    subjectKey: "concept:light-modulation",
    predicate: "mechanism.light_modulation",
    value: { kind: "text", statement: "液晶显示通过液晶层调制背光形成图像。" },
    evidenceIds: [process.env.DOMAIN_ANALYSIS_MODEL_INVALID_EVIDENCE ? "evidence:invented" : "evidence:doe"],
    limitations: ["该证据只说明液晶显示路径。"]
  }, {
    knowledgeNeedId: "need:display-mechanism",
    subjectKey: "category:television",
    predicate: "uses.display_mechanism",
    value: { kind: "subject_ref", subjectKey: "concept:light-modulation" },
    evidenceIds: ["evidence:doe"],
    limitations: []
  }]
};
const outputIndex = args.indexOf("--output-last-message");
await writeFile(args[outputIndex + 1], JSON.stringify(output));
await writeFile(process.env.DOMAIN_ANALYSIS_MODEL_TRACE, JSON.stringify({ args, cwd: process.cwd() }));
process.stdout.write(JSON.stringify({ type: "turn.started" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\\n");
`;
  await writeFile(executable, source);
  await chmod(executable, 0o755);
}

function restoreEnvironment(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
