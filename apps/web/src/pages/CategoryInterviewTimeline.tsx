import type { AppendMessage } from "@assistant-ui/react";
import type {
  CaptureTask,
  CategoryInterviewView,
  InterviewSession,
  InterviewTimelineEvent,
  InterviewTurnRequest,
  TaskModelSelection,
} from "@domain-analysis/shared";
import { DEFAULT_TASK_MODEL_SELECTION } from "@domain-analysis/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalStorage } from "usehooks-ts";

import {
  confirmCaptureTaskDraft,
  fetchCategoryInterview,
  startCategoryInterview,
  streamCategoryInterviewTurn,
  updateInterviewModelSelection,
} from "../lib/api";
import { CaptureTaskDraftCard } from "./CategoryInterviewTurnPanels";
import { InterviewThread } from "./InterviewThread";
import { TaskModelControl } from "./TaskModelControl";
import {
  appendAssistantActivity,
  appendAssistantText,
  appendPendingTurn,
  completeAssistantMessage,
  reconcilePersistedMessages,
  isActionErrorAlreadyVisible,
  settleAssistantTurn,
  type InterviewUiMessage,
} from "./interviewTimelineModel";

type InterviewTurnIntent = Omit<InterviewTurnRequest, "expectedRevision">;
type InterviewRunControls = {
  isRestoring: boolean;
  setIsRunning: React.Dispatch<React.SetStateAction<boolean>>;
  setActionError: React.Dispatch<React.SetStateAction<string | undefined>>;
  setRetryTurn: React.Dispatch<React.SetStateAction<InterviewTurnIntent | undefined>>;
  abortRef: React.MutableRefObject<AbortController | undefined>;
  activeTurnRef: React.MutableRefObject<InterviewTurnIntent | undefined>;
  activeAssistantRef: React.MutableRefObject<string | undefined>;
  turnInFlightRef: React.MutableRefObject<boolean>;
};

export const ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY = "domain-analysis.active-category-interview";
const TASK_MODEL_SELECTION_STORAGE_KEY = "domain-analysis.task-model-selection";

export function CategoryInterviewTimeline({
  onTaskCreated,
  onSessionChanged,
  initialSessionId,
}: {
  onTaskCreated: (task: CaptureTask) => void;
  onSessionChanged: (session: InterviewSession) => void;
  initialSessionId?: string;
}) {
  const store = useInterviewStore(initialSessionId);
  const modelSettings = useTaskModelSettings(store);
  const turns = useInterviewTurnRunner(store, modelSettings.selection);
  const { view, messages, isRestoring, setView, setMessages } = store;
  const confirmations = useInterviewConfirmations({
    view,
    setView,
    setMessages,
    setActionError: turns.setActionError,
    onTaskCreated,
  });
  const proposed = currentProposedDecision(view);
  useEffect(() => {
    // WHY：侧栏是采访会话的只读投影；每次持久化状态变化后同步缓存，避免已完成回合仍显示“正在生成”。
    if (view) onSessionChanged(view.session);
  }, [onSessionChanged, view]);
  const hasOpenOwnerDecision = Boolean(proposed)
    || Boolean(view?.unresolvedItems.some((item) => item.owner === "user" && item.status === "open"));
  const actionErrorAlreadyVisible = turns.actionError
    ? isActionErrorAlreadyVisible(messages, turns.actionError)
    : false;
  // WHY：历史坏数据可能同时含未确认问题和草稿；页面必须以真实 Decision 状态为准，不能继续展示可确认草稿。
  const draftTask = turns.isRunning || view?.session.phase !== "task_ready" || hasOpenOwnerDecision
    ? undefined : [...(view?.taskDrafts ?? [])].reverse()
    .find((draft) => draft.status === "draft");

  async function handleNew(message: AppendMessage) {
    if (isRestoring) return;
    const text = textOf(message).trim();
    if (!text) return;
    // WHY：建议项只是当前语境，不是表单模式；任何原始输入都必须先由采访 Agent 理解，才能同时保留回答、纠正和新增事实。
    await turns.onNew(message);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-panel p-3 sm:p-5" aria-label="抓取任务对话">
      <InterviewThread
        key={view?.session.id ?? "new-interview"}
        messages={messages}
        isRunning={turns.isRunning}
        isRestoring={isRestoring}
        isComposerDisabled={modelSettings.isSaving}
        awaitingDecision={Boolean(proposed)}
        onNew={handleNew}
        onCancel={turns.onCancel}
        composerControls={(
          <TaskModelControl
            value={modelSettings.selection}
            disabled={isRestoring || turns.isRunning}
            saving={modelSettings.isSaving}
            error={modelSettings.error}
            onChange={(selection) => void modelSettings.change(selection)}
          />
        )}
      >
        {turns.actionError && (!actionErrorAlreadyVisible || turns.retryTurn) && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
            {!actionErrorAlreadyVisible && <span>{turns.actionError}</span>}
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
            isConfirming={confirmations.isConfirming}
          />
        )}
      </InterviewThread>
    </section>
  );
}

