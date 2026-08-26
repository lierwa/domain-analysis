import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config";

describe("API 安全配置", () => {
  it("未配置时只监听本机并使用已验证的规划模型默认值", () => {
    expect(loadConfig({})).toMatchObject({ host: "127.0.0.1", port: 4000,
      interviewModelId: "gpt-5.6-terra", interviewReasoningEffort: "medium",
      crawlPlanningBrandBatchSize: 3 });
  });

  it("允许把官网核对批量调整为单品牌，但拒绝无界批量", () => {
    expect(loadConfig({ CRAWL_PLANNING_BRAND_BATCH_SIZE: "1" }).crawlPlanningBrandBatchSize).toBe(1);
    expect(() => loadConfig({ CRAWL_PLANNING_BRAND_BATCH_SIZE: "11" })).toThrow();
  });
});
