import type {
  MarketUniverseUnknown,
  OfficialCatalogSnapshot,
  ProductProjectView,
} from "@domain-analysis/shared";
import type {
  MarketUniverseModule,
  MarketUniverseRegulatoryPipelineModule,
  ProductProjectModule,
} from "@domain-analysis/workbench";
import { SourceAccessError, type OfficialCatalogSource } from "@domain-analysis/worker";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerMarketUniverseRoutes } from "../src/routes/marketUniverseRoutes";

describe("MarketUniverse HTTP contract", () => {
  it("从十个生产来源能力生成候选总体，而不是接收客户端上传样例", async () => {
    const marketUniverses = {
      latest: vi.fn(async () => null),
      confirmCandidate: vi.fn(),
      refreshCandidate: vi.fn(async (_projectId, snapshots) => ({
        id: "universe-1",
        status: "candidate",
        models: snapshots.flatMap((snapshot: { entries: unknown[] }) => snapshot.entries),
      })),
    } as unknown as MarketUniverseModule;
    const app = Fastify();
    await registerMarketUniverseRoutes(app, {
      projects: fakeProjects("household_refrigerator"),
      marketUniverses,
      haierCatalog: fakeCatalog("haier", "海尔", "BCD-500"),
      leaderCatalog: fakeCatalog("leader", "统帅", "LC2-160WS9"),
      mideaCatalog: fakeCatalog("midea", "美的", "MR-457"),
      tclCatalog: fakeCatalog("tcl", "TCL", "R555Q10-SS"),
      hisenseGroupCatalog: fakeCatalog("hisense-group", "海信", "BCD-500V5CZKQD"),
      meilingCatalog: fakeCatalog("meiling", "美菱", "BCD-401WP9BT"),
      konkaFrestecCatalog: fakeCatalog("konka-group", "新飞", "BCD-640WGQ8E"),
      siemensCatalog: fakeCatalog("siemens", "西门子", "KF89BV156C"),
      royalstarCatalog: fakeCatalog("royalstar", "荣事达", "BCD-271WGP", "official_channel_discovery", "partial"),
      jdCatalog: fakeJdCatalog(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-fridge/market-universe/refresh",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().item).toMatchObject({ status: "candidate" });
    expect(marketUniverses.refreshCandidate).toHaveBeenCalledWith(
      "project-fridge",
      [
        expect.objectContaining({ sourceId: "haier" }),
        expect.objectContaining({ sourceId: "leader" }),
        expect.objectContaining({ sourceId: "midea" }),
        expect.objectContaining({ sourceId: "tcl" }),
        expect.objectContaining({ sourceId: "hisense-group" }),
        expect.objectContaining({ sourceId: "meiling" }),
        expect.objectContaining({ sourceId: "konka-group" }),
        expect.objectContaining({ sourceId: "siemens" }),
        expect.objectContaining({ sourceId: "royalstar" }),
        expect.objectContaining({ sourceId: "jd" }),
      ],
      expect.not.arrayContaining([expect.objectContaining({ key: expect.stringContaining("jd-official-direct-models") })]),
    );
    await app.close();
  });

  it("用版本号和内容哈希确认候选总体", async () => {
    const confirmCandidate = vi.fn(async () => ({ id: "universe-1", status: "confirmed" }));
    const app = Fastify();
    await registerMarketUniverseRoutes(app, {
      projects: fakeProjects("household_refrigerator"),
      marketUniverses: { latest: async () => null, confirmCandidate } as unknown as MarketUniverseModule,
      haierCatalog: fakeCatalog("haier", "海尔", "BCD-500"),
      leaderCatalog: fakeCatalog("leader", "统帅", "LC2-160WS9"),
      mideaCatalog: fakeCatalog("midea", "美的", "MR-457"),
      tclCatalog: fakeCatalog("tcl", "TCL", "R555Q10-SS"),
      hisenseGroupCatalog: fakeCatalog("hisense-group", "海信", "BCD-500V5CZKQD"),
      meilingCatalog: fakeCatalog("meiling", "美菱", "BCD-401WP9BT"),
      konkaFrestecCatalog: fakeCatalog("konka-group", "新飞", "BCD-640WGQ8E"),
      siemensCatalog: fakeCatalog("siemens", "西门子", "KF89BV156C"),
      royalstarCatalog: fakeCatalog("royalstar", "荣事达", "BCD-271WGP", "official_channel_discovery", "partial"),
      jdCatalog: fakeJdCatalog(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-fridge/market-universe/confirm",
      payload: { expectedVersion: 3, expectedContentHash: "a".repeat(64) },
    });

    expect(response.statusCode).toBe(200);
    expect(confirmCandidate).toHaveBeenCalledWith("project-fridge", 3, "a".repeat(64));
    await app.close();
  });

  it("京东需要登录时仍保存九个官网结果，并把失败保留为 source_access unknown", async () => {
    const refreshCandidate = vi.fn(async () => ({ id: "universe-1", status: "candidate" }));
    const app = Fastify();
    await registerMarketUniverseRoutes(app, {
      projects: fakeProjects("household_refrigerator"),
      marketUniverses: { latest: async () => null, refreshCandidate } as unknown as MarketUniverseModule,
      haierCatalog: fakeCatalog("haier", "海尔", "BCD-500"),
      leaderCatalog: fakeCatalog("leader", "统帅", "LC2-160WS9"),
      mideaCatalog: fakeCatalog("midea", "美的", "MR-457"),
      tclCatalog: fakeCatalog("tcl", "TCL", "R555Q10-SS"),
      hisenseGroupCatalog: fakeCatalog("hisense-group", "海信", "BCD-500V5CZKQD"),
      meilingCatalog: fakeCatalog("meiling", "美菱", "BCD-401WP9BT"),
      konkaFrestecCatalog: fakeCatalog("konka-group", "新飞", "BCD-640WGQ8E"),
      siemensCatalog: fakeCatalog("siemens", "西门子", "KF89BV156C"),
      royalstarCatalog: fakeCatalog("royalstar", "荣事达", "BCD-271WGP", "official_channel_discovery", "partial"),
      jdCatalog: {
        enumerate: vi.fn(async () => {
          throw new SourceAccessError("login_required", "fixture login page");
        }),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-fridge/market-universe/refresh",
    });

    expect(response.statusCode).toBe(201);
    const [, snapshots, unknowns] = (refreshCandidate.mock.calls as unknown as Array<[
      string,
      OfficialCatalogSnapshot[],
      MarketUniverseUnknown[],
    ]>)[0]!;
    expect(snapshots).toHaveLength(9);
    expect(unknowns).toContainEqual(expect.objectContaining({
      key: "jd-official-direct-models:login_required",
      kind: "source_access",
      scope: { type: "source", sourceId: "jd-cn-self-operated-refrigerator-catalog" },
      blocking: true,
    }));
    await app.close();
  });

  it("拒绝把冰箱来源接到其他品类", async () => {
    const app = Fastify();
    await registerMarketUniverseRoutes(app, {
      projects: fakeProjects("television"),
      marketUniverses: { latest: async () => null } as unknown as MarketUniverseModule,
      haierCatalog: fakeCatalog("haier", "海尔", "BCD-500"),
      leaderCatalog: fakeCatalog("leader", "统帅", "LC2-160WS9"),
      mideaCatalog: fakeCatalog("midea", "美的", "MR-457"),
      tclCatalog: fakeCatalog("tcl", "TCL", "R555Q10-SS"),
      hisenseGroupCatalog: fakeCatalog("hisense-group", "海信", "BCD-500V5CZKQD"),
      meilingCatalog: fakeCatalog("meiling", "美菱", "BCD-401WP9BT"),
      konkaFrestecCatalog: fakeCatalog("konka-group", "新飞", "BCD-640WGQ8E"),
      siemensCatalog: fakeCatalog("siemens", "西门子", "KF89BV156C"),
      royalstarCatalog: fakeCatalog("royalstar", "荣事达", "BCD-271WGP", "official_channel_discovery", "partial"),
      jdCatalog: fakeJdCatalog(),
    });
    app.setErrorHandler((error, _request, reply) => reply.status(422).send({ message: error.message }));

    const response = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-tv/market-universe/refresh",
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain("只接入冰箱");
    await app.close();
  });

  it("通过独立监管流水线开始、查询和取消同一运行", async () => {
    const start = vi.fn(async () => regulatoryRun("running"));
    const latest = vi.fn(async () => regulatoryRun("running"));
    const get = vi.fn(async () => regulatoryRun("running"));
    const cancel = vi.fn(async () => regulatoryRun("cancelled"));
    const app = Fastify();
    await registerMarketUniverseRoutes(app, {
      projects: fakeProjects("household_refrigerator"),
      marketUniverses: { latest: async () => null } as unknown as MarketUniverseModule,
      haierCatalog: fakeCatalog("haier", "海尔", "BCD-500"),
      leaderCatalog: fakeCatalog("leader", "统帅", "LC2-160WS9"),
      mideaCatalog: fakeCatalog("midea", "美的", "MR-457"),
      tclCatalog: fakeCatalog("tcl", "TCL", "R555Q10-SS"),
      hisenseGroupCatalog: fakeCatalog("hisense-group", "海信", "BCD-500V5CZKQD"),
      meilingCatalog: fakeCatalog("meiling", "美菱", "BCD-401WP9BT"),
      konkaFrestecCatalog: fakeCatalog("konka-group", "新飞", "BCD-640WGQ8E"),
      siemensCatalog: fakeCatalog("siemens", "西门子", "KF89BV156C"),
      royalstarCatalog: fakeCatalog("royalstar", "荣事达", "BCD-271WGP", "official_channel_discovery", "partial"),
      jdCatalog: fakeJdCatalog(),
      regulatoryPipeline: { start, latest, get, cancel },
      requestedBy: "local-user",
    });

    const started = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-fridge/market-universe/regulatory-reconciliations",
    });
    const recovered = await app.inject({
      method: "GET",
      url: "/api/product-projects/project-fridge/market-universe/regulatory-reconciliations",
    });
    const read = await app.inject({
      method: "GET",
      url: "/api/product-projects/project-fridge/market-universe/regulatory-reconciliations/run-1",
    });
    const cancelled = await app.inject({
      method: "POST",
      url: "/api/product-projects/project-fridge/market-universe/regulatory-reconciliations/run-1/cancel",
    });

    expect(started.statusCode).toBe(202);
    expect(recovered.json().item.lifecycleStatus).toBe("running");
    expect(read.json().item.lifecycleStatus).toBe("running");
    expect(cancelled.json().item.lifecycleStatus).toBe("cancelled");
    expect(start).toHaveBeenCalledWith("project-fridge", "local-user");
    expect(latest).toHaveBeenCalledWith("project-fridge");
    expect(cancel).toHaveBeenCalledWith("run-1");
    await app.close();
  });
});

function regulatoryRun(
  lifecycleStatus: "running" | "cancelled",
): Awaited<ReturnType<MarketUniverseRegulatoryPipelineModule["cancel"]>> {
  return {
    id: "run-1",
    projectId: "project-fridge",
    sourceUniverse: { id: "universe-1", version: 1, contentHash: "a".repeat(64) },
    lifecycleStatus,
    totalModels: 1,
    completedModels: 0,
    matchedModels: 0,
    notFoundModels: 0,
    failedModels: 0,
    producerConflictModels: 0,
    createdAt: "2026-08-16T12:00:00.000Z",
    updatedAt: "2026-08-16T12:00:00.000Z",
  };
}

function fakeProjects(categoryCode: string) {
  return {
    get: vi.fn(async () => ({
      project: { id: "project-fridge", status: "ready" },
      categoryDefinition: { categoryCode },
    } as ProductProjectView)),
  } as unknown as ProductProjectModule;
}

function fakeCatalog(
  sourceId: string,
  brand: string,
  manufacturerModel: string,
  coverageKind: "independent_brand_catalog" | "official_channel_discovery" = "independent_brand_catalog",
  coverageStatus: "complete" | "partial" = "complete",
): OfficialCatalogSource {
  return {
    enumerate: vi.fn(async () => ({
      sourceId,
      sourceIdentity: sourceId,
      sourceAuthorityType: "brand_official_site" as const,
      coverageKind,
      catalogUrl: `https://example.com/${sourceId}`,
      observedAt: "2026-08-16T12:00:00.000Z",
      declaredItemCount: 1,
      fetchedItemCount: 1,
      acceptedItemCount: 1,
      coverageStatus,
      entries: [{
        brand,
        manufacturerModel,
        sourceItemId: "1",
        sourceUrl: `https://example.com/${sourceId}/1`,
      }],
    })),
  };
}

function fakeJdCatalog(): OfficialCatalogSource {
  return {
    enumerate: vi.fn(async () => ({
      sourceId: "jd",
      sourceIdentity: "jd-cn-self-operated-refrigerator-channel",
      sourceAuthorityType: "official_direct_retail" as const,
      coverageKind: "official_channel_discovery" as const,
      catalogUrl: "https://www.jd.com/brand/737a81dda3769f80aa8.html",
      observedAt: "2026-08-16T12:00:00.000Z",
      declaredItemCount: 1,
      fetchedItemCount: 1,
      acceptedItemCount: 1,
      coverageStatus: "complete" as const,
      entries: [{
        brand: "米家",
        manufacturerModel: "MC-186DMD",
        sourceItemId: "1001",
        sourceUrl: "https://item.jd.com/1001.html",
      }],
    })),
  };
}
