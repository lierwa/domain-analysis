import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CaptureTask, CrawlPlan } from "@domain-analysis/shared";

export interface FakeScenario {
  outputs: unknown[][];
  missingSearchThreads?: number[];
  delayMs?: number;
}

export async function fakeExecutable(scenario: FakeScenario) {
  const root = await mkdtemp(path.join(tmpdir(), "domain-analysis-fake-staged-plan-"));
  const executable = path.join(root, "codex-fake.mjs");
  await writeFile(executable, fakeSource(scenario));
  await chmod(executable, 0o755);
  return { executable, root };
}

function fakeSource(scenario: FakeScenario) {
  return `#!/usr/bin/env node
import { createInterface } from "node:readline";
const outputs = ${JSON.stringify(scenario.outputs)};
const missingSearchThreads = new Set(${JSON.stringify(scenario.missingSearchThreads ?? [])});
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const lines = createInterface({ input: process.stdin });
const turns = new Map();
let threadCount = 0;
lines.on("line", (line) => void handle(JSON.parse(line)));
async function handle(message) {
  if (message.method === "initialize") {
    emit({ id: message.id, result: { userAgent: "fake" } });
    return;
  }
  if (message.method === "thread/start") {
    threadCount += 1;
    if (threadCount > outputs.length || message.params.ephemeral !== true) process.exit(11);
    emit({ id: message.id, result: { thread: { id: "thread-" + threadCount, ephemeral: true } } });
    emit({ method: "thread/started", params: {} });
    return;
  }
  if (message.method === "turn/interrupt") {
    emit({ id: message.id, result: {} });
    emit({ method: "turn/completed", params: { turn: { status: "interrupted", error: null, items: [] } } });
    return;
  }
  if (message.method !== "turn/start") return;
  const threadIndex = Number(String(message.params.threadId).split("-")[1]);
  const turn = (turns.get(threadIndex) ?? 0) + 1;
  turns.set(threadIndex, turn);
  const skill = message.params.input.find((item) => item.type === "skill");
  if (skill?.name !== "plan-product-crawl" || message.params.outputSchema?.type !== "object") process.exit(12);
  const threadOutputs = outputs[threadIndex - 1];
  const value = threadOutputs[Math.min(turn - 1, threadOutputs.length - 1)];
  emit({ id: message.id, result: { turn: { id: "turn-" + threadIndex + "-" + turn } } });
  emit({ method: "turn/started", params: {} });
  if (!missingSearchThreads.has(threadIndex)) {
    const search = { id: "search-" + threadIndex + "-" + turn, type: "webSearch", query: "阶段核对" };
    emit({ method: "item/started", params: { item: search } });
    emit({ method: "item/completed", params: { item: { ...search, results: [{ url: "https://evidence.example.com/" + threadIndex }] } } });
  }
  const commentary = { id: "commentary-" + threadIndex + "-" + turn, type: "agentMessage", text: "正在核对阶段资料。", phase: "commentary" };
  emit({ method: "item/started", params: { item: { ...commentary, text: "" } } });
  emit({ method: "item/agentMessage/delta", params: { itemId: commentary.id, delta: commentary.text } });
  emit({ method: "item/completed", params: { item: commentary } });
  await pause(${scenario.delayMs ?? 0});
  const finalItem = { id: "final-" + threadIndex + "-" + turn, type: "agentMessage", text: JSON.stringify(value), phase: "final_answer" };
  emit({ method: "item/started", params: { item: { ...finalItem, text: "" } } });
  emit({ method: "item/completed", params: { item: finalItem } });
  emit({ method: "turn/completed", params: { turn: { status: "completed", error: null, items: [finalItem] } } });
}
`;
}

export function validStageOutputs(
  topic = "品牌与型号",
  knowledgeOptions: { standardUrl?: string; standardKind?: string } = {},
): unknown[][] {
  return [
    [landscape()],
    [saturation(1)],
    [saturation(2)],
    [marketCatalog(topic)],
    [plannedMapping("品牌一", topic)],
    [unresolvedMapping("品牌二")],
    [knowledge(topic, knowledgeOptions)],
  ];
}

