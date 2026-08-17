import type { MarketUniverseUnknown, OfficialCatalogSnapshot } from "@domain-analysis/shared";
import {
  MarketUniverseError,
  type MarketUniverseModule,
  type MarketUniverseRegulatoryPipelineModule,
  type ProductProjectModule,
} from "@domain-analysis/workbench";
import {
  SourceAccessError,
  type OfficialCatalogSource,
  type SourceAccessFailureCode,
} from "@domain-analysis/worker";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const projectParamsSchema = z.object({ projectId: z.string().min(1) }).strict();
const runParamsSchema = z.object({ projectId: z.string().min(1), runId: z.string().min(1) }).strict();
const confirmCandidateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export interface MarketUniverseRouteDependencies {
  projects: ProductProjectModule;
  marketUniverses: MarketUniverseModule;
  haierCatalog: OfficialCatalogSource;
  leaderCatalog: OfficialCatalogSource;
  mideaCatalog: OfficialCatalogSource;
  tclCatalog: OfficialCatalogSource;
  hisenseGroupCatalog: OfficialCatalogSource;
  meilingCatalog: OfficialCatalogSource;
  konkaFrestecCatalog: OfficialCatalogSource;
  siemensCatalog: OfficialCatalogSource;
  royalstarCatalog: OfficialCatalogSource;
  jdCatalog: OfficialCatalogSource;
  regulatoryPipeline?: MarketUniverseRegulatoryPipelineModule;
  requestedBy?: string;
}

export async function registerMarketUniverseRoutes(
  app: FastifyInstance,
  dependencies: MarketUniverseRouteDependencies,
) {
  app.get("/api/product-projects/:projectId/market-universe", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    return { item: await dependencies.marketUniverses.latest(projectId) };
  });

  app.post("/api/product-projects/:projectId/market-universe/refresh", async (request, reply) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const project = await dependencies.projects.get(projectId);
    if (!project) return reply.status(404).send({ error: "not_found", message: `项目不存在：${projectId}` });
    if (project.categoryDefinition.categoryCode !== "household_refrigerator") {
      throw new MarketUniverseError("unsupported_category", "当前生产纵切片只接入冰箱官方目录");
    }
    // WHY：各来源互不依赖且站内并发均为 1；并行等待减少 PC 操作时间，不改变单站访问上限。
    const [officialSnapshots, jdResult] = await Promise.all([
      Promise.all([
        dependencies.haierCatalog.enumerate(),
        dependencies.leaderCatalog.enumerate(),
        dependencies.mideaCatalog.enumerate(),
        dependencies.tclCatalog.enumerate(),
        dependencies.hisenseGroupCatalog.enumerate(),
        dependencies.meilingCatalog.enumerate(),
        dependencies.konkaFrestecCatalog.enumerate(),
        dependencies.siemensCatalog.enumerate(),
        dependencies.royalstarCatalog.enumerate(),
      ]),
      enumerateJd(dependencies.jdCatalog),
    ]);
    const snapshots = jdResult.snapshot
      ? [...officialSnapshots, jdResult.snapshot]
      : officialSnapshots;
    const item = await dependencies.marketUniverses.refreshCandidate(
      projectId,
      snapshots,
      pendingUniverseUnknowns(jdResult.failure),
    );
    return reply.status(201).send({ item });
  });

  app.post("/api/product-projects/:projectId/market-universe/confirm", async (request) => {
    const { projectId } = projectParamsSchema.parse(request.params);
    const { expectedVersion, expectedContentHash } = confirmCandidateSchema.parse(request.body);
    return {
      item: await dependencies.marketUniverses.confirmCandidate(
        projectId,
        expectedVersion,
        expectedContentHash,
      ),
    };
  });

  if (dependencies.regulatoryPipeline) {
    app.get("/api/product-projects/:projectId/market-universe/regulatory-reconciliations", async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      return { item: await dependencies.regulatoryPipeline!.latest(projectId) };
    });

    app.post("/api/product-projects/:projectId/market-universe/regulatory-reconciliations", async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const item = await dependencies.regulatoryPipeline!.start(
        projectId,
        dependencies.requestedBy ?? "local-user",
      );
      return reply.status(202).send({ item });
    });

    app.get("/api/product-projects/:projectId/market-universe/regulatory-reconciliations/:runId", async (request, reply) => {
      const { projectId, runId } = runParamsSchema.parse(request.params);
      const item = await dependencies.regulatoryPipeline!.get(runId);
      if (!item || item.projectId !== projectId) {
        return reply.status(404).send({ error: "not_found", message: `监管对账运行不存在：${runId}` });
      }
      return { item };
    });

    app.post("/api/product-projects/:projectId/market-universe/regulatory-reconciliations/:runId/cancel", async (request, reply) => {
      const { projectId, runId } = runParamsSchema.parse(request.params);
      const existing = await dependencies.regulatoryPipeline!.get(runId);
      if (!existing || existing.projectId !== projectId) {
        return reply.status(404).send({ error: "not_found", message: `监管对账运行不存在：${runId}` });
      }
      return { item: await dependencies.regulatoryPipeline!.cancel(runId) };
    });
  }
}

