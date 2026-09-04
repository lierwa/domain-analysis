import { z } from "zod";

const id = z.string().min(1).max(240);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true });
export const knowledgeSourceRefSchema = z.object({
  taskId: id, runId: id, snapshotId: id, assetId: id.optional(), sha256: hash,
}).strict();
export const knowledgeBatchRefSchema = z.object({ taskId: id, batchId: id }).strict();
export const knowledgeInputSchema = z.object({
  ref: knowledgeSourceRefSchema, key: hash, providerKey: id,
  subjectKey: z.string().min(1).max(1_000), subjectName: z.string().min(1).max(1_000),
  label: z.string().min(1).max(1_000), url: z.string().url(),
  format: z.enum(["html", "image", "pdf", "text", "unsupported"]),
  mediaType: z.string(), bytes: z.number().int().nonnegative(), capturedAt: date,
  availability: z.enum(["ready", "blocked"]), reason: z.string().optional(),
}).strict();
export const knowledgeSettingsSchema = z.object({
  ocr: z.boolean().default(false), budgetSeconds: z.number().int().min(30).max(600).default(120),
  requiredInputKeys: z.array(hash).max(200).default([]),
}).strict();
export const knowledgePackCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  skillName: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64),
  scope: z.string().trim().min(1).max(2_000),
}).strict();
export const knowledgeRevisionRequestSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const knowledgeSelectionRequestSchema = knowledgeRevisionRequestSchema.extend({
  skillName: knowledgePackCreateSchema.shape.skillName,
  selection: z.array(knowledgeBatchRefSchema).min(1).max(20),
}).strict();
export const knowledgePackSchema = knowledgePackCreateSchema.extend({
  id, revision: z.number().int().positive(), selectionRevision: z.number().int().positive(),
  selection: z.array(knowledgeBatchRefSchema).max(20),
  settings: knowledgeSettingsSchema, createdAt: date, updatedAt: date,
}).strict();
export const knowledgeCandidateSchema = z.object({
  id: hash, kind: z.enum(["text", "image"]),
  label: z.string().max(1_000), text: z.string().max(100_000), locator: z.string().max(4_000),
  // WHY：审核绑定提取内容哈希；重新提取出的另一份文字不能沿用过期决定。
  contentHash: hash, box: z.array(z.tuple([z.number(), z.number()])).optional(),
  confidence: z.number().min(0).max(1).optional(),
}).strict();
export const knowledgeDerivativeSchema = z.object({
  sha256: hash, bytes: z.number().int().positive(), width: z.number().int().positive(),
  height: z.number().int().positive(), originalSha256: hash, maskSha256: hash.optional(),
  method: z.enum(["opencv-telea", "opencv-copy"]), boundaryCuts: z.array(z.number().int().nonnegative()),
  outsideMaskChangedPixels: z.literal(0),
  automation: z.object({ action: z.enum(["keep", "remove_watermark"]), confidence: z.literal("high"),
    candidateIds: z.array(hash).max(500) }).strict().optional(),
}).strict();
export const knowledgeExtractionSchema = z.object({
  toolVersion: z.string().min(1), cacheKey: hash, reused: z.boolean(),
  candidates: z.array(knowledgeCandidateSchema).max(2_000), notes: z.array(z.string().max(2_000)).max(20),
  dimensions: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
}).strict();
export const knowledgeAttemptSchema = z.object({
  startedAt: date, finishedAt: date, status: z.enum(["completed", "failed", "stopped"]),
  seconds: z.number().nonnegative(), error: z.string().max(2_000).optional(),
}).strict();
export const knowledgeItemSchema = z.object({
  id, runId: id, input: knowledgeInputSchema, status: z.enum(["pending", "running", "completed", "failed"]),
  attempts: z.array(knowledgeAttemptSchema), result: knowledgeExtractionSchema.optional(),
  derivative: knowledgeDerivativeSchema.optional(), error: z.string().optional(),
}).strict();
export const knowledgeRunSchema = z.object({
  id, packId: id, sourceRevision: z.number().int().positive(),
  inputs: z.array(knowledgeInputSchema).max(20_000), settings: knowledgeSettingsSchema, inputHash: hash,
  toolVersion: z.string().min(1).max(1_000), llmCalls: z.literal(0), llmTokens: z.literal(0),
  generation: z.number().int().positive(), reviewRevision: z.number().int().nonnegative(),
  stage: z.enum(["extract", "review"]),
  status: z.enum(["queued", "running", "completed", "partial", "stopped", "failed"]),
  stopRequested: z.boolean(), startedAt: date.optional(), finishedAt: date.optional(), createdAt: date,
  error: z.string().optional(),
}).strict();
export const knowledgeAiRecommendationSchema = z.object({
  protocol: z.literal("automatic-review-2").optional(),
  issueId: hash,
  recommendation: z.enum(["accept", "exclude", "human_action"]),
  confidence: z.enum(["high", "medium", "low"]),
  candidateIds: z.array(hash).max(500),
  imageAction: z.enum(["keep", "remove_watermark", "exclude"]).optional(),
  maskCandidateIds: z.array(hash).max(100).optional(),
  rationale: z.string().trim().min(1).max(2_000),
}).strict();
export const knowledgeAiReviewSchema = z.object({
  id, runId: id, issueFingerprint: hash, generation: z.number().int().positive(),
  reviewRevision: z.number().int().nonnegative(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  model: z.string().min(1).max(200), reasoningEffort: z.string().min(1).max(40),
  recommendations: z.array(knowledgeAiRecommendationSchema).max(50_000),
  createdAt: date, startedAt: date.optional(), finishedAt: date.optional(), error: z.string().max(2_000).optional(),
}).strict();
export const knowledgeReviewRequestSchema = knowledgeRevisionRequestSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  candidateIds: z.array(hash).min(1).max(500), decision: z.enum(["accepted", "pending", "excluded"]),
  factKey: z.string().trim().min(1).max(240).optional(), dependsOn: z.array(hash).max(500).default([]),
  reason: z.string().trim().min(1).max(2_000), visualApproved: z.boolean().default(false),
  contentApproved: z.boolean().default(false), humanSeconds: z.number().int().min(0).max(86_400).default(0),
}).strict();
export const knowledgeDecisionSchema = knowledgeReviewRequestSchema.omit({ expectedRevision: true }).extend({
  id, runId: id, revision: z.number().int().positive(), contentHashes: z.record(hash, hash), createdAt: date,
}).strict();
export const knowledgeResourceSchema = z.object({
  name: z.string(), path: z.string(), bytes: z.number().int().nonnegative(), hash: z.string(), mediatype: z.string(),
}).strict();
export const knowledgeArtifactSchema = z.object({
  format: z.enum(["agent-skill", "data-package-2"]).default("data-package-2"),
  skillName: knowledgePackCreateSchema.shape.skillName.optional(),
  entrypoint: z.string().optional(),
  sha256: hash, bytes: z.number().int().positive(), resources: z.array(knowledgeResourceSchema),
  accepted: z.number().int().nonnegative(), images: z.number().int().nonnegative(),
  quarantined: z.number().int().nonnegative(), gaps: z.array(z.string()), contentHashes: z.record(hash, hash),
  changes: z.object({ added: z.number().int(), removed: z.number().int(), modified: z.number().int() }).strict(),
}).strict();
export const knowledgeVersionSchema = z.object({
  id, packId: id, runId: id, number: z.number().int().positive(), generation: z.number().int().positive(),
  packRevision: z.number().int().positive(),
  reviewRevision: z.number().int().nonnegative(), inputHash: hash,
  status: z.enum(["building", "ready", "failed", "published"]),
  artifact: knowledgeArtifactSchema.optional(), error: z.string().optional(), createdAt: date,
  startedAt: date.optional(), publishedAt: date.optional(),
}).strict();
export const knowledgePackViewSchema = z.object({
  pack: knowledgePackSchema, runs: z.array(knowledgeRunSchema), versions: z.array(knowledgeVersionSchema),
}).strict();
export const knowledgeAdmissionSchema = z.object({
  candidates: z.array(z.object({ candidateId: hash, decision: z.enum(["accepted", "pending", "excluded"]),
    admitted: z.boolean(), automatic: z.boolean(), reason: z.string(), factKeys: z.array(z.string()),
    dependsOn: z.array(hash) }).strict()),
  accepted: z.number().int().nonnegative(), images: z.number().int().nonnegative(),
  autoAccepted: z.number().int().nonnegative(), reviewAccepted: z.number().int().nonnegative(),
  excluded: z.number().int().nonnegative(), openIssues: z.number().int().nonnegative(),
  quarantined: z.number().int().nonnegative(), gaps: z.array(z.string()),
}).strict();
export const knowledgeReviewIssueSchema = z.object({
  id: hash,
  code: z.enum(["processing_failed", "empty_content", "unstructured_content", "ocr_requires_review",
    "image_requires_processing", "image_requires_review", "conflicting_values"]),
  title: z.string().min(1).max(300), summary: z.string().min(1).max(2_000),
  action: z.string().min(1).max(500), status: z.enum(["open", "resolved"]),
  itemIds: z.array(id).min(1), candidateIds: z.array(hash),
}).strict();
export const knowledgeRunViewSchema = z.object({
  run: knowledgeRunSchema, items: z.array(knowledgeItemSchema), decisions: z.array(knowledgeDecisionSchema),
  admission: knowledgeAdmissionSchema, issues: z.array(knowledgeReviewIssueSchema),
  versionInputHash: hash,
  aiReview: knowledgeAiReviewSchema.optional(),
}).strict();
export const knowledgeCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("extract"), runId: id, generation: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("build"), versionId: id }).strict(),
  z.object({ kind: z.literal("ai_review"), reviewId: id }).strict(),
]);
export const knowledgeCapabilitiesSchema = z.object({
  imageProcessing: z.boolean(), ocr: z.boolean(), aiReview: z.boolean().default(false),
  pdf: z.literal("review"), detail: z.string(),
}).strict();

