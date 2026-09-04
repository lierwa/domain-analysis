import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { knowledgeCapabilitiesSchema, knowledgeDerivativeSchema, knowledgeExtractionSchema,
  type KnowledgeCandidate, type KnowledgeDerivative, type KnowledgeExtraction, type KnowledgeInput,
  type KnowledgeSettings } from "@domain-analysis/shared";
import cacache from "cacache";
import { load } from "cheerio";
import { execa } from "execa";
import { z } from "zod";
import { digest, KnowledgeProcessingError, sha256, storeBytes } from "./storage";

export type KnowledgeProcessor = ReturnType<typeof createKnowledgeProcessor>;
export type KnowledgeProcessorOptions = { cachePath: string; artifactPath: string; workPath: string; pythonPath?: string; modelRoot?: string };
const script = fileURLToPath(new URL("../../resources/knowledge_image.py", import.meta.url));
const imageResultSchema = z.object({ dimensions: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  lines: z.array(z.object({ text: z.string(), confidence: z.number().min(0).max(1),
    box: z.array(z.tuple([z.number(), z.number()])) }).strict()).max(1_999) }).strict();
const capabilityResultSchema = knowledgeCapabilitiesSchema.extend({ models: z.array(z.object({
  filename: z.string(), sha256: z.string() }).passthrough()), versions: z.record(z.string(), z.string()) });

export function createKnowledgeProcessor(options: KnowledgeProcessorOptions) {
  const capabilities = probeCapabilities(options);
  const version = async () => `knowledge-extraction-1/cheerio-1.1.2/${(await capabilities).identity}`;
  return {
    version,
    async capabilities() { return knowledgeCapabilitiesSchema.parse((await capabilities).public); },
    async extract(input: KnowledgeInput, bytes: Uint8Array, settings: KnowledgeSettings, signal: AbortSignal): Promise<KnowledgeExtraction> {
      signal.throwIfAborted();
      const support = await capabilities;
      if (settings.ocr && input.format === "image" && !support.public.ocr) {
        throw new KnowledgeProcessingError("unavailable", "本地 OCR 模型尚未就绪");
      }
      const toolVersion = await version();
      // WHY：身份进入缓存键；相同字节来自另一份来源时必须保留自己的谱系和审核身份。
      const cacheKey = digest({ input, toolVersion, ocr: settings.ocr });
      const hit = await cacache.get(options.cachePath, cacheKey).catch(error => {
        if (error.code !== "ENOENT") throw error;
      });
      if (hit) return knowledgeExtractionSchema.parse({ ...JSON.parse(hit.data.toString()), reused: true });
      const extracted = await extractContent(options, input, bytes, settings, signal);
      const result = knowledgeExtractionSchema.parse({ toolVersion, cacheKey, reused: false, ...extracted });
      signal.throwIfAborted();
      await cacache.put(options.cachePath, cacheKey, JSON.stringify(result));
      return result;
    },
    async prepareAutomatic(input: KnowledgeInput, bytes: Uint8Array, action: "keep" | "remove_watermark",
      candidates: Array<Pick<KnowledgeCandidate, "id" | "box">>, signal: AbortSignal): Promise<KnowledgeDerivative> {
      if (!(await capabilities).public.imageProcessing) throw new KnowledgeProcessingError("unavailable", "本地图片处理环境尚未就绪");
      const boxes = candidates.map(candidate => candidate.box).filter((box): box is [number, number][] => !!box);
      if (action === "remove_watermark" && boxes.length !== candidates.length) {
        throw new KnowledgeProcessingError("invalid_input", "自动去水印缺少 OCR 坐标");
      }
      const result = await runImage(options, { action: "automatic", imageAction: action,
        sha256: input.ref.sha256, boxes }, bytes, undefined, signal);
      const metrics = z.object({ outsideMaskChangedPixels: z.literal(0), width: z.number(), height: z.number() }).strict().parse(result.value);
      const hash = await storeBytes(options.artifactPath, result.image!);
      const maskSha256 = result.mask ? await storeBytes(options.artifactPath, result.mask) : undefined;
      return knowledgeDerivativeSchema.parse({ ...metrics, sha256: hash, bytes: result.image!.byteLength,
        originalSha256: input.ref.sha256, maskSha256,
        method: action === "keep" ? "opencv-copy" : "opencv-telea", boundaryCuts: [],
        automation: { action, confidence: "high", candidateIds: candidates.map(candidate => candidate.id) } });
    },
  };
}

async function probeCapabilities(options: KnowledgeProcessorOptions) {
  try {
    const result = await runImage(options, { action: "capabilities" }, undefined, undefined, AbortSignal.timeout(30_000));
    const value = capabilityResultSchema.parse(result.value);
    const publicValue = { imageProcessing: value.imageProcessing, ocr: value.ocr, pdf: value.pdf, detail: value.detail };
    return { public: publicValue, identity: digest({ versions: value.versions, models: value.models, script: sha256(await fs.readFile(script)) }) };
  } catch {
    return { public: { imageProcessing: false, ocr: false, pdf: "review" as const,
      detail: "配置本地 Python 图片环境后可进行图片处理与 OCR；HTML 可继续加工" }, identity: "html-only" };
  }
}

