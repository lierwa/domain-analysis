import { DBOS } from "@dbos-inc/dbos-sdk";

import {
  MarketUniverseRegulatoryPipelineError,
  registerMarketUniverseRegulatoryPipeline,
  type MarketUniverseRegulatoryPipelineModule,
  type OpenMarketUniverseRegulatoryPipelineOptions,
} from "./marketUniverseRegulatoryPipelineModule";
import {
  registerSourceCollectionPipeline,
  type OpenSourceCollectionPipelineOptions,
  type SourceCollectionPipelineModule,
} from "./sourceCollectionPipelineModule";

type RuntimeFields =
  | "systemDatabaseUrl"
  | "applicationName"
  | "systemDatabaseSchemaName";

export interface OpenProductKnowledgePipelineRuntimeOptions {
  systemDatabaseUrl: string;
  applicationName?: string;
  systemDatabaseSchemaName?: string;
  regulatory: Omit<OpenMarketUniverseRegulatoryPipelineOptions, RuntimeFields>;
  sourceCollection: Omit<OpenSourceCollectionPipelineOptions, RuntimeFields>;
}

export interface ProductKnowledgePipelineRuntime {
  marketUniverseRegulatory: MarketUniverseRegulatoryPipelineModule;
  sourceCollection: SourceCollectionPipelineModule;
  close(): Promise<void>;
}

export async function openProductKnowledgePipelineRuntime(
  options: OpenProductKnowledgePipelineRuntimeOptions,
): Promise<ProductKnowledgePipelineRuntime> {
  if (DBOS.isInitialized()) {
    throw new MarketUniverseRegulatoryPipelineError("invalid_state", "DBOS 已在当前进程启动");
  }
  const runtime = {
    systemDatabaseUrl: options.systemDatabaseUrl,
    applicationName: options.applicationName,
    systemDatabaseSchemaName: options.systemDatabaseSchemaName,
  };
  // WHY：所有生产 workflow 必须在同一次 launch 前注册；DBOS 是进程级 runtime，不能让模块各自启动单例。
  const regulatory = registerMarketUniverseRegulatoryPipeline({
    ...options.regulatory,
    ...runtime,
  });
  const sourceCollection = registerSourceCollectionPipeline({
    ...options.sourceCollection,
    ...runtime,
  });
  DBOS.setConfig({
    name: options.applicationName ?? "domain-analysis",
    systemDatabaseUrl: options.systemDatabaseUrl,
    systemDatabaseSchemaName: options.systemDatabaseSchemaName ?? "domain_analysis_pipeline",
    runAdminServer: false,
    logLevel: "warn",
  });
  await DBOS.launch();
  await Promise.all([
    DBOS.registerQueue(regulatory.queueName, { concurrency: 1 }),
    DBOS.registerQueue(sourceCollection.queueName, { concurrency: 1 }),
  ]);
  return {
    marketUniverseRegulatory: regulatory.module,
    sourceCollection: sourceCollection.module,
    close: () => DBOS.shutdown(),
  };
}
