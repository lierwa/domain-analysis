import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCacacheSourceAssetStore } from "../src/sourceAssetStore";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("来源附件内容寻址存储", () => {
  it("按摘要保存并读回相同字节，拒绝错误哈希", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "domain-analysis-source-assets-"));
    directories.push(directory);
    const store = createCacacheSourceAssetStore(directory);
    const content = new TextEncoder().encode("standard-pdf-bytes");
    const contentHash = createHash("sha256").update(content).digest("hex");

    const integrity = await store.put({ key: "standard.pdf", contentHash, content });
    const chunks: Buffer[] = [];
    for await (const chunk of store.open(integrity)) chunks.push(Buffer.from(chunk));

    expect(Buffer.concat(chunks)).toEqual(Buffer.from(content));
    await expect(store.put({ key: "wrong.pdf", contentHash: "0".repeat(64), content }))
      .rejects.toThrow("附件内容 hash 不匹配");
  });
});
