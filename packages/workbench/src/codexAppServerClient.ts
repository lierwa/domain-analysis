import { z } from "zod";

import {
  mapCodexAppServerNotification,
  normalizedCodexEventType,
} from "./codexAppServerNotification";
import {
  startCodexAppServerTransport,
  type CodexAppServerTransport,
} from "./codexAppServerTransport";

const responseSchema = z.object({
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
}).passthrough();

const notificationSchema = z.object({
  method: z.string(),
  params: z.unknown().optional(),
}).passthrough();

const threadStartResultSchema = z.object({
  thread: z.object({ id: z.string(), ephemeral: z.literal(true) }).passthrough(),
}).passthrough();

const turnStartResultSchema = z.object({
  turn: z.object({ id: z.string() }).passthrough(),
}).passthrough();


export interface CodexAppServerClientOptions {
  cwd: string;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
  executable?: string;
  timeoutMs?: number;
  webSearch?: boolean;
  packageRoot?: string;
  skill?: { name: string; path: string };
}

export interface CodexAppServerResult {
  interrupted: boolean;
  outputText?: string;
  observedEvents: string[];
  observedItemTypes: string[];
}

export type CodexAppServerStreamItem =
  | {
    type: "event";
    eventType: string;
    itemType?: string;
    itemId?: string;
    itemStatus?: "running" | "completed" | "failed";
    phase?: "commentary" | "final_answer" | null;
    detail?: string;
    urls?: string[];
  }
  | { type: "text_delta"; delta: string }
  | { type: "result"; result: CodexAppServerResult };

export class CodexAppServerError extends Error {
  constructor(
    readonly code: "service_unavailable" | "authentication_required" | "execution_failed" | "invalid_output",
    message: string,
    readonly diagnostic: string,
  ) {
    super(message);
    this.name = "CodexAppServerError";
  }
}

export interface CodexAppServerClient {
  run(prompt: string, signal?: AbortSignal): AsyncIterable<CodexAppServerStreamItem>;
  close(): Promise<void>;
}

export function createCodexAppServerClient(options: CodexAppServerClientOptions): CodexAppServerClient {
  return new ReusableCodexAppServerClient(options);
}

export async function* streamCodexAppServer(
  options: CodexAppServerClientOptions,
  prompt: string,
  signal?: AbortSignal,
): AsyncIterable<CodexAppServerStreamItem> {
  const client = createCodexAppServerClient(options);
  try {
    for await (const item of client.run(prompt, signal)) yield item;
  } finally {
    await client.close();
  }
}

class ReusableCodexAppServerClient implements CodexAppServerClient {
  private transport?: CodexAppServerTransport;
  private requestSequence = 0;
  private active = false;

  constructor(private readonly options: CodexAppServerClientOptions) {}

  async *run(prompt: string, signal?: AbortSignal): AsyncIterable<CodexAppServerStreamItem> {
    if (this.active) {
      throw new CodexAppServerError(
        "execution_failed",
        "已有 Codex 任务正在运行，请等待当前任务结束后重试。",
        "reusable app-server client is busy",
      );
    }
    if (signal?.aborted) {
      yield resultItem(true, new Set(), new Set());
      return;
    }
    this.active = true;
    try {
      const transport = await this.ensureTransport();
      yield* this.runTurn(transport, prompt, signal);
    } finally {
      this.active = false;
    }
  }

  async close() {
    const transport = this.transport;
    this.transport = undefined;
    if (transport) await transport.close();
  }

  private async ensureTransport() {
    if (this.transport) return this.transport;
    const transport = startCodexAppServerTransport(this.options);
    this.transport = transport;
    const initializeId = ++this.requestSequence;
    transport.send("initialize", initializeId, initializeParams());
    try {
      for (;;) {
        const raw = await this.nextRaw(transport, new Set(), new Set());
        const response = responseSchema.safeParse(raw);
        if (!response.success || response.data.id !== initializeId) continue;
        if (response.data.error) {
          throw failedAppServerError(undefined, "", new Set(), new Set([JSON.stringify(response.data.error)]));
        }
        transport.notify("initialized");
        return transport;
      }
    } catch (error) {
      if (this.transport === transport) this.transport = undefined;
      await transport.close();
      throw error;
    }
  }

