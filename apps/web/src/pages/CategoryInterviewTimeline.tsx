import type { AppendMessage } from "@assistant-ui/react";
import type {
  CaptureTask,
  CategoryInterviewView,
  InterviewTimelineEvent,
  InterviewTurnRequest,
} from "@domain-analysis/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  confirmCaptureTaskDraft,
  confirmInterviewDecision,
  fetchCategoryInterview,
  startCategoryInterview,
  streamCategoryInterviewTurn,
} from "../lib/api";
import { CaptureTaskDraftCard } from "./CategoryInterviewTurnPanels";
import { InterviewThread } from "./InterviewThread";
import {
  appendAssistantActivity,
  appendAssistantText,
  appendPendingTurn,
  completeAssistantMessage,
  reconcilePersistedMessages,
  settleAssistantTurn,
  type InterviewUiMessage,
} from "./interviewTimelineModel";

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
  const confirmations = useInterviewConfirmations({
    view,
    setView,
    setMessages,
    setActionError: turns.setActionError,
    run: turns.run,
    onTaskCreated,
  });
  const proposed = currentProposedDecision(view);
  const confirmedDecisionIds = new Set(view?.decisions
    .filter((decision) => decision.status === "confirmed")
    .map((decision) => decision.id));
  const hasOpenOwnerDecision = Boolean(proposed)
    || Boolean(view?.unresolvedItems.some((item) => item.owner === "user" && item.status === "open"));
  // WHY：历史坏数据可能同时含未确认问题和草稿；页面必须以真实 Decision 状态为准，不能继续展示可确认草稿。
  const draftTask = hasOpenOwnerDecision ? undefined : [...(view?.taskDrafts ?? [])].reverse()
    .find((draft) => draft.status === "draft"
      && draft.content.decisionIds.every((id) => confirmedDecisionIds.has(id)));

  async function handleNew(message: AppendMessage) {
    const text = textOf(message).trim();
    if (!text) return;
    if (proposed) {
      await confirmations.answerDecision(proposed.id, text);
      return;
    }
    await turns.onNew(message);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-panel p-3 sm:p-5" aria-label="抓取任务对话">
      <InterviewThread
        key={view?.session.id ?? "new-interview"}
        messages={messages}
        isRunning={turns.isRunning}
        isSubmitting={Boolean(confirmations.confirmingDecisionId)}
        awaitingDecision={Boolean(proposed)}
        onNew={handleNew}
        onCancel={turns.onCancel}
      >
        {turns.actionError && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
            <span>{turns.actionError}</span>
            {turns.retryTurn && (
              <button type="button" className="button-secondary" onClick={() => void turns.run(turns.retryTurn!)}>
                重试本轮
              </button>
            )}
          </div>
        )}
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
  setMessages: React.Dispatch<React.SetStateAction<InterviewUiMessage[]>>;
  setActionError: React.Dispatch<React.SetStateAction<string | undefined>>;
  run: (intent: InterviewTurnIntent, confirmedView?: CategoryInterviewView) => Promise<void>;
  onTaskCreated: (task: CaptureTask) => void;
}) {
  const [confirmingDecisionId, setConfirmingDecisionId] = useState<string>();
  async function answerDecision(decisionId: string, selection: string) {
    if (!view || confirmingDecisionId) return;
    setActionError(undefined);
    setConfirmingDecisionId(decisionId);
    try {
      const next = await confirmInterviewDecision(
        view.session.id,
        decisionId,
        selection,
        view.session.revision,
      );
      setView(next);
      setMessages((current) => reconcilePersistedMessages(current, next.messages));
      const confirmed = next.decisions.find((decision) => decision.status === "confirmed"
        && decision.supersedesDecisionId === decisionId);
      if (!confirmed) throw new Error("回答没有形成已确认决定，无法继续采访");
      // WHY：发送 Composer 就是负责人本轮的显式回答；写入决定后直接推进，不能再要求无业务含义的“继续”。
      await run({ trigger: "decision_confirmed", decisionId: confirmed.id }, next);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "回答提交失败");
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
      setMessages((current) => reconcilePersistedMessages(current, result.interview.messages));
      onTaskCreated(result.task);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "抓取任务确认失败");
    }
  }
  return { confirmingDecisionId, answerDecision, confirmTaskDraft };
}

