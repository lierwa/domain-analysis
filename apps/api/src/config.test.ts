import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("api config", () => {
  it("defaults legacy SQLite and the shared PostgreSQL runtime store", () => {
    expect(loadConfig({})).toMatchObject({
      databaseUrl: "file:../../data/domain-analysis.sqlite",
      postgresDatabaseUrl: "postgresql://guojunxi@127.0.0.1:5432/domain_analysis",
      evidenceRoot: "data/evidence",
      knowledgePackageRoot: "data/knowledge-packages",
      interviewModelId: "gpt-5.6-terra",
      interviewReasoningEffort: "medium",
      knowledgeFactoryModelId: "gpt-5.3-codex-spark",
      knowledgeFactoryReasoningEffort: "low",
      collectionAllowedOrigins: [
        "https://www.haier.com",
        "https://www.leader.com.cn",
        "https://www.midea.cn",
        "https://www.tcl.com",
        "https://www.hisense.com",
        "https://mlmall.meiling.com",
        "https://www.konka.com",
        "https://www.siemens-home.bsh-group.cn",
        "https://www.rsdgroup.com.cn",
        "https://www.jd.com",
        "https://item.jd.com",
        "https://www.energylabel.com.cn",
        "https://www.cnis.ac.cn",
        "https://www.nist.gov",
        "https://www.fsis.usda.gov",
        "https://www.energy.gov",
        "https://data.energystar.gov",
      ],
    });
  });

  it("rejects silently changing the accepted batch knowledge model", () => {
    expect(() => loadConfig({ KNOWLEDGE_FACTORY_MODEL_ID: "another-model" })).toThrow();
    expect(() => loadConfig({ KNOWLEDGE_FACTORY_REASONING_EFFORT: "medium" })).toThrow();
  });

  it("accepts one PostgreSQL URL for Workbench and DBOS schemas", () => {
    const databaseUrl = "postgresql://domain:secret@localhost:5432/domain_test";
    expect(loadConfig({ POSTGRES_DATABASE_URL: databaseUrl }).postgresDatabaseUrl).toBe(databaseUrl);
  });

  it("accepts explicit repository-relative runtime data roots", () => {
    expect(loadConfig({
      EVIDENCE_ROOT: "var/evidence",
      KNOWLEDGE_PACKAGE_ROOT: "var/knowledge-packages",
    })).toMatchObject({
      evidenceRoot: "var/evidence",
      knowledgePackageRoot: "var/knowledge-packages",
    });
  });

  it("parses an explicit local source-origin allowlist", () => {
    expect(loadConfig({
      COLLECTION_ALLOWED_ORIGINS: "https://www.haier.com, https://www.midea.cn",
    }).collectionAllowedOrigins).toEqual([
      "https://www.haier.com",
      "https://www.midea.cn",
    ]);
  });
});