  private async *runTurn(
    transport: CodexAppServerTransport,
    prompt: string,
    signal?: AbortSignal,
  ): AsyncIterable<CodexAppServerStreamItem> {
    const observedEvents = new Set<string>();
    const observedItemTypes = new Set<string>();
    const observedErrors = new Set<string>();
    const messagePhases = new Map<string, "commentary" | "final_answer" | null>();
    const streamedCommentaryItems = new Set<string>();
    let threadId: string | undefined;
    let turnId: string | undefined;
    let finalOutputText: string | undefined;
    let turnStatus: "completed" | "interrupted" | "failed" | undefined;
    const threadRequestId = ++this.requestSequence;
    const turnRequestId = ++this.requestSequence;
    let interruptRequestId: number | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const interrupt = () => {
      if (threadId && turnId && interruptRequestId === undefined) {
        interruptRequestId = ++this.requestSequence;
        transport.send("turn/interrupt", interruptRequestId, { threadId, turnId });
      }
      killTimer ??= setTimeout(() => transport.kill(), 2_000);
    };
    signal?.addEventListener("abort", interrupt, { once: true });
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      interrupt();
    }, this.options.timeoutMs ?? 180_000);
    transport.send("thread/start", threadRequestId, threadStartParams(this.options));

    try {
      for (;;) {
        const raw = await this.nextRaw(transport, observedEvents, observedErrors, signal?.aborted === true);
        const response = responseSchema.safeParse(raw);
        if (response.success && response.data.error) {
          observedErrors.add(JSON.stringify(response.data.error));
          throw failedAppServerError(undefined, "", observedEvents, observedErrors);
        }
        if (response.success && response.data.id === threadRequestId) {
          const parsed = threadStartResultSchema.safeParse(response.data.result);
          if (!parsed.success) throw protocolError("thread/start 没有返回 ephemeral thread", parsed.error.message);
          threadId = parsed.data.thread.id;
          transport.send("turn/start", turnRequestId, turnStartParams(this.options, threadId, prompt));
        }
        if (response.success && response.data.id === turnRequestId) {
          const parsed = turnStartResultSchema.safeParse(response.data.result);
          if (!parsed.success) throw protocolError("turn/start 没有返回 turn", parsed.error.message);
          turnId = parsed.data.turn.id;
          if (signal?.aborted) interrupt();
        }
        if (response.success) continue;

        const notification = notificationSchema.safeParse(raw);
        if (!notification.success) continue;
        observedEvents.add(normalizedCodexEventType(notification.data.method));
        const mapped = mapCodexAppServerNotification(notification.data.method, notification.data.params);
        if (mapped?.kind === "item") {
          // WHY：started/failed 仍是必须展示的真实活动，但只有 completed 才能证明调查动作实际完成。
          if (mapped.event.itemStatus === "completed") observedItemTypes.add(mapped.itemType);
          if (mapped.rawType === "agentMessage") messagePhases.set(mapped.itemId, mapped.phase);
          yield mapped.event;
        }
        if (mapped?.kind === "delta" && messagePhases.get(mapped.itemId) === "commentary") {
          const separator = streamedCommentaryItems.has(mapped.itemId)
            ? "" : streamedCommentaryItems.size > 0 ? "\n\n" : "";
          streamedCommentaryItems.add(mapped.itemId);
          yield { type: "text_delta", delta: separator + mapped.delta };
        }
        if (mapped?.kind === "final_message") finalOutputText = mapped.text;
        if (mapped?.kind === "turn_completed" && timedOut) {
          throw new CodexAppServerError(
            "execution_failed", "Codex 本轮执行超时，本轮未保存，请重试。",
            `timeoutMs=${this.options.timeoutMs ?? 180_000}`,
          );
        }
        if (mapped?.kind === "event") yield mapped.event;
        if (mapped?.kind !== "turn_completed") continue;
        turnStatus = mapped.status === "inProgress" ? "failed" : mapped.status;
        finalOutputText = mapped.outputText ?? finalOutputText;
        if (mapped.error) observedErrors.add(mapped.error);
        yield { type: "event", eventType: "turn.completed" };
        yield completedResult({
          aborted: signal?.aborted === true, processSignal: undefined, exitCode: 0, stderr: "",
          turnStatus, threadId, turnId, finalOutputText, observedEvents, observedItemTypes, observedErrors,
        });
        return;
      }
    } finally {
      signal?.removeEventListener("abort", interrupt);
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
    }
  }

  private async nextRaw(
    transport: CodexAppServerTransport,
    observedEvents: Set<string>,
    observedErrors: Set<string>,
    aborted = false,
  ) {
    const next = await transport.next();
    if (!next.done) return next.value;
    const result = await transport.result();
    if (this.transport === transport) this.transport = undefined;
    if (aborted) return { method: "turn/completed", params: { turn: { status: "interrupted", items: [] } } };
    throw failedAppServerError(result.exitCode, result.stderr, observedEvents, observedErrors);
  }
}

