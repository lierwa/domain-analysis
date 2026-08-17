import { createHash } from "node:crypto";

import canonicalize from "canonicalize";

export function contentHash(value: unknown) {
  // WHY：RFC 8785 规范化后再哈希，字段顺序不同但语义相同的内容得到同一身份。
  const serialized = canonicalize(value);
  if (serialized === undefined) throw new Error("RFC 8785 不能序列化该内容");
  return createHash("sha256").update(serialized).digest("hex");
}