async function enumerateJd(source: OfficialCatalogSource): Promise<{
  snapshot?: OfficialCatalogSnapshot;
  failure?: SourceAccessError;
}> {
  try {
    return { snapshot: await source.enumerate() };
  } catch (error) {
    // WHY：登录/验证只阻塞京东来源，不得吞掉其他编程错误或让九个官网结果一起丢失。
    if (error instanceof SourceAccessError) return { failure: error };
    throw error;
  }
}

function pendingUniverseUnknowns(jdFailure?: SourceAccessError): MarketUniverseUnknown[] {
  const unknowns: MarketUniverseUnknown[] = [
    {
      key: "regulatory-active-intersection",
      kind: "window_mismatch",
      scope: { type: "market" },
      blocking: true,
      description: "监管备案是合规身份台账，尚未与当前官方在售目录完成同一观察窗口交叉核验。",
      requiredSourceAuthorityTypes: ["regulatory_source"],
    },
    {
      key: "remaining-brand-official-catalogs",
      kind: "brand_discovery",
      scope: { type: "market" },
      blocking: true,
      description: "容声独立官网、米家/小米、志高、奥克斯等品牌仍缺少同一窗口的独立完整官方目录；已有集团或渠道来源不能冒充独立品牌目录。",
      requiredSourceAuthorityTypes: ["brand_official_site", "brand_flagship_store"],
    },
  ];
  if (jdFailure) unknowns.push(jdAccessUnknown(jdFailure.code));
  return unknowns;
}

function jdAccessUnknown(code: SourceAccessFailureCode): MarketUniverseUnknown {
  const descriptions: Record<SourceAccessFailureCode, string> = {
    login_required: "京东来源要求登录，官方自营商品详情没有进入本次候选。",
    verification_required: "京东要求人工安全验证；系统已停止该来源且没有自动绕过。",
    access_denied: "京东拒绝当前来源访问，官方自营商品详情没有进入本次候选。",
    rate_limited: "京东限制了当前低并发访问，官方自营商品详情没有进入本次候选。",
    source_abnormal: "京东页面结构或分页完整性异常，系统拒绝生成不完整的官方自营快照。",
    origin_not_allowed: "京东目录或商品 origin 未进入本地来源白名单，系统没有发起越界访问。",
    evidence_not_found: "京东官方自营商品详情缺少可定位的规格数据，系统没有从标题猜测厂商型号。",
  };
  return {
    key: `jd-official-direct-models:${code}`,
    kind: "source_access",
    scope: { type: "source", sourceId: "jd-cn-self-operated-refrigerator-catalog" },
    blocking: true,
    description: descriptions[code],
    requiredSourceAuthorityTypes: ["official_direct_retail"],
  };
}
