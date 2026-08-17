import { z } from "zod";

import {
  sourceClaimScopes,
  sourceDatasetContentSchema,
  sourceDatasetObjectInputSchema,
  sourceDatasetObservationSchema,
  sourceParsingSchema,
  sourceRelationSchema,
  sourceUsagePermissionSchema,
} from "./source-dataset";

const idSchema = z.string().min(1).max(240);
const isoDateSchema = z.string().datetime({ offset: true });

export const sourceCollectionRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("full_resource") }).strict(),
  z.object({
    kind: z.literal("document_excerpt"),
    requiredIdentityText: z.string().min(1).max(1000),
    requiredSectionTerms: z.array(z.string().min(1).max(240)).min(1).max(10),
    section: z.string().min(1).max(500),
    maximumSourceBytes: z.number().int().positive().max(20 * 1024 * 1024),
    maximumExcerptBytes: z.number().int().positive().max(256 * 1024),
  }).strict(),
  z.object({
    kind: z.literal("structured_record_lookup"),
    fields: z.array(z.object({
      code: idSchema,
      value: z.string().trim().min(1).max(1000),
    }).strict()).min(1).max(10),
    maximumBytes: z.number().int().positive().max(64 * 1024),
  }).strict(),
]);

export const sourceCollectionWorkItemSchema = z.object({
  id: idSchema,
  object: sourceDatasetObjectInputSchema,
  requestedUrl: z.string().url(),
  // WHY：只表达通用的资源选择方式；具体来源 adapter 负责把字段码收窄为它支持的外部协议。
  request: sourceCollectionRequestSchema.optional(),
  targetKeys: z.array(idSchema).min(1),
  knowledgeNeedIds: z.array(idSchema).min(1),
  parsing: sourceParsingSchema,
  claimScopes: z.array(z.enum(sourceClaimScopes)).min(1),
  usagePermission: sourceUsagePermissionSchema,
}).strict();

export const startSourceCollectionPipelineSchema = z.object({
  sourceRunId: idSchema,
  workItems: z.array(sourceCollectionWorkItemSchema).min(1).max(100_000),
}).strict().superRefine((input, context) => {
  const ids = new Set<string>();
  for (const [index, item] of input.workItems.entries()) {
    if (ids.has(item.id)) {
      context.addIssue({
        code: "custom",
        path: ["workItems", index, "id"],
        message: "工作项 id 不能重复",
      });
    }
    ids.add(item.id);
  }
});

export const sourceCollectionProviderResultSchema = z.object({
  accessStartedAt: isoDateSchema,
  accessFinishedAt: isoDateSchema,
  observation: sourceDatasetObservationSchema,
  content: sourceDatasetContentSchema.optional(),
  relations: z.array(sourceRelationSchema),
  stopRun: z.boolean(),
}).strict().superRefine((result, context) => {
  if (Date.parse(result.accessFinishedAt) < Date.parse(result.accessStartedAt)) {
    context.addIssue({
      code: "custom",
      path: ["accessFinishedAt"],
      message: "访问结束时间不能早于开始时间",
    });
  }
  if (result.observation.state === "accessible" && !result.content) {
    context.addIssue({ code: "custom", path: ["content"], message: "可访问结果必须带来源内容" });
  }
  if (result.observation.state !== "accessible" && result.content) {
    context.addIssue({ code: "custom", path: ["content"], message: "失败结果不能带来源内容" });
  }
  if (result.stopRun && result.observation.state === "accessible") {
    context.addIssue({ code: "custom", path: ["stopRun"], message: "可访问结果不能触发来源停止" });
  }
});

export const sourceCollectionPipelineRunSchema = z.object({
  id: idSchema,
  sourceRunId: idSchema,
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  lifecycleStatus: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  totalItems: z.number().int().positive(),
  completedItems: z.number().int().nonnegative(),
  currentItemId: idSchema.optional(),
  recentRequestStartedAt: z.array(isoDateSchema).max(10_000),
  lastRequestFinishedAt: isoDateSchema.optional(),
  errorCode: idSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict().superRefine((run, context) => {
  if (run.completedItems > run.totalItems) {
    context.addIssue({
      code: "custom",
      path: ["completedItems"],
      message: "完成工作项不能超过总数",
    });
  }
  if (run.lifecycleStatus === "failed" && !run.errorCode) {
    context.addIssue({ code: "custom", path: ["errorCode"], message: "失败运行必须记录错误码" });
  }
});

export type SourceCollectionWorkItem = z.infer<typeof sourceCollectionWorkItemSchema>;
export type SourceCollectionRequest = z.infer<typeof sourceCollectionRequestSchema>;
export type StartSourceCollectionPipeline = z.infer<typeof startSourceCollectionPipelineSchema>;
export type SourceCollectionProviderResult = z.infer<typeof sourceCollectionProviderResultSchema>;
export type SourceCollectionPipelineRun = z.infer<typeof sourceCollectionPipelineRunSchema>;

export interface SourceCollectionProviderPort {
  collect(context: {
    sourceRun: import("./source-dataset").SourceCollectionRun;
    item: SourceCollectionWorkItem;
    abortSignal?: AbortSignal;
  }): Promise<SourceCollectionProviderResult>;
  cancel(sourceRunId: string, reason: string): void;
}
