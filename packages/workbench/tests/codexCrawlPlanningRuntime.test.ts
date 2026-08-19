import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CaptureTask, CrawlPlanningRuntimeOutput } from "@domain-analysis/shared";
import { afterEach, describe, expect, it } from "vitest";

import { CodexAppServerError } from "../src/codexAppServerClient";
import { createCodexCrawlPlanningRuntime } from "../src/codexCrawlPlanningRuntime";

const temporaryRoots: string[] = [];
const runtimeClosers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(runtimeClosers.splice(0).map((close) => close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex 抓取规划运行时", () => {
  it("通过显式 Skill 和网页搜索交付 typed 计划候选", async () => {
    const runtime = createCodexCrawlPlanningRuntime({
      repositoryRoot: process.cwd(), model: "gpt-5.6-terra", reasoningEffort: "medium",
      executable: await fakeExecutable(true),
    });
    runtimeClosers.push(() => runtime.close?.() ?? Promise.resolve());

    const events = await collect(runtime.run({ task: task(), previousPlans: [] }));

    expect(events).toContainEqual({ type: "activity", activity: {
      id: "turn-lifecycle", kind: "agent", label: "启动抓取计划 Agent", status: "running",
    } });
    expect(events).toContainEqual(expect.objectContaining({
      type: "activity", activity: expect.objectContaining({ kind: "web_search", status: "completed" }),
    }));
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      output: { planCandidate: { sources: [{ key: "jd" }] } },
    });
  });

  it("没有真实 web_search item 时拒绝生成计划", async () => {
    const runtime = createCodexCrawlPlanningRuntime({
      repositoryRoot: process.cwd(), model: "gpt-5.6-terra", reasoningEffort: "medium",
      executable: await fakeExecutable(false),
    });
    runtimeClosers.push(() => runtime.close?.() ?? Promise.resolve());

    await expect(collect(runtime.run({ task: task(), previousPlans: [] }))).rejects.toMatchObject({
      code: "invalid_output",
      message: "抓取计划缺少本轮真实网页搜索记录，请重试。",
    } satisfies Partial<CodexAppServerError>);
  });
});

async function fakeExecutable(includeSearch: boolean) {
  const root = await mkdtemp(path.join(tmpdir(), "domain-analysis-fake-crawl-plan-"));
  temporaryRoots.push(root);
  const executable = path.join(root, "codex-fake.mjs");
  await writeFile(executable, fakeSource(includeSearch));
  await chmod(executable, 0o755);
  return executable;
}

function fakeSource(includeSearch: boolean) {
  const output = JSON.stringify(runtimeOutput());
  return `#!/usr/bin/env node
import { createInterface } from "node:readline";
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => void handle(JSON.parse(line)));
function handle(message) {
  if (message.method === "initialize") {
    emit({ id: message.id, result: { userAgent: "fake" } });
    return;
  }
  if (message.method === "thread/start") {
    if (message.params.ephemeral !== true || !String(message.params.cwd).endsWith("domain-analysis-crawl-planning")) process.exit(5);
    emit({ id: message.id, result: { thread: { id: "thread-1", ephemeral: true } } });
    emit({ method: "thread/started", params: {} });
    return;
  }
  if (message.method !== "turn/start") return;
  const prompt = message.params.input.find((item) => item.type === "text")?.text ?? "";
  const skill = message.params.input.find((item) => item.type === "skill");
  if (!prompt.includes("$plan-product-crawl") || !prompt.includes("Required task topics")) process.exit(6);
  if (skill?.name !== "plan-product-crawl" || !String(skill.path).endsWith(".agents/skills/plan-product-crawl/SKILL.md")) process.exit(7);
  emit({ id: message.id, result: { turn: { id: "turn-1" } } });
  emit({ method: "turn/started", params: {} });
  ${includeSearch ? `emit({ method: "item/started", params: { item: { id: "search-1", type: "webSearch", query: "京东 冰箱" } } });
  emit({ method: "item/completed", params: { item: { id: "search-1", type: "webSearch", query: "京东 冰箱", results: [{ url: "https://www.jd.com/" }] } } });` : ""}
  const finalItem = { id: "message-final", type: "agentMessage", text: ${JSON.stringify(output)}, phase: "final_answer" };
  emit({ method: "item/started", params: { item: { ...finalItem, text: "" } } });
  emit({ method: "item/completed", params: { item: finalItem } });
  emit({ method: "turn/completed", params: { turn: { status: "completed", error: null, items: [finalItem] } } });
}
`;
}

function runtimeOutput(): CrawlPlanningRuntimeOutput {
  return {
    assistantText: "已核对来源并形成计划。",
    planCandidate: {
      summary: "冰箱计划", excludedContent: [],
      sources: [{
        key: "jd", name: "京东", publisher: "京东", sourceKind: "retailer",
        role: "覆盖商品详情", entryUrls: ["https://www.jd.com/"],
        observationLevel: "search_discovered", accessState: "unknown",
        observedAt: "2026-08-19T00:00:00.000Z",
        targets: [{
          key: "products", name: "商品", taskTopics: ["品牌与型号"],
          captureUnit: "商品详情", rawFormats: ["HTML"],
          quantity: { mode: "target_count", targetCount: 100, unit: "个",
            denominator: "京东冰箱分类可见商品", rationale: "首批数据" },
          uniqueKey: "SKU", traversal: "分类列表", stopCondition: "100 个 SKU 或列表结束",
        }],
        executionBlockers: ["Provider 尚未验证"],
      }],
    },
  };
}

function task(): CaptureTask {
  const now = "2026-08-19T00:00:00.000Z";
  return {
    id: "task-1", name: "冰箱抓取任务", status: "ready", revision: 1,
    content: {
      originalRequest: "抓冰箱", category: { code: "refrigerator", label: "冰箱" },
      marketScope: "中国大陆", generalTopics: ["品牌与型号"], categoryTopics: [],
      jd: { applicable: true, disposition: "included", scope: ["product_details"], rationale: "核心平台" },
      sourceCandidates: [], excludedContent: [], unresolvedItems: [], decisionIds: [],
    },
    createdAt: now, updatedAt: now, confirmedAt: now,
  };
}

async function collect<T>(iterable: AsyncIterable<T>) {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
