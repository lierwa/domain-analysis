import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type AppendMessage,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import type {
  CategoryInterviewView,
  InterviewTimelineEvent,
  InterviewTurnRequest,
  NormalizedInterviewMessage,
  ProductProjectView,
} from "@domain-analysis/shared";
import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  confirmCategoryResearchBrief,
  confirmInterviewDecision,
  fetchCategoryInterview,
  fetchCategoryInterviews,
  startCategoryInterview,
  streamCategoryInterviewTurn,
} from "../lib/api";

type UiMessage = NormalizedInterviewMessage;
type InterviewTurnIntent =
  | Omit<Extract<InterviewTurnRequest, { trigger: "user_message" }>, "expectedRevision">
  | Omit<Extract<InterviewTurnRequest, { trigger: "decision_confirmed" }>, "expectedRevision">;
const ACTIVE_SESSION_KEY = "domain-analysis.active-category-interview";

export function CategoryInterviewTimeline({
  onProjectCreated,
}: {
  onProjectCreated: (project: ProductProjectView) => void;
}) {
  const store = useInterviewStore();
  const turns = useInterviewTurnRunner(store);
  const { view, messages, setView, setMessages } = store;
  const { isRunning, actionError, retryTurn, setActionError, run, onNew, onCancel } = turns;

  async function confirmDecision(decisionId: string) {
    if (!view) return;
    setActionError(undefined);
    try {
      const next = await confirmInterviewDecision(view.session.id, decisionId, view.session.revision);
      setView(next);
      setMessages(next.messages);
      const confirmed = next.decisions.find((decision) => decision.status === "confirmed"
        && decision.supersedesDecisionId === decisionId);
      if (!confirmed) throw new Error("确认结果缺少已确认决定，无法继续采访");
      // WHY：确认本身已经是明确用户动作；系统直接推进下一分支，不能再要求用户发送无业务含义的“继续”。
      await run({ trigger: "decision_confirmed", decisionId: confirmed.id }, next);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "决定确认失败");
    }
  }

  async function confirmBrief(briefId: string) {
    if (!view) return;
    setActionError(undefined);
    try {
      const result = await confirmCategoryResearchBrief(view.session.id, briefId, view.session.revision);
      setView(result.item.interview);
      setMessages(result.item.interview.messages);
      onProjectCreated(result.item.project);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "任务书确认失败");
    }
  }

  const proposed = view?.decisions.filter((decision) => decision.status === "proposed"
    && !view.decisions.some((candidate) => candidate.supersedesDecisionId === decision.id)) ?? [];
  const draftBrief = [...(view?.briefs ?? [])].reverse().find((brief) => brief.status === "draft");

  return (
    <section className="rounded-xl border border-line bg-panel p-3 sm:p-5" aria-label="品类采访对话">
      <InterviewThread
        key={view?.session.id ?? "new-interview"}
        messages={messages}
        isRunning={isRunning}
        onNew={onNew}
        onCancel={onCancel}
      />

      {actionError && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
          <span>{actionError}</span>
          {retryTurn && <button type="button" className="button-secondary" onClick={() => void run(retryTurn)}>重试本轮</button>}
        </div>
      )}
      {proposed.map((decision) => (
        <div key={decision.id} className="mt-3 rounded-lg border border-line bg-surface p-4">
          <p className="text-xs font-medium text-muted">待确认取舍</p><p className="mt-1 text-sm font-medium">{decision.selection}</p><p className="mt-2 text-xs leading-5 text-muted">{decision.rationale}</p>
          <button type="button" className="button-primary mt-3" onClick={() => void confirmDecision(decision.id)}><Check className="h-4 w-4" aria-hidden="true" />显式确认</button>
        </div>
      ))}
      {draftBrief && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-4">
          <p className="text-xs font-medium text-muted">调研任务书 v{draftBrief.version}</p><p className="mt-1 text-sm font-medium">{draftBrief.content.objective}</p><p className="mt-2 text-xs leading-5 text-muted">{draftBrief.content.acceptanceCriteria.join("；")}</p>
          <button type="button" className="button-primary mt-3" onClick={() => void confirmBrief(draftBrief.id)}><Check className="h-4 w-4" aria-hidden="true" />确认任务书并生成项目草稿</button>
        </div>
      )}
    </section>
  );
}

