import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { knowledgeAiRecommendationSchema, type KnowledgeReviewIssue } from "@domain-analysis/shared";
import { z } from "zod";
import { createCodexAppServerClient, type CodexAppServerAttachment,
  type CodexAppServerClient } from "../codexAppServerClient";
import { parseCodexStructuredOutput, zodSchemaToCodexOutputSchema } from "../codexStructuredOutput";

const automaticRecommendationSchema = knowledgeAiRecommendationSchema.extend({
  protocol: z.literal("automatic-review-2"),
});
const modelRecommendationSchema = automaticRecommendationSchema.extend({
  issueId: z.string(),
  candidateIds: z.array(z.string()).max(500),
  imageAction: z.enum(["keep", "remove_watermark", "exclude"]).nullable(),
  maskCandidateIds: z.array(z.string()).max(100).nullable(),
});
const modelOutputSchema = z.object({
  recommendations: z.array(modelRecommendationSchema).max(100),
}).strict();

export interface KnowledgeAiReviewInput {
  pack: { name: string; scope: string };
  issues: Array<KnowledgeReviewIssue & { humanRequired: boolean; candidates: Array<{
    id: string; subject: string; label: string; text: string; locator: string; sourceUrl: string;
    confidence?: number; box?: number[][];
  }>; imageSlots: string[] }>;
  attachments: CodexAppServerAttachment[];
}

export interface KnowledgeAiReviewer {
  identity: { model: string; reasoningEffort: string };
  review(input: KnowledgeAiReviewInput, signal?: AbortSignal): Promise<z.infer<typeof automaticRecommendationSchema>[]>;
  close(): Promise<void>;
}

export function createCodexKnowledgeAiReviewer(options: {
  repositoryRoot: string; model: string; reasoningEffort: string; executable?: string;
}): KnowledgeAiReviewer {
  const cwd = path.join(tmpdir(), "domain-analysis-knowledge-ai-review");
  const client = createCodexAppServerClient({ cwd, packageRoot: options.repositoryRoot,
    model: options.model, reasoningEffort: options.reasoningEffort, executable: options.executable,
    timeoutMs: 180_000, webSearch: false });
  return {
    identity: { model: options.model, reasoningEffort: options.reasoningEffort },
    async review(input, signal) {
      await mkdir(cwd, { recursive: true });
      return runReview(client, input, signal);
    },
    close: () => client.close(),
  };
}

