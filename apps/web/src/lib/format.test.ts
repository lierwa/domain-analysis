import { describe, expect, it } from "vitest";
import { formatDateTime } from "./format";

describe("format helpers", () => {
  it("formats ISO and SQLite timestamps with date, time, and timezone context", () => {
    const formattedIso = formatDateTime("2026-05-06T00:00:00.000Z");
    const formattedSqlite = formatDateTime("2026-05-06 00:00:00");

    expect(formattedIso).toContain("2026");
    expect(formattedSqlite).toContain("2026");
    expect(formattedSqlite).not.toBe("2026-05-06 00:00:00");
  });

  it("uses clear empty-state text for missing timestamps", () => {
    expect(formatDateTime()).toBe("Not yet");
  });
});
