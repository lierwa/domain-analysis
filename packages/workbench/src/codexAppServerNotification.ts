import { z } from "zod";

import {
  extractCodexWebSearchProjection,
  sanitizeCodexDisplayDetail,
} from "./codexActivityProjection";

const threadItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string().optional(),
  text: z.string().optional(),
  phase: z.enum(["commentary", "final_answer"]).nullable().optional(),
  query: z.string().optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  aggregatedOutput: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  durationMs: z.number().nonnegative().nullable().optional(),
  server: z.string().optional(),
  tool: z.string().optional(),
  action: z.object({
    type: z.string(),
    query: z.string().nullable().optional(),
    queries: z.array(z.string()).nullable().optional(),
    url: z.string().nullable().optional(),
  }).passthrough().nullable().optional(),
  results: z.array(z.unknown()).nullable().optional(),
}).passthrough();

const itemNotificationSchema = z.object({ item: threadItemSchema }).passthrough();
const deltaNotificationSchema = z.object({ itemId: z.string(), delta: z.string().min(1) }).passthrough();
const rawResponseItemCompletedSchema = z.object({
  item: z.object({
    type: z.literal("web_search_call"),
    action: z.object({
      type: z.string(),
      url: z.string().nullable().optional(),
    }).passthrough().nullable().optional(),
  }).passthrough(),
}).passthrough();
const turnCompletedSchema = z.object({
  turn: z.object({
    status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
    error: z.unknown().nullable().optional(),
    items: z.array(threadItemSchema).default([]),
  }).passthrough(),
}).passthrough();

export function mapCodexAppServerNotification(method: string, params: unknown) {
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
        eventType: normalizedCodexEventType(method),
        itemType: normalizedItemType(item.type),
        itemId: boundedId(item.id),
        itemStatus: itemStatusOf(method, item.status),
        ...displayDetailOf(item),
      },
    };
  }
  if (method === "rawResponseItem/completed") {
    const parsed = rawResponseItemCompletedSchema.safeParse(params);
    const url = parsed.success
      ? extractCodexWebSearchProjection({ action: parsed.data.item.action }).urls[0]
      : undefined;
    if (!url) return undefined;
    // WHY：官方 raw 通知在 adapter 内收窄为既有 web_search activity，不向 Workbench 泄漏底层协议。
    return {
      kind: "item" as const,
      rawType: "webSearch",
      itemType: "web_search",
      itemId: "web-search-pages",
      phase: null,
      event: {
        type: "event" as const,
        eventType: "item.completed",
        itemType: "web_search",
        itemId: "web-search-pages",
        itemStatus: "completed" as const,
        urls: [url],
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
  if (method === "thread/started" || method === "turn/started") {
    return { kind: "event" as const, event: {
      type: "event" as const,
      eventType: normalizedCodexEventType(method),
    } };
  }
  return undefined;
}

export function normalizedCodexEventType(method: string) {
  return method.replaceAll("/", ".");
}

function finalMessageOf(items: z.infer<typeof threadItemSchema>[]) {
  return [...items].reverse().find((item) => item.type === "agentMessage"
    && item.phase !== "commentary" && item.text)?.text;
}

function normalizedItemType(type: string) {
  return type.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function itemStatusOf(method: string, status?: string): "running" | "completed" | "failed" {
  if (status && /fail|error|cancel|declin/i.test(status)) return "failed";
  if (status && /complete|success/i.test(status)) return "completed";
  return method === "item/completed" ? "completed" : "running";
}

function displayDetailOf(item: z.infer<typeof threadItemSchema>) {
  let raw: string | undefined;
  let urls: string[] = [];
  if (item.type === "webSearch") {
    const projection = extractCodexWebSearchProjection(item);
    raw = projection.detail;
    urls = projection.urls;
  }
  if (item.type === "mcpToolCall") raw = [item.server, item.tool].filter(Boolean).join(" / ") || undefined;
  const detail = raw ? sanitizeCodexDisplayDetail(raw) : undefined;
  return {
    ...(detail ? { detail } : {}),
    ...(urls.length > 0 ? { urls } : {}),
  };
}

function boundedId(value: string) {
  return value.trim().slice(0, 240);
}
