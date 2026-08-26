import { copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { output, ZodTypeAny } from "zod";

import type { CrawlPlanningRuntime, CrawlPlanningRuntimeEvent } from "./crawlPlanningModule";
import { finalizingActivity, projectCodexAppServerActivity } from "./codexAppServerActivity";
import {
  CodexAppServerError,
  createCodexAppServerClient,
  type CodexAppServerClient,
  type CodexAppServerResult,
} from "./codexAppServerClient";
import {
  brandDiscoveryPrompt,
  brandMappingPrompt,
  brandSaturationPrompt,
  knowledgeSourcesPrompt,
  marketCatalogPrompt,
} from "./crawlPlanningStagePrompts";
import {
  assembleBrandLandscape,
  brandDiscoveryStageSchema,
  brandSaturationStageSchema,
  mergeObservedBrands,
  projectBrandLandscape,
  saturationNewBrandCount,
  type BrandLandscapeStage,
  type BrandSaturationStage,
} from "./crawlPlanningBrandDiscovery";
import {
  assembleStagedCrawlPlan,
  brandStageCandidates,
  brandMappingStageSchema,
  knowledgeStageCandidates,
  knowledgeSourcesStageSchema,
  marketCatalogStageSchema,
  requireBrandBatch,
  requireKnowledgeSources,
  requireMarketCatalogSources,
  requireStageCandidateSources,
  requireStageSources,
  type BrandMappingStage,
} from "./crawlPlanningStages";
import {
  type CrawlPlanningRuntimeInput,
  type CrawlPlanningStageCommand,
  type CrawlPlanningStageOutcome,
  type CrawlPlanningStageRuntime,
  type CrawlPlanningStageValueMap,
} from "./crawlPlanningStageRuntime";
import { parseCodexStructuredOutput, zodSchemaToCodexOutputSchema } from "./codexStructuredOutput";

export interface CodexCrawlPlanningRuntimeOptions {
  repositoryRoot: string;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
  executable?: string;
  timeoutMs?: number;
  brandBatchSize?: number;
}

export function createCodexCrawlPlanningRuntime(
  options: CodexCrawlPlanningRuntimeOptions,
): CrawlPlanningRuntime {
  const brandBatchSize = requireBrandBatchSize(options.brandBatchSize);
  const stages = createCodexCrawlPlanningStageRuntime(options);
  return {
    run: (input) => runCrawlPlanningWithStages(stages, brandBatchSize, input),
    close: () => stages.close?.() ?? Promise.resolve(),
  };
}

export function createCodexCrawlPlanningStageRuntime(
  options: CodexCrawlPlanningRuntimeOptions,
): CrawlPlanningStageRuntime {
  requireBrandBatchSize(options.brandBatchSize);
  const runtimeCwd = path.join(tmpdir(), "domain-analysis-crawl-planning");
  const skillPath = path.join(runtimeCwd, ".agents", "skills", "plan-product-crawl", "SKILL.md");
  const client = createCodexAppServerClient({
    cwd: runtimeCwd,
    packageRoot: options.repositoryRoot,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    executable: options.executable,
    timeoutMs: options.timeoutMs ?? 600_000,
    webSearch: true,
    skill: { name: "plan-product-crawl", path: skillPath },
  });
  const run = (async function* (command: CrawlPlanningStageCommand, signal?: AbortSignal) {
    await mkdir(path.dirname(skillPath), { recursive: true });
    await copyFile(
      path.join(options.repositoryRoot, ".agents", "skills", "plan-product-crawl", "SKILL.md"), skillPath,
    );
    return yield* runCodexStage(client, command, signal);
  }) as CrawlPlanningStageRuntime["run"];
  return { run, close: () => client.close() };
}

export async function* runCrawlPlanningWithStages(
  stages: CrawlPlanningStageRuntime,
  brandBatchSize: number,
  input: Parameters<CrawlPlanningRuntime["run"]>[0],
): AsyncIterable<CrawlPlanningRuntimeEvent> {
  const runtimeInput = { task: input.task, instruction: input.instruction, previousPlans: input.previousPlans };
  const landscapeRun = yield* runBrandLandscape({ stages, signal: input.signal, runtimeInput });
  if (landscapeRun.interrupted) return yield { type: "interrupted" };
  let landscape = landscapeRun.value;
  const marketRun = yield* stages.run({
    kind: "market_catalog", key: "market-catalog", label: "核对跨品牌品类市场目录",
    runtimeInput, landscape,
  }, input.signal);
  if (marketRun.interrupted) return yield { type: "interrupted" };
  const mappings = new Map<string, BrandMappingStage["brands"][number]>();
  const mappingStages: BrandMappingStage[] = [];
  let reconciliationCount = 0;

  for (;;) {
    const pending = landscape.brands.filter((brand) => !mappings.has(normalized(brand.name)));
    if (pending.length === 0) break;
    const newlyObserved = new Map<string, BrandMappingStage["additionalBrands"][number]>();
    for (let offset = 0; offset < pending.length; offset += brandBatchSize) {
      const batch = pending.slice(offset, offset + brandBatchSize);
      const batchRun = yield* stages.run({
        kind: "brand_mapping",
        key: `brand-mapping:${reconciliationCount}:${Math.floor(offset / brandBatchSize) + 1}`,
        label: `核对品牌官网（${offset + 1}-${offset + batch.length}/${pending.length}）`,
        runtimeInput, brands: batch,
      }, input.signal);
      if (batchRun.interrupted) return yield { type: "interrupted" };
      mappingStages.push(batchRun.value);
      for (const brand of batchRun.value.brands) mappings.set(normalized(brand.name), brand);
      for (const brand of batchRun.value.additionalBrands) {
        const key = normalized(brand.name);
        if (!mappings.has(key) && !landscape.brands.some((item) => normalized(item.name) === key)) {
          newlyObserved.set(key, brand);
        }
      }
    }
    if (newlyObserved.size === 0) break;
    if (reconciliationCount >= 2) {
      throw new Error("品牌官网核对连续发现新品牌，两次分母复核后仍未收敛；本轮不生成计划");
    }
    reconciliationCount += 1;
    landscape = mergeObservedBrands(landscape, [...newlyObserved.values()]);
    const reconciliation = yield* runBrandSaturation({
      stages, signal: input.signal, runtimeInput, landscape,
      labelPrefix: `复核新增品牌（${reconciliationCount}/2）`,
      keyPrefix: `brand-reconciliation:${reconciliationCount}`,
    });
    if (reconciliation.interrupted) return yield { type: "interrupted" };
    landscape = reconciliation.value;
  }

  const knowledgeRun = yield* stages.run({
    kind: "knowledge_sources", key: "knowledge-sources", label: "补齐标准、监管与技术原理来源",
    runtimeInput,
  }, input.signal);
  if (knowledgeRun.interrupted) return yield { type: "interrupted" };
  yield { type: "activity", activity: finalizingActivity("确定性组装并校验抓取计划", "running") };
  const output = assembleStagedCrawlPlan({
    task: input.task, previousPlans: input.previousPlans,
    landscape, market: marketRun.value, mappings: mappingStages, knowledge: knowledgeRun.value,
  });
  await input.validateOutput?.(output);
  yield { type: "activity", activity: finalizingActivity("确定性组装并校验抓取计划", "completed") };
  yield { type: "completed", output };
}

type StageResult<T> = CrawlPlanningStageOutcome<T>;

async function* runBrandLandscape(input: {
  stages: CrawlPlanningStageRuntime;
  signal?: AbortSignal;
  runtimeInput: CrawlPlanningRuntimeInput;
}): AsyncGenerator<CrawlPlanningRuntimeEvent, StageResult<BrandLandscapeStage>> {
  const discovery = yield* input.stages.run({
    kind: "brand_discovery", key: "brand-discovery", label: "调查六类品牌发现镜头",
    runtimeInput: input.runtimeInput,
  }, input.signal);
  if (discovery.interrupted) return { interrupted: true };
  return yield* runBrandSaturation({ ...input,
    landscape: projectBrandLandscape(discovery.value, []), keyPrefix: "brand-saturation" });
}

async function* runBrandSaturation(input: {
  stages: CrawlPlanningStageRuntime;
  signal?: AbortSignal;
  runtimeInput: CrawlPlanningRuntimeInput;
  landscape: BrandLandscapeStage;
  keyPrefix: string;
  labelPrefix?: string;
}): AsyncGenerator<CrawlPlanningRuntimeEvent, StageResult<BrandLandscapeStage>> {
  const saturationStages: BrandSaturationStage[] = [];
  const previousQueries = input.landscape.passes
    .filter((pass) => pass.lens === "saturation_check").map((pass) => pass.query);
  let zeroNewCount = 0;
  // WHY：饱和是由连续查询结果驱动的停止条件；由 Workbench 计数可避免模型在一个大对象里自报已经收敛。
  for (let index = 0; index < 6 && zeroNewCount < 2; index += 1) {
    const current = projectBrandLandscape(input.landscape, saturationStages);
    const saturation = yield* input.stages.run({
      kind: "brand_saturation", key: `${input.keyPrefix}:${index + 1}`,
      label: `${input.labelPrefix ? `${input.labelPrefix}：` : ""}执行品牌饱和查询（${index + 1}/6）`,
      runtimeInput: input.runtimeInput, landscape: current, previousQueries,
    }, input.signal);
    if (saturation.interrupted) return { interrupted: true };
    const newCount = saturationNewBrandCount(saturation.value, current.brands);
    zeroNewCount = newCount === 0 ? zeroNewCount + 1 : 0;
    saturationStages.push(saturation.value);
    previousQueries.push(saturation.value.pass.query);
  }
  if (zeroNewCount < 2) throw new Error("六次独立饱和查询后仍未连续两次零新增品牌；本轮不生成计划");
  return { interrupted: false, value: assembleBrandLandscape(input.landscape, saturationStages) };
}

async function* runCodexStage(
  client: CodexAppServerClient,
  command: CrawlPlanningStageCommand,
  signal?: AbortSignal,
): AsyncGenerator<CrawlPlanningRuntimeEvent, CrawlPlanningStageOutcome<CrawlPlanningStageValueMap[keyof CrawlPlanningStageValueMap]>> {
  if (command.kind === "brand_discovery") {
    return yield* runRawStage({ client, signal, label: command.label,
      prompt: brandDiscoveryPrompt(command.runtimeInput), schema: brandDiscoveryStageSchema });
  }
  if (command.kind === "brand_saturation") {
    return yield* runRawStage({ client, signal, label: command.label,
      prompt: brandSaturationPrompt(command.runtimeInput, command.landscape, command.previousQueries),
      schema: brandSaturationStageSchema,
      validate: (stage) => requireDistinctSaturationQuery(stage, command.previousQueries) });
  }
  if (command.kind === "market_catalog") {
    return yield* runRawStage({ client, signal, label: command.label,
      prompt: marketCatalogPrompt(command.runtimeInput, command.landscape), schema: marketCatalogStageSchema,
      validate: (stage) => {
        requireStageSources(stage, command.runtimeInput.task);
        requireMarketCatalogSources(stage, command.landscape);
      } });
  }
  if (command.kind === "brand_mapping") {
    const candidates = brandStageCandidates(command.runtimeInput.task, command.brands);
    return yield* runRawStage({ client, signal, label: command.label,
      prompt: brandMappingPrompt(command.runtimeInput, command.brands), schema: brandMappingStageSchema,
      validate: (stage) => {
        requireBrandBatch(stage, command.brands);
        requireStageSources(stage, command.runtimeInput.task);
        requireStageCandidateSources(stage, candidates);
      } });
  }
  return yield* runRawStage({ client, signal, label: command.label,
    prompt: knowledgeSourcesPrompt(command.runtimeInput), schema: knowledgeSourcesStageSchema,
    validate: (stage) => {
      requireStageSources(stage, command.runtimeInput.task);
      requireStageCandidateSources(stage, knowledgeStageCandidates(command.runtimeInput.task));
      requireKnowledgeSources(stage);
    } });
}

async function* runRawStage<TSchema extends ZodTypeAny>(input: {
  client: CodexAppServerClient;
  signal?: AbortSignal;
  label: string;
  prompt: string;
  schema: TSchema;
  validate?: (value: output<TSchema>) => void;
}): AsyncGenerator<CrawlPlanningRuntimeEvent, StageResult<output<TSchema>>> {
  let prompt = input.prompt;
  let threadId: string | undefined;
  let hasWebResearch = false;
  const commentary = { mode: "new" as CommentaryMode, buffer: "", messageCount: 0 };
  yield { type: "text_delta", delta: `\n\n${input.label}` };
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let result: CodexAppServerResult | undefined;
    let eventSequence = 0;
    for await (const item of input.client.run(
      prompt, input.signal, threadId, zodSchemaToCodexOutputSchema(input.schema),
    )) {
      if (item.type === "text_delta") {
        const delta = projectCommentaryDelta(commentary, item.delta);
        if (delta) yield { type: "text_delta", delta };
      } else if (item.type === "event") {
        eventSequence += 1;
        const activity = projectCodexAppServerActivity(item, eventSequence, {
          lifecycle: "启动抓取计划 Agent", analysis: input.label, finalizing: `整理${input.label}结果`,
        });
        if (activity) yield { type: "activity", activity };
      } else {
        result = item.result;
      }
    }
    if (!result) throw new Error(`Codex ${input.label}未返回结果`);
    if (result.interrupted) return { interrupted: true };
    hasWebResearch ||= result.observedItemTypes.includes("web_search");
    try {
      if (!hasWebResearch) requireWebResearch(result, input.label);
      const value = parseCodexStructuredOutput({
        text: result.outputText ?? "", schema: input.schema,
        label: `Codex ${input.label}结果`, observedEvents: result.observedEvents,
      });
      input.validate?.(value);
      return { interrupted: false, value };
    } catch (error) {
      if (attempt === maxAttempts - 1 || !result.threadId) throw error;
      const message = validationMessage(error);
      const repairNumber = attempt + 1;
      const repairLabel = repairNumber === 1
        ? "第一次未通过校验，已在本阶段修正一次" : "第二次未通过校验，已在本阶段修正第二次";
      yield { type: "text_delta", delta: `\n${input.label}${repairLabel}：${message}` };
      threadId = result.threadId;
      prompt = repairPrompt(input.label, message);
      commentary.mode = "new";
      commentary.buffer = "";
    }
  }
  throw new Error(`Codex ${input.label}未完成`);
}