export function landscape() {
  const brands = [
    { name: "品牌一", aliases: [], evidenceUrls: ["https://directory.example.com/brands"] },
    { name: "品牌二", aliases: [], evidenceUrls: ["https://catalog.example.net/brands"] },
  ];
  const definitions = [
    ["authoritative_directory", "https://directory.example.com/brands"],
    ["broad_market_catalog", "https://catalog.example.net/brands"],
    ["mainstream_brands", "https://mainstream.example.org/brands"],
    ["long_tail_and_niche", "https://longtail.example.cn/brands"],
    ["regional_and_imported", "https://regional.example.com/brands"],
    ["brand_families_and_subbrands", "https://families.example.net/brands"],
  ] as const;
  return {
    assistantText: "已形成品牌分母。", marketScope: "中国大陆",
    passes: definitions.map(([lens, url], index) => ({
      area: "brand_landscape", lens, query: `品牌核对查询 ${index + 1}`,
      evidenceUrls: [url], discoveredBrands: ["品牌一", "品牌二"], finding: "交叉核对品牌集合。",
    })),
    denominator: { method: "multi_source_union", description: "多来源并集并完成饱和核查",
      evidenceUrls: ["https://directory.example.com/brands", "https://catalog.example.net/brands"] },
    brands,
  };
}

export function saturation(index: number) {
  return {
    assistantText: `已执行第 ${index} 次独立饱和查询。`,
    pass: { area: "brand_landscape", lens: "saturation_check", query: `电视品牌饱和查询 ${index}`,
      evidenceUrls: [`https://saturation-${index}.example.com/brands`], discoveredBrands: [],
      finding: "本次查询没有发现分母外新品牌。" },
    brands: [],
  };
}

export function saturationWithBrand(index: number, name: string) {
  const value = saturation(index);
  return { ...value,
    pass: { ...value.pass, discoveredBrands: [name], finding: `本次查询发现新品牌：${name}。` },
    brands: [{ name, aliases: [], evidenceUrls: [`https://saturation-${index}.example.com/brands`] }] };
}

export function landscapeWithAlias(alias: string) {
  const value = landscape();
  return { ...value,
    brands: value.brands.map((brand, index) => index === 0 ? { ...brand, aliases: [alias] } : brand) };
}

export function plannedMapping(
  name: string,
  topic = "品牌与型号",
  url = "https://brand.example.com/products",
) {
  return {
    assistantText: `已核对${name}。`,
    brands: [{ name, status: "planned", note: "已找到公开官网目录。", officialSourceUrls: [url],
      officialMappingPasses: [evidencePass(`${name} 中国官网`, url)],
      parameterAndManualPasses: [evidencePass(`${name} 参数 说明书`, "https://brand.example.com/support")] }],
    sources: [source("品牌一官网", "品牌一", "brand_official", url, topic)], additionalBrands: [],
  };
}

export function mappingWithAdditional(name: string, additionalName: string) {
  const value = plannedMapping(name);
  return { ...value, additionalBrands: [{
    name: additionalName, aliases: [], query: `${additionalName} 电视品牌`,
    evidenceUrls: ["https://additional.example.com/brands"], finding: `发现${additionalName}。`,
  }] };
}

export function invalidPlannedMapping(name: string) {
  const value = plannedMapping(name);
  value.brands[0]!.officialSourceUrls = [];
  return value;
}

export function unresolvedMapping(name: string) {
  return {
    assistantText: `未核实${name}公开官网。`,
    brands: [{ name, status: "unresolved", note: "两轮查询仍无明确公开入口。", officialSourceUrls: [],
      officialMappingPasses: [evidencePass(`${name} 中国官网`, "https://search.example.com/one"),
        evidencePass(`${name} 全球官网`, "https://search.example.net/two")], parameterAndManualPasses: [] }],
    sources: [], additionalBrands: [],
  };
}

