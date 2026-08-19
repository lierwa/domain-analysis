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
  ChevronDown,
  Circle,
  LoaderCircle,
  Search,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  collapseWebSearchActivities,
  type InterviewUiMessage,
} from "./interviewTimelineModel";

export function InterviewThread({
  messages,
  isRunning,
  isRestoring,
  awaitingDecision,
  onNew,
  onCancel,
  children,
}: {
  messages: InterviewUiMessage[];
  isRunning: boolean;
  isRestoring: boolean;
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
              {isRestoring
                ? "正在恢复采访…"
                : "直接输入你要抓的商品，例如“抓冰箱”。系统会调查内容范围和候选来源，只向你询问必须决定的取舍。"}
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
                placeholder={isRestoring
                  ? "正在恢复采访…"
                  : awaitingDecision ? "可以回答、补充、纠正或追问" : "例如：抓冰箱"}
                aria-label="输入抓取需求或回答"
                disabled={isRestoring}
              />
              {isRunning ? (
                <ComposerPrimitive.Cancel className="icon-button shrink-0 bg-ink text-surface hover:bg-ink/85" aria-label="停止生成">
                  <Square className="h-4 w-4 fill-current" aria-hidden="true" />
                </ComposerPrimitive.Cancel>
              ) : (
                <ComposerPrimitive.Send
                  className="icon-button shrink-0 bg-ink text-surface hover:bg-ink/85 disabled:cursor-wait disabled:opacity-60"
                  aria-label="发送消息"
                  disabled={isRestoring}
                >
                  <ArrowUp className="h-5 w-5" aria-hidden="true" />
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
  const content = (message.timelineParts ? collapseWebSearchActivities(message.timelineParts) : undefined)?.map((part) => part.type === "text"
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

export function InterviewActivity({ activity }: { activity: InterviewTurnActivity }) {
  if (activity.kind === "web_search") return <WebSearchActivity activity={activity} />;
  if (activity.kind === "tool") {
    return <ToolActivity activity={activity} />;
  }
  return (
    <div className="flex items-center gap-2 text-xs text-muted" data-activity-id={activity.id}>
      <ActivityStatusIcon status={activity.status} />
      <span className="min-w-0 flex-1 font-medium">{activity.label}</span>
    </div>
  );
}

function WebSearchActivity({ activity }: { activity: InterviewTurnActivity }) {
  const urls = activity.urls ?? [];
  const label = activity.status === "running"
    ? urls.length > 0 ? `已搜索 ${urls.length} 个网页，继续搜索中` : "正在搜索网页"
    : activity.status === "failed"
      ? urls.length > 0 ? `搜索了 ${urls.length} 个网页，本轮未完成` : "网页搜索未完成"
      : `搜索了 ${urls.length} 个网页`;
  const summary = (
    <>
      <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="font-medium">{label}</span>
      {urls.length > 0
        ? <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        : <ActivityStatusIcon status={activity.status} />}
    </>
  );

  if (urls.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted" data-activity-id={activity.id}>
        {summary}
      </div>
    );
  }
  return (
    <details
      className="group text-xs text-muted"
      data-activity-id={activity.id}
      data-activity-kind="web-search"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      <div className="ml-1.5 mt-1.5 space-y-1 border-l border-line pl-5">
        {urls.map((url) => (
          <a
            key={url}
            className="block break-all leading-5 text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            {url}
          </a>
        ))}
      </div>
    </details>
  );
}

function ToolActivity({ activity }: { activity: InterviewTurnActivity }) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-xs"
      data-activity-id={activity.id}
      data-activity-kind="tool"
    >
      <span className="flex shrink-0 items-center justify-center rounded-md border border-line bg-panel p-1 text-muted">
        <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
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
    return <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" aria-label="进行中" />;
  }
  if (status === "failed") {
    return <XCircle className="h-3.5 w-3.5 shrink-0 text-danger" aria-label="未完成" />;
  }
  if (status === "completed") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-label="已完成" />;
  }
  return <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
}
