import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CategoryInterviewView } from "@domain-analysis/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  CodexAppServerError,
  createCodexAppServerClient,
  streamCodexAppServer,
} from "../src/codexAppServerClient";
import { createCodexCategoryInterviewRuntime } from "../src/codexCategoryInterviewRuntime";

const temporaryRoots: string[] = [];
const runtimeClosers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(runtimeClosers.splice(0).map((close) => close()));
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
    expect(remaining).toContainEqual({
      type: "event",
      eventType: "item.completed",
      itemType: "web_search",
      itemId: "search-1",
      itemStatus: "completed",
      detail: "冰箱 中国市场 主流品牌 官方网站",
      urls: [
        "https://www.jd.com/",
        "https://www.haier.com/refrigerators/",
        "https://example.com/private",
      ],
    });
    expect(remaining).toContainEqual({
      type: "event",
      eventType: "item.completed",
      itemType: "web_search",
      itemId: "web-search-pages",
      itemStatus: "completed",
      urls: ["https://www.midea.cn/"],
    });
    expect(remaining.at(-1)).toMatchObject({ type: "result", result: { interrupted: false } });
  });

  it("started/failed 搜索仍可见，但不计为完成证据", async () => {
    const items = await collect(streamCodexAppServer(
      clientOptions(await fakeCodexExecutable(successSource(true))), "抓冰箱",
    ));

    expect(items).toContainEqual(expect.objectContaining({
      type: "event", eventType: "item.completed", itemType: "web_search", itemStatus: "failed",
    }));
    const result = items.at(-1);
    expect(result?.type === "result" ? result.result.observedItemTypes : []).not.toContain("web_search");
  });
});

describe("Codex 采访结果投影与连接复用", () => {
  it("把真实 commentary 和网页搜索映射给 Workbench，但不暴露内部本地命令", async () => {
    const runtime = createCodexCategoryInterviewRuntime({
      repositoryRoot: process.cwd(),
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      executable: await fakeCodexExecutable(successSource()),
    });
    runtimeClosers.push(() => runtime.close?.() ?? Promise.resolve());

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
        id: "turn-lifecycle", kind: "agent", label: "启动抓取规划 Agent", status: "running",
      } },
      { type: "activity", activity: {
        id: "turn-lifecycle", kind: "analysis", label: "理解用户输入并更新抓取范围", status: "running",
      } },
      { type: "activity", activity: {
        id: "search-1", kind: "web_search", label: "搜索网页",
        detail: "冰箱 中国市场 主流品牌 官方网站", status: "running",
      } },
      { type: "activity", activity: {
        id: "search-1", kind: "web_search", label: "搜索网页",
        detail: "冰箱 中国市场 主流品牌 官方网站",
        urls: [
          "https://www.jd.com/",
          "https://www.haier.com/refrigerators/",
          "https://example.com/private",
        ], status: "completed",
      } },
      { type: "activity", activity: {
        id: "web-search-pages", kind: "web_search", label: "搜索网页",
        urls: ["https://www.midea.cn/"], status: "completed",
      } },
      { type: "activity", activity: {
        id: "turn-finalizing", kind: "finalizing", label: "整理并校验本轮结果", status: "running",
      } },
      { type: "activity", activity: {
        id: "turn-finalizing", kind: "finalizing", label: "整理并校验本轮结果", status: "completed",
      } },
    ]);
    expect(JSON.stringify(events)).not.toContain("C:/private/file");
    expect(JSON.stringify(events)).not.toContain("Cannot find path");
    const completed = events.at(-1);
    expect(completed).toMatchObject({
      type: "completed",
      output: {
        assistantText: "已完成第一轮调查并生成抓取任务草稿。",
        taskCandidate: {
          jd: {
            applicable: true,
            disposition: "pending",
          },
        },
      },
    });
    if (completed?.type !== "completed") throw new Error("采访运行时没有返回 completed");
    expect(completed.output.proposedDecision).toBeUndefined();
  });

  it("同一 client 连续两轮只初始化一次连接，但每轮新建 ephemeral thread", async () => {
    const client = createCodexAppServerClient(clientOptions(
      await fakeCodexExecutable(reusableConnectionSource()),
    ));
    runtimeClosers.push(() => client.close());

    const first = await collect(client.run("第一轮"));
    const second = await collect(client.run("第二轮"));
    const firstResult = first.find((item) => item.type === "result");
    const secondResult = second.find((item) => item.type === "result");

    expect(first).toContainEqual({ type: "event", eventType: "thread.started" });
    expect(second).toContainEqual({ type: "event", eventType: "thread.started" });
    expect(firstResult?.type === "result" ? firstResult.result.outputText : undefined)
      .toBe(secondResult?.type === "result" ? secondResult.result.outputText : undefined);
  });
});

