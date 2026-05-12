import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunDetail } from "./RunDetail";
import type { AnalysisRun } from "../lib/api";

const baseRun: AnalysisRun = {
  id: "run_1",
  projectId: "project_1",
  name: "tattoo design",
  status: "login_required",
  includeKeywords: ["tattoo design"],
  excludeKeywords: [],
  platform: "x",
  limit: 200,
  collectedCount: 0,
  validCount: 0,
  duplicateCount: 0,
  analyzedCount: 0,
  createdAt: "2026-05-12T07:00:00.000Z",
  updatedAt: "2026-05-12T07:00:00.000Z"
};

describe("RunDetail", () => {
  it("shows login recovery actions for login-required runs", () => {
    const queryClient = new QueryClient();

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <RunDetail run={baseRun} onRefresh={() => undefined} onDeleted={() => undefined} />
      </QueryClientProvider>
    );

    expect(html).toContain("Login Required");
    expect(html).toContain("Open login browser");
    expect(html).toContain("Continue");
    expect(html).not.toContain(">Retry<");
  });
});
