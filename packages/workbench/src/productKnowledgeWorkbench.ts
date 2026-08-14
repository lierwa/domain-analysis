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

export interface ProductKnowledgeWorkbench {
  productProjects: ProductProjectModule;
  close(): void;
}

export interface OpenProductKnowledgeWorkbenchOptions {
  databaseUrl?: string;
  productProjectModule?: ProductProjectModuleOptions;
}

export async function openProductKnowledgeWorkbench(
  options: OpenProductKnowledgeWorkbenchOptions = {},
): Promise<ProductKnowledgeWorkbench> {
  const databaseUrl = options.databaseUrl ?? defaultProductKnowledgeDatabaseUrl;
  // WHY：先运行官方 migrator 再暴露 module，调用者永远不会拿到“表还没准备好”的工作台。
  await migrateProductKnowledgeDatabase(databaseUrl);
  const db = createProductKnowledgeDb(databaseUrl);

  return {
    productProjects: createProductProjectModule(db, options.productProjectModule),
    // TRADE-OFF：DB 生命周期由组合根统一关闭，领域 module 不感知 libSQL client。
    close: () => db.$client.close(),
  };
}
