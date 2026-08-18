import type {
  InterviewTurnActivity,
  NormalizedInterviewMessage,
} from "@domain-analysis/shared";

export type InterviewTimelinePart =
  | { type: "text"; text: string }
  | { type: "activity"; activity: InterviewTurnActivity };

export type InterviewUiMessage = NormalizedInterviewMessage & {
  timelineParts?: InterviewTimelinePart[];
  runtimeStatus?: "running" | "complete" | "failed" | "interrupted";
  persistedId?: string;
};

export function appendPendingTurn(
  current: InterviewUiMessage[],
  input: {
    sessionId: string;
    assistantId: string;
    userId?: string;
    userText?: string;
    createdAt: string;
    activity: InterviewTurnActivity;
  },
) {
  const base = current.filter((message) => !(message.role === "assistant"
    && !message.persistedId
    && (message.runtimeStatus === "failed" || message.runtimeStatus === "interrupted")));
  const next = input.userText && input.userId
    ? [...base, pendingUserMessage(base, input)]
    : base;
  return [...next, {
    id: input.assistantId,
    sessionId: input.sessionId,
    sequence: next.length + 1,
    role: "assistant" as const,
    text: "",
    deliveryStatus: "completed" as const,
    createdAt: input.createdAt,
    timelineParts: [{ type: "activity" as const, activity: input.activity }],
    runtimeStatus: "running" as const,
  }];
}

export function appendAssistantActivity(
  messages: InterviewUiMessage[],
  assistantId: string,
  activity: InterviewTurnActivity,
) {
  return updateAssistant(messages, assistantId, (message) => {
    const parts = settleLifecycleActivities(trimTrailingTextBoundary(partsOf(message)), activity.id);
    const existingIndex = parts.findIndex((part) => part.type === "activity"
      && part.activity.id === activity.id);
    if (existingIndex < 0) {
      return { ...message, timelineParts: [...parts, { type: "activity", activity }] };
    }
    return {
      ...message,
      timelineParts: parts.map((part, index) => index === existingIndex && part.type === "activity"
        ? { type: "activity", activity: {
          ...part.activity,
          ...activity,
          detail: activity.detail ?? part.activity.detail,
        } }
        : part),
    };
  });
}

export function appendAssistantText(
  messages: InterviewUiMessage[],
  assistantId: string,
  delta: string,
) {
  return updateAssistant(messages, assistantId, (message) => {
    const parts = settleLifecycleActivities(partsOf(message));
    const last = parts.at(-1);
    const visibleDelta = last?.type === "text" ? delta : trimLeadingBlankLines(delta);
    if (!visibleDelta) return { ...message, text: message.text + delta, timelineParts: parts };
    const timelineParts = last?.type === "text"
      ? parts.map((part, index) => index === parts.length - 1 && part.type === "text"
        ? { type: "text" as const, text: part.text + visibleDelta }
        : part)
      : [...parts, { type: "text" as const, text: visibleDelta }];
    return { ...message, text: message.text + delta, timelineParts };
  });
}

export function completeAssistantMessage(
  messages: InterviewUiMessage[],
  assistantId: string,
  persisted: NormalizedInterviewMessage,
) {
  return updateAssistant(messages, assistantId, (message) => ({
    ...persisted,
    id: assistantId,
    persistedId: persisted.id,
    timelineParts: appendFinalText(
      trimTrailingTextBoundary(settleAllActivities(partsOf(message))),
      persisted.text,
    ),
    runtimeStatus: "complete",
  }));
}

export function settleAssistantTurn(
  messages: InterviewUiMessage[],
  assistantId: string,
  status: "complete" | "failed" | "interrupted",
  error?: string,
) {
  return updateAssistant(messages, assistantId, (message) => ({
    ...message,
    deliveryStatus: status === "failed" ? "failed" : status === "interrupted" ? "interrupted" : "completed",
    ...(error ? { error } : {}),
    timelineParts: status === "complete"
      ? settleAllActivities(partsOf(message))
      : failLastRunningActivity(partsOf(message)),
    runtimeStatus: status,
  }));
}

