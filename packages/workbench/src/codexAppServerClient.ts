import { execa } from "execa";
import ndjson from "ndjson";
import { z } from "zod";

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

const threadItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string().optional(),
  text: z.string().optional(),
  phase: z.enum(["commentary", "final_answer"]).nullable().optional(),
  query: z.string().optional(),
  command: z.string().optional(),
  server: z.string().optional(),
  tool: z.string().optional(),
  action: z.object({
    type: z.string(),
    query: z.string().optional(),
    queries: z.array(z.string()).optional(),
    url: z.string().optional(),
  }).passthrough().nullable().optional(),
}).passthrough();

const itemNotificationSchema = z.object({ item: threadItemSchema }).passthrough();
const deltaNotificationSchema = z.object({
  itemId: z.string(),
  delta: z.string().min(1),
}).passthrough();
const turnCompletedSchema = z.object({
  turn: z.object({
    status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
    error: z.unknown().nullable().optional(),
    items: z.array(threadItemSchema).default([]),
  }).passthrough(),
}).passthrough();

export interface CodexAppServerClientOptions {
  cwd: string;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
  executable?: string;
  timeoutMs?: number;
  webSearch?: boolean;
  packageRoot?: string;
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
    detail?: string;
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

export async function* streamCodexAppServer(
  options: CodexAppServerClientOptions,
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

  const subprocess = startAppServer(options);
  if (!subprocess.stdin || !subprocess.stdout) throw new Error("Codex app-server stdio 未建立管道");
  const eventStream = subprocess.stdout.pipe(ndjson.parse());
  const interrupt = () => subprocess.kill("SIGTERM");
  signal?.addEventListener("abort", interrupt, { once: true });
  if (signal?.aborted) interrupt();
  writeRequest(subprocess.stdin, "initialize", 1, initializeParams());

  try {
    for await (const raw of eventStream) {
      const response = responseSchema.safeParse(raw);
      if (response.success) {
        if (response.data.error) {
          observedErrors.add(JSON.stringify(response.data.error));
          throw failedAppServerError(undefined, "", observedEvents, observedErrors);
        }
        const nextRequest = handleResponse(response.data, options, prompt);
        if (nextRequest?.kind === "thread") {
          writeNotification(subprocess.stdin, "initialized");
          writeRequest(subprocess.stdin, "thread/start", 2, nextRequest.params);
        }
        if (nextRequest?.kind === "turn") {
          threadId = nextRequest.threadId;
          writeRequest(subprocess.stdin, "turn/start", 3, nextRequest.params);
        }
        if (nextRequest?.kind === "turn_started") turnId = nextRequest.turnId;
        continue;
      }

      const notification = notificationSchema.safeParse(raw);
      if (!notification.success) continue;
      observedEvents.add(normalizedEventType(notification.data.method));
      const mapped = mapNotification(notification.data.method, notification.data.params);
      if (mapped?.kind === "item") {
        observedItemTypes.add(mapped.itemType);
        if (mapped.rawType === "agentMessage") messagePhases.set(mapped.itemId, mapped.phase);
        yield mapped.event;
      }
      if (mapped?.kind === "delta") {
        const phase = messagePhases.get(mapped.itemId);
        if (phase === "commentary") {
          const separator = streamedCommentaryItems.has(mapped.itemId)
            ? ""
            : streamedCommentaryItems.size > 0 ? "\n\n" : "";
          streamedCommentaryItems.add(mapped.itemId);
          yield { type: "text_delta", delta: separator + mapped.delta };
        }
      }
      if (mapped?.kind === "final_message") finalOutputText = mapped.text;
      if (mapped?.kind === "turn_completed") {
        turnStatus = mapped.status === "inProgress" ? "failed" : mapped.status;
        finalOutputText = mapped.outputText ?? finalOutputText;
        if (mapped.error) observedErrors.add(mapped.error);
        yield { type: "event", eventType: "turn.completed" };
        subprocess.stdin.end();
      }
      if (mapped?.kind === "event") yield mapped.event;
    }

    const result = await subprocess;
    yield completedResult({
      aborted: signal?.aborted === true,
      processSignal: result.signal,
      exitCode: result.exitCode,
      stderr: result.stderr,
      turnStatus,
      threadId,
      turnId,
      finalOutputText,
      observedEvents,
      observedItemTypes,
      observedErrors,
    });
  } finally {
    signal?.removeEventListener("abort", interrupt);
    subprocess.kill("SIGTERM");
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

function startAppServer(options: CodexAppServerClientOptions) {
  const args = [
    "app-server", "--stdio",
    "--disable", "plugins",
    "--disable", "hooks",
    "--disable", "memories",
  ];
  const executable = options.executable ?? "npm";
  const executableArgs = options.executable
    ? args
    : ["--prefix", options.packageRoot ?? options.cwd, "exec", "--", "codex", ...args];
  // WHY：app-server 是官方提供 token delta 的产品集成协议；execa 只承担跨平台进程生命周期，不自行实现进程管理。
  return execa(executable, executableArgs, {
    cwd: options.cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    reject: false,
    cleanup: true,
    timeout: options.timeoutMs ?? 180_000,
    forceKillAfterDelay: 2_000,
  });
}

function initializeParams() {
  return {
    clientInfo: { name: "domain-analysis-workbench", title: "Data Collection Workbench", version: "0.1.0" },
    capabilities: { experimentalApi: false, requestAttestation: false },
  };
}

function handleResponse(
  response: z.infer<typeof responseSchema>,
  options: CodexAppServerClientOptions,
  prompt: string,
) {
  if (response.error) return undefined;
  if (response.id === 1) {
    return {
      kind: "thread" as const,
      params: {
        model: options.model,
        cwd: options.cwd,
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
        config: {
          model_reasoning_effort: options.reasoningEffort,
          ...(options.webSearch ? { web_search: "live" } : {}),
        },
      },
    };
  }
  if (response.id === 2) {
    const parsed = threadStartResultSchema.safeParse(response.result);
    if (!parsed.success) throw protocolError("thread/start 没有返回 ephemeral thread", parsed.error.message);
    const threadId = parsed.data.thread.id;
    return {
      kind: "turn" as const,
      threadId,
      params: {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        effort: options.reasoningEffort,
      },
    };
  }
  if (response.id === 3) {
    const parsed = turnStartResultSchema.safeParse(response.result);
    if (!parsed.success) throw protocolError("turn/start 没有返回 turn", parsed.error.message);
    return { kind: "turn_started" as const, turnId: parsed.data.turn.id };
  }
  return undefined;
}

function mapNotification(method: string, params: unknown) {
  if (method === "item/agentMessage/delta") {
    const parsed = deltaNotificationSchema.safeParse(params);
    return parsed.success
      ? { kind: "delta" as const, itemId: parsed.data.itemId, delta: parsed.data.delta }
      : undefined;
  }
  if (method === "item/started" || method === "item/completed") {
    const parsed = itemNotificationSchema.safeParse(params);
    if (!parsed.success) return undefined;
    const item = parsed.data.item;
    if (method === "item/completed" && item.type === "agentMessage" && item.phase !== "commentary" && item.text) {
      return { kind: "final_message" as const, text: item.text };
    }
    return {
      kind: "item" as const,
      rawType: item.type,
      itemType: normalizedItemType(item.type),
      itemId: boundedId(item.id),
      phase: item.phase ?? null,
      event: {
        type: "event" as const,
        eventType: normalizedEventType(method),
        itemType: normalizedItemType(item.type),
        itemId: boundedId(item.id),
        itemStatus: itemStatusOf(method, item.status),
        ...displayDetailOf(item),
      },
    };
  }
  if (method === "turn/completed") {
    const parsed = turnCompletedSchema.safeParse(params);
    if (!parsed.success) return undefined;
    return {
      kind: "turn_completed" as const,
      status: parsed.data.turn.status,
      outputText: finalMessageOf(parsed.data.turn.items),
      error: parsed.data.turn.error ? JSON.stringify(parsed.data.turn.error) : undefined,
    };
  }
  if (method === "error") return undefined;
  if (method === "thread/started" || method === "turn/started") {
    return { kind: "event" as const, event: { type: "event" as const, eventType: normalizedEventType(method) } };
  }
  return undefined;
}

function finalMessageOf(items: z.infer<typeof threadItemSchema>[]) {
  const final = [...items].reverse().find((item) => item.type === "agentMessage"
    && item.phase !== "commentary" && item.text);
  return final?.text;
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

function writeRequest(stream: NodeJS.WritableStream, method: string, id: number, params: object) {
  stream.write(`${JSON.stringify({ method, id, params })}\n`);
}

function writeNotification(stream: NodeJS.WritableStream, method: string) {
  stream.write(`${JSON.stringify({ method })}\n`);
}

function normalizedEventType(method: string) {
  return method.replaceAll("/", ".");
}

function normalizedItemType(type: string) {
  return type.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function itemStatusOf(method: string, status?: string): "running" | "completed" | "failed" {
  if (status && /fail|error|cancel/i.test(status)) return "failed";
  if (status && /complete|success/i.test(status)) return "completed";
  return method === "item/completed" ? "completed" : "running";
}

function displayDetailOf(item: z.infer<typeof threadItemSchema>) {
  let raw: string | undefined;
  if (item.type === "webSearch") {
    raw = item.query ?? item.action?.query ?? item.action?.queries?.join("；") ?? item.action?.url;
  }
  if (item.type === "commandExecution") raw = item.command;
  if (item.type === "mcpToolCall") raw = [item.server, item.tool].filter(Boolean).join(" / ") || undefined;
  const detail = raw ? sanitizeDisplayDetail(raw) : undefined;
  return detail ? { detail } : {};
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

function sanitizeDisplayDetail(value: string) {
  return value
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\b(authorization|cookie|password|secret|token|api[_-]?key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[已隐藏]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[已隐藏]@")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function boundedId(value: string) {
  return value.trim().slice(0, 240);
}
