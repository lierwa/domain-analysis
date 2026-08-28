import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config";

describe("API 安全配置", () => {
  it("未配置时只监听本机并使用采访模型默认值", () => {
    expect(loadConfig({})).toMatchObject({ host: "127.0.0.1", port: 4000,
      interviewModelId: "gpt-5.6-terra", interviewReasoningEffort: "medium" });
  });

  it("允许调整采访模型与推理深度", () => {
    expect(loadConfig({
      INTERVIEW_MODEL_ID: "gpt-5.6-sol",
      INTERVIEW_REASONING_EFFORT: "high",
    })).toMatchObject({
      interviewModelId: "gpt-5.6-sol", interviewReasoningEffort: "high",
    });
  });
});
