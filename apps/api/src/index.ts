import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDb, initializeDatabase } from "@domain-analysis/db";
import {
  createCodexCategoryInterviewRuntime,
  createCodexKnowledgeCandidateModel,
  createSourceCollectionPlannerModule,
  openProductKnowledgePipelineRuntime,
  openProductKnowledgeWorkbench,
} from "@domain-analysis/workbench";
import {
  createCnisRegistryTableSource,
  createCrawleeDocumentExcerptSource,
  createCrawleeEnergyLabelRecordSource,
  createEnergyLabelRegulatoryCatalogSource,
  createCrawleePublicWebTextSource,
  createHaierOfficialCatalogSource,
  createHisenseGroupOfficialCatalogSource,
  createLeaderOfficialCatalogSource,
  createKonkaFrestecOfficialCatalogSource,
  createJdOfficialRetailSource,
  createJdSourceCollectionProvider,
  createPlaywrightCdpJdPageReader,
  createCrawleeReadablePageReader,
  createReadableTechnicalSourceCollectionProvider,
  createSourceCollectionProviderRouter,
  createDocumentExcerptSourceCollectionProvider,
  createEnergyLabelSourceCollectionProvider,
  createSiemensOfficialCatalogSource,
  createRoyalstarOfficialChannelSource,
  createMeilingOfficialCatalogSource,
  createMideaOfficialCatalogSource,
  createSocrataOpenDataSource,
  createSocrataSourceCollectionProvider,
  createTclOfficialCatalogSource,
} from "@domain-analysis/worker";
import { loadConfig } from "./config";
import { buildServer } from "./server";
import {
  createProductionSourceCollectionPlanningRules,
  jdSourceAccessPolicy,
} from "./sourceCollectionPlanning";

