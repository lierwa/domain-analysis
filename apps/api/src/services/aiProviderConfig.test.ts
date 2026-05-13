import { describe, expect, it } from "vitest";
import { getAiProviderStatus, loadAiProviderConfig } from "./aiProviderConfig";

describe("ai provider config", () => {
  it("reports an unconfigured provider without exposing secrets", () => {
    const status = getAiProviderStatus({});

    expect(status).toEqual({ configured: false, provider: "openai-compatible", model: undefined });
  });

  it("loads an OpenAI-compatible provider with base URL", () => {
    const config = loadAiProviderConfig({
      AI_PROVIDER: "openai-compatible",
      AI_MODEL: "qwen-plus",
      AI_API_KEY: "secret-key",
      AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    });
    const status = getAiProviderStatus({
      AI_PROVIDER: "openai-compatible",
      AI_MODEL: "qwen-plus",
      AI_API_KEY: "secret-key",
      AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    });

    expect(config).toMatchObject({
      provider: "openai-compatible",
      model: "qwen-plus",
      apiKey: "secret-key",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    });
    expect(JSON.stringify(status)).not.toContain("secret-key");
    expect(status).toMatchObject({ configured: true, provider: "openai-compatible", model: "qwen-plus" });
  });
});
