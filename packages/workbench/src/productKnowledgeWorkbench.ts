import {
  createProductKnowledgeDb,
  defaultProductKnowledgeDatabaseUrl,
  migrateProductKnowledgeDatabase,
} from "@domain-analysis/db";

import {
  createProductProjectModule,
  type ProductProjectModule,
  type ProductProjectModuleOptions,
} from "./productProjectModule";
import {
  createCacacheContentStore,
  type ContentAddressedStore,
} from "./cacacheContentStore";
import { createEvidenceModule, type EvidenceModule, type EvidenceModuleOptions } from "./evidenceModule";
import {
  createCategoryInterviewModule,
  type CategoryInterviewModule,
  type CategoryInterviewModuleOptions,
  type CategoryInterviewRuntime,
} from "./categoryInterviewModule";
import {
  createMarketUniverseModule,
  type MarketUniverseModule,
  type MarketUniverseModuleOptions,
} from "./marketUniverseModule";
import {
  createSourceDatasetModule,
  type SourceDatasetModule,
  type SourceDatasetModuleOptions,
} from "./sourceDatasetModule";
import { createSourceEvidenceModule, type SourceEvidenceModule } from "./sourceEvidenceModule";
import {
  createKnowledgeFactoryModule,
  type KnowledgeFactoryModule,
  type KnowledgeFactoryModuleOptions,
} from "./knowledgeFactoryModule";
import {
  createKnowledgeReviewModule,
  type KnowledgeReviewModule,
  type KnowledgeReviewModuleOptions,
} from "./knowledgeReviewModule";
import {
  createKnowledgePackageModule,
  type KnowledgePackageModule,
  type KnowledgePackageModuleOptions,
} from "./knowledgePackageModule";

export interface ProductKnowledgeWorkbench {
  categoryInterviews?: CategoryInterviewModule;
  productProjects: ProductProjectModule;
  evidence: EvidenceModule;
  marketUniverses: MarketUniverseModule;
  sourceDatasets: SourceDatasetModule;
  sourceEvidence: SourceEvidenceModule;
  knowledgeFactory: KnowledgeFactoryModule;
  knowledgeReview: KnowledgeReviewModule;
  knowledgePackages: KnowledgePackageModule;
  close(): Promise<void>;
}

export interface OpenProductKnowledgeWorkbenchOptions {
  databaseUrl?: string;
  productProjectModule?: ProductProjectModuleOptions;
  evidenceModule?: EvidenceModuleOptions;
  categoryInterviewRuntime?: CategoryInterviewRuntime;
  categoryInterviewModule?: CategoryInterviewModuleOptions;
  evidenceRoot?: string;
  contentStore?: ContentAddressedStore;
  marketUniverseModule?: MarketUniverseModuleOptions;
  sourceDatasetModule?: SourceDatasetModuleOptions;
  knowledgeFactoryModule?: KnowledgeFactoryModuleOptions;
  knowledgeReviewModule?: KnowledgeReviewModuleOptions;
  knowledgePackageModule?: Partial<KnowledgePackageModuleOptions>;
}

export async function openProductKnowledgeWorkbench(
  options: OpenProductKnowledgeWorkbenchOptions = {},
): Promise<ProductKnowledgeWorkbench> {
  const databaseUrl = options.databaseUrl ?? defaultProductKnowledgeDatabaseUrl;
  // WHY：先运行官方 migrator 再暴露 module，调用者永远不会拿到“表还没准备好”的工作台。
  await migrateProductKnowledgeDatabase(databaseUrl);
  const db = createProductKnowledgeDb(databaseUrl);
  const contentStore = options.contentStore ?? createCacacheContentStore(
    options.evidenceRoot ?? process.env.EVIDENCE_ROOT ?? "data/evidence",
  );
  const productProjects = createProductProjectModule(db, options.productProjectModule);
  const evidence = createEvidenceModule(db, productProjects, contentStore, options.evidenceModule);
  const sourceDatasets = createSourceDatasetModule(
    db,
    productProjects,
    contentStore,
    options.sourceDatasetModule,
  );
  const sourceEvidence = createSourceEvidenceModule(sourceDatasets, evidence);
  const knowledgeFactory = createKnowledgeFactoryModule(
    db,
    productProjects,
    evidence,
    options.knowledgeFactoryModule,
  );
  const knowledgeReview = createKnowledgeReviewModule(
    db,
    knowledgeFactory,
    evidence,
    options.knowledgeReviewModule,
  );
  const knowledgePackages = createKnowledgePackageModule(
    productProjects,
    knowledgeReview,
    evidence,
    {
      root: options.knowledgePackageModule?.root
        ?? process.env.KNOWLEDGE_PACKAGE_ROOT
        ?? "data/knowledge-packages",
      now: options.knowledgePackageModule?.now,
    },
  );

  return {
    categoryInterviews: options.categoryInterviewRuntime
      ? createCategoryInterviewModule(
        db,
        productProjects,
        options.categoryInterviewRuntime,
        options.categoryInterviewModule,
      )
      : undefined,
    productProjects,
    evidence,
    marketUniverses: createMarketUniverseModule(db, productProjects, options.marketUniverseModule),
    sourceDatasets,
    sourceEvidence,
    knowledgeFactory,
    knowledgeReview,
    knowledgePackages,
    // TRADE-OFF：PostgreSQL 连接池由组合根统一关闭，领域 module 不感知连接生命周期。
    close: () => db.$client.end(),
  };
}
