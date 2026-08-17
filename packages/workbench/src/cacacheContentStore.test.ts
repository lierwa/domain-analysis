import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createCacacheContentStore } from "./cacacheContentStore";

describe("CacacheContentStore", () => {
  it("deduplicates identical content and verifies it when read", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "domain-analysis-cas-"));
    const store = createCacacheContentStore(root);
    const content = new TextEncoder().encode("official product material");

    const first = await store.put({ privacyClass: "public", content });
    const second = await store.put({ privacyClass: "public", content });

    expect(second).toEqual(first);
    expect(new TextDecoder().decode(await store.get("public", first.integrity)))
      .toBe("official product material");
    expect(first.integrity).toMatch(/^sha256-/);
  });

  it("keeps public and restricted material in separate stores", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "domain-analysis-cas-"));
    const store = createCacacheContentStore(root);
    const content = new Uint8Array([1, 2, 3]);
    const restricted = await store.put({ privacyClass: "restricted", content });

    await expect(store.get("public", restricted.integrity)).rejects.toThrow();
    expect(Array.from(await store.get("restricted", restricted.integrity))).toEqual([1, 2, 3]);
  });
});
