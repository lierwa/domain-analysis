/** @vitest-environment jsdom */

import { knowledgePackSchema } from "@domain-analysis/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { KnowledgeAction } from "../src/pages/KnowledgeWorkspace";
import { KnowledgeSelection } from "../src/pages/knowledge/KnowledgeSelection";

afterEach(cleanup);

describe("知识包按采集批次选料", () => {
  it("复用组件选择任务，并按整个完成批次汇总全部恢复 Run", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(["capture-tasks"], [{ id: "task-1", name: "微波炉抓取任务" }]);
    client.setQueryData(["source-dataset", "task-1"], {
      batches: [{ id: "batch-1", taskId: "task-1", sourceCollectionPlanId: "plan-2",
        sourceCollectionPlanVersion: 2, taskRevision: 2, status: "completed", recoveryState: "completed",
        plannedSourceCount: 1, startedAt: "2026-08-31T01:50:14.188Z" }],
      runs: [
        { executionBatchId: "batch-1", snapshotCount: 347, assetCount: 275 },
        { executionBatchId: "batch-1", snapshotCount: 2211, assetCount: 1773 },
        { executionBatchId: "batch-1", snapshotCount: 1217, assetCount: 870 },
        { executionBatchId: "batch-1", snapshotCount: 24, assetCount: 0 },
        { executionBatchId: "batch-1", snapshotCount: 1, assetCount: 0 },
      ],
      executions: [{ batchId: "batch-1", status: "failed", plannedSourceCount: 1,
        counts: { running: 0, completed: 0, failed: 1, stopped: 0, missing: 0 }, latestRuns: [] }],
    });
    const pack = knowledgePackSchema.parse({ id: "pack-1", name: "微波炉资料", scope: "家用微波炉",
      skillName: "microwave-knowledge", revision: 2, selectionRevision: 1,
      selection: [{ taskId: "task-1", batchId: "batch-1" }],
      settings: { ocr: true, budgetSeconds: 120, requiredInputKeys: [] },
      createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" });
    const action: KnowledgeAction = async () => true;

    render(<QueryClientProvider client={client}><KnowledgeSelection pack={pack} action={action}
      busy={false} onSaved={() => undefined} /></QueryClientProvider>);

    expect(screen.getByRole("combobox", { name: "抓取任务" }).tagName).toBe("BUTTON");
    expect(screen.getByText("3800")).toBeTruthy();
    expect(screen.getByText("2918 个附件")).toBeTruthy();
    expect(screen.getByText("1/1")).toBeTruthy();
    expect(screen.getByText("已完成")).toBeTruthy();
    expect((screen.getByRole("button", { name: "保存并进入加工" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