function useInterviewStore() {
  const [view, setView] = useState<CategoryInterviewView>();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const sessionId = window.localStorage.getItem(ACTIVE_SESSION_KEY);
    const load = sessionId
      ? fetchCategoryInterview(sessionId)
      : fetchCategoryInterviews().then((sessions) => {
        const latest = sessions[0];
        if (!latest) return undefined;
        window.localStorage.setItem(ACTIVE_SESSION_KEY, latest.id);
        return fetchCategoryInterview(latest.id);
      });
    // WHY：localStorage 只保存可丢弃的导航指针；找不到时仍从 Workbench 恢复最新会话。
    void load.then((next) => {
      if (!next) return;
      setView(next);
      setMessages(next.messages);
    }).catch(() => window.localStorage.removeItem(ACTIVE_SESSION_KEY));
  }, []);
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
  const [actionError, setActionError] = useState<string>();
  const [retryTurn, setRetryTurn] = useState<InterviewTurnIntent>();
  const abortRef = useRef<AbortController>();
  const activeTurnRef = useRef<InterviewTurnIntent>();
  const run = useCallback(async (intent: InterviewTurnIntent, confirmedView?: CategoryInterviewView) => {
    setActionError(undefined);
    setRetryTurn(undefined);
    let current = confirmedView ?? viewRef.current;
    if (!current) {
      if (intent.trigger !== "user_message") throw new Error("采访尚未创建，不能执行确认后继续");
      current = await startCategoryInterview(intent.text);
      window.localStorage.setItem(ACTIVE_SESSION_KEY, current.session.id);
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
          applyTimelineEvent(event, assistantId, setMessages, setView);
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
        setMessages((items) => items.map((item) => item.id === assistantId
          ? { ...item, text: item.text || message, deliveryStatus: "failed" }
          : item));
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
    setIsRunning(false);
  }, []);
  return { isRunning, actionError, retryTurn, setActionError, run, onNew, onCancel };
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
  const assistantId = `pending-assistant-${Date.now()}`;
  setMessages((items) => [...items, {
    id: assistantId, sessionId: view.session.id, sequence: items.length + 1,
    role: "assistant", text: "", deliveryStatus: "completed", createdAt,
  }]);
  return assistantId;
}

function InterviewThread({
  messages,
  isRunning,
  onNew,
  onCancel,
}: {
  messages: UiMessage[];
  isRunning: boolean;
  onNew: (message: AppendMessage) => Promise<void>;
  onCancel: () => Promise<void>;
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
      <ThreadPrimitive.Root className="overflow-hidden rounded-lg border border-line bg-surface">
        <ThreadPrimitive.Viewport className="flex max-h-[620px] min-h-[360px] flex-col overflow-y-auto p-3 sm:p-5">
          {messages.length === 0 && <div className="m-auto max-w-md text-center text-sm leading-6 text-muted">采访消息、决定和任务书都由 Workbench 保存；Codex 每轮无持久 Session 执行。</div>}
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto bg-surface pt-4">
            <ThreadPrimitive.ScrollToBottom className="button-secondary mb-2 w-full sm:w-auto">滚动到底部</ThreadPrimitive.ScrollToBottom>
            <ComposerPrimitive.Root className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-2 sm:flex-row">
              <label htmlFor="category-interview-input" className="sr-only">输入品类目标或采访回答</label>
              <ComposerPrimitive.Input id="category-interview-input" className="min-h-12 min-w-0 flex-1 resize-none bg-transparent px-2 py-3 text-base outline-none sm:text-sm" placeholder="例如：开启冰箱品类" aria-label="输入品类目标或采访回答" />
              <ComposerPrimitive.Send className="button-primary">发送</ComposerPrimitive.Send>
              <ComposerPrimitive.Cancel className="button-secondary">停止</ComposerPrimitive.Cancel>
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
    <MessagePrimitive.Root className="my-2 max-w-[92%] rounded-2xl rounded-bl-sm bg-panel px-4 py-3 text-sm leading-6">
      <p className="mb-1 text-xs font-medium text-muted">采访 Agent</p><MessagePrimitive.Parts />
      <ErrorPrimitive.Root className="mt-2 text-xs text-danger"><ErrorPrimitive.Message /></ErrorPrimitive.Root>
    </MessagePrimitive.Root>
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
) {
  if (event.type === "assistant.delta") {
    setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, text: item.text + event.delta } : item));
  }
  if (event.type === "assistant.message.completed") {
    setMessages((items) => items.map((item) => item.id === assistantId ? event.message : item));
  }
  if (event.type === "interview.state.changed") {
    setView((current) => current ? {
      ...current,
      session: { ...current.session, revision: event.revision, phase: event.phase, turnState: event.turnState },
    } : current);
  }
  if (event.type === "turn.interrupted") {
    setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, deliveryStatus: "interrupted" } : item));
  }
  if (event.type === "turn.failed" || event.type === "stream.failed") {
    setMessages((items) => items.map((item) => item.id === assistantId
      ? { ...item, text: item.text || event.error, deliveryStatus: "failed" }
      : item));
  }
}