function completedResult(input: {
  aborted: boolean;
  processSignal: unknown;
  exitCode: number | undefined;
  stderr: unknown;
  turnStatus: "completed" | "interrupted" | "failed" | undefined;
  threadId?: string;
  turnId?: string;
  finalOutputText?: string;
  observedEvents: Set<string>;
  observedItemTypes: Set<string>;
  observedErrors: Set<string>;
}): CodexAppServerStreamItem {
  if (input.aborted || input.processSignal || input.turnStatus === "interrupted") {
    return resultItem(true, input.observedEvents, input.observedItemTypes);
  }
  if (input.exitCode !== 0 || input.turnStatus === "failed") {
    throw failedAppServerError(input.exitCode, input.stderr, input.observedEvents, input.observedErrors);
  }
  if (input.turnStatus !== "completed" || !input.threadId || !input.turnId || !input.finalOutputText) {
    throw new CodexAppServerError(
      "invalid_output",
      "Codex 本轮没有生成可用的结构化结果，请重试。",
      compactDiagnostic(`turnStatus=${String(input.turnStatus)} thread=${String(input.threadId)} turn=${String(input.turnId)} stderr=${String(input.stderr ?? "")}`),
    );
  }
  return { type: "result", result: {
    interrupted: false,
    outputText: input.finalOutputText,
    observedEvents: [...input.observedEvents],
    observedItemTypes: [...input.observedItemTypes],
  } };
}

function initializeParams() {
  return {
    clientInfo: { name: "domain-analysis-workbench", title: "Data Collection Workbench", version: "0.1.0" },
    capabilities: { experimentalApi: false, requestAttestation: false },
  };
}

function threadStartParams(options: CodexAppServerClientOptions) {
  return {
    model: options.model,
    cwd: options.cwd,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    config: {
      model_reasoning_effort: options.reasoningEffort,
      ...(options.webSearch ? { web_search: "live" } : {}),
    },
  };
}

function turnStartParams(options: CodexAppServerClientOptions, threadId: string, prompt: string) {
  return {
    threadId,
    input: [
      { type: "text", text: prompt, text_elements: [] },
      ...(options.skill ? [{ type: "skill", name: options.skill.name, path: options.skill.path }] : []),
    ],
    effort: options.reasoningEffort,
  };
}

function resultItem(
  interrupted: true,
  events: Set<string>,
  itemTypes: Set<string>,
): CodexAppServerStreamItem {
  return { type: "result", result: {
    interrupted,
    observedEvents: [...events],
    observedItemTypes: [...itemTypes],
  } };
}

function failedAppServerError(
  exitCode: number | undefined,
  stderr: unknown,
  observedEvents: Set<string>,
  observedErrors: Set<string>,
) {
  const diagnostic = compactDiagnostic(
    `exitCode=${String(exitCode)} events=${[...observedEvents].join(",")} errors=${[...observedErrors].join(" | ")} stderr=${String(stderr ?? "")}`,
  );
  if (/UnexpectedServerResponse\(\"HTTP 502|\bHTTP 502\b/i.test(diagnostic)) {
    return new CodexAppServerError(
      "service_unavailable",
      "Codex 服务暂时不可用（HTTP 502）。本轮未完成，请稍后重试。",
      diagnostic,
    );
  }
  if (/not logged in|authentication|unauthorized|login required|401\b/i.test(diagnostic)) {
    return new CodexAppServerError(
      "authentication_required",
      "Codex 登录已失效，请先在本机完成 Codex 登录后重试。",
      diagnostic,
    );
  }
  return new CodexAppServerError(
    "execution_failed",
    "Codex 本轮执行失败。请重试；如果持续失败，请检查本机 Codex 登录和网络状态。",
    diagnostic,
  );
}

function protocolError(message: string, diagnostic: string) {
  return new CodexAppServerError("execution_failed", `Codex 协议异常：${message}`, compactDiagnostic(diagnostic));
}

function compactDiagnostic(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(-4_000);
}
