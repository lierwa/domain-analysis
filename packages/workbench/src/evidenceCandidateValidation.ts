import { createHash } from "node:crypto";

import type {
  EvidenceCandidate,
  EvidenceRequest,
  SourceObservation,
} from "@domain-analysis/shared";
import sharp from "sharp";

import { EvidenceError } from "./evidenceError";

export async function validateEvidenceCandidate(
  candidate: EvidenceCandidate,
  content: Uint8Array,
  request: EvidenceRequest,
  observation: SourceObservation,
  currentTime: Date,
) {
  if (observation.requestId !== request.id) reject("来源观察不属于该证据请求");
  if (observation.state !== "accessible") {
    throw new EvidenceError("observation_not_accessible", "只有可访问观察才能提交证据");
  }
  if (!request.acceptedEvidenceKinds.includes(candidate.kind)) reject("证据类型未获请求允许");
  if (content.byteLength > request.evidenceByteLimits[candidate.kind]!) {
    reject("证据内容超过请求允许的最大字节数");
  }
  if (candidate.subjectKeys.some((key) => !request.targetKeys.includes(key))) {
    reject("证据对象不属于请求目标");
  }
  if (candidate.subjectKeys.some((key) => !observation.subjectKeys.includes(key))) {
    reject("证据对象没有出现在该来源观察的目标范围内");
  }
  validateFreshness(request, observation, currentTime);
  await validateMediaAndLocator(candidate, content, request);
}

function validateFreshness(
  request: EvidenceRequest,
  observation: SourceObservation,
  currentTime: Date,
) {
  const observedAt = new Date(observation.observedAt);
  if (request.freshness.observedAfter
      && observedAt < new Date(request.freshness.observedAfter)) {
    reject("来源观察早于请求允许的时间");
  }
  if (request.freshness.maxAgeDays) {
    const age = currentTime.getTime() - observedAt.getTime();
    if (age > request.freshness.maxAgeDays * 86_400_000) reject("来源观察已经过期");
  }
}

async function validateMediaAndLocator(
  candidate: EvidenceCandidate,
  content: Uint8Array,
  request: EvidenceRequest,
) {
  if (candidate.locator.kind === "image_region") {
    if (!candidate.mediaType.startsWith("image/")) reject("图片证据必须使用图片媒体类型");
    const allowed = new Set(["structured_data", "caption", "link_target", "human_confirmed"]);
    if (!allowed.has(candidate.relationProof.method)) reject("图片缺少可接受的对象关系依据");
    validateImageRegion(candidate.locator);
    if (request.imagePolicy?.mode === "crop_required" && isFullImage(candidate.locator)) {
      reject("该请求只允许保存必要图片区域，不能保存整图");
    }
    if (!isFullImage(candidate.locator)) {
      // TRADE-OFF：裁片还无法从永久最小内容独立复核原图 hash，继续失败关闭。
      reject("图片裁片尚未通过原图哈希与裁片一致性验证");
    }
    await validateFullImageBytes(candidate.locator, candidate.mediaType, content);
    return;
  }
  if (candidate.locator.kind === "table_region") {
    if (!["text/csv", "application/json"].includes(candidate.mediaType)) {
      reject("表格最小证据必须是 CSV 或 JSON 区域，不得保存完整工作簿");
    }
    if (candidate.relationProof.method !== "table_row_identity"
        && candidate.relationProof.method !== "human_confirmed") {
      reject("表格证据必须通过唯一行或人工确认绑定对象");
    }
    return;
  }
  if (!candidate.mediaType.startsWith("text/plain")) {
    reject("文本和文档摘录必须保存为纯文本，不得保存整页或完整文件");
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    reject("文本或文档摘录必须是 UTF-8 最小文本");
  }
  const quote = candidate.locator.quote;
  const expected = `${quote.prefix ?? ""}${quote.exact}${quote.suffix ?? ""}`;
  if (decoded! !== expected) reject("保存内容必须恰好等于 locator 的前文、原文和后文，不能夹带整页内容");
}

async function validateFullImageBytes(
  locator: Extract<EvidenceCandidate["locator"], { kind: "image_region" }>,
  mediaType: string,
  content: Uint8Array,
) {
  const sourceHash = createHash("sha256").update(content).digest("hex");
  if (sourceHash !== locator.sourceImageSha256) reject("图片字节与来源哈希不一致");
  let metadata;
  try {
    metadata = await sharp(content).metadata();
  } catch {
    reject("图片字节无法由 sharp 解码");
  }
  const mediaTypes: Record<string, string> = {
    avif: "image/avif",
    gif: "image/gif",
    jpeg: "image/jpeg",
    png: "image/png",
    tiff: "image/tiff",
    webp: "image/webp",
  };
  if (!metadata!.format || mediaTypes[metadata!.format] !== mediaType) {
    reject("图片媒体类型与真实格式不一致");
  }
  if (metadata!.width !== locator.sourceWidth
      || metadata!.height !== locator.sourceHeight) {
    reject("图片 locator 尺寸与真实字节不一致");
  }
  if ((metadata!.pages ?? 1) !== 1) reject("当前整图证据只接受单帧图片");
}

function isFullImage(locator: Extract<EvidenceCandidate["locator"], { kind: "image_region" }>) {
  const { xywh } = locator;
  const width = xywh.unit === "percent" ? 100 : locator.sourceWidth;
  const height = xywh.unit === "percent" ? 100 : locator.sourceHeight;
  return xywh.x === 0 && xywh.y === 0 && xywh.width === width && xywh.height === height;
}

function validateImageRegion(locator: Extract<EvidenceCandidate["locator"], { kind: "image_region" }>) {
  const { xywh } = locator;
  const maxWidth = xywh.unit === "percent" ? 100 : locator.sourceWidth;
  const maxHeight = xywh.unit === "percent" ? 100 : locator.sourceHeight;
  if (xywh.x + xywh.width > maxWidth || xywh.y + xywh.height > maxHeight) {
    reject("图片证据区域超出原图边界");
  }
}

function reject(message: string): never {
  throw new EvidenceError("candidate_rejected", message);
}