export type KnowledgeSourceRef = z.infer<typeof knowledgeSourceRefSchema>;
export type KnowledgeBatchRef = z.infer<typeof knowledgeBatchRefSchema>;
export type KnowledgeInput = z.infer<typeof knowledgeInputSchema>;
export type KnowledgeSettings = z.infer<typeof knowledgeSettingsSchema>;
export type KnowledgePack = z.infer<typeof knowledgePackSchema>;
export type KnowledgeRun = z.infer<typeof knowledgeRunSchema>;
export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>;
export type KnowledgeCandidate = z.infer<typeof knowledgeCandidateSchema>;
export type KnowledgeExtraction = z.infer<typeof knowledgeExtractionSchema>;
export type KnowledgeAttempt = z.infer<typeof knowledgeAttemptSchema>;
export type KnowledgeDerivative = z.infer<typeof knowledgeDerivativeSchema>;
export type KnowledgeDecision = z.infer<typeof knowledgeDecisionSchema>;
export type KnowledgeReviewRequest = z.input<typeof knowledgeReviewRequestSchema>;
export type KnowledgeArtifact = z.infer<typeof knowledgeArtifactSchema>;
export type KnowledgeVersion = z.infer<typeof knowledgeVersionSchema>;
export type KnowledgePackView = z.infer<typeof knowledgePackViewSchema>;
export type KnowledgeRunView = z.infer<typeof knowledgeRunViewSchema>;
export type KnowledgeReviewIssue = z.infer<typeof knowledgeReviewIssueSchema>;
export type KnowledgeAiRecommendation = z.infer<typeof knowledgeAiRecommendationSchema>;
export type KnowledgeAiReview = z.infer<typeof knowledgeAiReviewSchema>;
export type KnowledgeCommand = z.infer<typeof knowledgeCommandSchema>;