function useInterviewStore(initialSessionId?: string) {
  const [view, setView] = useState<CategoryInterviewView>();
  const [messages, setMessages] = useState<InterviewUiMessage[]>([]);
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
    setMessages((current) => reconcilePersistedMessages(current, next.messages));
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
  const activeAssistantRef = useRef<string>();
  const run = useCallback(async (intent: InterviewTurnIntent, confirmedView?: CategoryInterviewView) => {
    setActionError(undefined);
    setRetryTurn(undefined);
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
    activeAssistantRef.current = assistantId;
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
        setMessages((items) => settleAssistantTurn(items, assistantId, "failed", message));
      }
    } finally {
      setIsRunning(false);
      abortRef.current = undefined;
      activeTurnRef.current = undefined;
      activeAssistantRef.current = undefined;
      if (abortController.signal.aborted) window.setTimeout(() => void refresh(current.session.id), 200);
    }
  }, [refresh, setMessages, setView, viewRef]);
  const onNew = useCallback(async (message: AppendMessage) => run({
    trigger: "user_message",
    text: textOf(message).trim(),
  }), [run]);
  const onCancel = useCallback(async () => {
    const active = activeTurnRef.current;
    if (active) {
      setRetryTurn(active);
      setActionError("本轮已停止，可以从同一动作重试。");
    }
    abortRef.current?.abort();
    if (activeAssistantRef.current) {
      setMessages((items) => settleAssistantTurn(
        items,
        activeAssistantRef.current!,
        "interrupted",
      ));
    }
    setIsRunning(false);
  }, [setMessages]);
  return { isRunning, actionError, retryTurn, setActionError, run, onNew, onCancel };
}

function appendPendingMessages(
  intent: InterviewTurnIntent,
  view: CategoryInterviewView,
  setMessages: React.Dispatch<React.SetStateAction<InterviewUiMessage[]>>,
) {
  const assistantId = `pending-assistant-${crypto.randomUUID()}`;
  const appendUser = intent.trigger === "user_message" && !intent.retryMessageId;
  setMessages((items) => appendPendingTurn(items, {
    sessionId: view.session.id,
    assistantId,
    ...(appendUser ? {
      userId: `pending-user-${crypto.randomUUID()}`,
      userText: intent.text,
    } : {}),
    createdAt: new Date().toISOString(),
    activity: {
      // WHY：连接、thread 启动和 turn 启动是同一段基础设施生命周期；复用 ID 让它原位推进，完成后只留下有业务含义的当前阶段。
      id: "turn-lifecycle",
      kind: "agent",
      label: "连接本机 Codex",
      status: "running",
    },
  }));
  return assistantId;
}

function applyTimelineEvent(
  event: InterviewTimelineEvent,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<InterviewUiMessage[]>>,
  setView: React.Dispatch<React.SetStateAction<CategoryInterviewView | undefined>>,
) {
  if (event.type === "assistant.delta") {
    setMessages((items) => appendAssistantText(items, assistantId, event.delta));
  }
  if (event.type === "turn.activity") {
    setMessages((items) => appendAssistantActivity(items, assistantId, event.activity));
  }
  if (event.type === "assistant.message.completed") {
    setMessages((items) => completeAssistantMessage(items, assistantId, event.message));
  }
  if (event.type === "interview.state.changed") {
    setView((current) => current ? {
      ...current,
      session: {
        ...current.session,
        revision: event.revision,
        phase: event.phase,
        turnState: event.turnState,
      },
    } : current);
  }
  if (event.type === "turn.interrupted") {
    setMessages((items) => settleAssistantTurn(items, assistantId, "interrupted"));
  }
  if (event.type === "turn.failed" || event.type === "stream.failed") {
    setMessages((items) => settleAssistantTurn(items, assistantId, "failed", event.error));
  }
  if (event.type === "turn.completed") {
    setMessages((items) => settleAssistantTurn(items, assistantId, "complete"));
  }
}

function retryIntent(intent: InterviewTurnIntent, view: CategoryInterviewView): InterviewTurnIntent {
  if (intent.trigger === "decision_confirmed" || intent.retryMessageId) return intent;
  const userMessage = [...view.messages].reverse().find((message) => message.role === "user"
    && message.text === intent.text);
  return userMessage ? { ...intent, retryMessageId: userMessage.id } : intent;
}

function currentProposedDecision(view: CategoryInterviewView | undefined) {
  if (!view) return undefined;
  return view.decisions.find((decision) => decision.status === "proposed"
    && !view.decisions.some((candidate) => candidate.supersedesDecisionId === decision.id));
}

function textOf(message: AppendMessage) {
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
}

function focusComposer() {
  document.getElementById("category-interview-input")?.focus();
}
