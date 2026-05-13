import {
  createAiInsightRunRepository,
  createAnalyzedContentRepository,
  createAnalysisRunRepository,
  createRawContentRepository,
  type AppDb
} from "@domain-analysis/db";
import pLimit from "p-limit";
import type { AnalysisRunStatus } from "@domain-analysis/shared";
import { createVercelAiInsightAnalyzer, type AiInsightAnalyzer, type AiInsightContentInput } from "./aiInsightAnalyzer";
import { loadAiProviderConfig } from "./aiProviderConfig";
import type { PostInsight, RunInsightSummary } from "./aiInsightSchemas";
import { getEngagementScore, getSubreddit } from "./analysisMetrics";

const RUN_SUMMARY_CONTENT_TYPE = "__run_summary";

export type { AiInsightAnalyzer } from "./aiInsightAnalyzer";

export function createAnalysisInsightService(
  db: AppDb,
  options: { analyzer?: AiInsightAnalyzer; env?: NodeJS.ProcessEnv } = {}
) {
  const runRepo = createAnalysisRunRepository(db);
  const contentRepo = createRawContentRepository(db);
  const insightRepo = createAnalyzedContentRepository(db);
  const insightRunRepo = createAiInsightRunRepository(db);

  return {
    async generateInsights(runId: string) {
      const run = await getRunnableRun(runId);
      const contents = await listRunContents(runId);
      const insightConfig = loadAiInsightConfig(options.env);
      const providerConfig = options.analyzer ? null : loadAiProviderConfig(options.env);
      const analyzer = options.analyzer ?? createVercelAiInsightAnalyzer(providerConfig!);
      const modelName = providerConfig ? `${providerConfig.provider}:${providerConfig.model}` : "test-analyzer";
      const startedAt = new Date().toISOString();
      const insightRun = await insightRunRepo.createRun({
        analysisRunId: runId,
        status: "selecting",
        modelName,
        configSnapshot: { ...insightConfig },
        startedAt
      });
      await runRepo.update(runId, { status: "analyzing", errorMessage: null });

      try {
        const selection = selectInsightCandidates(run, contents, insightConfig);
        await insightRunRepo.createCandidates(selection.candidates.map((candidate) => ({
          aiInsightRunId: insightRun.id,
          analysisRunId: runId,
          rawContentId: candidate.content.id,
          selected: candidate.selected,
          selectionScore: candidate.selectionScore,
          selectionReasons: candidate.selectionReasons,
          excludedReason: candidate.excludedReason,
          batchIndex: candidate.batchIndex,
          inputTextPreview: candidate.inputTextPreview
        })));
        const batches = await Promise.all(selection.batches.map((batch) =>
          insightRunRepo.createBatch({
            aiInsightRunId: insightRun.id,
            analysisRunId: runId,
            batchIndex: batch.batchIndex,
            status: "pending",
            rawContentIds: batch.contents.map((content) => content.id),
            candidateCount: batch.contents.length
          })
        ));
        await insightRunRepo.updateRun(insightRun.id, {
          status: "extracting",
          totalRawCount: contents.length,
          eligibleCount: selection.eligibleCount,
          selectedCandidateCount: selection.selectedCount,
          excludedCandidateCount: contents.length - selection.selectedCount,
          batchCount: selection.batches.length
        });

        const limit = pLimit(insightConfig.maxConcurrentBatches);
        const batchOutputs = await Promise.all(selection.batches.map((batch) =>
          limit(async () => {
            const persistedBatch = batches.find((item) => item.batchIndex === batch.batchIndex);
            if (!persistedBatch) throw new Error("ai_insight_batch_missing");
            await insightRunRepo.updateBatch(persistedBatch.id, { status: "running", startedAt: new Date().toISOString() });
            try {
              const output = await analyzer.analyzeRun({
                run,
                contents: batch.contents.map((content) => toAnalyzerContent(content, insightConfig)),
                maxInsights: insightConfig.maxInsightsPerBatch
              });
              const items = keepEvidenceBackedInsights(output.items, batch.contents);
              await insightRunRepo.updateBatch(persistedBatch.id, {
                status: "completed",
                outputInsightCount: items.length,
                finishedAt: new Date().toISOString()
              });
              return { batchIndex: batch.batchIndex, items, summary: output.summary };
            } catch (error) {
              const message = error instanceof Error ? error.message : "ai_insight_batch_failed";
              await insightRunRepo.updateBatch(persistedBatch.id, {
                status: "failed",
                errorMessage: message,
                finishedAt: new Date().toISOString()
              });
              throw error;
            }
          })
        ));

        const items = batchOutputs.flatMap((output) =>
          output.items.map((item) => ({ ...item, batchIndex: output.batchIndex }))
        );
        const summary = analyzer.summarizeRun
          ? await analyzer.summarizeRun({ run, totalContents: contents.length, insights: items })
          : mergeBatchSummaries(batchOutputs.map((output) => output.summary));
        await insightRepo.replaceRunInsights(runId, toPersistedInsights(runId, contents, { items, summary }, selection.candidates));
        await insightRunRepo.updateRun(insightRun.id, {
          status: "completed",
          outputInsightCount: items.length,
          finishedAt: new Date().toISOString()
        });
        const nextStatus = run.status === "report_ready" ? "report_ready" : "insight_ready";
        await runRepo.update(runId, { status: nextStatus, analyzedCount: items.length });
        return this.getRunInsights(runId, { page: 1, pageSize: 20 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "ai_insight_failed";
        await insightRunRepo.updateRun(insightRun.id, {
          status: "failed",
          errorMessage: message,
          finishedAt: new Date().toISOString()
        });
        await runRepo.update(runId, { status: "analysis_failed", errorMessage: message });
        throw Object.assign(new Error(message), { statusCode: 502 });
      }
    },

    async getRunInsights(runId: string, pageInput = { page: 1, pageSize: 20 }) {
      const contents = await listRunContents(runId);
      const sourceById = new Map(contents.map((content) => [content.id, content]));
      const allRows = await insightRepo.listByRun(runId);
      const summaryRow = allRows.find((row) => row.contentType === RUN_SUMMARY_CONTENT_TYPE);
      const itemRows = allRows.filter((row) => row.contentType !== RUN_SUMMARY_CONTENT_TYPE);
      const pageRows = paginateRows(itemRows, pageInput);
      const items = pageRows.items.map((row) => enrichPostInsight(row, sourceById));
      return {
        summary: buildRunSummary(summaryRow?.analysisJson?.summary, itemRows, contents),
        items,
        page: pageRows.page
      };
    },

    async getLatestInsightRun(runId: string) {
      return insightRunRepo.getLatestRun(runId);
    },

    async listInsightCandidates(runId: string, pageInput = { page: 1, pageSize: 20 }, selected?: boolean) {
      return insightRunRepo.listCandidatesByLatestRun(runId, pageInput, selected);
    },

    async listInsightBatches(runId: string) {
      return { items: await insightRunRepo.listBatchesByLatestRun(runId) };
    }
  };

  async function getRunnableRun(runId: string) {
    const run = await runRepo.getById(runId);
    if (!run) throw Object.assign(new Error("run_not_found"), { statusCode: 404 });
    if (!canAnalyze(run.status)) {
      throw Object.assign(new Error("Insights can only be generated after content is ready"), { statusCode: 400 });
    }
    return run;
  }

  async function listRunContents(runId: string) {
    return (await contentRepo.listByRunPage(runId, { page: 1, pageSize: 500 })).items;
  }
}

function canAnalyze(status: AnalysisRunStatus) {
  return ["content_ready", "insight_ready", "report_ready", "analysis_failed"].includes(status);
}

function toPersistedInsights(
  runId: string,
  contents: SourceContent[],
  output: { items: Array<PostInsight & { batchIndex?: number }>; summary: RunInsightSummary },
  candidates: InsightCandidate[] = []
) {
  const candidateById = new Map(candidates.map((candidate) => [candidate.content.id, candidate]));
  const firstContentId = contents[0]?.id;
  const rows = output.items.map((item) => ({
    rawContentId: item.rawContentId,
    analysisRunId: runId,
    summary: item.problemStatement,
    contentType: item.needType,
    topics: item.painPoints,
    entities: [item.audienceSegment],
    intent: item.userIntent,
    sentiment: item.sentiment,
    insightScore: Math.round(item.confidence * 100),
    opportunityScore: Math.round(item.confidence * 100),
    contentOpportunity: item.recommendedAction,
    reason: item.evidence.map((evidence) => evidence.quote).join("\n"),
    modelName: "ai-insights-v1",
    analysisJson: {
      ...item,
      batchIndex: item.batchIndex,
      selectionReasons: candidateById.get(item.rawContentId)?.selectionReasons ?? []
    } as unknown as Record<string, unknown>
  }));
  if (firstContentId) rows.push(createSummaryRow(runId, firstContentId, output.summary));
  return rows;
}

function createSummaryRow(runId: string, rawContentId: string, summary: RunInsightSummary) {
  return {
    rawContentId,
    analysisRunId: runId,
    summary: "AI run insight summary",
    contentType: RUN_SUMMARY_CONTENT_TYPE,
    topics: summary.themes.map((theme) => theme.themeName),
    entities: [],
    intent: "run_summary",
    sentiment: "unknown" as const,
    insightScore: 0,
    opportunityScore: 0,
    contentOpportunity: summary.recommendedNextActions.join("\n"),
    reason: summary.dataLimitations.join("\n") || "AI generated summary",
    modelName: "ai-insights-v1",
    analysisJson: { summary } as Record<string, unknown>
  };
}

function enrichPostInsight(row: PersistedInsight, sourceById: Map<string, SourceContent>) {
  const source = sourceById.get(row.rawContentId);
  const postInsight = row.analysisJson as Partial<PostInsight> | null;
  return {
    id: row.id,
    rawContentId: row.rawContentId,
    analysisRunId: row.analysisRunId,
    ...(postInsight ?? {}),
    engagementScore: getEngagementScore(source?.metricsJson ?? null),
    modelName: row.modelName,
    createdAt: row.createdAt,
    source: source ? toSourcePayload(source) : undefined
  };
}

function loadAiInsightConfig(env: NodeJS.ProcessEnv = process.env): AiInsightConfig {
  const maxItemsPerBatch = readPositiveInt(env.AI_INSIGHTS_MAX_ITEMS_PER_BATCH, 20);
  const maxExtractionBatches = readPositiveInt(env.AI_INSIGHTS_MAX_EXTRACTION_BATCHES, 6);
  return {
    maxItemsPerBatch,
    maxInputTokensPerBatch: readPositiveInt(env.AI_INSIGHTS_MAX_INPUT_TOKENS_PER_BATCH, 6000),
    maxExtractionBatches,
    maxCandidates: readPositiveInt(env.AI_INSIGHTS_MAX_CANDIDATES, maxItemsPerBatch * maxExtractionBatches),
    maxConcurrentBatches: readPositiveInt(env.AI_INSIGHTS_MAX_CONCURRENT_BATCHES, 2),
    maxInsightsPerBatch: readPositiveInt(env.AI_INSIGHTS_MAX_INSIGHTS_PER_BATCH, 5),
    textCharLimit: readPositiveInt(env.AI_INSIGHTS_TEXT_CHAR_LIMIT, 800),
    detailCharLimit: readPositiveInt(env.AI_INSIGHTS_DETAIL_CHAR_LIMIT, 1200),
    minTextChars: readPositiveInt(env.AI_INSIGHTS_MIN_TEXT_CHARS, 20)
  };
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function selectInsightCandidates(run: SourceRun, contents: SourceContent[], config: AiInsightConfig) {
  const seenKeys = new Set<string>();
  const scored = contents.map((content) => scoreCandidate(run, content, config, seenKeys));
  const eligible = scored.filter((candidate) => !candidate.excludedReason);
  const ranked = [...eligible].sort((a, b) => b.selectionScore - a.selectionScore);
  const selectedIds = new Set(ranked.slice(0, config.maxCandidates).map((candidate) => candidate.content.id));
  const batches: Array<{ batchIndex: number; contents: SourceContent[] }> = [];
  let current: SourceContent[] = [];
  let currentTokens = 0;

  for (const candidate of ranked) {
    if (!selectedIds.has(candidate.content.id)) {
      candidate.excludedReason = "budget_cap";
      continue;
    }
    const tokens = estimateTokens(candidate.inputTextPreview);
    if (
      current.length > 0 &&
      (current.length >= config.maxItemsPerBatch || currentTokens + tokens > config.maxInputTokensPerBatch)
    ) {
      batches.push({ batchIndex: batches.length, contents: current });
      current = [];
      currentTokens = 0;
    }
    if (batches.length >= config.maxExtractionBatches) {
      candidate.excludedReason = "budget_cap";
      selectedIds.delete(candidate.content.id);
      continue;
    }
    candidate.selected = true;
    candidate.batchIndex = batches.length;
    current.push(candidate.content);
    currentTokens += tokens;
  }
  if (current.length && batches.length < config.maxExtractionBatches) batches.push({ batchIndex: batches.length, contents: current });

  for (const candidate of scored) {
    if (!candidate.selected && !candidate.excludedReason) candidate.excludedReason = "budget_cap";
  }
  return {
    candidates: scored,
    batches,
    eligibleCount: eligible.length,
    selectedCount: scored.filter((candidate) => candidate.selected).length
  };
}

function scoreCandidate(run: SourceRun, content: SourceContent, config: AiInsightConfig, seenKeys: Set<string>): InsightCandidate {
  const text = content.text.trim();
  const inputTextPreview = truncateText(text, config.textCharLimit);
  const duplicateKey = [content.externalId, content.url || normalizeTextKey(text)].filter(Boolean)[0] ?? normalizeTextKey(text);
  const selectionReasons: string[] = [];
  let selectionScore = 0;

  if (text.length < config.minTextChars) {
    return createExcludedCandidate(content, inputTextPreview, "too_short", selectionReasons);
  }
  if (run.excludeKeywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()))) {
    return createExcludedCandidate(content, inputTextPreview, "exclude_keyword", selectionReasons);
  }
  if (seenKeys.has(duplicateKey)) {
    return createExcludedCandidate(content, inputTextPreview, "duplicate", selectionReasons);
  }
  seenKeys.add(duplicateKey);

  const engagementScore = getEngagementScore(content.metricsJson);
  if (engagementScore > 0) {
    selectionScore += Math.min(40, engagementScore);
    selectionReasons.push("engagement");
  }
  if (/[?？]|advice|help|how|should|recommend|worried|concern|problem|need/i.test(text)) {
    selectionScore += 25;
    selectionReasons.push("explicit_need");
  }
  if (content.rawJson?.detail) {
    selectionScore += 20;
    selectionReasons.push("detail_available");
  }
  if (run.includeKeywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()))) {
    selectionScore += 15;
    selectionReasons.push("keyword_match");
  }
  selectionScore += Math.min(10, Math.floor(text.length / 80));
  if (!selectionReasons.length) selectionReasons.push("baseline_content");

  return {
    content,
    selected: false,
    selectionScore,
    selectionReasons,
    inputTextPreview
  };
}

