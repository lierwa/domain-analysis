import { createHash } from "node:crypto";
import path from "node:path";

import cacache from "cacache";

export type ContentPrivacyClass = "public" | "restricted";

export interface ContentAddressedStore {
  put(input: {
    privacyClass: ContentPrivacyClass;
    content: Uint8Array;
    metadata?: Record<string, string>;
  }): Promise<{ integrity: string; bytes: number }>;
  get(privacyClass: ContentPrivacyClass, integrity: string): Promise<Uint8Array>;
}

export function createCacacheContentStore(rootDirectory: string): ContentAddressedStore {
  return {
    async put({ privacyClass, content, metadata }) {
      const integrity = sha256Integrity(content);
      const cache = path.join(rootDirectory, privacyClass);
      const existing = await cacache.get.hasContent(cache, integrity);
      if (!existing) {
        // WHY：cacache 负责原子写、并发、去重和读写校验；预期 integrity 让损坏内容失败关闭。
        await cacache.put(cache, `content:${integrity}`, content, {
          algorithms: ["sha256"],
          integrity,
          metadata,
          size: content.byteLength,
        });
      }
      return { integrity, bytes: content.byteLength };
    },
    async get(privacyClass, integrity) {
      return cacache.get.byDigest(path.join(rootDirectory, privacyClass), integrity);
    },
  };
}

function sha256Integrity(content: Uint8Array) {
  const digest = createHash("sha256").update(content).digest("base64");
  return `sha256-${digest}`;
}
