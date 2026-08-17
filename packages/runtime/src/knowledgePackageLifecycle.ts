import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  activeKnowledgePackagePointerSchema,
  knowledgePackageDescriptorSchema,
  knowledgePackageSchemaVersion,
  type ActiveKnowledgePackagePointer,
  type KnowledgePackageDescriptor,
} from "@domain-analysis/shared";

import { openKnowledgeRuntime } from "./knowledgeRuntime";

export async function activateKnowledgePackage(
  outputRoot: string,
  rawDescriptor: KnowledgePackageDescriptor,
  now: () => Date = () => new Date(),
) {
  const descriptor = knowledgePackageDescriptorSchema.parse(rawDescriptor);
  const root = path.resolve(outputRoot);
  const expectedPath = path.join(root, "versions", `${descriptor.versionHash}.sqlite`);
  if (path.resolve(descriptor.filePath) !== expectedPath) {
    throw new Error("只能激活当前知识包目录中的内容寻址版本");
  }
  const runtime = await openKnowledgeRuntime(descriptor.filePath, descriptor.databaseSha256);
  try {
    if (runtime.manifest.versionHash !== descriptor.versionHash
      || runtime.manifest.projectId !== descriptor.projectId) {
      throw new Error("知识包 descriptor 与内部 manifest 不一致");
    }
  } finally {
    runtime.close();
  }
  await mkdir(root, { recursive: true });
  const pointer = activeKnowledgePackagePointerSchema.parse({
    schemaVersion: knowledgePackageSchemaVersion,
    projectId: descriptor.projectId,
    packageId: descriptor.packageId,
    versionHash: descriptor.versionHash,
    databaseSha256: descriptor.databaseSha256,
    relativeFilePath: path.relative(root, descriptor.filePath),
    activatedAt: now().toISOString(),
  });
  const current = await readPointer(path.join(root, "active.json"));
  if (current) await atomicWrite(path.join(root, "previous.json"), current);
  await atomicWrite(path.join(root, "active.json"), pointer);
  return { current: pointer, previous: current };
}

export async function rollbackKnowledgePackage(outputRoot: string) {
  const root = path.resolve(outputRoot);
  const previousPath = path.join(root, "previous.json");
  const previous = await readPointer(previousPath);
  if (!previous) throw new Error("没有可回滚知识包");
  const filePath = safePointerPath(root, previous);
  const runtime = await openKnowledgeRuntime(filePath, previous.databaseSha256);
  runtime.close();
  const current = await readPointer(path.join(root, "active.json"));
  if (current) await atomicWrite(previousPath, current);
  await atomicWrite(path.join(root, "active.json"), previous);
  return previous;
}

export async function openActiveKnowledgeRuntime(outputRoot: string) {
  const root = path.resolve(outputRoot);
  const pointer = await readPointer(path.join(root, "active.json"));
  if (!pointer) throw new Error("尚未激活知识包");
  return openKnowledgeRuntime(safePointerPath(root, pointer), pointer.databaseSha256);
}

export async function readActiveKnowledgePackage(outputRoot: string) {
  return readPointer(path.join(path.resolve(outputRoot), "active.json"));
}

function safePointerPath(root: string, pointer: ActiveKnowledgePackagePointer) {
  const filePath = path.resolve(root, pointer.relativeFilePath);
  const versionsRoot = `${path.join(root, "versions")}${path.sep}`;
  if (!filePath.startsWith(versionsRoot)) throw new Error("知识包指针越出版本目录");
  return filePath;
}

async function readPointer(filePath: string) {
  try {
    return activeKnowledgePackagePointerSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(filePath: string, value: ActiveKnowledgePackagePointer) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(temporaryPath, body, { flag: "wx" });
  await rename(temporaryPath, filePath);
  const saved = await readFile(filePath);
  if (sha256(saved) !== sha256(new TextEncoder().encode(body))) {
    throw new Error("知识包指针写入后校验失败");
  }
}

function sha256(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