async function runReview(client: CodexAppServerClient, input: KnowledgeAiReviewInput, signal?: AbortSignal) {
  let correction = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let outputText = "";
    let observedItemTypes: string[] = [];
    for await (const event of client.run(prompt(input, correction), signal, undefined,
      zodSchemaToCodexOutputSchema(modelOutputSchema), undefined, input.attachments)) {
      if (event.type === "result") {
        if (event.result.interrupted) throw new Error("自动判断已中断");
        outputText = event.result.outputText ?? "";
        observedItemTypes = event.result.observedItemTypes;
      }
    }
    const sideEffects = observedItemTypes.filter(type =>
      ["command_execution", "file_change", "mcp_tool_call", "dynamic_tool_call", "web_search"].includes(type));
    // WHY：判断证据已经随请求给足；拒绝工具调用，避免模型从工作区或网络引入第二套事实源。
    if (sideEffects.length) throw new Error(`自动判断执行了不允许的工具：${sideEffects.join(", ")}`);
    try {
      return parseKnowledgeAiReviewOutput(input, outputText);
    } catch (error) {
      if (attempt === 1) throw error;
      // WHY：只把既有协议错误回填一次，让模型修正外部输出形状；业务规则仍由同一校验函数决定。
      correction = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error("自动判断没有返回结果");
}

export function parseKnowledgeAiReviewOutput(input: KnowledgeAiReviewInput, outputText: string) {
  const output = parseCodexStructuredOutput({ text: outputText, schema: modelOutputSchema,
    label: "知识内容自动判断结果", observedEvents: [] });
  // WHY：OpenAI 结构化输出会把不适用的可选字段写成 null；只在外部 seam 归一化，不放宽内部协议。
  const recommendations = output.recommendations.map(value => automaticRecommendationSchema.parse({ ...value,
    imageAction: value.imageAction ?? undefined, maskCandidateIds: value.maskCandidateIds ?? [] }));
  validateCoverage(input, recommendations);
  return recommendations;
}

function validateCoverage(input: KnowledgeAiReviewInput, recommendations: z.infer<typeof automaticRecommendationSchema>[]) {
  const issues = new Map(input.issues.map(issue => [issue.id, issue]));
  if (recommendations.length !== issues.size || new Set(recommendations.map(row => row.issueId)).size !== issues.size) {
    throw new Error("自动判断没有逐项返回全部问题");
  }
  for (const row of recommendations) {
    const issue = issues.get(row.issueId);
    if (!issue || row.candidateIds.some(id => !issue.candidateIds.includes(id))) throw new Error("自动判断引用了范围外候选");
    const evidence = new Set(issue.candidates.filter(value => value.box).map(value => value.id));
    if ((row.maskCandidateIds ?? []).some(id => !evidence.has(id))) throw new Error("AI 去水印引用了范围外 OCR 坐标");
    if (["image_requires_processing", "image_requires_review"].includes(issue.code)) validateImageAction(row, issue);
    else if (row.imageAction || row.maskCandidateIds?.length) throw new Error("非图片问题不应返回图片操作");
    if (row.recommendation === "human_action" && issue.code !== "conflicting_values") {
      throw new Error("只有来源冲突可以进入人工判断");
    }
  }
}

function validateImageAction(row: z.infer<typeof knowledgeAiRecommendationSchema>, issue: KnowledgeReviewIssue) {
  if (!row.imageAction) throw new Error("AI 图片判断缺少自动处理动作");
  if (row.imageAction === "exclude" && row.recommendation !== "exclude") throw new Error("AI 图片隔离动作与结论不一致");
  if (row.imageAction !== "exclude" && row.recommendation !== "accept") throw new Error("AI 图片处理动作与结论不一致");
  if (row.recommendation === "accept" && (row.candidateIds.length !== issue.candidateIds.length
    || row.candidateIds.some(id => !issue.candidateIds.includes(id)))) throw new Error("AI 图片采用结论缺少图片候选");
  if (row.recommendation === "exclude" && row.candidateIds.length) throw new Error("AI 图片隔离结论不应采用候选");
  if (row.imageAction === "remove_watermark" && !row.maskCandidateIds?.length) throw new Error("AI 去水印没有定位文字框");
  if (row.imageAction !== "remove_watermark" && row.maskCandidateIds?.length) throw new Error("AI 图片动作包含无关遮罩");
  if (issue.code === "image_requires_review" && row.imageAction === "remove_watermark") {
    throw new Error("图片副本验收不能再次修改图片");
  }
}

function prompt(input: KnowledgeAiReviewInput, correction = "") {
  const evidence = input.issues.map(issue => ({ id: issue.id, code: issue.code, title: issue.title,
    summary: issue.summary, humanRequired: issue.humanRequired, candidates: issue.candidates,
    imageSlots: issue.imageSlots }));
  return [
    "你在知识包生产线上做一次有界自动判断。只使用下面的候选、来源定位和随消息附带的图片，不读取本地文件，不执行命令，不联网。",
    `知识包：${JSON.stringify(input.pack)}`,
    `待审问题：${JSON.stringify(evidence)}`,
    "逐个 issueId 返回一条 recommendation，每条 protocol 固定为 automatic-review-2。OCR 的 candidateIds 只列可直接入包的完整、准确、有用文字；不要列站点标识、水印、装饰文字、截断片段、重复项和低置信内容。没有可用文字时返回 exclude 和空 candidateIds。",
    "unstructured_content 的 candidateIds 只列明确属于当前知识包范围的完整片段；范围不明或证据不足的片段不入包。",
    "OCR 必须结合 confidence、box 与对应 imageSlots 原图核对型号、数字、小数点、单位和否定。置信度只是识别证据，不代表文字属于知识内容。",
    "image_requires_processing 必须返回 imageAction：清晰且无水印为 keep；能由 OCR 框准确定位的水印为 remove_watermark，并在 maskCandidateIds 只列水印文字框；图片无关、低质或无法安全定位水印时为 exclude。keep/remove_watermark 使用 accept 并采用该问题的图片 candidateId，exclude 使用 exclude 和空 candidateIds。",
    "image_requires_review 必须对照原图与处理副本：内容完整、无可见修补痕迹且目标水印已清除时返回 keep、accept 和图片 candidateId；否则返回 exclude、exclude 和空 candidateIds。不得要求人修图或再次处理。",
    "只有 conflicting_values 来源冲突可以返回 human_action。不要把来源声誉、常识或猜测当作候选事实。",
    "非图片问题的 imageAction 必须为 null，未选择遮罩时 maskCandidateIds 必须为 null；所有 ID 必须逐字复制输入中的完整 ID。",
    correction ? `上次结果未通过本地协议校验：${correction}\n请按相同证据重新完整输出全部问题。` : "",
    "只在 final_answer 输出符合 schema 的 JSON，不输出 Markdown。",
  ].join("\n\n");
}