function useTaskModelSettings(store: ReturnType<typeof useInterviewStore>) {
  const { view, setView } = store;
  const [preferredSelection, setPreferredSelection] = useLocalStorage<TaskModelSelection>(
    TASK_MODEL_SELECTION_STORAGE_KEY,
    DEFAULT_TASK_MODEL_SELECTION,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();
  // WHY：会话内选择属于当前任务事实；本地偏好只负责下一份任务的默认值。
  const selection = view?.session.modelSelection ?? preferredSelection;

  const change = useCallback(async (next: TaskModelSelection) => {
    setError(undefined);
    if (!view) {
      setPreferredSelection(next);
      return;
    }
    setIsSaving(true);
    try {
      const updated = await updateInterviewModelSelection(
        view.session.id,
        view.session.revision,
        next,
      );
      setView(updated);
      setPreferredSelection(updated.session.modelSelection);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型设置保存失败");
    } finally {
      setIsSaving(false);
    }
  }, [setPreferredSelection, setView, view]);
  return { selection, isSaving, error, change };
}

function useInterviewConfirmations({
  view,
  setView,
  setMessages,
  setActionError,
  onTaskCreated,
}: {
  view: CategoryInterviewView | undefined;
  setView: React.Dispatch<React.SetStateAction<CategoryInterviewView | undefined>>;
  setMessages: React.Dispatch<React.SetStateAction<InterviewUiMessage[]>>;
  setActionError: React.Dispatch<React.SetStateAction<string | undefined>>;
  onTaskCreated: (task: CaptureTask) => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  async function confirmTaskDraft(draftId: string) {
    if (!view || isConfirming) return;
    setActionError(undefined);
    setIsConfirming(true);
    try {
      const result = await confirmCaptureTaskDraft(view.session.id, draftId, view.session.revision);
      setView(result.interview);
      setMessages((current) => reconcilePersistedMessages(current, result.interview.messages));
      onTaskCreated(result.task);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "抓取任务确认失败");
    } finally {
      setIsConfirming(false);
    }
  }
  return { confirmTaskDraft, isConfirming };
}

function useInterviewStore(initialSessionId?: string) {
  // WHY：该参数只描述当前 Timeline 实例首次恢复哪个会话；新建会话获得 ID 后不能反向触发恢复并覆盖正在到达的实时事件。
  const restoreSessionId = useRef(initialSessionId).current;
  const [view, setView] = useState<CategoryInterviewView>();
  const [messages, setMessages] = useState<InterviewUiMessage[]>([]);
  const [isRestoring, setIsRestoring] = useState(() => Boolean(restoreSessionId
    ?? (typeof window === "undefined" ? undefined : window.localStorage
      .getItem(ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY))));
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const sessionId = restoreSessionId
      ?? window.localStorage.getItem(ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY);
    if (!sessionId) {
      setIsRestoring(false);
      return;
    }
    let active = true;
    setIsRestoring(true);
    // WHY：localStorage 只保存可丢弃的导航指针；任务修订仍从 Workbench 的 session 恢复全部事实。
    void fetchCategoryInterview(sessionId).then((next) => {
      if (!active) return;
      window.localStorage.setItem(ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY, next.session.id);
      setView(next);
      setMessages(next.messages);
    }).catch(() => {
      if (active) window.localStorage.removeItem(ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY);
    }).finally(() => {
      if (active) setIsRestoring(false);
    });
    return () => { active = false; };
  }, [restoreSessionId]);
  const refresh = useCallback(async (sessionId: string) => {
    const next = await fetchCategoryInterview(sessionId);
    setView(next);
    setMessages((current) => reconcilePersistedMessages(current, next.messages));
    return next;
  }, []);
  return { view, messages, isRestoring, setView, setMessages, viewRef, refresh };
}