export function knowledge(
  topic = "品牌与型号",
  options: { standardUrl?: string; standardKind?: string } = {},
) {
  const standardUrl = options.standardUrl ?? "https://standards.example.com/refrigerator";
  return {
    assistantText: "已补齐标准和原理来源。",
    passes: [pass("standards_and_principles", "冰箱标准与制冷原理", "https://standards.example.com/")],
    sources: [
      source("冰箱标准", "标准机构", options.standardKind ?? "standards_body", standardUrl, topic),
      source("制冷技术原理", "技术出版机构", "technical_publisher", "https://technical.example.org/refrigeration", topic),
    ],
  };
}

export function marketCatalog(topic = "品牌与型号") {
  return {
    assistantText: "已核对跨品牌品类市场目录。",
    sources: [source("品类市场目录", "市场目录出版方", "other",
      "https://catalog.example.net/brands", topic)],
  };
}

function source(name: string, publisher: string, sourceKind: string, url: string, topic = "品牌与型号") {
  return { name, publisher, sourceKind, role: "保留公开原始资料",
    targets: [{ name, url, taskTopics: [topic], captureUnit: "一份公开页面",
      rawFormats: ["html"], denominator: "计划冻结的精确 URL", rationale: "逐项保存原始响应" }] };
}

function pass(area: string, query: string, url: string) {
  return { area, query, evidenceUrls: [url], finding: `已核实${query}相关公开来源。` };
}

function evidencePass(query: string, url: string) {
  return { query, evidenceUrls: [url], finding: `已核实${query}相关公开来源。` };
}

export function task(): CaptureTask {
  const now = "2026-08-19T00:00:00.000Z";
  return {
    id: "task-1", name: "冰箱抓取任务", status: "ready", revision: 1,
    content: { originalRequest: "抓冰箱", category: { code: "refrigerator", label: "冰箱" },
      marketScope: "中国大陆", generalTopics: ["品牌与型号"], categoryTopics: [],
      jd: { applicable: true, disposition: "excluded", scope: [], rationale: "当前正式规划排除" },
      sourceCandidates: [], excludedContent: [], unresolvedItems: [], decisionIds: [] },
    createdAt: now, updatedAt: now, confirmedAt: now,
  };
}

export function pdfTask(entryUrl: string): CaptureTask {
  const value = task();
  value.content.generalTopics = ["国家标准"];
  value.content.sourceCandidates = [{ id: "candidate-pdf", name: "冰箱标准 PDF", publisher: "标准机构", entryUrl,
    sourceKind: "regulator", expectedContents: ["PDF 正文"], observedFormats: ["PDF"],
    accessState: "public", observedAt: value.updatedAt }];
  return value;
}

export function brandCandidateTask(entryUrl: string): CaptureTask {
  const value = task();
  value.content.sourceCandidates = [{ id: "candidate-brand-one", name: "品牌一确认目录", publisher: "品牌一", entryUrl,
    sourceKind: "brand_official", expectedContents: ["品牌一产品目录"], observedFormats: ["网页"],
    accessState: "public", observedAt: value.updatedAt }];
  return value;
}

export function historicalPlan() {
  return { taskRevision: 1, content: { sources: [{
    key: "obsolete-brand-source", name: "旧官网来源", publisher: "旧品牌",
    sourceKind: "brand_official", entryUrls: ["https://obsolete.example.com/old-brand-page"],
    sourceCandidateIds: [], provider: { key: "public.web-resource", version: "1.0.0", configuration: [] },
    targets: [{ name: "旧入口", taskTopics: ["品牌与型号"],
      providerConfiguration: [{ key: "url", value: "https://obsolete.example.com/old-brand-page" }] }],
  }] } } as unknown as CrawlPlan;
}

export async function collect<T>(iterable: AsyncIterable<T>) {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