function createExcludedCandidate(
  content: SourceContent,
  inputTextPreview: string,
  excludedReason: string,
  selectionReasons: string[]
): InsightCandidate {
  return {
    content,
    selected: false,
    selectionScore: 0,
    selectionReasons,
    excludedReason,
    inputTextPreview
  };
}

function toAnalyzerContent(content: SourceContent, config: AiInsightConfig): AiInsightContentInput {
  return {
    id: content.id,
    url: content.url,
    text: truncateText(content.text, config.textCharLimit),
    mediaUrls: content.mediaUrls,
    metricsJson: slimMetrics(content.metricsJson),
    rawJson: { detail: truncateUnknown(content.rawJson?.detail, config.detailCharLimit) },
    authorName: content.authorName,
    publishedAt: content.publishedAt
  };
}

function slimMetrics(metrics: Record<string, unknown> | null) {
  if (!metrics) return null;
  return {
    score: metrics.score,
    comments: metrics.comments ?? metrics.num_comments,
    subreddit: metrics.subreddit
  };
}

function keepEvidenceBackedInsights(items: PostInsight[], batchContents: SourceContent[]) {
  const sourceById = new Map(batchContents.map((content) => [content.id, content]));
  return items.filter((item) => {
    const source = sourceById.get(item.rawContentId);
    if (!source) return false;
    return item.evidence.some((evidence) => evidence.rawContentId === item.rawContentId && source.text.includes(evidence.quote));
  });
}

