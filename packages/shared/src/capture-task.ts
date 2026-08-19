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

export const defaultJdStandardProductScope = [
  "category_taxonomy",
  "category_filters",
  "brand_filters",
  "jd_self_operated",
  "brand_flagship_stores",
  "product_details",
  "product_parameters",
  "product_media",
  "review_samples",
  "positive_rate",
  "negative_rate",
] as const;

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

export const jdCollectionIntentSchema = z.object({
  applicable: z.boolean(),
  disposition: z.enum(["included", "excluded", "pending"]),
  scope: z.array(z.enum(defaultJdStandardProductScope)),
  rationale: z.string().min(1).max(2000),
}).strict();

export const captureTaskContentSchema = z.object({
  originalRequest: z.string().min(1).max(20_000),
  category: z.object({
    code: z.string().regex(/^[a-z][a-z0-9_-]+$/),
    label: z.string().min(1).max(120),
  }).strict(),
  marketScope: z.string().min(1).max(1000),
  generalTopics: z.array(z.string().min(1).max(500)).min(1),
  categoryTopics: z.array(z.string().min(1).max(500)),
  jd: jdCollectionIntentSchema,
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
}).extend({
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
export type JdCollectionIntent = z.infer<typeof jdCollectionIntentSchema>;
export type CaptureTaskContent = z.infer<typeof captureTaskContentSchema>;
export type CaptureTaskMaterialization = z.infer<typeof captureTaskMaterializationSchema>;
export type CaptureTask = z.infer<typeof captureTaskSchema>;
export type CaptureTaskDraftVersion = z.infer<typeof captureTaskDraftVersionSchema>;

export function applyDefaultJdSourcePolicy(content: CaptureTaskContent): CaptureTaskContent {
  if (!content.jd.applicable) {
    return {
      ...content,
      jd: {
        ...content.jd,
        disposition: "excluded",
        scope: [],
      },
    };
  }
  return {
    ...content,
    jd: {
      applicable: true,
      disposition: "included",
      scope: [...defaultJdStandardProductScope],
      // WHY：标准商品在京东可售时，平台覆盖是来源策略而非负责人取舍；模型只负责调查适用性。
      rationale: "该标准商品适用于京东，按平台默认来源策略覆盖类目、商品、参数、媒体与评价指标。",
    },
  };
}
