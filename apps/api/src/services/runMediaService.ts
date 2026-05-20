import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { createRawContentRepository } from "@domain-analysis/db";
import { Jimp } from "jimp";
import type { BusinessLogger } from "./businessLogger";

const MAX_MEDIA_PER_CONTENT = 3;
const THUMBNAIL_SIZE = 320;
const MEDIA_STORAGE_ROOT = resolve(process.cwd(), "data", "media");

interface MediaAsset {
  originalUrl: string;
  thumbnailUrl: string;
  thumbnailPath: string;
  width: number;
  height: number;
  format: "jpeg";
}

export async function queueRunMediaDownloads(input: {
  runId: string;
  contentRepo: ReturnType<typeof createRawContentRepository>;
  logger?: BusinessLogger;
}) {
  // WHY: 媒体下载是长尾耗时任务，必须与主采集解耦，避免 run 状态长期卡在 collecting。
  // TRADE-OFF: UI 会短暂出现“正文已就绪、缩略图处理中”的最终一致性窗口。
  const contents = await input.contentRepo.listByRun(input.runId);

  for (const content of contents) {
    const mediaUrls = pickImageUrls(content).slice(0, MAX_MEDIA_PER_CONTENT);
    if (mediaUrls.length === 0) {
      await input.contentRepo.updateMediaDownloadState(content.id, { status: "skipped" });
      continue;
    }

    await input.contentRepo.updateMediaDownloadState(content.id, { status: "processing" });

    const assets: MediaAsset[] = [];
    for (const [index, url] of mediaUrls.entries()) {
      try {
        const asset = await downloadAndCreateThumbnail({
          runId: input.runId,
          rawContentId: content.id,
          index,
          url
        });
        assets.push(asset);
      } catch (error) {
        input.logger?.info(
          {
            runId: input.runId,
            rawContentId: content.id,
            url,
            error: error instanceof Error ? error.message : "unknown_media_error"
          },
          "analysis.media.download_failed"
        );
      }
    }

    if (assets.length > 0) {
      await input.contentRepo.updateMediaDownloadState(content.id, {
        status: "ready",
        assets
      });
    } else {
      await input.contentRepo.updateMediaDownloadState(content.id, {
        status: "failed",
        errorMessage: "No image thumbnail could be generated."
      });
    }
  }
}

async function downloadAndCreateThumbnail(input: {
  runId: string;
  rawContentId: string;
  index: number;
  url: string;
}) {
  const response = await fetch(input.url, {
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`download_failed_${response.status}`);

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) throw new Error("unsupported_media_type");

  const buffer = Buffer.from(await response.arrayBuffer());
  const image = await Jimp.read(buffer);
  // WHY: 用户要求“非原图存储 + 可预览”，统一中心裁剪为方图可保证列表密度和观感一致。
  // TRADE-OFF: 边缘信息会被裁掉，但换来稳定的缩略图布局和更小文件体积。
  image.cover({ w: THUMBNAIL_SIZE, h: THUMBNAIL_SIZE });
  const thumbnailBuffer = await image.getBuffer("image/jpeg", { quality: 78 });

  const directory = join(MEDIA_STORAGE_ROOT, input.runId, input.rawContentId);
  await mkdir(directory, { recursive: true });
  const filename = `${input.index + 1}.jpg`;
  const thumbnailPath = join(directory, filename);
  await writeFile(thumbnailPath, thumbnailBuffer);

  return {
    originalUrl: input.url,
    thumbnailUrl: buildThumbnailUrl(input.runId, input.rawContentId, filename),
    thumbnailPath,
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    format: "jpeg" as const
  };
}

function pickImageUrls(content: {
  mediaUrls?: string[] | null;
  rawJson?: Record<string, unknown> | null;
}) {
  const urls = new Set<string>();
  for (const url of content.mediaUrls ?? []) {
    if (isLikelyImageUrl(url)) urls.add(url);
  }
  const detail = readDetail(content.rawJson);
  for (const url of detail.mediaUrls) {
    if (isLikelyImageUrl(url)) urls.add(url);
  }
  return Array.from(urls);
}

function readDetail(rawJson: Record<string, unknown> | null | undefined) {
  const detail = rawJson && typeof rawJson.detail === "object" && rawJson.detail
    ? rawJson.detail as Record<string, unknown>
    : {};
  const mediaUrls = Array.isArray(detail.mediaUrls)
    ? detail.mediaUrls.filter((item): item is string => typeof item === "string")
    : [];
  return { mediaUrls };
}

function isLikelyImageUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const extension = extname(parsed.pathname).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(extension);
  } catch {
    return false;
  }
}

function buildThumbnailUrl(runId: string, rawContentId: string, filename: string) {
  const safeRunId = encodeURIComponent(runId);
  const safeRawId = encodeURIComponent(rawContentId);
  const safeFile = encodeURIComponent(filename);
  return `/api/media/${safeRunId}/${safeRawId}/${safeFile}`;
}

export function resolveThumbnailAbsolutePath(runId: string, rawContentId: string, filename: string) {
  const targetPath = resolve(MEDIA_STORAGE_ROOT, runId, rawContentId, filename);
  const allowedRoot = `${MEDIA_STORAGE_ROOT}${process.platform === "win32" ? "\\" : "/"}`;
  if (!targetPath.startsWith(allowedRoot)) return null;
  return targetPath;
}