type CommentaryMode = "new" | "plain" | "structured" | "structured_done";
interface CommentaryProjection { mode: CommentaryMode; buffer: string; messageCount: number }

function projectCommentaryDelta(state: CommentaryProjection, delta: string) {
  let body = delta;
  if (body.startsWith("\n\n")) {
    body = body.slice(2);
    state.mode = "new";
    state.buffer = "";
  }
  if (state.mode === "new") {
    state.mode = body.trimStart().startsWith("{") ? "structured" : "plain";
    if (state.mode === "plain") {
      state.messageCount += 1;
      return `\n${body}`;
    }
  }
  if (state.mode === "plain") return body;
  if (state.mode === "structured_done") return undefined;
  state.buffer += body;
  try {
    const parsed = JSON.parse(state.buffer) as { assistantText?: unknown };
    state.mode = "structured_done";
    if (typeof parsed.assistantText !== "string" || !parsed.assistantText.trim()) return undefined;
    state.messageCount += 1;
    return `\n${parsed.assistantText.trim()}`;
  } catch {
    return undefined;
  }
}

function repairPrompt(label: string, message: string) {
  return [
    `上一轮“${label}”结果没有通过 Workbench 现有阶段协议。保留同一 thread 的搜索，只修正本阶段 JSON。`,
    `现有错误：${message}`,
    "不要扩展到其他阶段。final_answer 仍只返回符合当前 outputSchema 的完整对象。",
  ].join("\n\n");
}

function requireWebResearch(result: CodexAppServerResult, label: string) {
  if (!result.observedItemTypes.includes("web_search")) {
    throw new CodexAppServerError(
      "invalid_output", `${label}缺少真实网页搜索记录，请重试。`,
      `events=${result.observedEvents.join(",")} itemTypes=${result.observedItemTypes.join(",")}`,
    );
  }
}

function requireDistinctSaturationQuery(stage: BrandSaturationStage, previousQueries: string[]) {
  const query = normalized(stage.pass.query);
  if (previousQueries.some((item) => normalized(item) === query)) {
    throw new Error("品牌饱和查询必须使用与此前不同的查询");
  }
}

function requireBrandBatchSize(value: number | undefined) {
  const brandBatchSize = value ?? 3;
  if (!Number.isInteger(brandBatchSize) || brandBatchSize < 1 || brandBatchSize > 10) {
    throw new Error("品牌规划批量必须是 1 到 10 的整数");
  }
  return brandBatchSize;
}

function validationMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").trim().slice(0, 2_000);
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN");
}
