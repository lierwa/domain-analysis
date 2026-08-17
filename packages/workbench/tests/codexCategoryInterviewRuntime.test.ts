import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { CategoryInterviewView } from "@domain-analysis/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createCodexCategoryInterviewRuntime } from "../src/codexCategoryInterviewRuntime";

describe.sequential("Codex category interview runtime", () => {
  let temporaryRoot: string | undefined;
  const previousSessionDir = process.env.DOMAIN_ANALYSIS_FAKE_SESSION_DIR;
  const previousSearchEvidence = process.env.DOMAIN_ANALYSIS_FAKE_SEARCH_EVIDENCE;

  afterEach(async () => {
    if (previousSessionDir === undefined) delete process.env.DOMAIN_ANALYSIS_FAKE_SESSION_DIR;
    else process.env.DOMAIN_ANALYSIS_FAKE_SESSION_DIR = previousSessionDir;
    if (previousSearchEvidence === undefined) delete process.env.DOMAIN_ANALYSIS_FAKE_SEARCH_EVIDENCE;
    else process.env.DOMAIN_ANALYSIS_FAKE_SEARCH_EVIDENCE = previousSearchEvidence;
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  });

  it("runs Codex ephemerally without creating a global Session rollout", async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), "domain-analysis-codex-runtime-"));
    const fakeSessionDir = path.join(temporaryRoot, "sessions");
    const executable = path.join(temporaryRoot, "fake-codex.mjs");
    process.env.DOMAIN_ANALYSIS_FAKE_SESSION_DIR = fakeSessionDir;
    await writeFakeCodex(executable);

    const runtime = createCodexCategoryInterviewRuntime({
      repositoryRoot: path.resolve("."),
      model: "gpt-test",
      reasoningEffort: "low",
      executable,
    });
    const events = [];
    for await (const event of runtime.run({
      session: interviewView(),
      trigger: { type: "user_message", text: "开启冰箱品类" },
    })) events.push(event);

    const sessionFiles = await readdir(fakeSessionDir).catch(() => []);
    expect(sessionFiles).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: "completed" }));
    expect(events).toContainEqual({
      type: "text_delta",
      delta: expect.stringContaining("这份知识资产首先服务哪类用户决策？"),
    });
  });

  it("kills an interrupted ephemeral turn without persisting a Session", async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), "domain-analysis-codex-runtime-"));
    const fakeSessionDir = path.join(temporaryRoot, "sessions");
    const executable = path.join(temporaryRoot, "fake-codex.mjs");
    process.env.DOMAIN_ANALYSIS_FAKE_SESSION_DIR = fakeSessionDir;
    await writeFakeCodex(executable);
    const controller = new AbortController();
    const runtime = createCodexCategoryInterviewRuntime({
      repositoryRoot: path.resolve("."),
      model: "gpt-test-slow",
      reasoningEffort: "low",
      executable,
    });

    const eventPromise = collectEvents(runtime.run({
      session: interviewView(),
      trigger: { type: "user_message", text: "开启冰箱品类" },
      signal: controller.signal,
    }));
    await delay(100);
    controller.abort();

    await expect(eventPromise).resolves.toEqual([{ type: "interrupted" }]);
    await expect(readdir(fakeSessionDir).catch(() => [])).resolves.toEqual([]);
  });

  it("requires an observed web search before accepting a sourced brief", async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), "domain-analysis-codex-runtime-"));
    const executable = path.join(temporaryRoot, "fake-codex.mjs");
    await writeFakeCodex(executable);
    const runtime = createCodexCategoryInterviewRuntime({
      repositoryRoot: path.resolve("."),
      model: "gpt-test",
      reasoningEffort: "low",
      executable,
    });

    await expect(collectEvents(runtime.run({
      session: interviewView(),
      trigger: { type: "user_message", text: "生成任务书" },
    }))).rejects.toThrow("未观察到 web_search item");

    process.env.DOMAIN_ANALYSIS_FAKE_SEARCH_EVIDENCE = "1";
    await expect(collectEvents(runtime.run({
      session: interviewView(),
      trigger: { type: "user_message", text: "生成任务书" },
    }))).resolves.toContainEqual(expect.objectContaining({ type: "completed" }));
  });
});

