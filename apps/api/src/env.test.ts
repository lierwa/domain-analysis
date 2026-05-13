import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRuntimeEnv } from "./env";

describe("runtime env loader", () => {
  it("loads the repository .env when the API starts from apps/api", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "domain-analysis-env-"));
    try {
      const apiDir = join(tempDir, "apps", "api");
      await mkdir(apiDir, { recursive: true });
      await writeFile(
        join(tempDir, ".env"),
        [
          "AI_MODEL=qwen-plus",
          "AI_API_KEY=secret-key",
          "AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1"
        ].join("\n")
      );

      const env: NodeJS.ProcessEnv = {};
      loadRuntimeEnv({ cwd: apiDir, env });

      expect(env).toMatchObject({
        AI_MODEL: "qwen-plus",
        AI_API_KEY: "secret-key",
        AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
