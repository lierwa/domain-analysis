import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CodexAppServerError } from "../src/codexAppServerClient";
import { createCodexCrawlPlanningRuntime } from "../src/codexCrawlPlanningRuntime";
import {
  brandCandidateTask,
  collect,
  fakeExecutable,
  type FakeScenario,
  historicalPlan,
  invalidPlannedMapping,
  knowledge,
  landscape,
  landscapeWithAlias,
  marketCatalog,
  mappingWithAdditional,
  pdfTask,
  plannedMapping,
  saturation,
  saturationWithBrand,
  task,
  unresolvedMapping,
  validStageOutputs,
} from "./codexCrawlPlanningRuntimeTestSupport";

const temporaryRoots: string[] = [];
const runtimeClosers: Array<() => Promise<void>> = [];
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const firstMappingOutput = 4;
const knowledgeOutput = 6;

afterEach(async () => {
  await Promise.all(runtimeClosers.splice(0).map((close) => close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex 分阶段抓取规划运行时", () => {
  it("先冻结品牌分母，再按可调单品牌批次核对，最后确定性组装计划", async () => {
    const runtime = await createRuntime({ brandBatchSize: 1, outputs: validStageOutputs() });
    let validations = 0;

    const events = await collect(runtime.run({
      task: task(), previousPlans: [], validateOutput: async () => { validations += 1; },
    }));

    expect(events.filter((event) => event.type === "text_delta").map((event) =>
      event.type === "text_delta" ? event.delta : "").join("\n")).toContain("核对品牌官网（1-1/2）");
    expect(events.filter((event) => event.type === "text_delta").map((event) =>
      event.type === "text_delta" ? event.delta : "").join("\n")).toContain("核对品牌官网（2-2/2）");
    expect(validations).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      output: {
        planCandidate: {
          executionChecklistVersion: 4,
          sources: expect.arrayContaining([
            expect.objectContaining({ sourceKind: "brand_official" }),
            expect.objectContaining({ sourceKind: "other" }),
            expect.objectContaining({ sourceKind: "standards_body" }),
            expect.objectContaining({ sourceKind: "technical_publisher" }),
          ]),
          researchAudit: { denominator: { brandCount: 2 }, completeness: "partial" },
        },
      },
    });
    const completed = events.at(-1);
    if (completed?.type !== "completed") throw new Error("测试没有收到完成计划");
    const officialSource = completed.output.planCandidate.sources.find((source) => source.sourceKind === "brand_official");
    expect(officialSource).toMatchObject({ provider: { version: "2.0.0" } });
    const siteTarget = officialSource?.targets.find((target) => target.providerConfiguration
      .some((item) => item.key === "route" && item.value === "site"));
    expect(siteTarget).toMatchObject({ quantity: { mode: "all_available" },
      providerConfiguration: expect.arrayContaining([
        { key: "route", value: "site" }, { key: "minimum_accepted_pages", value: 2 },
      ]) });
    const marketSource = completed.output.planCandidate.sources.find((source) => source.sourceKind === "other");
    expect(marketSource).toMatchObject({
      entryUrls: ["https://catalog.example.net/brands"],
      targets: [expect.objectContaining({ quantity: expect.objectContaining({ mode: "all_available" }),
        providerConfiguration: expect.arrayContaining([
          { key: "route", value: "site" }, { key: "minimum_accepted_pages", value: 2 },
        ]) })],
    });
    const landscapePasses = completed.output.planCandidate.researchAudit.passes
      .filter((pass) => pass.area === "brand_landscape");
    expect(landscapePasses[0]?.newlyAddedBrands).toEqual(["品牌一", "品牌二"]);
    expect(landscapePasses.slice(-2).every((pass) => pass.newlyAddedBrands.length === 0)).toBe(true);
  });

  it("饱和查询发现新品牌时重置计数并继续到连续两次零新增", async () => {
    const runtime = await createRuntime({ brandBatchSize: 1, outputs: [
      [landscape()],
      [saturationWithBrand(1, "品牌三")],
      [saturation(2)],
      [saturation(3)],
      [marketCatalog()],
      [plannedMapping("品牌一")],
      [unresolvedMapping("品牌二")],
      [unresolvedMapping("品牌三")],
      [knowledge()],
    ] });

    const events = await collect(runtime.run({ task: task(), previousPlans: [] }));
    const completed = events.at(-1);

    if (completed?.type !== "completed") throw new Error("测试没有收到完成计划");
    expect(completed.output.planCandidate.researchAudit.denominator.brandCount).toBe(3);
    expect(completed.output.planCandidate.researchAudit.brands.map((brand) => brand.name))
      .toEqual(["品牌一", "品牌二", "品牌三"]);
    const saturationPasses = completed.output.planCandidate.researchAudit.passes
      .filter((pass) => pass.area === "brand_landscape")
      .filter((pass) => pass.lens === "saturation_check");
    expect(saturationPasses.map((pass) => pass.newlyAddedBrands)).toEqual([["品牌三"], [], []]);
  });

  it("饱和查询命中已有品牌别名时不重复计为新增", async () => {
    const runtime = await createRuntime({ brandBatchSize: 1, outputs: [
      [landscapeWithAlias("Brand One")],
      [saturationWithBrand(1, "Brand One")],
      [saturation(2)],
      [marketCatalog()],
      [plannedMapping("品牌一")],
      [unresolvedMapping("品牌二")],
      [knowledge()],
    ] });

    const events = await collect(runtime.run({ task: task(), previousPlans: [] }));
    const completed = events.at(-1);

    if (completed?.type !== "completed") throw new Error("测试没有收到完成计划");
    expect(completed.output.planCandidate.researchAudit.denominator.brandCount).toBe(2);
    const passes = completed.output.planCandidate.researchAudit.passes
      .filter((pass) => pass.area === "brand_landscape");
    expect(passes.slice(-2).map((pass) => pass.newlyAddedBrands)).toEqual([[], []]);
  });

  it("官网批次新增品牌携带原查询证据并入分母后只继续饱和核查", async () => {
    const runtime = await createRuntime({ brandBatchSize: 1, outputs: [
      [landscape()],
      [saturation(1)],
      [saturation(2)],
      [marketCatalog()],
      [mappingWithAdditional("品牌一", "品牌三")],
      [unresolvedMapping("品牌二")],
      [saturation(3)],
      [saturation(4)],
      [unresolvedMapping("品牌三")],
      [knowledge()],
    ] });

    const events = await collect(runtime.run({ task: task(), previousPlans: [] }));

    expect(events).toContainEqual(expect.objectContaining({
      type: "text_delta",
      delta: expect.stringContaining("复核新增品牌（1/2）：执行品牌饱和查询（1/6）"),
    }));
    expect(events.filter((event) => event.type === "text_delta"
      && event.delta.includes("执行六类品牌发现"))).toHaveLength(0);
    const completed = events.at(-1);
    if (completed?.type !== "completed") throw new Error("测试没有收到完成计划");
    expect(completed.output.planCandidate.researchAudit.denominator.brandCount).toBe(3);
    expect(completed.output.planCandidate.researchAudit.passes).toContainEqual(expect.objectContaining({
      area: "brand_landscape", lens: "saturation_check", query: "品牌三 电视品牌",
      newlyAddedBrands: ["品牌三"],
    }));
  });

  it("官网批次把已知英文别名报告成新增时确定性合并且不重复核对", async () => {
    const runtime = await createRuntime({ brandBatchSize: 1, outputs: [
      [landscapeWithAlias("Brand One")], [saturation(1)], [saturation(2)],
      [marketCatalog()],
      [mappingWithAdditional("品牌一", "Brand One")], [unresolvedMapping("品牌二")],
      [saturation(3)], [saturation(4)], [knowledge()],
    ] });

    const events = await collect(runtime.run({ task: task(), previousPlans: [] }));
    const completed = events.at(-1);

    if (completed?.type !== "completed") throw new Error("测试没有收到完成计划");
    expect(completed.output.planCandidate.researchAudit.denominator.brandCount).toBe(2);
    expect(completed.output.planCandidate.researchAudit.brands.map((brand) => brand.name))
      .toEqual(["品牌一", "品牌二"]);
  });

  it("六镜头阶段把另一品牌名当别名时只修正当前阶段", async () => {
    const overlapping = landscapeWithAlias("品牌二");
    const runtime = await createRuntime({ brandBatchSize: 1, outputs: [
      [overlapping, landscape()],
      [saturation(1)], [saturation(2)],
      [marketCatalog()],
      [plannedMapping("品牌一")], [unresolvedMapping("品牌二")], [knowledge()],
    ] });

    const events = await collect(runtime.run({ task: task(), previousPlans: [] }));

    expect(events).toContainEqual(expect.objectContaining({
      type: "text_delta", delta: expect.stringContaining("品牌名称或别名与另一品牌重复"),
    }));
    expect(events.at(-1)).toMatchObject({ type: "completed" });
  });

  it("六镜头阶段混入模型占位品牌时在进入官网批次前修正", async () => {
    const polluted = landscape();
    polluted.brands[0] = { ...polluted.brands[0]!, name: "placeholder" };
    polluted.passes = polluted.passes.map((pass) => ({
      ...pass,
      discoveredBrands: pass.discoveredBrands.map((name) => name === "品牌一" ? "placeholder" : name),
    }));
    const runtime = await createRuntime({ brandBatchSize: 1, outputs: [
      [polluted, landscape()],
      [saturation(1)], [saturation(2)],
      [marketCatalog()],
      [plannedMapping("品牌一")], [unresolvedMapping("品牌二")], [knowledge()],
    ] });

    const events = await collect(runtime.run({ task: task(), previousPlans: [] }));

    expect(events).toContainEqual(expect.objectContaining({
      type: "text_delta", delta: expect.stringContaining("品牌名称不能使用占位标记"),
    }));
    expect(events.at(-1)).toMatchObject({ type: "completed" });
  });

  it("某个品牌批次校验失败时只在该独立 thread 内有界修正", async () => {
    const outputs = validStageOutputs();
    outputs[firstMappingOutput] = [invalidPlannedMapping("品牌一"), plannedMapping("品牌一")];
    const runtime = await createRuntime({ brandBatchSize: 1, outputs });

    const events = await collect(runtime.run({ task: task(), previousPlans: [] }));

    expect(events).toContainEqual(expect.objectContaining({
      type: "text_delta",
      delta: expect.stringContaining("第一次未通过校验，已在本阶段修正一次"),
    }));
    expect(events.at(-1)).toMatchObject({ type: "completed" });
  });

  it("品牌批次首次校验一次报告字段错误和重复 URL", async () => {
    const outputs = validStageOutputs();
    const invalid = plannedMapping("品牌一");
    invalid.brands[0]!.officialMappingPasses[0]!.evidenceUrls = [];
    invalid.sources.push({ ...invalid.sources[0]!, name: "重复官网来源" });
    outputs[firstMappingOutput] = [invalid, plannedMapping("品牌一")];
    const runtime = await createRuntime({ brandBatchSize: 1, outputs });

    const events = await collect(runtime.run({ task: task(), previousPlans: [] }));
    const timeline = events.filter((event) => event.type === "text_delta")
      .map((event) => event.type === "text_delta" ? event.delta : "").join("\n");

    expect(timeline).toContain("Array must contain at least 1 element");
    expect(timeline).toContain("阶段来源重复使用同一精确 URL");
    expect(events.at(-1)).toMatchObject({ type: "completed" });
  });

  it("第一次修正引入新的重复 URL 时仍可在同一阶段完成第二次修正", async () => {
    const outputs = validStageOutputs();
    const missingEvidence = plannedMapping("品牌一");
    missingEvidence.brands[0]!.officialMappingPasses[0]!.evidenceUrls = [];
    const duplicated = plannedMapping("品牌一");
    duplicated.sources.push({ ...duplicated.sources[0]!, name: "重复官网来源" });
    outputs[firstMappingOutput] = [missingEvidence, duplicated, plannedMapping("品牌一")];
    const runtime = await createRuntime({ brandBatchSize: 1, outputs });

    const events = await collect(runtime.run({ task: task(), previousPlans: [] }));
    const timeline = events.filter((event) => event.type === "text_delta")
      .map((event) => event.type === "text_delta" ? event.delta : "").join("\n");

    expect(timeline).toContain("第一次未通过校验，已在本阶段修正一次");
    expect(timeline).toContain("第二次未通过校验，已在本阶段修正第二次");
    expect(timeline).toContain("阶段来源重复使用同一精确 URL");
    expect(events.at(-1)).toMatchObject({ type: "completed" });
  });

  it("当前任务确认的品牌官网候选遗漏时在所属品牌批次内修正", async () => {
    const candidateUrl = "https://brand.example.com/confirmed-catalog";
    const outputs = validStageOutputs();
    outputs[firstMappingOutput] = [
      plannedMapping("品牌一"), plannedMapping("品牌一", "品牌与型号", candidateUrl),
    ];
    const runtime = await createRuntime({ brandBatchSize: 1, outputs });

    const events = await collect(runtime.run({
      task: brandCandidateTask(candidateUrl), previousPlans: [],
    }));

    expect(events).toContainEqual(expect.objectContaining({
      type: "text_delta",
      delta: expect.stringContaining("当前任务已确认的来源候选"),
    }));
    const completed = events.at(-1);
    if (completed?.type !== "completed") throw new Error("测试没有收到完成计划");
    expect(completed.output.planCandidate.sources).toContainEqual(expect.objectContaining({
      sourceCandidateIds: ["candidate-brand-one"],
      entryUrls: [candidateUrl],
    }));
  });

  it("当前任务确认的标准候选遗漏时在标准阶段内修正", async () => {
    const candidateUrl = "https://standards.example.com/confirmed-rule.pdf";
    const outputs = validStageOutputs("国家标准");
    outputs[knowledgeOutput] = [knowledge("国家标准"), knowledge("国家标准", {
      standardUrl: candidateUrl, standardKind: "regulator",
    })];
    const runtime = await createRuntime({ brandBatchSize: 1, outputs });

    const events = await collect(runtime.run({ task: pdfTask(candidateUrl), previousPlans: [] }));

    expect(events).toContainEqual(expect.objectContaining({
      type: "text_delta",
      delta: expect.stringContaining("当前任务已确认的来源候选"),
    }));
    expect(events.at(-1)).toMatchObject({ type: "completed" });
  });

  it("品牌检索证据嵌套在对应品牌项，不能用另一品牌的记录补齐", async () => {
    const outputs = validStageOutputs();
    const invalid = plannedMapping("品牌一");
    invalid.brands[0]!.officialMappingPasses = [];
    outputs[firstMappingOutput] = [invalid, plannedMapping("品牌一")];
    const runtime = await createRuntime({ brandBatchSize: 1, outputs });

    const events = await collect(runtime.run({ task: task(), previousPlans: [] }));

    expect(events).toContainEqual(expect.objectContaining({
      type: "text_delta",
      delta: expect.stringContaining("第一次未通过校验，已在本阶段修正一次"),
    }));
    expect(events.at(-1)).toMatchObject({ type: "completed" });
  });

  it("任一研究阶段没有真实 web_search 时整轮失败关闭", async () => {
    const runtime = await createRuntime({
      brandBatchSize: 1, outputs: validStageOutputs(), missingSearchThreads: [2],
    });

    await expect(collect(runtime.run({ task: task(), previousPlans: [] }))).rejects.toMatchObject({
      code: "invalid_output", message: expect.stringContaining("缺少真实网页搜索记录"),
    } satisfies Partial<CodexAppServerError>);
  });

  it("每个阶段继续使用独立的有界执行预算", async () => {
    const runtime = await createRuntime({
      brandBatchSize: 1, outputs: validStageOutputs(), delayMs: 80, timeoutMs: 20,
    });

    await expect(collect(runtime.run({ task: task(), previousPlans: [] }))).rejects.toMatchObject({
      code: "execution_failed", message: "Codex 本轮执行超时，本轮未保存，请重试。",
    } satisfies Partial<CodexAppServerError>);
  });

  it("确定性组装仍把任务中的精确 PDF 入口收窄为原始文档附件", async () => {
    const pdfUrl = "https://standards.example.com/refrigerator-rule.pdf";
    const runtime = await createRuntime({
      brandBatchSize: 1,
      outputs: validStageOutputs("国家标准", { standardUrl: pdfUrl, standardKind: "regulator" }),
    });

    const events = await collect(runtime.run({ task: pdfTask(pdfUrl), previousPlans: [] }));
    const completed = events.at(-1);

    expect(completed?.type).toBe("completed");
    if (completed?.type !== "completed") throw new Error("测试没有收到完成计划");
    const source = completed.output.planCandidate.sources.find((item) =>
      item.sourceCandidateIds.includes("candidate-pdf"));
    expect(source).toMatchObject({
      sourceKind: "regulator",
      provider: {
        configuration: expect.arrayContaining([{ key: "maximum_bytes", value: 25_000_000 }]),
      },
      accessPolicy: {
        version: "public-web-resource-low-frequency-v3",
        maximumRunMs: 1_800_000,
      },
      rawOutputPolicy: { formats: expect.arrayContaining(["document"]), retainAssets: true },
      targets: [expect.objectContaining({ rawFormats: ["document"] })],
    });
    if (!source) throw new Error("测试没有生成标准来源");
    const originCount = new Set(source.entryUrls.map((entry) => new URL(entry).origin)).size;
    expect(source.stopPolicy.requestBudget).toBe((source.targets.length + originCount) * 2);
  });

  it("历史计划只作复核线索，不把旧 source key 强塞进新计划", async () => {
    const runtime = await createRuntime({ brandBatchSize: 1, outputs: validStageOutputs() });

    const events = await collect(runtime.run({ task: task(), previousPlans: [historicalPlan()] }));
    const completed = events.at(-1);

    if (completed?.type !== "completed") throw new Error("测试没有收到完成计划");
    expect(completed.output.planCandidate.sources.flatMap((source) => source.entryUrls))
      .not.toContain("https://obsolete.example.com/old-brand-page");
  });

  it("拒绝超过小批量边界的配置", () => {
    expect(() => createCodexCrawlPlanningRuntime({
      repositoryRoot, model: "gpt-5.6-terra", reasoningEffort: "medium",
      brandBatchSize: 11,
    })).toThrow("品牌规划批量必须是 1 到 10 的整数");
  });
});

async function createRuntime(scenario: FakeScenario & { brandBatchSize: number; timeoutMs?: number }) {
  const fake = await fakeExecutable(scenario);
  temporaryRoots.push(fake.root);
  const runtime = createCodexCrawlPlanningRuntime({
    repositoryRoot, model: "gpt-5.6-terra", reasoningEffort: "medium",
    brandBatchSize: scenario.brandBatchSize,
    executable: fake.executable, timeoutMs: scenario.timeoutMs,
  });
  runtimeClosers.push(() => runtime.close?.() ?? Promise.resolve());
  return runtime;
}