async function collectEvents<T>(events: AsyncIterable<T>) {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

async function writeFakeCodex(executable: string) {
  const source = `#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const sessionDir = process.env.DOMAIN_ANALYSIS_FAKE_SESSION_DIR;
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
if (!prompt.includes("$interview-product-category") || !prompt.includes("Workbench state:")) {
  process.exit(3);
}
if (!args.includes("--ephemeral") && sessionDir) {
  await mkdir(sessionDir, { recursive: true });
  await writeFile(path.join(sessionDir, "rollout-pollution.jsonl"), "persisted\\n");
}
const questionOutput = {
  assistantText: "建议先确认中国大陆家用市场范围。",
  question: {
    key: "research_objective",
    text: "这份知识资产首先服务哪类用户决策？",
    recommendation: "先服务中国大陆家庭选购决策",
    rationale: "这会决定市场范围和知识深度"
  },
  unresolvedItems: [],
  resolvedUnresolvedKeys: []
};
const briefOutput = ${JSON.stringify(briefRuntimeOutput())};
const output = prompt.includes("生成任务书") ? briefOutput : questionOutput;
const modelIndex = args.indexOf("--model");
if (args[modelIndex + 1] === "gpt-test-slow") {
  await new Promise((resolve) => setTimeout(resolve, 60_000));
}
const outputPathIndex = args.indexOf("--output-last-message");
if (outputPathIndex < 0) process.exit(2);
await writeFile(args[outputPathIndex + 1], JSON.stringify(output));
process.stdout.write(JSON.stringify({ type: "turn.started" }) + "\\n");
if (process.env.DOMAIN_ANALYSIS_FAKE_SEARCH_EVIDENCE === "1") {
  process.stdout.write(JSON.stringify({
    type: "item.completed",
    item: { type: "web_search", query: "冰箱 官方 型号 参数" }
  }) + "\\n");
}
process.stdout.write(JSON.stringify({
  type: "item.completed",
  item: { type: "agent_message", text: JSON.stringify(output) }
}) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\\n");
`;
  await writeFile(executable, source);
  await chmod(executable, 0o755);
}

function briefRuntimeOutput() {
  const observedAt = "2026-08-16T00:00:00.000Z";
  return {
    assistantText: "前置调查完成，可以确认任务书。",
    unresolvedItems: [],
    resolvedUnresolvedKeys: [],
    briefCandidate: {
      category: { code: "refrigerator", label: "冰箱", market: "CN" },
      objective: "建立冰箱品类研究任务书。",
      audience: "中国大陆家庭消费者",
      priorityScenarios: ["安装与储存适配"],
      excludedScope: ["商用冷链"],
      knowledgeNeeds: [{
        id: "need-installation",
        question: "冰箱是否适配家庭安装与储存需求？",
        knowledgeLayers: ["specification", "decision"],
        priority: "must",
      }],
      categoryFramework: {
        attributes: [{
          code: "total_volume",
          label: "总容积",
          description: "官方标示的总容积",
          knowledgeLayer: "specification",
          valueKind: "decimal",
          canonicalUnitCode: "L",
          externalMappings: [],
          filterable: true,
          comparable: true,
        }],
        decisionDimensions: [{
          code: "storage_fit",
          label: "储存适配",
          description: "按家庭需求判断储存能力",
          relatedAttributeCodes: ["total_volume"],
        }],
        competencyQuestions: ["该型号是否适合目标家庭？"],
      },
      targetPopulation: {
        populationLayers: ["official_current_catalog"],
        targets: [{
          key: "category-refrigerator",
          kind: "category",
          label: "中国大陆家用冰箱",
          disposition: "included",
          reason: "首版目标总体",
        }],
      },
      sourcePolicy: {
        authorityTypes: ["brand_official_site"],
        accessModes: ["public_web"],
        freshnessPolicy: "manual",
        stopConditions: ["login_required", "verification_required", "access_denied"],
      },
      collectionLanes: [{
        id: "official-web",
        sourceAuthorityType: "brand_official_site",
        accessMode: "public_web",
        targetKeys: ["category-refrigerator"],
        knowledgeLayers: ["identity", "specification"],
        refreshPolicy: "manual",
        stopConditions: ["login_required", "verification_required", "access_denied"],
      }],
      sourceAssignments: [{
        collectionLaneId: "official-web",
        factReferenceId: "fact-official-fridge",
        knowledgeNeedIds: ["need-installation"],
      }],
      acceptanceCriteria: ["每项结论引用可定位官方证据"],
      decisionIds: ["decision-confirmed"],
      factReferences: [{
        id: "fact-official-fridge",
        label: "品牌官方冰箱资料",
        url: "https://example.com/official-fridge",
        sourceAuthorityType: "brand_official_site",
        observedAt,
      }],
      investigatedFacts: [
        "brand", "model", "parameter", "component", "mechanism", "source_entrypoint",
      ].map((kind) => ({
        id: `investigated-${kind}`,
        kind,
        statement: `${kind} 前置调查事实`,
        factReferenceIds: ["fact-official-fridge"],
      })),
    },
  };
}

function interviewView(): CategoryInterviewView {
  return {
    session: {
      id: "interview-session-test",
      categoryHint: "冰箱",
      phase: "active",
      turnState: "running",
      revision: 2,
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    },
    messages: [{
      id: "interview-message-test",
      sessionId: "interview-session-test",
      sequence: 1,
      role: "user",
      text: "开启冰箱品类",
      deliveryStatus: "completed",
      createdAt: "2026-08-16T00:00:00.000Z",
    }],
    decisions: [],
    unresolvedItems: [],
    briefs: [],
  };
}
