import { z } from "zod";

const idSchema = z.string().min(1).max(240);
const isoDateSchema = z.string().datetime({ offset: true });
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const sourceKinds = [
  "brand_official",
  "retailer",
  "regulator",
  "standards_body",
  "technical_publisher",
  "industry_organization",
  "other",
] as const;

export const sourceAccessStates = ["public", "login_required", "restricted", "unavailable", "unknown"] as const;

export const modelCoveragePolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all_available_per_brand") }).strict(),
  z.object({
    mode: z.literal("max_models_per_brand"),
    maxModelsPerBrand: z.number().int().positive().max(10_000),
  }).strict(),
]);

export const brandSelectionPolicySchema = z.discriminatedUnion("mode", [
  // WHY：只用于读取历史任务；新任务必须在采访草案中显式确认可审计的来源筛选规则。
  z.object({ mode: z.literal("all_available_brands") }).strict(),
  z.object({
    mode: z.literal("source_brand_ranking"),
    scoreField: z.literal("comprehensive_score"),
    minimumScoreExclusive: z.number().finite(),
    maxBrands: z.number().int().positive().max(500),
  }).strict(),
]);

export const fixedExecutionCadencePolicySchema = z.object({
  mode: z.literal("fixed"),
  brandBatchSize: z.number().int().positive().max(100),
  modelsPerBrandPerRound: z.number().int().positive().max(100),
}).strict();

export const executionCadencePolicySchema = z.discriminatedUnion("mode", [
  // WHY：旧任务没有批次确认事实；读取时明确标为未指定，规划不能静默套用新默认。
  z.object({ mode: z.literal("unspecified") }).strict(),
  fixedExecutionCadencePolicySchema,
]);

export const sourceCandidateSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(500),
  publisher: z.string().min(1).max(500),
  entryUrl: z.string().url(),
  sourceKind: z.enum(sourceKinds),
  expectedContents: z.array(z.string().min(1).max(500)).min(1),
  observedFormats: z.array(z.string().min(1).max(120)),
  accessState: z.enum(sourceAccessStates),
  observedAt: isoDateSchema,
}).strict();

export const captureTaskContentSchema = z.object({
  originalRequest: z.string().min(1).max(20_000),
  category: z.object({
    code: z.string().regex(/^[a-z][a-z0-9_-]+$/),
    label: z.string().min(1).max(120),
  }).strict(),
  marketScope: z.string().min(1).max(1000),
  brandSelectionPolicy: brandSelectionPolicySchema.default({ mode: "all_available_brands" }),
  executionCadencePolicy: executionCadencePolicySchema.default({ mode: "unspecified" }),
  // WHY：每品牌业务完成边界由负责人在采访中确认；旧任务缺少该字段时按全量读取，避免改变既有任务含义。
  modelCoveragePolicy: modelCoveragePolicySchema.default({ mode: "all_available_per_brand" }),
  generalTopics: z.array(z.string().min(1).max(500)).min(1),
  categoryTopics: z.array(z.string().min(1).max(500)),
  sourceCandidates: z.array(sourceCandidateSchema),
  excludedContent: z.array(z.string().min(1).max(500)),
  unresolvedItems: z.array(z.object({
    key: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
    description: z.string().min(1).max(2000),
    owner: z.enum(["system", "user"]),
  }).strict()),
  decisionIds: z.array(idSchema),
}).strict();

export const captureTaskMaterializationSchema = captureTaskContentSchema.omit({
  sourceCandidates: true,
  unresolvedItems: true,
  decisionIds: true,
  brandSelectionPolicy: true,
  executionCadencePolicy: true,
  modelCoveragePolicy: true,
}).extend({
  // WHY：品牌选择和批次是负责人确认的任务事实；新任务不能依赖运行时隐藏默认值。
  brandSelectionPolicy: brandSelectionPolicySchema,
  executionCadencePolicy: fixedExecutionCadencePolicySchema,
  // WHY：新确认的草案必须显式携带采访结论，不能依赖旧任务兼容默认值。
  modelCoveragePolicy: modelCoveragePolicySchema,
  // WHY：采访草案确认后才做正式结构化；观察时间仍由 Workbench 在提交时统一写入。
  sourceCandidates: z.array(sourceCandidateSchema.omit({ observedAt: true })),
}).strict();

export const captureTaskSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(160),
  status: z.enum(["draft", "ready", "archived"]),
  revision: z.number().int().positive(),
  content: captureTaskContentSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  confirmedAt: isoDateSchema.optional(),
}).strict().superRefine((task, context) => {
  if (task.status === "ready" && !task.confirmedAt) {
    context.addIssue({ code: "custom", path: ["confirmedAt"], message: "已确认抓取任务必须记录确认时间" });
  }
});

export const captureTaskDraftVersionSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  version: z.number().int().positive(),
  status: z.enum(["draft", "confirmed", "superseded"]),
  contentHash: hashSchema,
  markdown: z.string().min(1).max(100_000),
  taskId: idSchema.optional(),
  createdAt: isoDateSchema,
  confirmedAt: isoDateSchema.optional(),
}).strict();

export type SourceCandidate = z.infer<typeof sourceCandidateSchema>;
export type BrandSelectionPolicy = z.infer<typeof brandSelectionPolicySchema>;
export type ExecutionCadencePolicy = z.infer<typeof executionCadencePolicySchema>;
export type ModelCoveragePolicy = z.infer<typeof modelCoveragePolicySchema>;
export type CaptureTaskContent = z.infer<typeof captureTaskContentSchema>;
export type CaptureTaskMaterialization = z.infer<typeof captureTaskMaterializationSchema>;
export type CaptureTask = z.infer<typeof captureTaskSchema>;
export type CaptureTaskDraftVersion = z.infer<typeof captureTaskDraftVersionSchema>;

export function captureTaskRequiresImages(content: CaptureTaskContent) {
  // WHY：图片可以是跨品类通用捕获内容，也可以是品类补充内容；两组都是 Capture Task 的同级正向事实。
  return [...content.generalTopics, ...content.categoryTopics]
    .some((topic) => /(?:图集|商品原图|产品图片|型号图片|来源原图)/.test(topic));
}
