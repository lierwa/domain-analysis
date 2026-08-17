import type { SourceCollectionRun, SourceCollectionWorkItem } from "@domain-analysis/shared";
import { describe, expect, it, vi } from "vitest";

import {
  createReadableTechnicalSourceCollectionProvider,
  extractReadableDocument,
} from "../src/readableTechnicalSourceCollectionProvider";

const observedAt = "2026-08-17T08:00:00.000Z";

describe("Readable technical source collection provider", () => {
  it("用 Readability 提取正文并排除导航和脚本", () => {
    const document = extractReadableDocument(articleHtml(), "https://example.com/technical-note");
    expect(document).toMatchObject({ title: "制冷循环技术说明", publisher: "示例研究机构" });
    expect(document.text).toContain("压缩机提高制冷剂蒸气的压力");
    expect(document.text).toContain("适用边界包括环境温度与换热器工况");
    expect(document.text).not.toContain("首页 导航 登录");
    expect(document.text).not.toContain("不应执行的脚本文字");
  });

  it("把正文保存为 document 快照内容并保留知识目的", async () => {
    const reader = vi.fn(async () => ({
      state: "accessible" as const,
      requestedUrl: "https://example.com/technical-note",
      finalUrl: "https://example.com/technical-note",
      observedAt,
      httpValidation: { status: 200, etag: "fixture-v1" },
      html: articleHtml(),
    }));
    const provider = createReadableTechnicalSourceCollectionProvider({
      allowedOrigins: ["https://example.com"],
      pageReader: reader,
    });
    const result = await provider.collect({ sourceRun: run(), item: item() });

    expect(result).toMatchObject({
      observation: { state: "accessible", httpValidation: { status: 200 } },
      content: {
        kind: "document",
        title: "制冷循环技术说明",
        publicationStatus: "unknown",
        sections: [{ blocks: [{ text: expect.stringContaining("蒸发器吸收热量") }] }],
      },
      stopRun: false,
    });
    expect(item()).toMatchObject({
      targetKeys: ["category:refrigerator"],
      knowledgeNeedIds: ["need:vapor-compression-cycle"],
    });
  });

  it("证据保存许可未确认时不访问来源并失败关闭", async () => {
    const reader = vi.fn();
    const provider = createReadableTechnicalSourceCollectionProvider({
      allowedOrigins: ["https://example.com"],
      pageReader: reader,
    });
    const blocked = item();
    blocked.usagePermission.evidenceStorage = "unknown";

    const result = await provider.collect({ sourceRun: run(), item: blocked });
    expect(result).toMatchObject({
      observation: { state: "source_abnormal", failureCode: "source_abnormal" },
      stopRun: true,
    });
    expect(reader).not.toHaveBeenCalled();
  });
});

function articleHtml() {
  return `<!doctype html><html><head>
    <title>制冷循环技术说明</title>
    <meta property="og:site_name" content="示例研究机构">
  </head><body>
    <nav>首页 导航 登录</nav>
    <main><article>
      <h1>制冷循环技术说明</h1>
      <p>压缩机提高制冷剂蒸气的压力，冷凝器向环境释放热量，节流装置降低压力，蒸发器吸收热量。</p>
      <p>这个过程把低温空间的热量搬运到环境中。适用边界包括环境温度与换热器工况，不能只根据营销名称判断效率。</p>
      <p>循环性能还受制冷剂性质、压缩效率、换热温差、流动阻力和控制策略影响，需要在明确测试条件下比较。</p>
    </article></main>
    <script>window.payload = "不应执行的脚本文字";</script>
  </body></html>`;
}

function item(): SourceCollectionWorkItem {
  return {
    id: "item-vapor-compression-cycle",
    object: { sourceIdentity: "fixture-research", kind: "document", externalKey: "technical-note" },
    requestedUrl: "https://example.com/technical-note",
    targetKeys: ["category:refrigerator"],
    knowledgeNeedIds: ["need:vapor-compression-cycle"],
    parsing: { adapterId: "readability", adapterVersion: "0.6.0" },
    claimScopes: ["foundational_principle"],
    usagePermission: {
      localRead: "allowed", modelInput: "allowed", evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed", sourceRedistribution: "denied", basis: "项目自有测试夹具",
    },
  };
}

function run(): SourceCollectionRun {
  return {
    id: "run-foundational", projectId: "project-refrigerator",
    categoryDefinitionVersionId: "definition-refrigerator",
    confirmedScopeVersionId: "scope-refrigerator",
    collectionBoardVersionId: "board-refrigerator", categoryCode: "refrigerator",
    collectionLaneId: "lane-foundational", providerKey: "readable-technical-source",
    sourceAuthorityType: "government_research",
    accessPolicy: { kind: "manual", version: "fixture-v1" }, status: "running",
    snapshotCount: 0, accessibleCount: 0, failedCount: 0, assetCount: 0, startedAt: observedAt,
  };
}
