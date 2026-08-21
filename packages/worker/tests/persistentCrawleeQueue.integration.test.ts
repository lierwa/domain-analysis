import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  createPersistentCrawleeConfiguration,
  openPersistentRequestQueue,
  requestLockRecoveryWaitMs,
} from "../src/ephemeralCrawleeConfiguration";

describe("持久 RequestQueue 强杀恢复", () => {
  let temporaryDirectory: string | undefined;
  let child: ChildProcess | undefined;

  afterEach(async () => {
    if (child?.exitCode === null) child.kill("SIGKILL");
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    child = undefined;
    temporaryDirectory = undefined;
  });

  it("强杀后已完成项不重复，锁过期前不派发，显式继续只取得未完成项", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "domain-analysis-crawlee-kill-"));
    child = spawn(process.execPath, ["--import=tsx", childScript(), temporaryDirectory, "jd-kill-run"], {
      cwd: path.resolve("."), stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForLine(child, "LOCKED:detail:1");
    child.kill("SIGKILL");
    await waitForExit(child);

    const restarted = createPersistentCrawleeConfiguration(temporaryDirectory);
    const queue = await openPersistentRequestQueue("jd-kill-run", restarted, 1);
    const duplicate = await queue.addRequest({
      url: "https://fixture.invalid/catalog", uniqueKey: "catalog:1",
    });
    expect(duplicate.wasAlreadyHandled).toBe(true);
    expect(await queue.fetchNextRequest()).toBeNull();
    await restarted.getStorageClient().teardown?.();
    // Crawlee 3.18.1 的队头锁在水合时会再延长一个周期；只等一个周期正是旧实现漏抓的边界。
    await new Promise((resolve) => setTimeout(resolve, requestLockRecoveryWaitMs(2)));
    const continued = createPersistentCrawleeConfiguration(temporaryDirectory);
    const continuedQueue = await openPersistentRequestQueue("jd-kill-run", continued, 1);
    const remaining = await fetchNextEventually(continuedQueue);
    expect(remaining?.uniqueKey, JSON.stringify(await continuedQueue.getInfo())).toBe("detail:1");
    if (remaining) await continuedQueue.markRequestHandled(remaining);
    await continued.getStorageClient().teardown?.();
  }, 15_000);
});

function childScript() {
  return fileURLToPath(new URL("./fixtures/persistentQueueChild.ts", import.meta.url));
}

function waitForLine(child: ChildProcess, expected: string) {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`子进程未输出 ${expected}：${output}`)), 5_000);
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes(expected)) { clearTimeout(timeout); resolve(); }
    });
    child.stderr?.on("data", (chunk) => { output += String(chunk); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => {
      if (!output.includes(expected)) { clearTimeout(timeout); reject(new Error(`子进程提前退出 ${code}：${output}`)); }
    });
  });
}

function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

async function fetchNextEventually(queue: Awaited<ReturnType<typeof openPersistentRequestQueue>>) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const request = await queue.fetchNextRequest();
    if (request) return request;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}
