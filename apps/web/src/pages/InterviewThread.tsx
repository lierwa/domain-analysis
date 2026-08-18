import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import {
  interviewTurnActivitySchema,
  type InterviewTurnActivity,
} from "@domain-analysis/shared";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  LoaderCircle,
  Search,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";

import type { InterviewUiMessage } from "./interviewTimelineModel";

export function InterviewThread({
  messages,
  isRunning,
  isSubmitting,
  awaitingDecision,
  onNew,
  onCancel,
  children,
}: {
  messages: InterviewUiMessage[];
  isRunning: boolean;
  isSubmitting: boolean;
  awaitingDecision: boolean;
  onNew: (message: AppendMessage) => Promise<void>;
  onCancel: () => Promise<void>;
  children: ReactNode;
}) {
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: toThreadMessage,
    isRunning,
    onNew,
    onCancel,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-surface">
        <ThreadPrimitive.Viewport className="relative flex min-h-0 flex-1 flex-col overflow-y-auto p-3 sm:p-5">
          {messages.length === 0 && (
            <div className="m-auto max-w-md text-center text-sm leading-6 text-muted">
              直接输入你要抓的商品，例如“抓冰箱”。系统会调查内容范围和候选来源，只向你询问必须决定的取舍。
            </div>
          )}
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          {children}
          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto flex flex-col bg-surface/95 pt-4 backdrop-blur">
            <ThreadPrimitive.ScrollToBottom
              className="icon-button mx-auto mb-2 border border-line bg-surface shadow-sm disabled:hidden"
              aria-label="回到最新消息"
            >
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </ThreadPrimitive.ScrollToBottom>
            <ComposerPrimitive.Root className="flex items-end gap-2 rounded-xl border border-line bg-panel p-2 shadow-sm focus-within:border-ink">
              <label htmlFor="category-interview-input" className="sr-only">输入抓取需求或回答</label>
              <ComposerPrimitive.Input
                id="category-interview-input"
                className="max-h-36 min-h-12 min-w-0 flex-1 resize-none bg-transparent px-2 py-3 text-base outline-none disabled:cursor-wait disabled:opacity-60 sm:text-sm"
                placeholder={awaitingDecision ? "直接回答，也可以输入不同于建议的方案" : "例如：抓冰箱"}
                aria-label="输入抓取需求或回答"
                disabled={isSubmitting}
              />
              {isRunning ? (
                <ComposerPrimitive.Cancel className="icon-button shrink-0 bg-ink text-surface hover:bg-ink/85" aria-label="停止生成">
                  <Square className="h-4 w-4 fill-current" aria-hidden="true" />
                </ComposerPrimitive.Cancel>
              ) : (
                <ComposerPrimitive.Send
                  className="icon-button shrink-0 bg-ink text-surface hover:bg-ink/85 disabled:cursor-wait disabled:opacity-60"
                  aria-label={isSubmitting ? "正在提交回答" : "发送消息"}
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <ArrowUp className="h-5 w-5" aria-hidden="true" />}
                </ComposerPrimitive.Send>
              )}
            </ComposerPrimitive.Root>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function toThreadMessage(message: InterviewUiMessage): ThreadMessageLike {
  const content = message.timelineParts?.map((part) => part.type === "text"
    ? { type: "text" as const, text: part.text }
    : { type: "data-interview-activity" as const, data: part.activity })
    ?? [{ type: "text" as const, text: message.text }];
  return {
    id: message.id,
    role: message.role,
    content,
    createdAt: new Date(message.createdAt),
    status: assistantStatus(message),
  };
}

function assistantStatus(message: InterviewUiMessage) {
  if (message.role !== "assistant") return undefined;
  if (message.runtimeStatus === "running") return { type: "running" as const };
  if (message.runtimeStatus === "failed" || message.deliveryStatus === "failed") {
    return { type: "incomplete" as const, reason: "error" as const, error: message.error ?? "本轮执行失败" };
  }
  if (message.runtimeStatus === "interrupted" || message.deliveryStatus === "interrupted") {
    return { type: "incomplete" as const, reason: "cancelled" as const };
  }
  return { type: "complete" as const, reason: "stop" as const };
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="ml-auto my-2 max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-4 py-3 text-sm leading-6 text-surface">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <AuiIf condition={(state) => (state.message?.content.length ?? 0) > 0}>
      <MessagePrimitive.Root className="my-2 max-w-[92%] rounded-2xl rounded-bl-sm bg-panel px-4 py-3 text-sm leading-6">
        <p className="mb-2 text-xs font-medium text-muted">抓取规划 Agent</p>
        <div className="space-y-3" aria-live="polite">
          <MessagePrimitive.Parts>
            {({ part }) => {
              if (part.type === "text") {
                return <p className="whitespace-pre-wrap"><MessagePartPrimitive.Text /></p>;
              }
              if (part.type === "data" && part.name === "interview-activity") {
                const activity = interviewTurnActivitySchema.safeParse(part.data);
                return activity.success ? <InterviewActivity activity={activity.data} /> : null;
              }
              return part.type === "data" ? part.dataRendererUI : null;
            }}
          </MessagePrimitive.Parts>
        </div>
        <ErrorPrimitive.Root className="mt-2 text-xs text-danger empty:hidden">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Root>
    </AuiIf>
  );
}

function InterviewActivity({ activity }: { activity: InterviewTurnActivity }) {
  if (activity.kind === "web_search" || activity.kind === "tool") {
    return <ToolActivity activity={activity} />;
  }
  return (
    <div className="flex items-start gap-2 text-xs text-muted" data-activity-id={activity.id}>
      <ActivityStatusIcon status={activity.status} />
      <span className="min-w-0 flex-1 font-medium">{activity.label}</span>
    </div>
  );
}

function ToolActivity({ activity }: { activity: InterviewTurnActivity }) {
  const ToolIcon = activity.kind === "web_search" ? Search : Terminal;
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-xs"
      data-activity-id={activity.id}
      data-activity-kind="tool"
    >
      <span className="mt-0.5 rounded-md border border-line bg-panel p-1 text-muted">
        <ToolIcon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium text-ink">
          <span>{activity.label}</span>
          <ActivityStatusIcon status={activity.status} />
        </div>
        {activity.detail && (
          <p className="mt-1 break-words leading-5 text-muted">{activity.detail}</p>
        )}
      </div>
    </div>
  );
}

function ActivityStatusIcon({ status }: { status: InterviewTurnActivity["status"] }) {
  if (status === "running") {
    return <LoaderCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-label="进行中" />;
  }
  if (status === "failed") {
    return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-label="未完成" />;
  }
  if (status === "completed") {
    return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-label="已完成" />;
  }
  return <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
}
