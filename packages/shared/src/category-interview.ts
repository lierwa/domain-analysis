import { z } from "zod";

import { captureTaskContentSchema, captureTaskDraftVersionSchema } from "./capture-task";

const idSchema = z.string().min(1).max(240);
const isoDateSchema = z.string().datetime({ offset: true });
const revisionSchema = z.number().int().positive();

export const interviewPhases = ["active", "task_ready", "confirmed"] as const;
export const interviewTurnStates = ["idle", "running", "interrupted", "failed"] as const;

export const interviewSessionSchema = z.object({
  id: idSchema,
  initialRequest: z.string().max(20_000),
  phase: z.enum(interviewPhases),
  turnState: z.enum(interviewTurnStates),
  revision: revisionSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict();

export const interviewActivityKinds = ["agent", "analysis", "web_search", "tool", "finalizing"] as const;
export const interviewTurnActivitySchema = z.object({
  id: idSchema,
  kind: z.enum(interviewActivityKinds),
  label: z.string().min(1).max(200),
  detail: z.string().min(1).max(1000).optional(),
  // WHY：单个 App Server 搜索项最多提取 50 个网址，但同一轮会聚合多个搜索项；这里覆盖完整有序时间线的理论上限，避免聚合后整条记录校验失败并消失。
  urls: z.array(z.string().url().max(2048)).max(10_000).optional(),
  status: z.enum(["running", "completed", "failed"]),
}).strict();
export const interviewMessageTimelinePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(40_000) }).strict(),
  z.object({ type: z.literal("activity"), activity: interviewTurnActivitySchema }).strict(),
]);

export const normalizedInterviewMessageSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  sequence: z.number().int().positive(),
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(40_000),
  deliveryStatus: z.enum(["completed", "interrupted", "failed"]),
  error: z.string().min(1).max(2000).optional(),
  timelineParts: z.array(interviewMessageTimelinePartSchema).max(200).optional(),
  createdAt: isoDateSchema,
}).strict();

const decisionOptionSchema = z.object({
  label: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  recommended: z.boolean(),
}).strict();

export const interviewDecisionConfirmationSchema = z.object({
  expectedRevision: revisionSchema,
  selection: z.string().trim().min(1).max(2000),
}).strict();

export const interviewDecisionSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  key: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
  question: z.string().min(1).max(1000),
  options: z.array(decisionOptionSchema).min(2).max(3),
  selection: z.string().min(1).max(2000),
  rationale: z.string().min(1).max(4000),
  status: z.enum(["proposed", "confirmed", "superseded"]),
  sourceMessageId: idSchema,
  supersedesDecisionId: idSchema.optional(),
  createdAt: isoDateSchema,
  confirmedAt: isoDateSchema.optional(),
}).strict();

export const interviewUnresolvedItemSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  key: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
  description: z.string().min(1).max(2000),
  owner: z.enum(["system", "user"]),
  status: z.enum(["open", "resolved"]),
  resolution: z.string().min(1).max(4000).optional(),
  createdAt: isoDateSchema,
  resolvedAt: isoDateSchema.optional(),
}).strict();

export const categoryInterviewViewSchema = z.object({
  session: interviewSessionSchema,
  messages: z.array(normalizedInterviewMessageSchema),
  decisions: z.array(interviewDecisionSchema),
  unresolvedItems: z.array(interviewUnresolvedItemSchema),
  taskDrafts: z.array(captureTaskDraftVersionSchema),
}).strict();

export const interviewTurnRequestSchema = z.discriminatedUnion("trigger", [
  z.object({ trigger: z.literal("user_message"), expectedRevision: revisionSchema,
    text: z.string().min(1).max(20_000), retryMessageId: idSchema.optional() }).strict(),
  z.object({ trigger: z.literal("decision_confirmed"), expectedRevision: revisionSchema,
    decisionId: idSchema }).strict(),
]);

const proposedDecisionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
  question: z.string().min(1).max(1000),
  options: z.array(decisionOptionSchema).min(2).max(3),
  selection: z.string().min(1).max(2000),
  rationale: z.string().min(1).max(4000),
}).strict().superRefine((decision, context) => {
  if (decision.options.filter((option) => option.recommended).length !== 1) {
    context.addIssue({ code: "custom", path: ["options"], message: "每个问题必须且只能有一个推荐选项" });
  }
});

const ownerQuestionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
  text: z.string().min(1).max(1000),
  options: z.array(decisionOptionSchema).min(2).max(3),
  rationale: z.string().min(1).max(4000),
}).strict().superRefine((question, context) => {
  if (question.options.filter((option) => option.recommended).length !== 1) {
    context.addIssue({ code: "custom", path: ["options"], message: "每个问题必须且只能有一个推荐选项" });
  }
});

export const categoryInterviewRuntimeOutputSchema = z.object({
  assistantText: z.string().min(1).max(40_000),
  question: ownerQuestionSchema.nullable().optional().transform((value) => value ?? undefined),
  proposedDecision: proposedDecisionSchema.nullable().optional().transform((value) => value ?? undefined),
  unresolvedItems: z.array(z.object({
    key: z.string().regex(/^[a-z][a-z0-9_.-]+$/),
    description: z.string().min(1).max(2000),
    owner: z.enum(["system", "user"]),
  }).strict()).nullable().default([]).transform((value) => value ?? []),
  resolvedUnresolvedKeys: z.array(z.string().min(1)).nullable().default([]).transform((value) => value ?? []),
  taskCandidate: captureTaskContentSchema.nullable().optional().transform((value) => value ?? undefined),
}).strict().superRefine((output, context) => {
  const hasPendingOwnerDecision = Boolean(output.question || output.proposedDecision)
    || output.unresolvedItems.some((item) => item.owner === "user")
    || output.taskCandidate?.unresolvedItems.some((item) => item.owner === "user");
  if (output.taskCandidate && hasPendingOwnerDecision) {
    context.addIssue({
      code: "custom",
      path: ["taskCandidate"],
      message: "存在待负责人确认的问题时不能生成抓取任务草稿",
    });
  }
});

const eventBase = { sessionId: idSchema, turnId: idSchema };
export const interviewTimelineEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("turn.started"), ...eventBase }).strict(),
  z.object({ type: z.literal("turn.activity"), ...eventBase,
    activity: interviewTurnActivitySchema }).strict(),
  z.object({ type: z.literal("assistant.delta"), ...eventBase, delta: z.string().min(1) }).strict(),
  z.object({ type: z.literal("assistant.message.completed"), ...eventBase, message: normalizedInterviewMessageSchema }).strict(),
  z.object({ type: z.literal("interview.state.changed"), ...eventBase, revision: revisionSchema,
    phase: z.enum(interviewPhases), turnState: z.enum(interviewTurnStates) }).strict(),
  z.object({ type: z.literal("turn.completed"), ...eventBase }).strict(),
  z.object({ type: z.literal("turn.interrupted"), ...eventBase }).strict(),
  z.object({ type: z.literal("turn.failed"), ...eventBase, error: z.string().min(1).max(2000) }).strict(),
  z.object({ type: z.literal("stream.failed"), sessionId: idSchema, error: z.string().min(1).max(2000) }).strict(),
]);

export type InterviewSession = z.infer<typeof interviewSessionSchema>;
export type NormalizedInterviewMessage = z.infer<typeof normalizedInterviewMessageSchema>;
export type InterviewMessageTimelinePart = z.infer<typeof interviewMessageTimelinePartSchema>;
export type InterviewDecision = z.infer<typeof interviewDecisionSchema>;
export type InterviewDecisionConfirmation = z.infer<typeof interviewDecisionConfirmationSchema>;
export type InterviewUnresolvedItem = z.infer<typeof interviewUnresolvedItemSchema>;
export type InterviewTurnActivity = z.infer<typeof interviewTurnActivitySchema>;
export type CategoryInterviewView = z.infer<typeof categoryInterviewViewSchema>;
export type InterviewTurnRequest = z.infer<typeof interviewTurnRequestSchema>;
export type CategoryInterviewRuntimeOutput = z.infer<typeof categoryInterviewRuntimeOutputSchema>;
export type InterviewTimelineEvent = z.infer<typeof interviewTimelineEventSchema>;

