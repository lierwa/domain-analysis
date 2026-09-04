import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { knowledgeInputSchema, type KnowledgeCandidate } from "@domain-analysis/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createKnowledgeProcessor } from "../../src/knowledge/processor";
import { digest, loadBytes, sha256 } from "../../src/knowledge/storage";

const suite = process.env.KNOWLEDGE_PYTHON_PATH ? describe : describe.skip;

suite("图片自动加工", () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

  it("按 OCR 坐标生成遮罩并只导出可校验的 PNG 副本", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-image-"));
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAjklEQVR4nO3aIQ7AMBTDUH9r979yxwZLBjpLezggUmhmrUWZxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxEmcxF180szsA8/VL7+AxEmcxEmcxM1/PT5M4iTO0wXeugG6Mwl7bXQjiQAAAABJRU5ErkJggg==", "base64");
    const input = knowledgeInputSchema.parse({ ref: { taskId: "task", runId: "source-run", snapshotId: "snapshot",
      assetId: "asset", sha256: sha256(bytes) }, key: digest("input"), providerKey: "fixture", subjectKey: "model",
      subjectName: "测试型号", label: "商品图片", url: "https://example.com/image.png", format: "image",
      mediaType: "image/png", bytes: bytes.length, capturedAt: "2026-09-04T00:00:00.000Z", availability: "ready" });
    const watermark: Pick<KnowledgeCandidate, "id" | "box"> = { id: digest("watermark"),
      box: [[50, 52], [60, 52], [60, 58], [50, 58]] };
    const processor = createKnowledgeProcessor({ cachePath: path.join(root, "cache"), artifactPath: path.join(root, "artifacts"),
      workPath: path.join(root, "work"), pythonPath: process.env.KNOWLEDGE_PYTHON_PATH,
      modelRoot: process.env.KNOWLEDGE_MODEL_ROOT });

    const derivative = await processor.prepareAutomatic(input, bytes, "remove_watermark", [watermark], AbortSignal.timeout(30_000));

    expect(derivative).toMatchObject({ method: "opencv-telea", width: 64, height: 64, outsideMaskChangedPixels: 0,
      automation: { action: "remove_watermark", confidence: "high", candidateIds: [watermark.id] } });
    expect(derivative.maskSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256(await loadBytes(path.join(root, "artifacts"), derivative.sha256))).toBe(derivative.sha256);
    expect(derivative.sha256).not.toBe(input.ref.sha256);
  });
});