function mergeBatchSummaries(summaries: RunInsightSummary[]): RunInsightSummary {
  return {
    themes: summaries.flatMap((summary) => summary.themes).slice(0, 8),
    opportunityTypes: uniqueStrings(summaries.flatMap((summary) => summary.opportunityTypes)),
    topDemandSignals: uniqueStrings(summaries.flatMap((summary) => summary.topDemandSignals)),
    recommendedNextActions: uniqueStrings(summaries.flatMap((summary) => summary.recommendedNextActions)),
    dataLimitations: uniqueStrings(summaries.flatMap((summary) => summary.dataLimitations))
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function estimateTokens(value: string) {
  return Math.ceil(value.length / 4);
}

function truncateText(value: string, limit: number) {
  return value.length > limit ? value.slice(0, limit) : value;
}

function truncateUnknown(value: unknown, limit: number) {
  if (!value) return null;
  return truncateText(typeof value === "string" ? value : JSON.stringify(value), limit);
}

function normalizeTextKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 160);
}

function buildRunSummary(summaryJson: unknown, itemRows: PersistedInsight[], contents: SourceContent[]) {
  const summary = normalizeSummary(summaryJson);
  return {
    totalContents: contents.length,
    totalInsights: itemRows.length,
    totalEngagement: contents.reduce((sum, item) => sum + getEngagementScore(item.metricsJson), 0),
    uniqueAuthors: countUniqueAuthors(contents),
    dataCompleteness: calculateCompleteness(contents),
    ...summary,
    opportunityTypes: countStrings(summary.opportunityTypes),
    topDemandSignals: countStrings(summary.topDemandSignals),
    topSubreddits: countStrings(contents.map((content) => getSubreddit(content.metricsJson)).filter(Boolean))
  };
}

