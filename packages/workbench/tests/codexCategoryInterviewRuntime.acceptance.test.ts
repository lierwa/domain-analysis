import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { CategoryInterviewView } from "@domain-analysis/shared";
import { describe, expect, it } from "vitest";

import { createCodexCategoryInterviewRuntime } from "../src/codexCategoryInterviewRuntime";

const acceptanceEnabled = process.env.RUN_CODEX_ACCEPTANCE === "1";

describe.runIf(acceptanceEnabled)("Codex category interview runtime acceptance", () => {
  it("completes a real ephemeral turn without adding a global Session rollout", async () => {
    const before = await globalSessionFiles();
    const runtime = createCodexCategoryInterviewRuntime({
      repositoryRoot: path.resolve("../.."),
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
    const eventTypes: string[] = [];

    for await (const event of runtime.run({
      session: interviewView(),
      trigger: { type: "user_message", text: "开始采访。只提出当前最关键的一个负责人决策问题。" },
    })) eventTypes.push(event.type);

    const after = await globalSessionFiles();
    const added = [...after].filter((file) => !before.has(file));
    expect(eventTypes).toEqual(["text_delta", "completed"]);
    expect(added).toEqual([]);
  }, 210_000);
});

async function globalSessionFiles() {
  const sessionRoot = path.join(homedir(), ".codex", "sessions");
  return new Set(await readdir(sessionRoot, { recursive: true }).catch(() => []));
}

function interviewView(): CategoryInterviewView {
  return {
    session: {
      id: "ephemeral-acceptance",
      categoryHint: "冰箱",
      phase: "active",
      turnState: "running",
      revision: 1,
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
    },
    messages: [],
    decisions: [],
    unresolvedItems: [],
    briefs: [],
  };
}
