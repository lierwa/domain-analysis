import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("frontend polling policy", () => {
  it("polls workspace lists only while collecting runs need live state", () => {
    const source = readSource("WorkspacePage.tsx");

    expect(source).toContain("hasActiveRuns");
    expect(source).toContain("hasActiveRuns(query.state.data");
  });

  it("polls batch detail and platform task rows only while collecting", () => {
    const source = readSource("BatchDetail.tsx");

    expect(source).toContain("item?.status === \"collecting\" ? 3000 : false");
    expect(source).toContain("run.status === \"collecting\" ? 3000 : false");
  });

  it("polls run crawl tasks only while the selected run is collecting", () => {
    const source = readSource("RunDetail.tsx");

    expect(source).toContain("isCollecting");
    expect(source).toContain("refetchInterval: isCollecting ? 3000 : false");
  });

  it("does not poll login status while the login flow is idle", () => {
    const source = readSource("SettingsPage.tsx");

    expect(source).not.toContain("refetchInterval: 5000");
  });

  it("disables implicit refetch on window focus globally", () => {
    const source = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");

    expect(source).toContain("refetchOnWindowFocus: false");
  });
});

function readSource(fileName: string) {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}