const config = loadConfig();
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
await initializeDatabase(config.databaseUrl);
const workbench = await openProductKnowledgeWorkbench({
  databaseUrl: config.postgresDatabaseUrl,
  // WHY：npm workspace 运行时 cwd 是 apps/api；持久数据必须锚定仓库根，不能混进源码目录。
  evidenceRoot: path.resolve(repositoryRoot, config.evidenceRoot),
  knowledgePackageModule: { root: path.resolve(repositoryRoot, config.knowledgePackageRoot) },
  knowledgeFactoryModule: {
    candidateModel: createCodexKnowledgeCandidateModel({
      repositoryRoot,
      model: config.knowledgeFactoryModelId,
      reasoningEffort: config.knowledgeFactoryReasoningEffort,
    }),
  },
  categoryInterviewRuntime: createCodexCategoryInterviewRuntime({
    repositoryRoot,
    model: config.interviewModelId,
    reasoningEffort: config.interviewReasoningEffort,
  }),
});
const energyLabelRecordSource = createCrawleeEnergyLabelRecordSource({
  allowedOrigins: config.collectionAllowedOrigins,
});
const documentExcerptSource = createCrawleeDocumentExcerptSource({
  allowedOrigins: config.collectionAllowedOrigins,
});
const jdPageReader = createPlaywrightCdpJdPageReader({
  endpointUrl: config.jdCdpEndpoint,
  allowedOrigins: config.collectionAllowedOrigins,
});
const jdSourceCollectionProvider = createJdSourceCollectionProvider({
  allowedOrigins: config.collectionAllowedOrigins,
  pageReader: jdPageReader,
});
const socrataSource = createSocrataOpenDataSource({
  allowedOrigins: config.collectionAllowedOrigins,
  // WHY：Provider 白名单锁定已核对许可/元数据的数据集；brief 只能在数据集内做单字段精确查询。
  allowedDatasetIds: ["8wj2-sec8"],
});
const readableTechnicalSource = createReadableTechnicalSourceCollectionProvider({
  allowedOrigins: config.collectionAllowedOrigins,
  pageReader: createCrawleeReadablePageReader({
    allowedOrigins: config.collectionAllowedOrigins,
  }),
});
const pipelines = await openProductKnowledgePipelineRuntime({
  systemDatabaseUrl: config.postgresDatabaseUrl,
  regulatory: {
    marketUniverses: workbench.marketUniverses,
    source: createEnergyLabelRegulatoryCatalogSource({ energyLabels: energyLabelRecordSource }),
  },
  sourceCollection: {
    sourceDatasets: workbench.sourceDatasets,
    // WHY：薄分发只按冻结 run.providerKey 选择来源；Provider 不从 URL 或品类猜测职责。
    source: createSourceCollectionProviderRouter({
      "jd-source-collection": jdSourceCollectionProvider,
      "readable-technical-source": readableTechnicalSource,
      "document-excerpt-source": createDocumentExcerptSourceCollectionProvider({
        source: documentExcerptSource,
      }),
      "energy-label-record": createEnergyLabelSourceCollectionProvider({
        source: energyLabelRecordSource,
      }),
      "socrata-open-data": createSocrataSourceCollectionProvider({ source: socrataSource }),
    }),
  },
});
if (!workbench.categoryInterviews) {
  throw new Error("生产来源 Planner 需要 Category Interview 事实源");
}
const sourceCollectionPlanner = createSourceCollectionPlannerModule(
  workbench.productProjects,
  workbench.categoryInterviews,
  workbench.sourceDatasets,
  pipelines.sourceCollection,
  {
    recipeVersion: "source-collection-plan-v1",
    // 京东当前没有通过许可门，因此这里故意只注册已逐资料核对的公共技术来源。
    rules: createProductionSourceCollectionPlanningRules(config.collectionAllowedOrigins),
  },
);
const app = await buildServer({
  db: createDb(config.databaseUrl),
  workbench,
  sourceCollectionPlanner,
  publicWebTextSource: createCrawleePublicWebTextSource({
    allowedOrigins: config.collectionAllowedOrigins,
  }),
  energyLabelRecordSource,
  documentExcerptSource,
  cnisRegistryTableSource: createCnisRegistryTableSource({
    allowedOrigins: config.collectionAllowedOrigins,
  }),
  haierOfficialCatalog: createHaierOfficialCatalogSource({
    allowedOrigins: config.collectionAllowedOrigins,
  }),
  leaderOfficialCatalog: createLeaderOfficialCatalogSource({
    allowedOrigins: config.collectionAllowedOrigins,
  }),
  mideaOfficialCatalog: createMideaOfficialCatalogSource({
    allowedOrigins: config.collectionAllowedOrigins,
  }),
  tclOfficialCatalog: createTclOfficialCatalogSource({
    allowedOrigins: config.collectionAllowedOrigins,
  }),
  hisenseGroupOfficialCatalog: createHisenseGroupOfficialCatalogSource({
    allowedOrigins: config.collectionAllowedOrigins,
  }),
  meilingOfficialCatalog: createMeilingOfficialCatalogSource({
    allowedOrigins: config.collectionAllowedOrigins,
  }),
  konkaFrestecOfficialCatalog: createKonkaFrestecOfficialCatalogSource({
    allowedOrigins: config.collectionAllowedOrigins,
  }),
  siemensOfficialCatalog: createSiemensOfficialCatalogSource({
    allowedOrigins: config.collectionAllowedOrigins,
  }),
  royalstarOfficialChannel: createRoyalstarOfficialChannelSource({
    allowedOrigins: config.collectionAllowedOrigins,
  }),
  jdOfficialRetailCatalog: createJdOfficialRetailSource({
    allowedOrigins: config.collectionAllowedOrigins,
    pageReader: jdPageReader,
    accessPolicy: jdSourceAccessPolicy,
  }),
  marketUniverseRegulatoryPipeline: pipelines.marketUniverseRegulatory,
  closeProductKnowledgePipelines: pipelines.close,
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
