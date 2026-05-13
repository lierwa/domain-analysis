import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../server";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("settings routes", () => {
  it("returns AI provider status without leaking the API key", async () => {
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_MODEL = "qwen-plus";
    process.env.AI_API_KEY = "secret-ai-key";
    process.env.AI_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const app = await buildServer({ logger: false });

    const response = await app.inject({ method: "GET", url: "/api/settings/ai/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json().item).toMatchObject({
      configured: true,
      provider: "openai-compatible",
      model: "qwen-plus",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    });
    expect(response.body).not.toContain("secret-ai-key");

    await app.close();
  });
});
