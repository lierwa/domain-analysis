import { generateObject, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { AiProviderConfig } from "./aiProviderConfig";
import {
  runAiInsightOutputSchema,
  runInsightSummarySchema,
  type PostInsight,
  type RunAiInsightOutput,
  type RunInsightSummary
} from "./aiInsightSchemas";

export interface AiInsightRunInput {
  run: {
    name: string;
    goal?: string;
    includeKeywords: string[];
    excludeKeywords: string[];
    platform: string;
  };
  contents: AiInsightContentInput[];
  maxInsights?: number;
}

export interface AiInsightContentInput {
  id: string;
  url: string;
  text: string;
  mediaUrls?: string[] | null;
  metricsJson: Record<string, unknown> | null;
  rawJson: Record<string, unknown> | null;
  authorName?: string;
  publishedAt?: string;
}

export interface AiInsightAnalyzer {
  analyzeRun(input: AiInsightRunInput): Promise<RunAiInsightOutput>;
  summarizeRun?(input: AiInsightSummaryInput): Promise<RunInsightSummary>;
}

export interface AiInsightSummaryInput {
  run: AiInsightRunInput["run"];
  totalContents: number;
  insights: PostInsight[];
}

export function createVercelAiInsightAnalyzer(config: AiProviderConfig): AiInsightAnalyzer {
  const model = createLanguageModel(config);
  return {
    async analyzeRun(input) {
      const { object } = await generateObject({
        model,
        schema: runAiInsightOutputSchema,
        system: buildSystemPrompt(),
        prompt: buildUserPrompt(input)
      });
      return object;
    },
    async summarizeRun(input) {
      const { object } = await generateObject({
        model,
        schema: runInsightSummarySchema,
        system: buildSystemPrompt(),
        prompt: buildSummaryPrompt(input)
      });
      return object;
    }
  };
}

function createLanguageModel(config: AiProviderConfig): LanguageModel {
  if (config.provider === "anthropic") {
    return createAnthropic({ apiKey: config.apiKey })(config.model);
  }
  if (config.provider === "google") {
    return createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model);
  }
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    name: config.provider === "openai-compatible" ? "openai-compatible" : "openai"
  });
  return config.provider === "openai-compatible" ? openai.chat(config.model) : openai(config.model);
}

function buildSystemPrompt() {
  return [
    "你是社媒监听和消费者洞察分析师。",
    "只基于输入的 Reddit 帖子、正文、媒体 URL 和评论证据输出结构化 JSON。",
    "不要使用固定分类；needType 和 themeName 必须从本批数据语义中归纳。",
    "每条单帖洞察必须至少引用一条 evidence，quote 必须来自输入原文或评论。",
    "如果详情页、图片视觉或评论不足，要在 dataLimitations 中明确说明，并降低 confidence。"
  ].join("\n");
}

function buildUserPrompt(input: AiInsightRunInput) {
  const payload = {
    run: input.run,
    contents: input.contents.map((content) => ({
      id: content.id,
      url: content.url,
      text: content.text,
      mediaUrls: content.mediaUrls ?? [],
      metricsJson: content.metricsJson,
      detail: content.rawJson?.detail ?? null,
      authorName: content.authorName,
      publishedAt: content.publishedAt
    }))
  };
  return [
    "请分析这批 Reddit 数据，输出业务机会洞察。",
    `最多输出 ${input.maxInsights ?? 5} 条高价值单帖洞察；低信号内容不要强行输出。`,
    `输入 JSON：\n${JSON.stringify(payload, null, 2)}`
  ].join("\n");
}

function buildSummaryPrompt(input: AiInsightSummaryInput) {
  const payload = {
    run: input.run,
    totalContents: input.totalContents,
    insights: input.insights.map((insight) => ({
      rawContentId: insight.rawContentId,
      problemStatement: insight.problemStatement,
      needType: insight.needType,
      painPoints: insight.painPoints,
      recommendedAction: insight.recommendedAction,
      confidence: insight.confidence,
      evidence: insight.evidence.slice(0, 2)
    }))
  };
  return `请只基于这些候选洞察聚合 run summary，不要新增无证据结论。输入 JSON：\n${JSON.stringify(payload, null, 2)}`;
}