export function appendInterviewTimelineActivity(
  parts: InterviewMessageTimelinePart[],
  activity: InterviewTurnActivity,
) {
  const settled = settleLifecycleActivities(trimTrailingTextBoundary(parts), activity.id);
  const existingIndex = settled.findIndex((part) => part.type === "activity"
    && part.activity.id === activity.id);
  if (existingIndex < 0) return [...settled, { type: "activity" as const, activity }];
  return settled.map((part, index) => index === existingIndex && part.type === "activity"
    ? { type: "activity" as const, activity: mergeActivity(part.activity, activity) }
    : part);
}

export function appendInterviewTimelineText(parts: InterviewMessageTimelinePart[], delta: string) {
  const settled = settleLifecycleActivities(parts);
  const last = settled.at(-1);
  const visibleDelta = last?.type === "text" ? delta : trimLeadingBlankLines(delta);
  if (!visibleDelta) return settled;
  return last?.type === "text"
    ? settled.map((part, index) => index === settled.length - 1 && part.type === "text"
      ? { type: "text" as const, text: part.text + visibleDelta }
      : part)
    : [...settled, { type: "text" as const, text: visibleDelta }];
}

export function completeInterviewTimeline(parts: InterviewMessageTimelinePart[], finalText: string) {
  const completed = trimTrailingTextBoundary(settleAllActivities(parts));
  const streamed = completed.filter((part) => part.type === "text").map((part) => part.text).join("");
  if (streamed.trim() === finalText.trim() || streamed.includes(finalText)) return completed;
  const suffix = finalText.startsWith(streamed) ? finalText.slice(streamed.length) : finalText;
  const visibleSuffix = trimLeadingBlankLines(suffix).replace(/(?:\r?\n[ \t]*)+$/, "");
  return visibleSuffix.trim() ? [...completed, { type: "text" as const, text: visibleSuffix }] : completed;
}

export function failInterviewTimeline(parts: InterviewMessageTimelinePart[]) {
  let runningIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type === "activity" && part.activity.status === "running") {
      runningIndex = index;
      break;
    }
  }
  return parts.map((part, index) => index === runningIndex && part.type === "activity"
    ? { type: "activity" as const, activity: { ...part.activity, status: "failed" as const } }
    : part);
}

function mergeActivity(previous: InterviewTurnActivity, current: InterviewTurnActivity): InterviewTurnActivity {
  const urls = [...new Set([...(previous.urls ?? []), ...(current.urls ?? [])])];
  return {
    ...previous,
    ...current,
    detail: current.detail ?? previous.detail,
    ...(urls.length > 0 ? { urls } : {}),
  };
}

function settleLifecycleActivities(parts: InterviewMessageTimelinePart[], currentId?: string) {
  return parts.map((part) => part.type === "activity"
    && part.activity.id !== currentId
    && part.activity.status === "running"
    && ["agent", "analysis", "finalizing"].includes(part.activity.kind)
    ? { type: "activity" as const, activity: { ...part.activity, status: "completed" as const } }
    : part);
}

function settleAllActivities(parts: InterviewMessageTimelinePart[]) {
  return parts.map((part) => part.type === "activity" && part.activity.status === "running"
    ? { type: "activity" as const, activity: { ...part.activity, status: "completed" as const } }
    : part);
}

function trimLeadingBlankLines(value: string) {
  return value.replace(/^(?:[ \t]*\r?\n)+/, "");
}

function trimTrailingTextBoundary(parts: InterviewMessageTimelinePart[]) {
  const last = parts.at(-1);
  if (last?.type !== "text") return parts;
  // WHY：事件顺序本身提供视觉分隔，边界空行不应被持久化成刷新后的大块留白。
  const text = last.text.replace(/(?:\r?\n[ \t]*)+$/, "");
  if (!text) return parts.slice(0, -1);
  return parts.map((part, index) => index === parts.length - 1 ? { type: "text" as const, text } : part);
}