describe("Codex 采访中断与错误边界", () => {
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
        observedEvents: ["thread.started", "turn.started", "turn.completed"],
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

function successSource(failedSearch = false) {
  const output = JSON.stringify({
    assistantText: "已完成第一轮调查并生成抓取任务草稿。",
    taskCandidate: {
      originalRequest: "抓冰箱",
      category: { code: "refrigerator", label: "冰箱" },
      marketScope: "中国大陆普通消费者可以买到的家用冰箱",
      generalTopics: ["品牌、型号、商品详情和原始参数"],
      categoryTopics: ["能效、容量、制冷方式和核心部件"],
      jd: { applicable: true, disposition: "pending", scope: [], rationale: "等待平台策略补全。" },
      sourceCandidates: [{
        id: "source-jd-refrigerator",
        name: "京东冰箱频道",
        publisher: "京东",
        entryUrl: "https://www.jd.com/",
        sourceKind: "retailer",
        expectedContents: ["冰箱类目、商品参数和评价指标"],
        observedFormats: ["HTML"],
        accessState: "public",
        observedAt: "2026-08-19T10:00:00+08:00",
      }],
      excludedContent: [],
      decisionIds: [],
    },
    unresolvedItems: [],
    resolvedUnresolvedKeys: [],
  });
  const rawCompletedSearch = failedSearch ? "" : `emit({ method: "rawResponseItem/completed", params: {
    threadId: "thread-1", turnId: "turn-1", item: {
      type: "web_search_call", id: "raw-search-1", status: "completed",
      action: { type: "open_page", url: "https://www.midea.cn/" }
    }
  } });`;
  return fakeServerPrelude() + `
let productInterviewThread = false;
let productInterviewCwd = "";
async function handle(message) {
  if (process.argv.includes("--output-schema")) process.exit(4);
  for (const feature of ["plugins", "hooks", "memories", "shell_tool", "unified_exec"]) {
    if (!process.argv.includes(feature)) process.exit(6);
  }
  if (message.method === "initialize") {
    emit({ id: message.id, result: { userAgent: "fake", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" } });
    return;
  }
  if (message.method === "thread/start") {
    if (message.params.ephemeral !== true) process.exit(5);
    productInterviewCwd = String(message.params.cwd);
    productInterviewThread = productInterviewCwd.endsWith("domain-analysis-category-interview");
    emit({ id: message.id, result: { thread: { id: "thread-1", ephemeral: true } } });
    emit({ method: "thread/started", params: { thread: { id: "thread-1", ephemeral: true } } });
    return;
  }
  if (message.method !== "turn/start") return;
  const isProductInterview = message.params.input.some((item) => item.type === "text"
    && item.text.includes("$interview-product-category"));
  if (isProductInterview && !productInterviewThread) process.exit(8);
  if (isProductInterview) {
    const prompt = message.params.input.find((item) => item.type === "text")?.text ?? "";
    if (!prompt.includes("不要通过本地命令查找或读取 Skill、AGENTS.md、开发文档或 Git 状态")) process.exit(9);
    if (!prompt.includes("不得把默认采集内容改写成采集深度问题")) process.exit(10);
    const skill = message.params.input.find((item) => item.type === "skill");
    if (skill?.name !== "interview-product-category"
      || !String(skill.path).startsWith(productInterviewCwd)
      || !String(skill.path).endsWith(".agents/skills/interview-product-category/SKILL.md")) {
      process.exit(7);
    }
  }
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
    id: "command-1", type: "commandExecution",
    command: "Get-Content .agents/skills/interview-product-category/SKILL.md; Get-Content docs/development/PROGRESS.md; git status --short; Get-Content C:/private/file"
  } } });
  emit({ method: "item/completed", params: { item: {
    id: "command-1", type: "commandExecution",
    command: "Get-Content .agents/skills/interview-product-category/SKILL.md; Get-Content docs/development/PROGRESS.md; git status --short; Get-Content C:/private/file",
    status: "failed", aggregatedOutput: "Cannot find path C:/private/file", exitCode: 1
  } } });
  emit({ method: "item/started", params: { item: {
    id: "search-1", type: "webSearch", query: "冰箱 中国市场 主流品牌 官方网站"
  } } });
  emit({ method: "item/completed", params: { item: {
    id: "search-1", type: "webSearch", query: "冰箱 中国市场 主流品牌 官方网站",
    status: "${failedSearch ? "failed" : "completed"}",
    action: { type: "openPage", url: "https://www.jd.com/", query: null, queries: null },
    results: [
      { title: "京东", url: "https://www.jd.com/" },
      { title: "海尔冰箱", metadata: { href: "https://www.haier.com/refrigerators/" } },
      { title: "带凭据 URL", url: "https://user:secret@example.com/private" },
      { title: "无效协议", link: "javascript:alert(1)" }
    ]
  } } });
  ${rawCompletedSearch}
  const finalItem = { id: "message-2", type: "agentMessage", text: ${JSON.stringify(output)}, phase: "final_answer" };
  emit({ method: "item/started", params: { item: {
    id: "message-2", type: "agentMessage", text: "", phase: "final_answer"
  } } });
  emit({ method: "item/completed", params: { item: finalItem } });
  emit({ method: "turn/completed", params: { turn: {
    status: "completed", error: null, items: [finalItem]
  } } });
}
`;
}

function reusableConnectionSource() {
  return fakeServerPrelude() + `
const connectionToken = String(process.pid) + "-" + String(Date.now());
let initializeCount = 0;
let threadCount = 0;
function handle(message) {
  if (message.method === "initialize") {
    initializeCount += 1;
    if (initializeCount !== 1) process.exit(21);
    emit({ id: message.id, result: { userAgent: "fake" } });
    return;
  }
  if (message.method === "thread/start") {
    threadCount += 1;
    if (message.params.ephemeral !== true) process.exit(22);
    emit({ id: message.id, result: { thread: { id: "thread-" + threadCount, ephemeral: true } } });
    emit({ method: "thread/started", params: { thread: { id: "thread-" + threadCount } } });
    return;
  }
  if (message.method !== "turn/start") return;
  const turnId = "turn-" + threadCount;
  emit({ id: message.id, result: { turn: { id: turnId } } });
  emit({ method: "turn/started", params: { turn: { id: turnId } } });
  const finalItem = { id: "message-" + threadCount, type: "agentMessage", text: connectionToken, phase: "final_answer" };
  emit({ method: "item/completed", params: { item: finalItem } });
  emit({ method: "turn/completed", params: { turn: { status: "completed", error: null, items: [finalItem] } } });
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
let activeThreadId = "thread-1";
let activeTurnId = "turn-1";
function handle(message) {
  if (message.method === "initialize") {
    emit({ id: message.id, result: { userAgent: "fake" } });
    return;
  }
  if (message.method === "thread/start") {
    emit({ id: message.id, result: { thread: { id: activeThreadId, ephemeral: true } } });
    emit({ method: "thread/started", params: {} });
    return;
  }
  if (message.method === "turn/start") {
    emit({ id: message.id, result: { turn: { id: activeTurnId } } });
    emit({ method: "turn/started", params: { threadId: activeThreadId, turn: { id: activeTurnId } } });
    return;
  }
  if (message.method === "turn/interrupt") {
    emit({ id: message.id, result: {} });
    emit({ method: "turn/completed", params: { turn: {
      status: "interrupted", error: null, items: []
    } } });
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
