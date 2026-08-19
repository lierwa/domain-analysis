import {
  appendInterviewTimelineActivity,
  appendInterviewTimelineText,
  completeInterviewTimeline,
  failInterviewTimeline,
  type InterviewMessageTimelinePart,
  InterviewTurnActivity,
  type NormalizedInterviewMessage,
} from "@domain-analysis/shared";

export type InterviewTimelinePart = InterviewMessageTimelinePart;

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
    return { ...message, timelineParts: appendInterviewTimelineActivity(partsOf(message), activity) };
  });
}

export function collapseWebSearchActivities(parts: InterviewTimelinePart[]) {
  const searches = parts.filter((part) => part.type === "activity"
    && part.activity.kind === "web_search");
  if (searches.length === 0) return parts;
  const urls = [...new Set(searches.flatMap((part) => part.type === "activity"
    ? part.activity.urls ?? []
    : []))];
  const status = searches.some((part) => part.type === "activity" && part.activity.status === "running")
    ? "running" as const
    : searches.some((part) => part.type === "activity" && part.activity.status === "completed")
      ? "completed" as const
      : "failed" as const;
  let emitted = false;

  // WHY：一次采访轮次可能产生多个 search/openPage item；产品表面按“本轮搜索”聚合，既保留消息顺序，也避免重复工具卡。
  return parts.flatMap((part) => {
    if (part.type !== "activity" || part.activity.kind !== "web_search") return [part];
    if (emitted) return [];
    emitted = true;
    return [{
      type: "activity" as const,
      activity: {
        ...part.activity,
        ...(urls.length > 0 ? { urls } : {}),
        status,
      },
    }];
  });
}

export function appendAssistantText(
  messages: InterviewUiMessage[],
  assistantId: string,
  delta: string,
) {
  return updateAssistant(messages, assistantId, (message) => ({
    ...message,
    text: message.text + delta,
    timelineParts: appendInterviewTimelineText(partsOf(message), delta),
  }));
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
    timelineParts: persisted.timelineParts ?? completeInterviewTimeline(partsOf(message), persisted.text),
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
      ? completeInterviewTimeline(partsOf(message), message.text)
      : failInterviewTimeline(partsOf(message)),
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

export function isActionErrorAlreadyVisible(messages: InterviewUiMessage[], error: string) {
  return messages.some((message) => message.role === "assistant"
    && message.deliveryStatus === "failed"
    && message.error === error);
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

function isSamePendingMessage(left: InterviewUiMessage, right: NormalizedInterviewMessage) {
  return left.id.startsWith("pending-")
    && left.sequence === right.sequence
    && left.role === right.role
    && left.text === right.text;
}
