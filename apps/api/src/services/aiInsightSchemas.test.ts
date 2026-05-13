import { describe, expect, it } from "vitest";
import { runAiInsightOutputSchema } from "./aiInsightSchemas";

describe("AI insight schemas", () => {
  it("accepts evidence-backed post and run insights", () => {
    const parsed = runAiInsightOutputSchema.parse({
      items: [
        {
          rawContentId: "raw_1",
          problemStatement: "User is unsure whether an arm placement works for the next tattoo.",
          userIntent: "Decide placement before booking.",
          audienceSegment: "Tattoo planning user",
          needType: "placement decision",
          painPoints: ["uncertain placement", "needs design confidence"],
          desiredOutcome: "A clear placement recommendation",
          sentiment: "concerned",
          confidence: 0.82,
          evidence: [
            {
              source: "post_body",
              rawContentId: "raw_1",
              quote: "Advice on next tattoo design and placement on arm?",
              url: "https://www.reddit.com/r/tattooadvice/comments/1"
            }
          ],
          recommendedAction: "Create placement decision content with visual examples."
        }
      ],
      summary: {
        themes: [
          {
            themeName: "Placement anxiety",
            whyItMatters: "Users delay booking because they cannot visualize fit.",
            opportunityType: "content",
            demandSignals: ["placement questions", "arm mentions"],
            contentIdeas: ["Arm placement checklist"],
            productServiceIdeas: ["Placement consult package"],
            representativePostIds: ["raw_1"],
            riskOrLimitations: ["Only one detailed post supports this theme."]
          }
        ],
        opportunityTypes: ["content"],
        topDemandSignals: ["placement questions"],
        recommendedNextActions: ["Collect more detail pages"],
        dataLimitations: ["Image content was not visually analyzed."]
      }
    });

    expect(parsed.items[0]?.evidence[0]?.source).toBe("post_body");
    expect(parsed.summary.themes[0]?.themeName).toBe("Placement anxiety");
  });
});
