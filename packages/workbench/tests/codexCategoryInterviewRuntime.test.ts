import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CategoryInterviewView } from "@domain-analysis/shared";
import { afterEach, describe, expect, it } from "vitest";

import { CodexAppServerError, streamCodexAppServer } from "../src/codexAppServerClient";
import { createCodexCategoryInterviewRuntime } from "../src/codexCategoryInterviewRuntime";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex 采访运行时事件边界", () => {
  it("使用 ephemeral app-server thread，并在进程结束前交付真实 token delta", async () => {
    const executable = await fakeCodexExecutable(successSource());
    const iterator = streamCodexAppServer(clientOptions(executable), "抓冰箱")[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "event", eventType: "thread.started" },
    });
    const remaining = await collectIterator(iterator);

    expect(remaining).toContainEqual({ type: "event", eventType: "turn.started" });
    expect(remaining).toContainEqual({ type: "text_delta", delta: "正在" });
    expect(remaining).toContainEqual({ type: "text_delta", delta: "调查候选来源。" });
    expect(remaining).toContainEqual({
      type: "event",
      eventType: "item.started",
      itemType: "web_search",
      itemId: "search-1",
      itemStatus: "running",
      detail: "冰箱 中国市场 主流品牌 官方网站",
    });
    expect(remaining.at(-1)).toMatchObject({ type: "result", result: { interrupted: false } });
  });

  it("把真实 commentary delta 和工具调用同时映射给 Workbench", async () => {
    const runtime = createCodexCategoryInterviewRuntime({
      repositoryRoot: process.cwd(),
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      executable: await fakeCodexExecutable(successSource()),
    });

    const events = await collect(runtime.run({
      session: emptyInterviewView(),
      trigger: { type: "user_message", text: "抓冰箱" },
    }));

    expect(events.filter((event) => event.type === "text_delta")).toEqual([
      { type: "text_delta", delta: "正在" },
      { type: "text_delta", delta: "调查候选来源。" },
    ]);
    expect(events.filter((event) => event.type === "activity")).toEqual([
      { type: "activity", activity: {
        id: "agent-starting", kind: "agent", label: "启动抓取规划 Agent", status: "running",
      } },
      { type: "activity", activity: {
        id: "turn-analysis", kind: "analysis", label: "分析需求与当前抓取范围", status: "running",
      } },
      { type: "activity", activity: {
        id: "search-1", kind: "web_search", label: "搜索网页",
        detail: "冰箱 中国市场 主流品牌 官方网站", status: "running",
      } },
      { type: "activity", activity: {
        id: "search-1", kind: "web_search", label: "搜索网页",
        detail: "冰箱 中国市场 主流品牌 官方网站", status: "completed",
      } },
      { type: "activity", activity: {
        id: "turn-finalizing", kind: "finalizing", label: "校验并生成本轮结果", status: "running",
      } },
      { type: "activity", activity: {
        id: "turn-finalizing", kind: "finalizing", label: "校验并生成本轮结果", status: "completed",
      } },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      output: { assistantText: "已完成第一轮调查。" },
    });
  });

  it("停止时终止当前 app-server 进程并返回 interrupted", async () => {
    const controller = new AbortController();
    const iterator = streamCodexAppServer(
      clientOptions(await fakeCodexExecutable(cancellableSource())),
      "抓冰箱",
      controller.signal,
    )[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "event", eventType: "thread.started" },
    });
    controller.abort();

    await expect(collectIterator(iterator)).resolves.toContainEqual({
      type: "result",
      result: {
        interrupted: true,
        observedEvents: ["thread.started"],
        observedItemTypes: [],
      },
    });
  });

  it("将带 ANSI 的 MCP 502 收窄为可重试的公开错误", async () => {
    const executable = await fakeCodexExecutable(failureSource());

    try {
      await collect(streamCodexAppServer(clientOptions(executable), "抓冰箱"));
      throw new Error("预期 Codex app-server 失败");
    } catch (error) {
      expect(error).toBeInstanceOf(CodexAppServerError);
      expect(error).toMatchObject({
        code: "service_unavailable",
        message: "Codex 服务暂时不可用（HTTP 502）。本轮未完成，请稍后重试。",
      });
      expect((error as Error).message).not.toContain("stderr");
      expect((error as Error).message).not.toContain("rmcp::transport::worker");
      expect((error as Error).message).not.toContain("\u001b");
    }
  });
});

