/** @vitest-environment jsdom */

import { knowledgePackSchema, knowledgeRunViewSchema, knowledgeVersionSchema } from "@domain-analysis/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeVersions } from "../src/pages/knowledge/KnowledgeVersions";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const at = "2026-09-04T00:00:00.000Z";
const hash = (char: string) => char.repeat(64);
const pack = knowledgePackSchema.parse({ id: "pack", name: "测试包", scope: "测试范围", revision: 5, selectionRevision: 1,
  skillName: "test-skill", selection: [], settings: { ocr: false, budgetSeconds: 120, requiredInputKeys: [] }, createdAt: at, updatedAt: at });
const run = knowledgeRunViewSchema.parse({ run: { id: "run", packId: pack.id, sourceRevision: 1, inputs: [], settings: pack.settings,
  inputHash: hash("a"), toolVersion: "fixture", llmCalls: 0, llmTokens: 0, generation: 1, reviewRevision: 0,
  stage: "review", status: "completed", stopRequested: false, createdAt: at }, items: [], decisions: [],
  admission: { candidates: [], accepted: 1, images: 0, autoAccepted: 1, reviewAccepted: 0, excluded: 0,
    openIssues: 0, quarantined: 0, gaps: [] }, issues: [], versionInputHash: hash("b") });

describe("知识包版本身份", () => {
  it("已有版本不匹配当前自动判断摘要时仍允许生成新版本", () => {
    const old = knowledgeVersionSchema.parse({ id: "version-3", packId: pack.id, runId: run.run.id, number: 3,
      generation: 1, packRevision: 5, reviewRevision: 0, inputHash: hash("c"), status: "published", createdAt: at, publishedAt: at });
    render(<KnowledgeVersions view={{ pack, runs: [run.run], versions: [old] }} run={run} action={vi.fn()} busy={false} />);

    expect((screen.getByRole("button", { name: "生成 Skill 版本" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("只有相同版本输入摘要才显示当前结果已冻结", () => {
    const current = knowledgeVersionSchema.parse({ id: "version-4", packId: pack.id, runId: run.run.id, number: 4,
      generation: 1, packRevision: 5, reviewRevision: 0, inputHash: run.versionInputHash,
      status: "published", createdAt: at, publishedAt: at });
    render(<KnowledgeVersions view={{ pack, runs: [run.run], versions: [current] }} run={run} action={vi.fn()} busy={false} />);

    expect((screen.getByRole("button", { name: "当前结果已冻结为版本 4" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("用固定高度文件浏览器切换包内文件", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "# preview" }));
    const version = knowledgeVersionSchema.parse({ id: "version-4", packId: pack.id, runId: run.run.id, number: 4,
      generation: 1, packRevision: 5, reviewRevision: 0, inputHash: run.versionInputHash,
      status: "published", createdAt: at, publishedAt: at, artifact: { format: "agent-skill",
        skillName: "test-skill", entrypoint: "test-skill/SKILL.md", sha256: hash("d"), bytes: 2048,
        resources: [
          { name: "SKILL.md", path: "test-skill/SKILL.md", bytes: 800, hash: hash("e"), mediatype: "text/markdown" },
          { name: "catalog.json", path: "test-skill/assets/data/catalog.json", bytes: 1248,
            hash: hash("f"), mediatype: "application/json" },
        ], accepted: 3, images: 0, quarantined: 0, gaps: [], contentHashes: {},
        changes: { added: 3, removed: 0, modified: 0 } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><KnowledgeVersions
      view={{ pack, runs: [run.run], versions: [version] }} run={run}
      action={vi.fn()} busy={false} /></QueryClientProvider>);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Skill 包文件" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /catalog\.json/ }));
    expect(screen.getByRole("region", { name: "包内文件预览" }).textContent)
      .toContain("test-skill/assets/data/catalog.json");
  });
});
