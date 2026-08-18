import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import type {
  CaptureTask,
  CategoryInterviewView,
  InterviewTimelineEvent,
  InterviewTurnActivity,
  InterviewTurnRequest,
  NormalizedInterviewMessage,
} from "@domain-analysis/shared";
import { ArrowDown, ArrowUp, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  confirmCaptureTaskDraft,
  confirmInterviewDecision,
  fetchCategoryInterview,
  startCategoryInterview,
  streamCategoryInterviewTurn,
} from "../lib/api";
import {
  CaptureTaskDraftCard,
  InterviewActivityPanel,
  InterviewDecisionCard,
} from "./CategoryInterviewTurnPanels";
import {
  completeInterviewActivities,
  failInterviewActivities,
  mergeInterviewActivity,
} from "./interviewActivityModel";

type UiMessage = NormalizedInterviewMessage;
type InterviewTurnIntent =
  | Omit<Extract<InterviewTurnRequest, { trigger: "user_message" }>, "expectedRevision">
  | Omit<Extract<InterviewTurnRequest, { trigger: "decision_confirmed" }>, "expectedRevision">;
export const ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY = "domain-analysis.active-category-interview";

export function CategoryInterviewTimeline({
  onTaskCreated,
  initialSessionId,
}: {
  onTaskCreated: (task: CaptureTask) => void;
  initialSessionId?: string;
}) {
  const store = useInterviewStore(initialSessionId);
  const turns = useInterviewTurnRunner(store);
  const { view, messages, setView, setMessages } = store;
  const {
    activities,
    elapsedSeconds,
    isRunning,
    actionError,
    retryTurn,
    setActionError,
    run,
    onNew,
    onCancel,
  } = turns;
  const confirmations = useInterviewConfirmations({
    view, setView, setMessages, setActionError, run, onTaskCreated,
  });

  const proposed = view?.decisions.filter((decision) => decision.status === "proposed"
    && !view.decisions.some((candidate) => candidate.supersedesDecisionId === decision.id)) ?? [];
  const draftTask = [...(view?.taskDrafts ?? [])].reverse().find((draft) => draft.status === "draft");

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-panel p-3 sm:p-5" aria-label="抓取任务对话">
      <InterviewThread
        key={view?.session.id ?? "new-interview"}
        messages={messages}
        isRunning={isRunning}
        onNew={onNew}
        onCancel={onCancel}
      >
        <InterviewActivityPanel
          activities={activities}
          elapsedSeconds={elapsedSeconds}
          isRunning={isRunning}
        />
        {actionError && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
            <span>{actionError}</span>
            {retryTurn && <button type="button" className="button-secondary" onClick={() => void run(retryTurn)}>重试本轮</button>}
          </div>
        )}
        {proposed.map((decision) => (
          <InterviewDecisionCard
            key={decision.id}
            decision={decision}
            disabled={isRunning || confirmations.confirmingDecisionId === decision.id}
            onConfirm={(selection) => void confirmations.confirmDecision(decision.id, selection)}
          />
        ))}
        {draftTask && (
          <CaptureTaskDraftCard
            draft={draftTask}
            onContinue={focusComposer}
            onConfirm={() => void confirmations.confirmTaskDraft(draftTask.id)}
          />
        )}
      </InterviewThread>
    </section>
  );
}

