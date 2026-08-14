import { z } from "zod";

const idSchema = z.string().min(1);
const isoDateSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const pipelineStages = [
  "acquire",
  "project_material",
  "produce_candidates",
  "review",
  "evaluate",
  "build_package",
] as const;

export const pipelineLifecycleStatuses = [
  "queued",
  "running",
  "waiting_user",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export const frozenPipelineInputSchema = z.object({
  projectId: idSchema,
  projectRevision: z.number().int().positive(),
  categoryDefinitionVersionId: idSchema,
  categoryDefinitionHash: sha256Schema,
  confirmedScopeVersionId: idSchema,
  confirmedScopeHash: sha256Schema,
  collectionBoardVersionId: idSchema,
  collectionBoardHash: sha256Schema,
}).strict();

export const startPipelineInputSchema = z.object({
  input: frozenPipelineInputSchema,
  requestedBy: idSchema,
}).strict();

export const pipelineCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pause"), reason: z.string().min(1).max(1000) }).strict(),
  z.object({ type: z.literal("resume") }).strict(),
  z.object({ type: z.literal("cancel"), reason: z.string().min(1).max(1000) }).strict(),
  z.object({ type: z.literal("retry_stage"), stageExecutionId: idSchema }).strict(),
  z.object({
    type: z.literal("resolve_intervention"),
    interventionId: idSchema,
    resolutionId: idSchema,
  }).strict(),
]);

export const stageExecutionSchema = z.object({
  id: idSchema,
  stage: z.enum(pipelineStages),
  status: z.enum(["pending", "running", "waiting_user", "succeeded", "failed", "cancelled"]),
  attemptCount: z.number().int().min(0),
  startedAt: isoDateSchema.optional(),
  finishedAt: isoDateSchema.optional(),
  errorCode: z.string().min(1).optional(),
}).strict();

export const pipelineInterventionSchema = z.object({
  id: idSchema,
  stageExecutionId: idSchema,
  kind: z.enum(["login", "verification", "review", "approval", "source_abnormal"]),
  status: z.enum(["open", "resolved", "cancelled"]),
  prompt: z.string().min(1).max(2000),
  resolutionId: idSchema.optional(),
  createdAt: isoDateSchema,
  resolvedAt: isoDateSchema.optional(),
}).strict();

export const pipelineRunViewSchema = z.object({
  id: idSchema,
  workflowId: idSchema,
  forkedFromRunId: idSchema.optional(),
  input: frozenPipelineInputSchema,
  lifecycleStatus: z.enum(pipelineLifecycleStatuses),
  currentStage: z.enum(pipelineStages).optional(),
  stages: z.array(stageExecutionSchema),
  interventions: z.array(pipelineInterventionSchema),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict().superRefine((run, context) => {
  const stageIds = new Set(run.stages.map((stage) => stage.id));
  if (stageIds.size !== run.stages.length) {
    context.addIssue({ code: "custom", path: ["stages"], message: "阶段执行 ID 不得重复" });
  }
  if (run.currentStage && !run.stages.some((stage) => stage.stage === run.currentStage)) {
    context.addIssue({ code: "custom", path: ["currentStage"], message: "当前阶段必须存在对应执行记录" });
  }
  if (run.interventions.some((intervention) => !stageIds.has(intervention.stageExecutionId))) {
    context.addIssue({ code: "custom", path: ["interventions"], message: "人工事项必须绑定阶段执行" });
  }
  const hasOpenIntervention = run.interventions.some((intervention) => intervention.status === "open");
  if ((run.lifecycleStatus === "waiting_user") !== hasOpenIntervention) {
    context.addIssue({ code: "custom", path: ["lifecycleStatus"], message: "等待人工状态必须与开放人工事项一致" });
  }
});

export type FrozenPipelineInput = z.infer<typeof frozenPipelineInputSchema>;
export type StartPipelineInput = z.infer<typeof startPipelineInputSchema>;
export type PipelineCommand = z.infer<typeof pipelineCommandSchema>;
export type PipelineRunView = z.infer<typeof pipelineRunViewSchema>;

// WHY：调用者只学习启动、命令和查询；DBOS 的 workflow/step/message 类型全部留在 adapter 内。
export interface PipelineModule {
  start(input: StartPipelineInput): Promise<PipelineRunView>;
  command(runId: string, command: PipelineCommand): Promise<PipelineRunView>;
  get(runId: string): Promise<PipelineRunView | null>;
}
