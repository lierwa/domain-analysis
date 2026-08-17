import { describe, expect, it } from "vitest";

import {
  commitSourceSnapshotSchema,
  sourceAccessPolicySchema,
  sourceAuthorityTypes,
} from "../src/index";

describe("Source Dataset contracts", () => {
  it("用同一 typed contract 表达记录、文档、目录和去个人化体验样本", () => {
    const contents = [
      {
        kind: "ordered_record",
        title: "型号详情",
        fieldGroups: [{ label: "规格", fields: [{ name: "接口", value: "HDMI 2.1" }] }],
        blocks: [],
      },
      {
        kind: "document",
        title: "制冷循环技术资料",
        publisher: "技术机构",
        documentIdentifier: "TR-2026-1",
        version: "1",
        publicationStatus: "current",
        sections: [{
          heading: "循环原理",
          blocks: [{ kind: "text", role: "description", text: "压缩、冷凝、节流和蒸发。" }],
        }],
      },
      {
        kind: "catalog",
        title: "当前产品目录",
        taxonomyPath: ["家电", "电视"],
        facets: [{
          name: "屏幕尺寸",
          options: [{ label: "65 英寸", value: "65", count: 12 }],
        }],
        entries: [{
          position: 1,
          label: "65T7G",
          target: {
            sourceIdentity: "fixture-brand-site",
            objectKind: "product",
            externalKey: "65T7G",
          },
          sourceUrl: "https://example.com/televisions/65t7g",
        }],
      },
      {
        kind: "experience_collection",
        title: "公开体验样本",
        summaryMetrics: [{ name: "样本量", value: "2", unit: "条" }],
        samplingPlan: {
          method: "按来源排序逐页抽样",
          sampleSize: 2,
          ordering: "time_desc",
          pageRange: "1",
        },
        ratingBands: [{ label: "5", count: 1 }, { label: "3", count: 1 }],
        samples: [
          { externalKey: "review-1", position: 1, text: "画面清晰", rating: 5 },
          { externalKey: "review-2", position: 2, text: "接口够用", rating: 3 },
        ],
      },
    ] as const;

    for (const [index, content] of contents.entries()) {
      expect(commitSourceSnapshotSchema.parse(accessibleCommit(content, index)).content)
        .toEqual(content);
    }
  });

  it("失败观察必须保存同名失败码且不能伪造来源内容", () => {
    const failed = commitSourceSnapshotSchema.parse({
      ...baseCommit(9),
      observation: {
        requestedUrl: "https://example.com/limited",
        observedAt: "2026-08-17T08:00:00.000Z",
        state: "rate_limited",
        failureCode: "rate_limited",
        httpValidation: { status: 429 },
      },
    });
    expect(failed).not.toHaveProperty("content");

    expect(() => commitSourceSnapshotSchema.parse({
      ...failed,
      observation: { ...failed.observation, failureCode: "access_denied" },
    })).toThrow("失败状态必须记录同名失败码");
  });

  it("商品底层知识所需的权威来源不是品类专用枚举", () => {
    expect(sourceAuthorityTypes).toEqual(expect.arrayContaining([
      "standards_body",
      "government_research",
      "intergovernmental_technical",
      "primary_research",
      "professional_association",
      "component_official_technical",
    ]));
  });

  it("频控政策拒绝 Infinity 和只靠单并发的空壳配置", () => {
    expect(sourceAccessPolicySchema.safeParse({
      kind: "paced_http",
      version: "unsafe",
      maxRequestsPerMinute: Number.POSITIVE_INFINITY,
      minimumIntervalMs: 250,
      jitterMs: { min: 0, max: 0 },
      batchSize: 20,
      batchCooldownMs: 1,
      maximumRunMs: 60_000,
    }).success).toBe(false);
  });
});

function accessibleCommit(content: object, index: number) {
  return {
    ...baseCommit(index),
    observation: {
      requestedUrl: `https://example.com/source/${index}`,
      finalUrl: `https://example.com/source/${index}`,
      observedAt: "2026-08-17T08:00:00.000Z",
      state: "accessible",
    },
    content,
  };
}

function baseCommit(index: number) {
  return {
    runId: "run-1",
    idempotencyKey: `snapshot-${index}`,
    object: {
      sourceIdentity: "fixture-brand-site",
      kind: "document",
      externalKey: `source-${index}`,
    },
    targetKeys: ["category:fixture"],
    knowledgeNeedIds: ["need:fixture"],
    parsing: { adapterId: "fixture-adapter", adapterVersion: "1.0.0" },
    claimScopes: ["foundational_principle"],
    usagePermission: {
      localRead: "allowed",
      modelInput: "allowed",
      evidenceStorage: "allowed",
      derivedKnowledgePublication: "allowed",
      sourceRedistribution: "allowed",
      basis: "项目自有测试夹具",
    },
    relations: [],
  };
}
