import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { knowledgeClaimCandidateDraftSchema } from "@domain-analysis/shared";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { runCodexExec } from "./codexExecClient";
import type {
  KnowledgeCandidateModelInput,
  KnowledgeCandidateModelPort,
} from "./knowledgeFactoryModule";

const modelOutputSchema = z.object({
  claims: z.array(z.object({
    knowledgeNeedId: z.string().min(1).max(240),
    subjectKey: z.string().min(1).max(240),
    predicate: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
    value: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("text"), statement: z.string().min(1).max(20_000) }).strict(),
      z.object({ kind: z.literal("subject_ref"), subjectKey: z.string().min(1).max(240) }).strict(),
    ]),
    evidenceIds: z.array(z.string().min(1).max(240)).min(1),
    limitations: z.array(z.string().min(1).max(2_000)).max(20),
  }).strict()).max(500),
}).strict();

export interface CodexKnowledgeCandidateModelOptions {
  repositoryRoot: string;
  model: "gpt-5.3-codex-spark";
  reasoningEffort: "low";
  executable?: string;
  timeoutMs?: number;
}

export function createCodexKnowledgeCandidateModel(
  options: CodexKnowledgeCandidateModelOptions,
): KnowledgeCandidateModelPort {
  return { propose: (input) => propose(options, input) };
}

async function propose(
  options: CodexKnowledgeCandidateModelOptions,
  input: KnowledgeCandidateModelInput,
) {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), "domain-analysis-factory-model-"));
  try {
    const result = await runCodexExec({
      cwd: workingDirectory,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      executable: options.executable,
      timeoutMs: options.timeoutMs,
      webSearch: false,
      skipGitRepoCheck: true,
      packageRoot: options.repositoryRoot,
      outputSchema: zodToJsonSchema(modelOutputSchema, {
        target: "openAi",
        $refStrategy: "none",
      }),
    }, prompt(input));
    if (result.interrupted) throw new Error("知识候选模型执行被中断");
    return validateOutput(input, parseOutput(result.outputText ?? ""), options);
  } finally {
    // WHY：模型工作目录只承载本批次执行上下文，成功或失败后都不能遗留最小证据副本。
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

function validateOutput(
  input: KnowledgeCandidateModelInput,
  output: z.infer<typeof modelOutputSchema>,
  options: CodexKnowledgeCandidateModelOptions,
) {
  const materialByNeed = new Map(input.materials.map((material) => [material.knowledgeNeedId, material]));
  const candidates = output.claims.map((claim) => {
    const material = materialByNeed.get(claim.knowledgeNeedId);
    if (!material) throw new Error(`模型引用了批次外知识需求：${claim.knowledgeNeedId}`);
    if (!material.subjects.some(({ key }) => key === claim.subjectKey)) {
      throw new Error(`模型引用了知识需求范围外对象：${claim.subjectKey}`);
    }
    const allowedEvidenceIds = new Set(material.evidence.map(({ id }) => id));
    if (claim.evidenceIds.some((id) => !allowedEvidenceIds.has(id))) {
      throw new Error(`模型引用了批次外证据：${claim.evidenceIds.join(",")}`);
    }
    const subject = material.subjects.find(({ key }) => key === claim.subjectKey)!;
    const value = modelValue(claim.value, material.subjects);
    return knowledgeClaimCandidateDraftSchema.parse({
      knowledgeNeedId: claim.knowledgeNeedId,
      subject,
      knowledgeLayer: material.knowledgeLayer,
      predicate: claim.predicate,
      value,
      evidenceIds: [...new Set(claim.evidenceIds)].sort(),
      limitations: claim.limitations,
      derivation: {
        kind: "model",
        recipeVersion: input.recipeVersion,
        modelId: options.model,
        reasoningEffort: options.reasoningEffort,
      },
      status: "review_required",
    });
  });
  requireFoundationalOwnership(input, candidates);
  return candidates;
}

function requireFoundationalOwnership(
  input: KnowledgeCandidateModelInput,
  candidates: ReturnType<typeof knowledgeClaimCandidateDraftSchema.parse>[],
) {
  for (const material of input.materials) {
    const concepts = material.subjects.filter(({ kind }) => kind === "foundational_concept");
    const owners = material.subjects.filter(({ kind }) => kind !== "foundational_concept");
    for (const concept of concepts) {
      const hasConceptFact = candidates.some((candidate) =>
        candidate.knowledgeNeedId === material.knowledgeNeedId
        && candidate.subject.key === concept.key
        && candidate.value.kind !== "subject_ref");
      if (!hasConceptFact) throw new Error(`模型没有把底层事实归属到概念：${concept.key}`);
      if (owners.length === 0) continue;
      const hasRelation = candidates.some((candidate) =>
        candidate.knowledgeNeedId === material.knowledgeNeedId
        && owners.some(({ key }) => key === candidate.subject.key)
        && candidate.value.kind === "subject_ref"
        && candidate.value.subject.key === concept.key);
      if (!hasRelation) throw new Error(`模型没有建立对象到底层概念的关系：${concept.key}`);
    }
  }
}

function modelValue(
  value: z.infer<typeof modelOutputSchema>["claims"][number]["value"],
  subjects: KnowledgeCandidateModelInput["materials"][number]["subjects"],
) {
  if (value.kind === "text") return { kind: "text" as const, raw: value.statement };
  const subject = subjects.find(({ key }) => key === value.subjectKey);
  if (!subject) throw new Error(`模型关系引用了知识需求范围外对象：${value.subjectKey}`);
  return { kind: "subject_ref" as const, subject };
}

function parseOutput(text: string) {
  try {
    return modelOutputSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new Error(`知识候选模型输出无效：${error instanceof Error ? error.message : String(error)}`);
  }
}

function prompt(input: KnowledgeCandidateModelInput) {
  return [
    "你是商品知识工厂的候选映射器，只处理下面给出的最小证据，不搜索网络、不读取文件、不补充常识。",
    "把证据拆成原子知识候选；机制、适用条件、边界、取舍分别表达，不要把原文整段当作结论。",
    "当证据明确支持一个品类或型号使用/属于某底层概念时，可输出 subject_ref；关系两端都必须来自本知识需求的 subjects。",
    "若 subjects 同时含 foundational_concept 和品类/型号：机制、条件、边界、取舍文本必须归属 foundational_concept；品类/型号必须另输出一条 subject_ref 指向该概念。两者缺一不可。",
    "每条 claim 必须只引用同一个 knowledgeNeedId 下实际支持它的 evidenceIds；证据不足就不输出该 claim。",
    "predicate 使用领域中立的小写点分代码，例如 mechanism.energy_conversion、condition.operating_range、boundary.applicability、tradeoff.efficiency。",
    "输出只是 review_required 候选，禁止声称已确认或已发布。只返回 schema 要求的 JSON。",
    JSON.stringify(input),
  ].join("\n\n");
}