function normalizeSummary(value: unknown): RunInsightSummary {
  const fallback: RunInsightSummary = {
    themes: [],
    opportunityTypes: [],
    topDemandSignals: [],
    recommendedNextActions: [],
    dataLimitations: ["尚未生成 AI 聚合洞察。"]
  };
  return value && typeof value === "object" ? { ...fallback, ...(value as Partial<RunInsightSummary>) } : fallback;
}

function toSourcePayload(source: SourceContent) {
  return {
    text: source.text,
    url: source.url,
    authorName: source.authorName,
    authorHandle: source.authorHandle,
    mediaUrls: source.mediaUrls,
    metricsJson: source.metricsJson,
    publishedAt: source.publishedAt
  };
}

function paginateRows(rows: PersistedInsight[], input: { page: number; pageSize: number }) {
  const sorted = [...rows].sort((a, b) => b.opportunityScore - a.opportunityScore);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const start = (input.page - 1) * input.pageSize;
  return {
    items: sorted.slice(start, start + input.pageSize),
    page: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages,
      hasNextPage: input.page < totalPages,
      hasPreviousPage: input.page > 1
    }
  };
}

function countStrings(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => ({ key, count }));
}

function countUniqueAuthors(contents: SourceContent[]) {
  return new Set(contents.map((content) => content.authorName ?? content.authorHandle).filter(Boolean)).size;
}

