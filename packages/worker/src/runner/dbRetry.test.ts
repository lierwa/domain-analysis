import { describe, expect, it, vi } from "vitest";
import { withSqliteRetry } from "./dbRetry";

describe("withSqliteRetry", () => {
  it("retries transient SQLite lock errors", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("database is locked"))
      .mockResolvedValueOnce("ok");

    await expect(withSqliteRetry(operation, { retries: 2, delayMs: 0 })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