function useInterviewConfirmations({
  view,
  setView,
  setMessages,
  setActionError,
  run,
  onTaskCreated,
}: {
  view: CategoryInterviewView | undefined;
  setView: React.Dispatch<React.SetStateAction<CategoryInterviewView | undefined>>;
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>;
  setActionError: React.Dispatch<React.SetStateAction<string | undefined>>;
  run: (intent: InterviewTurnIntent, confirmedView?: CategoryInterviewView) => Promise<void>;
  onTaskCreated: (task: CaptureTask) => void;
}) {
  const [confirmingDecisionId, setConfirmingDecisionId] = useState<string>();
  async function confirmDecision(decisionId: string, selection: string) {
    if (!view) return;
    setActionError(undefined);
    setConfirmingDecisionId(decisionId);
    try {
      const next = await confirmInterviewDecision(
        view.session.id, decisionId, selection, view.session.revision,
      );
      setView(next);
      setMessages(next.messages);
      const confirmed = next.decisions.find((decision) => decision.status === "confirmed"
        && decision.supersedesDecisionId === decisionId);
      if (!confirmed) throw new Error("确认结果缺少已确认决定，无法继续采访");
      // WHY：确认本身已经是明确用户动作；系统直接推进下一分支，不能再要求用户发送无业务含义的“继续”。
      await run({ trigger: "decision_confirmed", decisionId: confirmed.id }, next);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "决定确认失败");
    } finally {
      setConfirmingDecisionId(undefined);
    }
  }
  async function confirmTaskDraft(draftId: string) {
    if (!view) return;
    setActionError(undefined);
    try {
      const result = await confirmCaptureTaskDraft(view.session.id, draftId, view.session.revision);
      setView(result.interview);
      setMessages(result.interview.messages);
      onTaskCreated(result.task);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "抓取任务确认失败");
    }
  }
  return { confirmingDecisionId, confirmDecision, confirmTaskDraft };
}

function useInterviewStore(initialSessionId?: string) {
  const [view, setView] = useState<CategoryInterviewView>();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const sessionId = initialSessionId
      ?? window.localStorage.getItem(ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY);
    if (!sessionId) return;
    const load = fetchCategoryInterview(sessionId);
    // WHY：localStorage 只保存可丢弃的导航指针；任务修订仍从 Workbench 的 session 恢复全部事实。
    void load.then((next) => {
      if (!next) return;
      window.localStorage.setItem(ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY, next.session.id);
      setView(next);
      setMessages(next.messages);
    }).catch(() => window.localStorage.removeItem(ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY));
  }, [initialSessionId]);
  const refresh = useCallback(async (sessionId: string) => {
    const next = await fetchCategoryInterview(sessionId);
    setView(next);
    setMessages(next.messages);
    return next;
  }, []);
  return { view, messages, setView, setMessages, viewRef, refresh };
}

function useInterviewTurnRunner(store: ReturnType<typeof useInterviewStore>) {
  const { setView, setMessages, viewRef, refresh } = store;
  const [isRunning, setIsRunning] = useState(false);
  const [activities, setActivities] = useState<InterviewTurnActivity[]>([]);
  const [startedAt, setStartedAt] = useState<number>();
  const [actionError, setActionError] = useState<string>();
  const [retryTurn, setRetryTurn] = useState<InterviewTurnIntent>();
  const abortRef = useRef<AbortController>();
  const activeTurnRef = useRef<InterviewTurnIntent>();
  const run = useCallback(async (intent: InterviewTurnIntent, confirmedView?: CategoryInterviewView) => {
    setActionError(undefined);
    setRetryTurn(undefined);
    setActivities([{
      id: "client-connecting",
      kind: "agent",
      label: "连接本机 Codex",
      status: "running",
    }]);
    setStartedAt(Date.now());
    let current = confirmedView ?? viewRef.current;
    if (!current) {
      if (intent.trigger !== "user_message") throw new Error("采访尚未创建，不能执行确认后继续");
      current = await startCategoryInterview(intent.text);
      window.localStorage.setItem(ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY, current.session.id);
      setView(current);
    }
    const assistantId = appendPendingMessages(intent, current, setMessages);
    setIsRunning(true);
    activeTurnRef.current = intent;
    const abortController = new AbortController();
    abortRef.current = abortController;
    let turnError: string | undefined;
    try {
      await streamCategoryInterviewTurn(
        current.session.id,
        { ...intent, expectedRevision: current.session.revision } as InterviewTurnRequest,
        (event) => {
          if (event.type === "turn.failed" || event.type === "stream.failed") turnError = event.error;
          applyTimelineEvent(event, assistantId, setMessages, setView, setActivities);
        },
        abortController.signal,
      );
      const next = await refresh(current.session.id);
      if (turnError) {
        setActionError(turnError);
        setRetryTurn(retryIntent(intent, next));
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        const message = error instanceof Error ? error.message : "采访失败，请重试。";
        setActionError(message);
        setRetryTurn(intent);
        setActivities((items) => failInterviewActivities(items));
      }
    } finally {
      setIsRunning(false);
      abortRef.current = undefined;
      activeTurnRef.current = undefined;
      if (abortController.signal.aborted) window.setTimeout(() => void refresh(current.session.id), 200);
    }
  }, [refresh, setMessages, setView, viewRef]);
  const onNew = useCallback(async (message: AppendMessage) => run({
    trigger: "user_message", text: textOf(message),
  }), [run]);
  const onCancel = useCallback(async () => {
    if (activeTurnRef.current) {
      setRetryTurn(activeTurnRef.current);
      setActionError("本轮已停止，可以从同一动作重试。");
    }
    abortRef.current?.abort();
    setActivities((items) => failInterviewActivities(items));
    setIsRunning(false);
  }, []);
  const elapsedSeconds = useElapsedSeconds(startedAt, isRunning);
  return {
    activities,
    elapsedSeconds,
    isRunning,
    actionError,
    retryTurn,
    setActionError,
    run,
    onNew,
    onCancel,
  };
}

