import type { CategoryInterviewView } from "@domain-analysis/shared";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  confirmCaptureTaskDraft: vi.fn(),
  fetchCategoryInterview: vi.fn(),
  startCategoryInterview: vi.fn(),
  streamCategoryInterviewTurn: vi.fn(),
  updateInterviewModelSelection: vi.fn(),
}));

const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  setters: [] as ReturnType<typeof vi.fn>[],
}));

vi.mock("../src/lib/api", () => api);

vi.mock("usehooks-ts", () => ({
  useLocalStorage: <T,>(_key: string, initial: T) => {
    const index = hooks.cursor++;
    const value = index < hooks.values.length ? hooks.values[index] as T : initial;
    const setter = vi.fn();
    hooks.setters[index] = setter;
    return [value, setter, vi.fn()] as const;
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useEffect: () => undefined,
    useRef: <T,>(value?: T) => ({ current: value }),
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      const fallback = typeof initial === "function" ? (initial as () => T)() : initial;
      const value = index < hooks.values.length ? hooks.values[index] as T : fallback;
      const setter = vi.fn();
      hooks.setters[index] = setter;
      return [value, setter] as const;
    },
  };
});

import { CategoryInterviewTimeline } from "../src/pages/CategoryInterviewTimeline";

beforeEach(() => {
  vi.clearAllMocks();
  hooks.cursor = 0;
  hooks.values = [];
  hooks.setters = [];
  vi.stubGlobal("window", {
    localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
    setTimeout,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("品类采访组件输入提交", () => {
  it("存在建议项时仍把混合原文完整交给采访 Agent", async () => {
    const view = interviewView({ proposedDecision: true });
    prepareComponent(view);
    api.fetchCategoryInterview.mockResolvedValue(view);
    api.streamCategoryInterviewTurn.mockResolvedValue(undefined);
    const thread = renderThread();

    await thread.props.onNew(message("1，同时排除二手；淘宝只是后续同级平台"));

    expect(api.streamCategoryInterviewTurn).toHaveBeenCalledOnce();
    expect(api.streamCategoryInterviewTurn.mock.calls[0]?.[1]).toMatchObject({
      trigger: "user_message",
      text: "1，同时排除二手；淘宝只是后续同级平台",
      expectedRevision: 1,
    });
    expect(api.confirmCaptureTaskDraft).not.toHaveBeenCalled();
  });

  it("首轮 start 返回前的双提交只创建一个会话", async () => {
    const start = deferred<CategoryInterviewView>();
    const view = interviewView();
    prepareComponent(undefined);
    api.startCategoryInterview.mockReturnValue(start.promise);
    api.streamCategoryInterviewTurn.mockResolvedValue(undefined);
    api.fetchCategoryInterview.mockResolvedValue(view);
    const thread = renderThread();

    const first = thread.props.onNew(message("抓冰箱"));
    const second = thread.props.onNew(message("抓冰箱"));

    expect(api.startCategoryInterview).toHaveBeenCalledOnce();
    expect(api.startCategoryInterview).toHaveBeenCalledWith("抓冰箱", {
      modelId: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
    start.resolve(view);
    await Promise.all([first, second]);
    expect(api.streamCategoryInterviewTurn).toHaveBeenCalledOnce();
  });
});

describe("品类采访组件运行生命周期", () => {
  it("取消后直到中断流与刷新都收敛前拒绝新提交", async () => {
    vi.useFakeTimers();
    const view = interviewView();
    const converged = interviewView({ userMessage: "抓电视机", turnState: "interrupted" });
    const refreshed = deferred<CategoryInterviewView>();
    prepareComponent(view);
    api.fetchCategoryInterview.mockReturnValue(refreshed.promise);
    api.streamCategoryInterviewTurn.mockImplementation((...args: unknown[]) => {
      const signal = args[3] as AbortSignal;
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const thread = renderThread();

    const active = thread.props.onNew(message("抓电视机"));
    await vi.waitFor(() => expect(api.streamCategoryInterviewTurn).toHaveBeenCalledOnce());
    await thread.props.onCancel();
    const blocked = thread.props.onNew(message("取消后不应立刻开始"));
    await vi.advanceTimersByTimeAsync(200);

    expect(api.streamCategoryInterviewTurn).toHaveBeenCalledOnce();
    expect(hooks.setters[6]).not.toHaveBeenCalledWith(false);
    refreshed.resolve(converged);
    await Promise.all([active, blocked]);
    expect(hooks.setters[6]).toHaveBeenLastCalledWith(false);
    expect(hooks.setters[8]).toHaveBeenLastCalledWith({
      trigger: "user_message",
      text: "抓电视机",
      retryMessageId: "user-message-1",
    });
  });

  it("流已结束但刷新中取消时仍保持提交门", async () => {
    const view = interviewView();
    const converged = interviewView({ userMessage: "抓洗衣机" });
    const refreshed = deferred<CategoryInterviewView>();
    prepareComponent(view);
    api.streamCategoryInterviewTurn.mockResolvedValue(undefined);
    api.fetchCategoryInterview.mockReturnValue(refreshed.promise);
    const thread = renderThread();

    const active = thread.props.onNew(message("抓洗衣机"));
    await vi.waitFor(() => expect(api.fetchCategoryInterview).toHaveBeenCalledOnce());
    await thread.props.onCancel();
    const blocked = thread.props.onNew(message("刷新完成前不应开始"));

    expect(api.streamCategoryInterviewTurn).toHaveBeenCalledOnce();
    expect(hooks.setters[6]).not.toHaveBeenCalledWith(false);
    refreshed.resolve(converged);
    await Promise.all([active, blocked]);
    expect(hooks.setters[8]).toHaveBeenLastCalledWith(undefined);
    expect(hooks.setters[6]).toHaveBeenLastCalledWith(false);
  });

  it("start 失败也进入统一错误与重试状态", async () => {
    prepareComponent(undefined);
    api.startCategoryInterview.mockRejectedValue(new Error("无法创建采访"));
    const thread = renderThread();

    await expect(thread.props.onNew(message("抓冰箱"))).resolves.toBeUndefined();

    expect(hooks.setters[7]).toHaveBeenCalledWith("无法创建采访");
    expect(hooks.setters[8]).toHaveBeenCalledWith({ trigger: "user_message", text: "抓冰箱" });
    expect(hooks.setters[6]).toHaveBeenLastCalledWith(false);
  });
});

function prepareComponent(view: CategoryInterviewView | undefined) {
  hooks.values = [
    view,
    view?.messages ?? [],
    false,
    view?.session.modelSelection ?? { modelId: "gpt-5.6-terra", reasoningEffort: "medium" },
    false,
    undefined,
    false,
    undefined,
    undefined,
    false,
  ];
}

function renderThread() {
  hooks.cursor = 0;
  const tree = CategoryInterviewTimeline({
    onTaskCreated: vi.fn(),
    onSessionChanged: vi.fn(),
  }) as ReactElement<{ children: ReactElement }>;
  return tree.props.children as ReactElement<{
    onNew: (input: ReturnType<typeof message>) => Promise<void>;
    onCancel: () => Promise<void>;
  }>;
}

function message(text: string) {
  return { role: "user" as const, content: [{ type: "text" as const, text }] };
}

function interviewView({
  proposedDecision = false,
  userMessage,
  turnState = "idle",
}: {
  proposedDecision?: boolean;
  userMessage?: string;
  turnState?: CategoryInterviewView["session"]["turnState"];
} = {}): CategoryInterviewView {
  return {
    session: {
      id: "interview-session-1",
      initialRequest: "抓冰箱",
      modelSelection: { modelId: "gpt-5.6-terra", reasoningEffort: "medium" },
      phase: "active",
      turnState,
      revision: 1,
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z",
    },
    messages: userMessage ? [{
      id: "user-message-1",
      sessionId: "interview-session-1",
      sequence: 1,
      role: "user",
      text: userMessage,
      deliveryStatus: "completed",
      createdAt: "2026-08-19T00:00:00.000Z",
    }] : [],
    decisions: proposedDecision ? [{
      id: "decision-1",
      sessionId: "interview-session-1",
      key: "market.scope",
      question: "只抓当前在售商品吗？",
      status: "proposed",
      selection: "current",
      rationale: "默认聚焦当前在售商品",
      options: [{ value: "current", label: "当前在售", description: "排除二手与停产商品" }],
      createdAt: "2026-08-19T00:00:00.000Z",
    }] : [],
    unresolvedItems: [],
    taskDrafts: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
