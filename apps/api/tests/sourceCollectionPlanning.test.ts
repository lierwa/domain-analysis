import { describe, expect, it } from "vitest";

import { createProductionSourceCollectionPlanningRules } from "../src/sourceCollectionPlanning";

describe("production source collection planning rules", () => {
  it("只注册 allowlist 中经过逐资料许可核对的技术来源", () => {
    const rules = createProductionSourceCollectionPlanningRules([
      "https://www.nist.gov",
      "https://www.fsis.usda.gov",
    ]);
    const executable = rules.filter((rule) => rule.usagePermission.localRead === "allowed");
    expect(executable).toHaveLength(3);
    expect(executable.every((rule) => rule.urlMatch.kind === "exact_url")).toBe(true);
    expect(executable.every((rule) => rule.usagePermission.evidenceStorage === "allowed")).toBe(true);
    expect(executable.every((rule) => rule.providerKey === "readable-technical-source")).toBe(true);
    expect(rules).toContainEqual(expect.objectContaining({
      providerKey: "document-excerpt-source",
      usagePermission: expect.objectContaining({ localRead: "denied" }),
    }));
  });

  it("当前不注册京东规则，许可不能被频控或 reader 替代", () => {
    const rules = createProductionSourceCollectionPlanningRules([
      "https://www.jd.com",
      "https://item.jd.com",
    ]);
    expect(rules.filter((rule) => rule.providerKey.startsWith("jd"))).toEqual([]);
    expect(rules.filter((rule) => rule.usagePermission.localRead === "allowed")).toEqual([]);
  });

  it("监管来源只在 allowlist 中注册，并要求通用结构化记录查询", () => {
    const rules = createProductionSourceCollectionPlanningRules([
      "https://www.energylabel.com.cn",
    ]);
    expect(rules).toContainEqual(expect.objectContaining({
      providerKey: "energy-label-record",
      requestKinds: ["structured_record_lookup"],
      objectKind: "regulatory_record",
      usagePermission: expect.objectContaining({ localRead: "allowed", evidenceStorage: "allowed" }),
    }));
  });

  it("ENERGY STAR 开放数据只注册通用 Socrata 单记录查询", () => {
    const rules = createProductionSourceCollectionPlanningRules([
      "https://data.energystar.gov",
    ]);
    expect(rules).toContainEqual(expect.objectContaining({
      providerKey: "socrata-open-data",
      sourceIdentity: "epa-energy-star-model-index",
      requestKinds: ["structured_record_lookup"],
      objectKind: "regulatory_record",
      usagePermission: expect.objectContaining({
        localRead: "allowed",
        modelInput: "allowed",
        evidenceStorage: "allowed",
        derivedKnowledgePublication: "allowed",
        sourceRedistribution: "allowed",
      }),
    }));
    expect(rules.filter((rule) => rule.usagePermission.localRead === "allowed"))
      .toHaveLength(1);
  });
});