function useElapsedSeconds(startedAt: number | undefined, isRunning: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    if (!isRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning, startedAt]);
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

function focusComposer() {
  document.getElementById("category-interview-input")?.focus();
}

function appendPendingMessages(
  intent: InterviewTurnIntent,
  view: CategoryInterviewView,
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>,
) {
  const createdAt = new Date().toISOString();
  if (intent.trigger === "user_message" && !intent.retryMessageId) {
    setMessages((items) => [...items, {
      id: `pending-user-${Date.now()}`, sessionId: view.session.id, sequence: items.length + 1,
      role: "user", text: intent.text, deliveryStatus: "completed", createdAt,
    }]);
  }
  return `pending-assistant-${Date.now()}`;
}

function InterviewThread({
  messages,
  isRunning,
  onNew,
  onCancel,
  children,
}: {
  messages: UiMessage[];
  isRunning: boolean;
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
          {messages.length === 0 && <div className="m-auto max-w-md text-center text-sm leading-6 text-muted">直接输入你要抓的商品，例如“抓冰箱”。系统会调查内容范围和候选来源，只向你询问必须决定的取舍。</div>}
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          {children}
          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto bg-surface/95 pt-4 backdrop-blur">
            <ThreadPrimitive.ScrollToBottom className="icon-button absolute bottom-[84px] right-3 border border-line bg-surface shadow-sm" aria-label="滚动到底部">
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </ThreadPrimitive.ScrollToBottom>
            <ComposerPrimitive.Root className="flex items-end gap-2 rounded-xl border border-line bg-panel p-2 shadow-sm focus-within:border-ink">
              <label htmlFor="category-interview-input" className="sr-only">输入抓取需求或回答</label>
              <ComposerPrimitive.Input id="category-interview-input" className="max-h-36 min-h-12 min-w-0 flex-1 resize-none bg-transparent px-2 py-3 text-base outline-none sm:text-sm" placeholder="例如：抓冰箱" aria-label="输入抓取需求或回答" />
              {isRunning ? (
                <ComposerPrimitive.Cancel className="icon-button shrink-0 bg-ink text-surface hover:bg-ink/85" aria-label="停止生成">
                  <Square className="h-4 w-4 fill-current" aria-hidden="true" />
                </ComposerPrimitive.Cancel>
              ) : (
                <ComposerPrimitive.Send className="icon-button shrink-0 bg-ink text-surface hover:bg-ink/85" aria-label="发送消息">
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

function textOf(message: AppendMessage) {
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
}

function toThreadMessage(message: UiMessage): ThreadMessageLike {
  const status = message.role === "assistant"
    ? message.deliveryStatus === "failed"
      ? { type: "incomplete" as const, reason: "error" as const, error: message.error ?? message.text }
      : message.deliveryStatus === "interrupted"
        ? { type: "incomplete" as const, reason: "cancelled" as const }
        : { type: "complete" as const, reason: "stop" as const }
    : undefined;
  return { id: message.id, role: message.role, content: [{ type: "text", text: message.text }], status };
}

function UserMessage() {
  return <MessagePrimitive.Root className="ml-auto my-2 max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-4 py-3 text-sm leading-6 text-surface"><MessagePrimitive.Parts /></MessagePrimitive.Root>;
}

function AssistantMessage() {
  return (
    <AuiIf condition={(state) => (state.message?.content.length ?? 0) > 0}>
      <MessagePrimitive.Root className="my-2 max-w-[92%] rounded-2xl rounded-bl-sm bg-panel px-4 py-3 text-sm leading-6">
        <p className="mb-1 text-xs font-medium text-muted">抓取规划 Agent</p>
        <span aria-live="polite"><MessagePrimitive.Parts /></span>
        <ErrorPrimitive.Root className="mt-2 text-xs text-danger empty:hidden"><ErrorPrimitive.Message /></ErrorPrimitive.Root>
      </MessagePrimitive.Root>
    </AuiIf>
  );
}

function retryIntent(intent: InterviewTurnIntent, view: CategoryInterviewView): InterviewTurnIntent {
  if (intent.trigger === "decision_confirmed" || intent.retryMessageId) return intent;
  const userMessage = [...view.messages].reverse().find((message) => message.role === "user"
    && message.text === intent.text);
  return userMessage ? { ...intent, retryMessageId: userMessage.id } : intent;
}

function applyTimelineEvent(
  event: InterviewTimelineEvent,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>,
  setView: React.Dispatch<React.SetStateAction<CategoryInterviewView | undefined>>,
  setActivities: React.Dispatch<React.SetStateAction<InterviewTurnActivity[]>>,
) {
  if (event.type === "assistant.delta") {
    setMessages((items) => appendAssistantDelta(items, assistantId, event));
  }
  if (event.type === "turn.activity") {
    setActivities((items) => mergeInterviewActivity(items, event.activity));
  }
  if (event.type === "assistant.message.completed") {
    setMessages((items) => replaceOrAppendAssistant(items, assistantId, event.message));
  }
  if (event.type === "interview.state.changed") {
    setView((current) => current ? {
      ...current,
      session: { ...current.session, revision: event.revision, phase: event.phase, turnState: event.turnState },
    } : current);
  }
  if (event.type === "turn.interrupted") {
    setActivities((items) => failInterviewActivities(items));
  }
  if (event.type === "turn.failed" || event.type === "stream.failed") {
    setActivities((items) => failInterviewActivities(items));
  }
  if (event.type === "turn.completed") {
    setActivities((items) => completeInterviewActivities(items));
  }
}

function appendAssistantDelta(
  items: UiMessage[],
  assistantId: string,
  event: Extract<InterviewTimelineEvent, { type: "assistant.delta" }>,
): UiMessage[] {
  const existing = items.find((item) => item.id === assistantId);
  if (existing) return items.map((item) => item.id === assistantId
    ? { ...item, text: item.text + event.delta }
    : item);
  return [...items, {
    id: assistantId,
    sessionId: event.sessionId,
    sequence: items.length + 1,
    role: "assistant" as const,
    text: event.delta,
    deliveryStatus: "completed" as const,
    createdAt: new Date().toISOString(),
  }];
}

function replaceOrAppendAssistant(
  items: UiMessage[],
  assistantId: string,
  message: NormalizedInterviewMessage,
) {
  return items.some((item) => item.id === assistantId)
    ? items.map((item) => item.id === assistantId ? message : item)
    : [...items, message];
}
