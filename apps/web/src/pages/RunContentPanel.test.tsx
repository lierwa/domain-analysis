import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContentCard } from "./RunContentPanel";
import type { RunContent } from "../lib/api";

describe("ContentCard", () => {
  it("renders reddit comment counts from metricsJson.comments", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        content={{
          id: "raw_1",
          analysisRunId: "run_1",
          crawlTaskId: "task_466bb421",
          platform: "reddit",
          authorName: "SquitleSkittle",
          url: "https://www.reddit.com/r/tattooadvice/comments/1",
          text: "Advice on next tattoo design and placement on arm?",
          matchedKeywords: ["tattoo design"],
          metricsJson: { score: 4, comments: 9 },
          capturedAt: "2026-05-13T06:23:00.000Z"
        } satisfies RunContent}
      />
    );

    expect(html).toContain("↑ 4");
    expect(html).toContain("💬 9");
  });

  it("renders AI selection status when candidate diagnostics are available", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        content={{
          id: "raw_1",
          analysisRunId: "run_1",
          platform: "reddit",
          authorName: "artist",
          url: "https://www.reddit.com/r/tattooadvice/comments/1",
          text: "Advice on next tattoo design and placement on arm?",
          matchedKeywords: ["tattoo design"],
          metricsJson: { score: 4, comments: 9 },
          capturedAt: "2026-05-13T06:23:00.000Z"
        } satisfies RunContent}
        aiCandidate={{
          id: "aicand_1",
          aiInsightRunId: "airun_1",
          analysisRunId: "run_1",
          rawContentId: "raw_1",
          selected: true,
          selectionScore: 84,
          selectionReasons: ["engagement"],
          batchIndex: 0,
          inputTextPreview: "Advice on next tattoo design and placement on arm?",
          createdAt: "2026-05-13T06:23:00.000Z"
        }}
      />
    );

    expect(html).toContain("Selected for AI");
  });
});
