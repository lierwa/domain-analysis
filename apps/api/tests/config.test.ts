import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config";

describe("API 安全配置", () => {
  it("未配置的部署默认关闭 JD 真实 HTTP，只有精确 true 才开启", () => {
    expect(loadConfig({}).jdRealHttpEnabled).toBe(false);
    expect(loadConfig({ JD_REAL_HTTP_ENABLED: "false" }).jdRealHttpEnabled).toBe(false);
    expect(loadConfig({ JD_REAL_HTTP_ENABLED: "true" }).jdRealHttpEnabled).toBe(true);
  });

  it("项目本地启动配置装配 JD HTTP，真正出网仍等待显式 Start", () => {
    const localDevelopmentEnv = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    expect(localDevelopmentEnv).toContain("JD_REAL_HTTP_ENABLED=true");
  });
});
