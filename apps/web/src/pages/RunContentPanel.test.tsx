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

    expect(html).toContain("Score 4");
    expect(html).toContain("Comments 9");
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

  it("renders raw detail summary and top comments when detail payload exists", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        content={{
          id: "raw_1",
          analysisRunId: "run_1",
          platform: "reddit",
          url: "https://www.reddit.com/r/tattooadvice/comments/1",
          text: "Advice on next tattoo design and placement on arm?",
          matchedKeywords: ["tattoo design"],
          metricsJson: { score: 4, comments: 9 },
          rawJson: {
            detail: {
              fetchStatus: "success",
              title: "Advice on next tattoo design",
              body: "Long detail body about placement and healing.",
              topComments: [{ author: "helper", text: "Upper arm works well.", score: 5 }]
            }
          },
          capturedAt: "2026-05-13T06:23:00.000Z"
        } satisfies RunContent}
      />
    );

    expect(html).toContain("Detail: ready");
    expect(html).toContain("Top comments");
    expect(html).toContain("Upper arm works well.");
  });

  it("separates list title/summary and cleans noisy detail comment text for display", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        content={{
          id: "raw_2",
          analysisRunId: "run_1",
          platform: "reddit",
          url: "https://www.reddit.com/r/tattooadvice/comments/2",
          text: "Advice on next tattoo design\n\nAdvice on next tattoo design Read more",
          matchedKeywords: ["tattoo design"],
          metricsJson: { score: 4, comments: 9 },
          rawJson: {
            detail: {
              fetchStatus: "success",
              title: "Advice on next tattoo design",
              body: "Advice on next tattoo design\n\nMore context in detail body. Read more",
              mediaUrls: ["https://preview.redd.it/a.jpg"],
              topComments: [
                {
                  author: "helper",
                  text: "helper • 9h ago Works well. SML.load([\"A\"], 'en-US/', 'auto'); 1"
                }
              ]
            }
          },
          capturedAt: "2026-05-13T06:23:00.000Z"
        } satisfies RunContent}
      />
    );

    expect(html).toContain("Advice on next tattoo design");
    expect(html).toContain("helper");
    expect(html).toContain("Works well.");
    expect(html).not.toContain("SML.load");
    expect(html).not.toContain("Read more");
    expect(html).toContain("Media links");
    expect(html).toContain("https://preview.redd.it/a.jpg");
    expect(html).not.toContain("Advice on next tattoo design Read more");
  });

  it("shows media thumbnails when async media download is ready", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        content={{
          id: "raw_3",
          analysisRunId: "run_1",
          platform: "reddit",
          url: "https://www.reddit.com/r/tattooadvice/comments/3",
          text: "Need ideas",
          matchedKeywords: ["tattoo design"],
          metricsJson: { score: 10, comments: 2 },
          rawJson: {
            detail: { fetchStatus: "success", body: "Body text." },
            media: {
              status: "ready",
              assets: [
                {
                  originalUrl: "https://i.redd.it/full.jpg",
                  thumbnailUrl: "/api/media/run_1/raw_3/1.jpg",
                  thumbnailPath: "data/media/run_1/raw_3/1.jpg",
                  width: 320,
                  height: 320,
                  format: "jpeg"
                }
              ]
            }
          },
          capturedAt: "2026-05-13T06:23:00.000Z"
        } satisfies RunContent}
      />
    );

    expect(html).toContain("Media ready");
    expect(html).toContain("media thumbnail");
    expect(html).toContain("/api/media/run_1/raw_3/1.jpg");
  });
});
