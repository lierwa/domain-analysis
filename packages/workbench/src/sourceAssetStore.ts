import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import cacache from "cacache";

export interface SourceAssetStore {
  put(input: { key: string; contentHash: string; content: Uint8Array }): Promise<string>;
  open(integrity: string): Readable;
}

export function createCacacheSourceAssetStore(cachePath: string): SourceAssetStore {
  return {
    async put(input) {
      const actual = createHash("sha256").update(input.content).digest("hex");
      if (actual !== input.contentHash) throw new Error(`附件内容 hash 不匹配：${input.key}`);
      const integrity = `sha256-${Buffer.from(actual, "hex").toString("base64")}`;
      const stored = await cacache.put(cachePath, input.key, input.content, {
        integrity,
        size: input.content.byteLength,
      });
      return stored.toString();
    },
    open(integrity) {
      return Readable.from(cacache.get.stream.byDigest(cachePath, integrity));
    },
  };
}
