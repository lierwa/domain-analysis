import { describe, expect, it } from "vitest";
import { createExternalCollectorError, runExternalCollectorCommand } from "./externalCollector";

describe("runExternalCollectorCommand", () => {
  it("returns items from the external collector stdout JSON contract", async () => {
    const result = await runExternalCollectorCommand({
      command: process.execPath,
      args: ["-e", "process.stdout.write(JSON.stringify({items:[{platform:'youtube',url:'https://youtu.be/1',text:'demo'}]}))"],
      input: {
        platform: "youtube",
        query: { includeKeywords: ["demo"], excludeKeywords: [], language: "en", limitPerRun: 1 },
        config: {}
      },
      timeoutMs: 5000
    });

    expect(result.items).toEqual([{ platform: "youtube", url: "https://youtu.be/1", text: "demo" }]);
  });

  it("throws the collector error code when stdout returns an error envelope", async () => {
    await expect(
      runExternalCollectorCommand({
        command: process.execPath,
        args: ["-e", "process.stdout.write(JSON.stringify({error:{code:'login_required',message:'session expired'}}))"],
        input: {
          platform: "x",
          query: { includeKeywords: ["demo"], excludeKeywords: [], language: "en", limitPerRun: 1 },
          config: {}
        },
        timeoutMs: 5000
      })
    ).rejects.toMatchObject({ code: "login_required", message: "session expired" });
  });

  it("maps malformed collector stdout to parse_failed", async () => {
    await expect(
      runExternalCollectorCommand({
        command: process.execPath,
        args: ["-e", "process.stdout.write('not json')"],
        input: {
          platform: "youtube",
          query: { includeKeywords: ["demo"], excludeKeywords: [], language: "en", limitPerRun: 1 },
          config: {}
        },
        timeoutMs: 5000
      })
    ).rejects.toMatchObject({ code: "parse_failed" });
  });
});

describe("createExternalCollectorError", () => {
  it("keeps stable low-level error codes for task status mapping", () => {
    const error = createExternalCollectorError("rate_limited", "slow down");

    expect(error.code).toBe("rate_limited");
    expect(error.message).toBe("slow down");
  });
});
