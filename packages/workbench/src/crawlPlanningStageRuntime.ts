import type { CaptureTask, CrawlPlan } from "@domain-analysis/shared";

import type {
  BrandDiscoveryStage,
  BrandLandscapeStage,
  BrandSaturationStage,
} from "./crawlPlanningBrandDiscovery";
import type { CrawlPlanningRuntimeEvent } from "./crawlPlanningModule";
import type {
  BrandMappingStage,
  KnowledgeSourcesStage,
  MarketCatalogStage,
} from "./crawlPlanningStages";

export interface CrawlPlanningRuntimeInput {
  task: CaptureTask;
  instruction?: string;
  previousPlans: CrawlPlan[];
}

interface StageCommandBase {
  key: string;
  label: string;
  runtimeInput: CrawlPlanningRuntimeInput;
}

export interface CrawlPlanningStageCommandMap {
  brand_discovery: StageCommandBase & { kind: "brand_discovery" };
  brand_saturation: StageCommandBase & {
    kind: "brand_saturation";
    landscape: BrandLandscapeStage;
    previousQueries: string[];
  };
  market_catalog: StageCommandBase & {
    kind: "market_catalog";
    landscape: BrandLandscapeStage;
  };
  brand_mapping: StageCommandBase & {
    kind: "brand_mapping";
    brands: BrandLandscapeStage["brands"];
  };
  knowledge_sources: StageCommandBase & { kind: "knowledge_sources" };
}

export interface CrawlPlanningStageValueMap {
  brand_discovery: BrandDiscoveryStage;
  brand_saturation: BrandSaturationStage;
  market_catalog: MarketCatalogStage;
  brand_mapping: BrandMappingStage;
  knowledge_sources: KnowledgeSourcesStage;
}

export type CrawlPlanningStageKind = keyof CrawlPlanningStageCommandMap;
export type CrawlPlanningStageCommand = CrawlPlanningStageCommandMap[CrawlPlanningStageKind];
export type CrawlPlanningStageValue = CrawlPlanningStageValueMap[CrawlPlanningStageKind];
export type CrawlPlanningStageOutcome<T> = { interrupted: true } | { interrupted: false; value: T };

export interface CrawlPlanningStageRuntime {
  run(command: CrawlPlanningStageCommandMap["brand_discovery"], signal?: AbortSignal):
    AsyncGenerator<CrawlPlanningRuntimeEvent, CrawlPlanningStageOutcome<CrawlPlanningStageValueMap["brand_discovery"]>>;
  run(command: CrawlPlanningStageCommandMap["brand_saturation"], signal?: AbortSignal):
    AsyncGenerator<CrawlPlanningRuntimeEvent, CrawlPlanningStageOutcome<CrawlPlanningStageValueMap["brand_saturation"]>>;
  run(command: CrawlPlanningStageCommandMap["market_catalog"], signal?: AbortSignal):
    AsyncGenerator<CrawlPlanningRuntimeEvent, CrawlPlanningStageOutcome<CrawlPlanningStageValueMap["market_catalog"]>>;
  run(command: CrawlPlanningStageCommandMap["brand_mapping"], signal?: AbortSignal):
    AsyncGenerator<CrawlPlanningRuntimeEvent, CrawlPlanningStageOutcome<CrawlPlanningStageValueMap["brand_mapping"]>>;
  run(command: CrawlPlanningStageCommandMap["knowledge_sources"], signal?: AbortSignal):
    AsyncGenerator<CrawlPlanningRuntimeEvent, CrawlPlanningStageOutcome<CrawlPlanningStageValueMap["knowledge_sources"]>>;
  run(command: CrawlPlanningStageCommand, signal?: AbortSignal):
    AsyncGenerator<CrawlPlanningRuntimeEvent, CrawlPlanningStageOutcome<CrawlPlanningStageValue>>;
  close?(): Promise<void>;
}

export interface CollectedCrawlPlanningStage {
  kind: CrawlPlanningStageKind;
  events: CrawlPlanningRuntimeEvent[];
  value: CrawlPlanningStageValue;
}

export async function collectCrawlPlanningStage(
  runtime: CrawlPlanningStageRuntime,
  command: CrawlPlanningStageCommand,
): Promise<CollectedCrawlPlanningStage> {
  const events: CrawlPlanningRuntimeEvent[] = [];
  const iterator = runtime.run(command);
  for (;;) {
    const item = await iterator.next();
    if (item.done) {
      if (item.value.interrupted) throw new Error(`Crawl Planning 阶段意外中断：${command.label}`);
      return { kind: command.kind, events, value: item.value.value };
    }
    events.push(item.value);
  }
}
