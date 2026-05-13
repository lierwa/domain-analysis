import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InsightsWorkspace, RunDetail } from "./RunDetail";
import type { AnalysisRun, RunInsightsResponse } from "../lib/api";

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

  it("shows report regeneration for report-ready runs", () => {
    const queryClient = new QueryClient();

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <RunDetail
          run={{ ...baseRun, status: "report_ready", reportId: "report_1" }}
          onRefresh={() => undefined}
          onDeleted={() => undefined}
        />
      </QueryClientProvider>
    );

    expect(html).toContain("Regenerate report");
  });

  it("renders the AI insights workspace with evidence and confidence", () => {
    const html = renderToStaticMarkup(
      <InsightsWorkspace
        data={createInsightsData()}
        onRunAnalysis={() => undefined}
        isAnalyzing={false}
        canRunAnalysis={true}
        providerStatus={{ configured: true, provider: "openai-compatible", model: "test-model" }}
      />
    );

    expect(html).toContain("AI Opportunity Workspace");
    expect(html).toContain("Placement confidence");
    expect(html).toContain("84%");
    expect(html).toContain("Advice on tattoo placement");
    expect(html).not.toContain("deterministic-v1");
  });

  it("hides refresh when AI provider is not configured", () => {
    const html = renderToStaticMarkup(
      <InsightsWorkspace
        data={createInsightsData()}
        onRunAnalysis={() => undefined}
        isAnalyzing={false}
        canRunAnalysis={true}
        providerStatus={{ configured: false, provider: "openai-compatible" }}
      />
    );

    expect(html).toContain("AI provider not configured");
    expect(html).not.toContain("Refresh AI insights");
  });
});

function createInsightsData(): RunInsightsResponse {
  return {
    summary: {
      totalContents: 2,
      totalInsights: 2,
      totalEngagement: 26,
      uniqueAuthors: 2,
      dataCompleteness: 50,
      themes: [
        {
          themeName: "Placement confidence",
          whyItMatters: "Users need help visualizing fit before booking.",
          opportunityType: "content",
          demandSignals: ["placement question"],
          contentIdeas: ["Arm placement checklist"],
          productServiceIdeas: ["Placement consult"],
          representativePostIds: ["raw_1"],
          riskOrLimitations: ["No visual model analysis."]
        }
      ],
      opportunityTypes: [{ key: "content", count: 1 }],
      topDemandSignals: [{ key: "placement question", count: 1 }],
      topSubreddits: [{ key: "tattooadvice", count: 1 }],
      recommendedNextActions: ["Collect more comments"],
      dataLimitations: ["Images were collected as URLs only."]
    },
    items: [
      {
        id: "insight_1",
        rawContentId: "raw_1",
        problemStatement: "User needs confidence before committing to arm placement.",
        userIntent: "Choose tattoo placement.",
        audienceSegment: "Tattoo planning user",
        needType: "placement decision",
        painPoints: ["uncertain fit"],
        desiredOutcome: "A confident placement decision",
        sentiment: "concerned",
        confidence: 0.84,
        engagementScore: 22,
        evidence: [
          {
            source: "post_body",
            rawContentId: "raw_1",
            quote: "Advice on tattoo placement",
            url: "https://www.reddit.com/r/tattooadvice/comments/1"
          }
        ],
        recommendedAction: "Create a placement decision guide.",
        modelName: "openai-compatible:test-model",
        createdAt: "2026-05-13T00:00:00.000Z",
        source: {
          text: "Advice on tattoo placement",
          url: "https://www.reddit.com/r/tattooadvice/comments/1",
          authorName: "artist",
          metricsJson: { score: 4, comments: 9, subreddit: "tattooadvice" }
        }
      }
    ],
    page: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false }
  };
}
