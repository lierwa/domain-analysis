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

  it("允许多个本地 checkout 显式复用同一份 Source Asset 存储", () => {
    expect(loadConfig({ SOURCE_ASSET_CACHE_PATH: "/var/local/domain-analysis/source-assets" }))
      .toMatchObject({ sourceAssetCachePath: "/var/local/domain-analysis/source-assets" });
  });
});