function useInterviewTurnRunner(
  store: ReturnType<typeof useInterviewStore>,
  modelSelection: TaskModelSelection,
) {
  const { isRestoring, setView, setMessages, viewRef, refresh } = store;
  const [isRunning, setIsRunning] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [retryTurn, setRetryTurn] = useState<InterviewTurnIntent>();
  const abortRef = useRef<AbortController>();
  const activeTurnRef = useRef<InterviewTurnIntent>();
  const activeAssistantRef = useRef<string>();
  const turnInFlightRef = useRef(false);
  const run = useInterviewRun(store, modelSelection, {
    isRestoring, setIsRunning, setActionError, setRetryTurn,
    abortRef, activeTurnRef, activeAssistantRef, turnInFlightRef,
  });
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
    const assistantId = activeAssistantRef.current;
    if (assistantId) {
      setMessages((items) => settleAssistantTurn(
        items,
        assistantId,
        "interrupted",
      ));
    }
  }, [setMessages]);
  return { isRunning, actionError, retryTurn, setActionError, run, onNew, onCancel };
}

function useInterviewRun(
  store: ReturnType<typeof useInterviewStore>,
  modelSelection: TaskModelSelection,
  controls: InterviewRunControls,
) {
  const { setView, setMessages, viewRef, refresh } = store;
  const { isRestoring, setIsRunning, setActionError, setRetryTurn,
    abortRef, activeTurnRef, activeAssistantRef, turnInFlightRef } = controls;
  return useCallback(async (intent: InterviewTurnIntent) => {
    // WHY：React state 要到下一次渲染才可见；同步 lease 必须先于任何 await 获取，才能挡住首轮建会话和取消收敛期间的重入。
    if (isRestoring || turnInFlightRef.current) return;
    turnInFlightRef.current = true;
    setActionError(undefined);
    setRetryTurn(undefined);
    setIsRunning(true);
    activeTurnRef.current = intent;
    const abortController = new AbortController();
    abortRef.current = abortController;
    let current = viewRef.current;
    let assistantId: string | undefined;
    let turnError: string | undefined;
    try {
      if (!current) {
        current = await startCategoryInterview(intent.text, modelSelection);
        window.localStorage.setItem(ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY, current.session.id);
        setView(current);
      }
      if (abortController.signal.aborted) return;
      const pendingAssistantId = appendPendingMessages(intent, current, setMessages);
      assistantId = pendingAssistantId;
      activeAssistantRef.current = pendingAssistantId;
      await streamCategoryInterviewTurn(
        current.session.id,
        { ...intent, expectedRevision: current.session.revision } as InterviewTurnRequest,
        (event) => {
          if (event.type === "turn.failed" || event.type === "stream.failed") turnError = event.error;
          applyTimelineEvent(event, pendingAssistantId, setMessages, setView);
        },
        abortController.signal,
      );
    } catch (error) {
      if (!abortController.signal.aborted) {
        turnError = error instanceof Error ? error.message : "采访失败，请重试。";
        if (assistantId) {
          const failedAssistantId = assistantId;
          setMessages((items) => settleAssistantTurn(items, failedAssistantId, "failed", turnError));
        }
      }
    } finally {
      let canRelease = true;
      if (current) {
        try {
          const next = await refresh(current.session.id);
          if (next.session.turnState === "running") {
            setActionError("本轮正在停止，请刷新后继续。");
            setRetryTurn(undefined);
            canRelease = false;
          } else if (abortController.signal.aborted) {
            const retry = retryAfterCancellation(intent, next);
            setRetryTurn(retry);
            if (!retry) setActionError(undefined);
          } else if (turnError) {
            setActionError(turnError);
            setRetryTurn(retryIntent(intent, next));
          }
        } catch {
          setActionError("本轮状态同步失败，请刷新后继续。");
          setRetryTurn(undefined);
          canRelease = false;
        }
      } else if (turnError) {
        setActionError(turnError);
        setRetryTurn(intent);
      }
      abortRef.current = undefined;
      activeTurnRef.current = undefined;
      activeAssistantRef.current = undefined;
      if (canRelease) {
        turnInFlightRef.current = false;
        setIsRunning(false);
      }
    }
  }, [isRestoring, refresh, setMessages, setView, viewRef,
    modelSelection,
    abortRef, activeTurnRef, activeAssistantRef, turnInFlightRef,
    setActionError, setIsRunning, setRetryTurn]);
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
      label: "准备本轮分析",
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
  if (intent.retryMessageId) return intent;
  const userMessage = [...view.messages].reverse().find((message) => message.role === "user"
    && message.text === intent.text);
  return userMessage ? { ...intent, retryMessageId: userMessage.id } : intent;
}

function retryAfterCancellation(intent: InterviewTurnIntent, view: CategoryInterviewView) {
  if (view.session.turnState === "failed" || view.session.turnState === "interrupted") {
    return retryIntent(intent, view);
  }
  const alreadyPersisted = view.messages.some((message) => message.role === "user"
    && message.text === intent.text);
  return alreadyPersisted ? undefined : intent;
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
