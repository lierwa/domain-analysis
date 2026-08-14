import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function writeImmutableJson(filePath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, serialized, { flag: "wx" });
  return { bytes: Buffer.byteLength(serialized), sha256: sha256(serialized) };
}