async function runImage(options: KnowledgeProcessorOptions, command: Record<string, unknown>,
  bytes?: Uint8Array, mask?: Uint8Array, signal?: AbortSignal) {
  if (!options.pythonPath) throw new KnowledgeProcessingError("unavailable", "尚未配置本地图片处理环境");
  await fs.mkdir(options.workPath, { recursive: true });
  const temp = await fs.mkdtemp(path.join(options.workPath, "image-"));
  const input = path.join(temp, "input"), output = path.join(temp, "result.json");
  const maskPath = path.join(temp, "mask.png"), imageOutput = path.join(temp, "processed.png");
  try {
    if (bytes) await fs.writeFile(input, bytes);
    if (mask) await fs.writeFile(maskPath, mask);
    const job = path.join(temp, "job.json");
    await fs.writeFile(job, JSON.stringify({ ...command, input, output, mask: maskPath, imageOutput,
      modelRoot: options.modelRoot ?? "" }));
    await execa(options.pythonPath, [script, job], { cancelSignal: signal, timeout: 120_000,
      forceKillAfterDelay: 1_000, maxBuffer: 128 * 1024 });
    const value: unknown = JSON.parse(await fs.readFile(output, "utf8"));
    const hasImage = command.action === "automatic";
    const hasMask = command.action === "automatic" && command.imageAction === "remove_watermark";
    return { value, image: hasImage ? await fs.readFile(imageOutput) : undefined,
      mask: hasMask ? await fs.readFile(maskPath) : undefined };
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

async function extractContent(options: KnowledgeProcessorOptions, input: KnowledgeInput,
  bytes: Uint8Array, settings: KnowledgeSettings, signal: AbortSignal) {
  if (input.format === "image") {
    const value = imageResultSchema.parse((await runImage(options,
      { action: settings.ocr ? "ocr" : "inspect", sha256: input.ref.sha256 }, bytes, undefined, signal)).value);
    const candidates = value.lines.map((line, i) => makeCandidate(input, { ...line, kind: "text",
      label: "图片文字", locator: `OCR line ${i + 1}` }));
    candidates.unshift(makeCandidate(input, { kind: "image", label: input.label, text: "", locator: "full image" }));
    return { candidates, dimensions: value.dimensions, notes: ["图片副本、内容归属和 OCR 文字分别进入对应质量门"] };
  }
  if (input.format === "html" && input.providerKey === "zol.catalog-gallery") return extractZol(input, bytes);
  if (input.format === "text") return { candidates: Buffer.from(bytes).toString("utf8").split(/\n\s*\n/)
    .filter(value => value.trim()).slice(0, 2_000).map((text, i) => makeCandidate(input,
      { kind: "text", label: "来源原文", text, locator: `paragraph ${i + 1}` })), notes: ["原文片段需要确认领域归属"] };
  return { candidates: [], notes: [input.format === "pdf"
    ? "PDF 原件已保留；正文、表格与插图须通过布局质量门后加工" : "此来源的 HTML 内容提取规则等待验证"] };
}

function extractZol(input: KnowledgeInput, bytes: Uint8Array) {
  const $ = load(Buffer.from(bytes).toString("utf8"));
  const fields = $("[id^=newPmName_]").toArray().map(node => {
    const locator = `#${$(node).attr("id")!.replace("newPmName_", "newPmVal_")}`;
    const value = $(locator).clone();
    if (value.length !== 1) throw new KnowledgeProcessingError("invalid_input", "来源参数的标签与值未能一一对应");
    value.find("br").replaceWith("\n");
    return makeCandidate(input, { kind: "text", label: $(node).text().trim(), text: value.text().trim(), locator });
  });
  if (fields.length) fields.unshift(makeCandidate(input, { kind: "text", label: "来源型号",
    text: $("title").text().match(/【(.+?)参数】/)?.[1] ?? $("title").text(), locator: "title" }));
  const noImages = $("p.nopic").text().trim();
  if (noImages) fields.push(makeCandidate(input, { kind: "text", label: "来源图片状态", text: noImages, locator: "p.nopic" }));
  return { candidates: fields, notes: [fields.length ? "已按来源结构保留标签、单位与缺失表达" : "此页仅作为来源谱系保留"] };
}

export function makeCandidate(input: KnowledgeInput, fields: Omit<KnowledgeCandidate, "id" | "contentHash">): KnowledgeCandidate {
  return { ...fields, id: digest({ source: input.key, locator: fields.locator }),
    contentHash: fields.kind === "image" ? input.ref.sha256 : digest(fields) };
}
