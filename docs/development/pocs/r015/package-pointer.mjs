import { readFile } from "node:fs/promises";

import writeFileAtomic from "write-file-atomic";

import { sha256 } from "../lib/poc-artifact.mjs";

export async function switchPackage(pointerPath, previousPath, descriptor) {
  // WHY：先验哈希、再原子替换小指针文件；大知识包无需原地覆盖，失败时仍可读取旧版本。
  await assertDescriptor(descriptor);
  const current = await readJson(pointerPath);
  if (current) await writeJson(previousPath, current);
  await writeJson(pointerPath, descriptor);
  return { previous: current, current: descriptor };
}

export async function rollbackPackage(pointerPath, previousPath) {
  const previous = await readJson(previousPath);
  if (!previous) throw new Error("没有可回滚知识包");
  await assertDescriptor(previous);
  await writeJson(pointerPath, previous);
  return previous;
}

async function assertDescriptor(descriptor) {
  const actual = sha256(await readFile(descriptor.filePath));
  if (actual !== descriptor.sha256) throw new Error(`知识包哈希不匹配：${descriptor.version}`);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, { fsync: true });
}