function clientOptions(executable: string) {
  return {
    cwd: process.cwd(),
    model: "gpt-5.6-terra",
    reasoningEffort: "medium" as const,
    executable,
    webSearch: true,
  };
}

async function fakeCodexExecutable(source: string) {
  const root = await mkdtemp(path.join(tmpdir(), "domain-analysis-fake-codex-"));
  temporaryRoots.push(root);
  const executable = path.join(root, "codex-fake.mjs");
  await writeFile(executable, source);
  await chmod(executable, 0o755);
  return executable;
}

function successSource() {
  const output = JSON.stringify({
    assistantText: "已完成第一轮调查。",
    unresolvedItems: [],
    resolvedUnresolvedKeys: [],
  });
  return fakeServerPrelude() + `
async function handle(message) {
  if (process.argv.includes("--output-schema")) process.exit(4);
  for (const feature of ["plugins", "hooks", "memories"]) {
    if (!process.argv.includes(feature)) process.exit(6);
  }
  if (message.method === "initialize") {
    emit({ id: message.id, result: { userAgent: "fake", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" } });
    return;
  }
  if (message.method === "thread/start") {
    if (message.params.ephemeral !== true) process.exit(5);
    emit({ id: message.id, result: { thread: { id: "thread-1", ephemeral: true } } });
    emit({ method: "thread/started", params: { thread: { id: "thread-1", ephemeral: true } } });
    return;
  }
  if (message.method !== "turn/start") return;
  emit({ id: message.id, result: { turn: { id: "turn-1" } } });
  emit({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
  emit({ method: "item/started", params: { item: {
    id: "message-1", type: "agentMessage", text: "", phase: "commentary"
  } } });
  emit({ method: "item/agentMessage/delta", params: { itemId: "message-1", delta: "正在" } });
  await pause(10);
  emit({ method: "item/agentMessage/delta", params: { itemId: "message-1", delta: "调查候选来源。" } });
  emit({ method: "item/completed", params: { item: {
    id: "message-1", type: "agentMessage", text: "正在调查候选来源。", phase: "commentary"
  } } });
  emit({ method: "item/started", params: { item: {
    id: "search-1", type: "webSearch", query: "冰箱 中国市场 主流品牌 官方网站"
  } } });
  emit({ method: "item/completed", params: { item: {
    id: "search-1", type: "webSearch", query: "冰箱 中国市场 主流品牌 官方网站"
  } } });
  const finalItem = { id: "message-2", type: "agentMessage", text: ${JSON.stringify(output)}, phase: "final_answer" };
  emit({ method: "item/completed", params: { item: finalItem } });
  emit({ method: "turn/completed", params: { turn: {
    status: "completed", error: null, items: [finalItem]
  } } });
}
`;
}

function failureSource() {
  return fakeServerPrelude() + `
function handle(message) {
  if (message.method === "initialize") {
    emit({ id: message.id, result: { userAgent: "fake" } });
    return;
  }
  if (message.method === "thread/start") {
    emit({ id: message.id, result: { thread: { id: "thread-1", ephemeral: true } } });
    emit({ method: "thread/started", params: {} });
    return;
  }
  if (message.method === "turn/start") {
    process.stderr.write("\\u001b[31mrmcp::transport::worker UnexpectedServerResponse(\\\"HTTP 502: \\\")\\u001b[0m\\n");
    process.exit(1);
  }
}
`;
}

function cancellableSource() {
  return fakeServerPrelude() + `
function handle(message) {
  if (message.method === "initialize") {
    emit({ id: message.id, result: { userAgent: "fake" } });
    return;
  }
  if (message.method === "thread/start") {
    emit({ id: message.id, result: { thread: { id: "thread-1", ephemeral: true } } });
    emit({ method: "thread/started", params: {} });
  }
}
setInterval(() => {}, 60_000);
`;
}

function fakeServerPrelude() {
  return `#!/usr/bin/env node
import { createInterface } from "node:readline";
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => void handle(JSON.parse(line)));
`;
}

function emptyInterviewView(): CategoryInterviewView {
  const now = new Date().toISOString();
  return {
    session: {
      id: "session-1",
      initialRequest: "抓冰箱",
      phase: "active",
      turnState: "running",
      revision: 2,
      createdAt: now,
      updatedAt: now,
    },
    messages: [],
    decisions: [],
    unresolvedItems: [],
    taskDrafts: [],
  };
}

async function collect<T>(iterable: AsyncIterable<T>) {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

async function collectIterator<T>(iterator: AsyncIterator<T>) {
  const items: T[] = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) return items;
    items.push(next.value);
  }
}
