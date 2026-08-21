import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { crawlPlanningRuntimeOutputSchema, type CaptureTask,
  type CrawlPlanningRuntimeOutput } from "@domain-analysis/shared";
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
    expect(events).toContainEqual({ type: "text_delta", delta: "正在核实来源。" });
    expect(events).not.toContainEqual(expect.objectContaining({
      type: "text_delta", delta: expect.stringContaining("planCandidate"),
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

  it("现有校验失败时在同一个 thread 回填错误并只修正一次", async () => {
    const runtime = createCodexCrawlPlanningRuntime({
      repositoryRoot: process.cwd(), model: "gpt-5.6-terra", reasoningEffort: "medium",
      executable: await fakeExecutable(true),
    });
    runtimeClosers.push(() => runtime.close?.() ?? Promise.resolve());
    let validations = 0;

    const events = await collect(runtime.run({
      task: task(), previousPlans: [],
      validateOutput: async () => {
        validations += 1;
        if (validations === 1) throw new Error("抓取计划遗漏了任务中必须覆盖的京东来源");
      },
    }));

    expect(validations).toBe(2);
    expect(events).toContainEqual({
      type: "text_delta",
      delta: "第一次计划未通过现有校验，已回填错误并修正一次：抓取计划遗漏了任务中必须覆盖的京东来源",
    });
    expect(events.at(-1)).toMatchObject({ type: "completed" });
  });

  it("第二次仍未通过现有校验时直接失败，不继续增加重试", async () => {
    const runtime = createCodexCrawlPlanningRuntime({
      repositoryRoot: process.cwd(), model: "gpt-5.6-terra", reasoningEffort: "medium",
      executable: await fakeExecutable(true),
    });
    runtimeClosers.push(() => runtime.close?.() ?? Promise.resolve());
    let validations = 0;

    await expect(collect(runtime.run({
      task: task(), previousPlans: [],
      validateOutput: async () => {
        validations += 1;
        throw new Error("抓取计划遗漏了任务中必须覆盖的京东来源");
      },
    }))).rejects.toThrow("抓取计划遗漏了任务中必须覆盖的京东来源");
    expect(validations).toBe(2);
  });

  it("把 Crawl Planning 的独立单轮预算传给 App Server client", async () => {
    const runtime = createCodexCrawlPlanningRuntime({
      repositoryRoot: process.cwd(), model: "gpt-5.6-terra", reasoningEffort: "medium",
      executable: await fakeExecutable(true, 80), timeoutMs: 20,
    });
    runtimeClosers.push(() => runtime.close?.() ?? Promise.resolve());

    await expect(collect(runtime.run({ task: task(), previousPlans: [] }))).rejects.toMatchObject({
      code: "execution_failed", message: "Codex 本轮执行超时，本轮未保存，请重试。",
    } satisfies Partial<CodexAppServerError>);
  });

  it("把已确认的精确 PDF 候选收窄为原始 document 附件", async () => {
    const runtime = createCodexCrawlPlanningRuntime({
      repositoryRoot: process.cwd(), model: "gpt-5.6-terra", reasoningEffort: "medium",
      executable: await fakeExecutable(true, 0, pdfAsHtmlOutput()),
    });
    runtimeClosers.push(() => runtime.close?.() ?? Promise.resolve());

    const events = await collect(runtime.run({ task: pdfTask(), previousPlans: [] }));
    const completed = events.at(-1);

    expect(completed?.type).toBe("completed");
    if (completed?.type !== "completed") throw new Error("测试没有收到完成事件");
    const [pdfSource] = completed.output.planCandidate.sources;
    expect(pdfSource).toMatchObject({
      rawOutputPolicy: { formats: expect.arrayContaining(["document"]), retainAssets: true },
    });
    expect(pdfSource?.targets).toEqual([expect.objectContaining({ key: "energy-rule-pdf", rawFormats: ["document"] })]);
  });
});

async function fakeExecutable(includeSearch: boolean, delayMs = 0, output = runtimeOutput()) {
  const root = await mkdtemp(path.join(tmpdir(), "domain-analysis-fake-crawl-plan-"));
  temporaryRoots.push(root);
  const executable = path.join(root, "codex-fake.mjs");
  await writeFile(executable, fakeSource(includeSearch, delayMs, output));
  await chmod(executable, 0o755);
  return executable;
}

function fakeSource(includeSearch: boolean, delayMs: number, runtimeResult: CrawlPlanningRuntimeOutput) {
  const output = JSON.stringify(runtimeResult);
  return `#!/usr/bin/env node
import { createInterface } from "node:readline";
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const lines = createInterface({ input: process.stdin });
let threadCount = 0;
let turnCount = 0;
lines.on("line", (line) => void handle(JSON.parse(line)));
async function handle(message) {
  if (message.method === "initialize") {
    emit({ id: message.id, result: { userAgent: "fake" } });
    return;
  }
  if (message.method === "thread/start") {
    threadCount += 1;
    if (threadCount !== 1) process.exit(13);
    if (message.params.ephemeral !== true || !String(message.params.cwd).endsWith("domain-analysis-crawl-planning")) process.exit(5);
    emit({ id: message.id, result: { thread: { id: "thread-1", ephemeral: true } } });
    emit({ method: "thread/started", params: {} });
    return;
  }
  if (message.method === "turn/interrupt") {
    emit({ id: message.id, result: {} });
    emit({ method: "turn/completed", params: { turn: { status: "interrupted", error: null, items: [] } } });
    return;
  }
  if (message.method !== "turn/start") return;
  turnCount += 1;
  if (turnCount > 2 || message.params.threadId !== "thread-1") process.exit(14);
  const prompt = message.params.input.find((item) => item.type === "text")?.text ?? "";
  const skill = message.params.input.find((item) => item.type === "skill");
  if (turnCount === 1 && (!prompt.includes("$plan-product-crawl") || !prompt.includes("Required task topics") || !prompt.includes("严禁 provider_missing") || !prompt.includes("Candidate execution checklist") || !prompt.includes("requiredProvider") || !prompt.includes("generic JD search/root snapshot does not satisfy JD product coverage") || !prompt.includes("search.jd.com is public.web-resource") || !prompt.includes("Every exact public target configuration url MUST appear in that same source.entryUrls") || !prompt.includes("Topic coverage checklist") || !prompt.includes("Provider binding checklist") || !prompt.includes("never represent a PDF URL as an HTML target") || !prompt.includes("Final answer local validation JSON Schema"))) process.exit(6);
  if (turnCount === 2 && !prompt.includes("现有校验错误：")) process.exit(15);
  if (message.params.outputSchema?.type !== "object" || !message.params.outputSchema?.properties?.planCandidate) process.exit(8);
  const normalizedSkillPath = String(skill?.path).replaceAll("\\\\", "/");
  if (skill?.name !== "plan-product-crawl" || !normalizedSkillPath.endsWith(".agents/skills/plan-product-crawl/SKILL.md")) process.exit(7);
  emit({ id: message.id, result: { turn: { id: "turn-" + turnCount } } });
  emit({ method: "turn/started", params: {} });
  ${includeSearch ? `emit({ method: "item/started", params: { item: { id: "search-1", type: "webSearch", query: "京东 冰箱" } } });
  emit({ method: "item/completed", params: { item: { id: "search-1", type: "webSearch", query: "京东 冰箱", results: [{ url: "https://www.jd.com/" }] } } });` : ""}
  const commentaryText = JSON.stringify({ assistantText: "正在核实来源。", planCandidate: { summary: "处理中", sources: [], excludedContent: [], executionChecklistVersion: 2 } });
  const commentaryItem = { id: "message-commentary", type: "agentMessage", text: commentaryText, phase: "commentary" };
  emit({ method: "item/started", params: { item: { ...commentaryItem, text: "" } } });
  emit({ method: "item/agentMessage/delta", params: { itemId: "message-commentary", delta: commentaryText.slice(0, 37) } });
  emit({ method: "item/agentMessage/delta", params: { itemId: "message-commentary", delta: commentaryText.slice(37) } });
  emit({ method: "item/completed", params: { item: commentaryItem } });
  await pause(${delayMs});
  const finalItem = { id: "message-final", type: "agentMessage", text: ${JSON.stringify(output)}, phase: "final_answer" };
  emit({ method: "item/started", params: { item: { ...finalItem, text: "" } } });
  emit({ method: "item/completed", params: { item: finalItem } });
  emit({ method: "turn/completed", params: { turn: { status: "completed", error: null, items: [finalItem] } } });
}
`;
}

function runtimeOutput(): CrawlPlanningRuntimeOutput {
  return crawlPlanningRuntimeOutputSchema.parse({
    assistantText: "已核对来源并形成计划。",
    planCandidate: {
      executionChecklistVersion: 2,
      summary: "冰箱计划", excludedContent: [],
      sources: [{
        key: "jd", name: "京东", publisher: "京东", sourceKind: "retailer",
        sourceCandidateIds: [],
        role: "覆盖商品详情", entryUrls: ["https://www.jd.com/"],
        provider: { key: "jd.catalog-product", version: "2.0.0", configuration: [
          { key: "mode", value: "explicit_http" }, { key: "include_text", value: "冰箱" }, { key: "exclude_text", value: "二手|冷柜|冰吧" },
        ] },
        accessPolicy: { kind: "paced_http", version: "jd-explicit-http-v2", maxRequestsPerMinute: 1, minimumIntervalMs: 60_000, maximumRunMs: 3_600_000 },
        stopPolicy: { requestBudget: 12, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
        rawOutputPolicy: { formats: ["html", "source_json"], retainAssets: false },
        observationLevel: "search_discovered", accessState: "unknown",
        observedAt: "2026-08-19T00:00:00.000Z",
        targets: [runtimeTarget("catalog_pages"), runtimeTarget("store_catalogs"),
          runtimeTarget("product_details"), runtimeTarget("review_summaries"),
          runtimeTarget("review_samples")],
        executionBlockers: [],
      }],
    },
  });
}

function runtimeTarget(operation: "catalog_pages" | "store_catalogs" | "product_details"
  | "review_summaries" | "review_samples") {
  const review = operation === "review_summaries" || operation === "review_samples";
  return {
    key: operation, name: operation, taskTopics: ["品牌与型号"],
    providerConfiguration: operation === "review_samples"
      ? [{ key: "operation" as const, value: operation }, { key: "samples_per_product" as const, value: 100 as const }]
      : [{ key: "operation" as const, value: operation }],
    captureUnit: "源站响应", rawFormats: review ? ["source_json" as const] : ["html" as const],
    quantity: { mode: "all_available" as const, unit: "份",
      denominator: "动态发现工作项", rationale: "逐工作项严格对账" },
    uniqueKey: "规范化 GET URL", traversal: "只从已保存前序响应发现",
    stopCondition: "全部工作完成或首次受限",
  };
}

function pdfAsHtmlOutput(): CrawlPlanningRuntimeOutput {
  const entryUrl = "https://example.com/tv-energy-rule.pdf";
  return crawlPlanningRuntimeOutputSchema.parse({
    assistantText: "已核对规则原文入口。",
    planCandidate: {
      executionChecklistVersion: 2, summary: "电视能效规则原文", excludedContent: [],
      sources: [{
        key: "energy-rule", name: "平板电视能源效率标识实施规则", publisher: "监管机构",
        sourceKind: "regulator", sourceCandidateIds: ["candidate-energy-rule"],
        role: "保留监管规则原文", entryUrls: [entryUrl],
        provider: { key: "public.web-resource", version: "1.0.0", configuration: [
          { key: "mode", value: "exact_https" }, { key: "maximum_bytes", value: 5_000_000 },
        ] },
        accessPolicy: { kind: "paced_http", version: "public-web-resource-low-frequency-v1",
          maxRequestsPerMinute: 2, minimumIntervalMs: 30_000, maximumRunMs: 120_000 },
        stopPolicy: { requestBudget: 2, noNewUniqueKeysLimit: 1, stopOnAccessRestriction: true },
        rawOutputPolicy: { formats: ["html"], retainAssets: false },
        observationLevel: "search_discovered", accessState: "unknown",
        observedAt: "2026-08-19T00:00:00.000Z", executionBlockers: [],
        targets: [{
          key: "energy-rule-pdf", name: "规则 PDF", taskTopics: ["国家标准"],
          providerConfiguration: [{ key: "url", value: entryUrl }], captureUnit: "一份规则原文",
          rawFormats: ["html"], quantity: { mode: "target_count", targetCount: 1, unit: "份",
            denominator: "计划冻结的精确 PDF URL", rationale: "保留一份原始规则正文" },
          uniqueKey: "规范化 PDF URL", traversal: "只请求精确入口",
          stopCondition: "保存一份响应或遇访问限制",
        }],
      }],
    },
  });
}

function pdfTask(): CaptureTask {
  const value = task();
  value.content.generalTopics = ["国家标准"];
  value.content.sourceCandidates = [{
    id: "candidate-energy-rule", name: "平板电视能源效率标识实施规则", publisher: "监管机构",
    entryUrl: "https://example.com/tv-energy-rule.pdf", sourceKind: "regulator",
    expectedContents: ["PDF 正文"], observedFormats: ["PDF"], accessState: "public",
    observedAt: "2026-08-19T00:00:00.000Z",
  }];
  return value;
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