export function reconcilePersistedMessages(
  current: InterviewUiMessage[],
  persisted: NormalizedInterviewMessage[],
) {
  const matched = new Set<InterviewUiMessage>();
  const restored = persisted.map((message) => {
    const live = current.find((candidate) => candidate.id === message.id
      || candidate.persistedId === message.id
      || isSamePendingMessage(candidate, message));
    if (!live) return message;
    matched.add(live);
    return {
      ...message,
      ...(live.timelineParts ? { timelineParts: live.timelineParts } : {}),
      ...(live.runtimeStatus ? { runtimeStatus: live.runtimeStatus } : {}),
    };
  });
  const unpersistedFailures = current.filter((message) => !matched.has(message)
    && (message.runtimeStatus === "failed" || message.runtimeStatus === "interrupted"));
  return [...restored, ...unpersistedFailures].sort((left, right) => left.sequence - right.sequence);
}

function pendingUserMessage(
  current: InterviewUiMessage[],
  input: { sessionId: string; userId?: string; userText?: string; createdAt: string },
): InterviewUiMessage {
  return {
    id: input.userId!,
    sessionId: input.sessionId,
    sequence: current.length + 1,
    role: "user",
    text: input.userText!,
    deliveryStatus: "completed",
    createdAt: input.createdAt,
  };
}

function updateAssistant(
  messages: InterviewUiMessage[],
  assistantId: string,
  update: (message: InterviewUiMessage) => InterviewUiMessage,
) {
  return messages.map((message) => message.id === assistantId ? update(message) : message);
}

function partsOf(message: InterviewUiMessage): InterviewTimelinePart[] {
  if (message.timelineParts) return message.timelineParts;
  return message.text ? [{ type: "text", text: message.text }] : [];
}

function settleLifecycleActivities(parts: InterviewTimelinePart[], currentId?: string) {
  return parts.map((part) => part.type === "activity"
    && part.activity.id !== currentId
    && part.activity.status === "running"
    && ["agent", "analysis", "finalizing"].includes(part.activity.kind)
    ? { type: "activity" as const, activity: { ...part.activity, status: "completed" as const } }
    : part);
}

function settleAllActivities(parts: InterviewTimelinePart[]) {
  return parts.map((part) => part.type === "activity" && part.activity.status === "running"
    ? { type: "activity" as const, activity: { ...part.activity, status: "completed" as const } }
    : part);
}

function failLastRunningActivity(parts: InterviewTimelinePart[]) {
  let index = -1;
  for (let current = parts.length - 1; current >= 0; current -= 1) {
    const part = parts[current];
    if (part?.type === "activity" && part.activity.status === "running") {
      index = current;
      break;
    }
  }
  return parts.map((part, partIndex) => partIndex === index && part.type === "activity"
    ? { type: "activity" as const, activity: { ...part.activity, status: "failed" as const } }
    : part);
}

function appendFinalText(parts: InterviewTimelinePart[], finalText: string) {
  const streamed = parts.filter((part) => part.type === "text").map((part) => part.text).join("");
  if (streamed.trim() === finalText.trim() || streamed.includes(finalText)) return parts;
  const suffix = finalText.startsWith(streamed) ? finalText.slice(streamed.length) : finalText;
  const visibleSuffix = trimLeadingBlankLines(suffix).replace(/(?:\r?\n[ \t]*)+$/, "");
  return visibleSuffix.trim() ? [...parts, { type: "text" as const, text: visibleSuffix }] : parts;
}

function trimLeadingBlankLines(value: string) {
  return value.replace(/^(?:[ \t]*\r?\n)+/, "");
}

function trimTrailingTextBoundary(parts: InterviewTimelinePart[]) {
  const last = parts.at(-1);
  if (last?.type !== "text") return parts;
  // WHY：模型常在工具前后输出段落分隔换行；parts 已提供视觉间距，边界换行继续保留会形成截图中的大块空白。
  const text = last.text.replace(/(?:\r?\n[ \t]*)+$/, "");
  if (!text) return parts.slice(0, -1);
  return parts.map((part, index) => index === parts.length - 1 ? { type: "text" as const, text } : part);
}

function isSamePendingMessage(left: InterviewUiMessage, right: NormalizedInterviewMessage) {
  return left.id.startsWith("pending-")
    && left.sequence === right.sequence
    && left.role === right.role
    && left.text === right.text;
}