function calculateCompleteness(contents: SourceContent[]) {
  if (!contents.length) return 0;
  const score = contents.reduce((sum, content) => {
    const fields = [content.text, content.url, content.metricsJson, content.publishedAt, content.rawJson?.detail];
    return sum + fields.filter(Boolean).length / fields.length;
  }, 0);
  return Math.round((score / contents.length) * 100);
}

type InsightRepo = ReturnType<typeof createAnalyzedContentRepository>;
type PersistedInsight = Awaited<ReturnType<InsightRepo["listByRun"]>>[number];
type SourceContent = Awaited<ReturnType<ReturnType<typeof createRawContentRepository>["listByRunPage"]>>["items"][number];
type SourceRun = Awaited<ReturnType<ReturnType<typeof createAnalysisRunRepository>["getById"]>> & {};

interface AiInsightConfig {
  maxItemsPerBatch: number;
  maxInputTokensPerBatch: number;
  maxExtractionBatches: number;
  maxCandidates: number;
  maxConcurrentBatches: number;
  maxInsightsPerBatch: number;
  textCharLimit: number;
  detailCharLimit: number;
  minTextChars: number;
}

interface InsightCandidate {
  content: SourceContent;
  selected: boolean;
  selectionScore: number;
  selectionReasons: string[];
  excludedReason?: string;
  batchIndex?: number;
  inputTextPreview: string;
}
