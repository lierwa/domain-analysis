import {
  sourceCollectionProviderResultSchema,
  type SourceCollectionProviderPort,
  type SourceCollectionProviderResult,
  type SourceCollectionWorkItem,
} from "@domain-analysis/shared";

import {
  jdPageObservationSchema,
  type JdPageObservation,
  type JdPageReader,
} from "./jdOfficialRetailSource";
import { SourceAccessError } from "./sourceAccessError";

export interface JdSourceCollectionProviderOptions {
  allowedOrigins: string[];
  pageReader?: JdPageReader;
  now?: () => Date;
}

export type { JdPageReader } from "./jdOfficialRetailSource";

export function createJdSourceCollectionProvider(
  options: JdSourceCollectionProviderOptions,
): SourceCollectionProviderPort {
  const active = new Map<string, Set<AbortController>>();
  const now = options.now ?? (() => new Date());
  return {
    collect: async ({ sourceRun, item, abortSignal }) => {
      const startedAt = now().toISOString();
      if (!options.pageReader) {
        return failureResult(item, startedAt, now().toISOString(), "source_abnormal");
      }
      const controller = registerController(active, sourceRun.id);
      const signal = abortSignal
        ? AbortSignal.any([abortSignal, controller.signal])
        : controller.signal;
      try {
        assertAllowed(item.requestedUrl, options.allowedOrigins);
        const kind = requestKind(item);
        const page = jdPageObservationSchema.parse(
          await options.pageReader(item.requestedUrl, kind, signal),
        );
        const finishedAt = now().toISOString();
        if (page.state !== "accessible") {
          return failureResult(item, startedAt, finishedAt, page.state);
        }
        if (page.kind !== kind) {
          return failureResult(item, startedAt, finishedAt, "source_abnormal");
        }
        return accessibleResult(item, page, startedAt, finishedAt, options.allowedOrigins);
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        const state = error instanceof SourceAccessError
          ? failureState(error)
          : "source_abnormal";
        return failureResult(item, startedAt, now().toISOString(), state);
      } finally {
        unregisterController(active, sourceRun.id, controller);
      }
    },
    cancel: (sourceRunId, reason) => {
      for (const controller of active.get(sourceRunId) ?? []) {
        controller.abort(new SourceAccessError("source_abnormal", reason));
      }
    },
  };
}

function accessibleResult(
  item: SourceCollectionWorkItem,
  page: JdPageObservation,
  accessStartedAt: string,
  accessFinishedAt: string,
  allowedOrigins: string[],
): SourceCollectionProviderResult {
  const content = sourceContent(item, page, allowedOrigins);
  return sourceCollectionProviderResultSchema.parse({
    accessStartedAt,
    accessFinishedAt,
    observation: {
      requestedUrl: item.requestedUrl,
      finalUrl: item.requestedUrl,
      observedAt: accessFinishedAt,
      state: "accessible",
    },
    content,
    relations: [],
    stopRun: false,
  });
}

function sourceContent(
  item: SourceCollectionWorkItem,
  page: JdPageObservation,
  allowedOrigins: string[],
) {
  if (page.kind === "catalog") return catalogContent(item, page, allowedOrigins);
  if (page.kind === "detail") return detailContent(item, page);
  if (!page.content) {
    throw new SourceAccessError("source_abnormal", `京东 ${page.kind} 页面缺少可保存内容`);
  }
  const expectedKind = item.object.kind === "taxonomy"
    ? "catalog"
    : item.object.kind === "experience" ? "experience_collection" : "ordered_record";
  if (page.content.kind !== expectedKind) {
    throw new SourceAccessError("source_abnormal", `京东 ${page.kind} 内容类型与来源对象不一致`);
  }
  assertContentOrigins(page.content, allowedOrigins);
  return page.content;
}

function assertContentOrigins(
  content: NonNullable<Extract<JdPageObservation, { kind: "taxonomy" | "store" | "product" | "reviews" }>[
    "content"
  ]>,
  allowedOrigins: string[],
) {
  if (content.kind === "catalog") {
    for (const entry of content.entries) {
      if (entry.sourceUrl) assertAllowed(entry.sourceUrl, allowedOrigins);
    }
    return;
  }
  if (content.kind !== "ordered_record") return;
  for (const block of content.blocks) {
    // WHY：reader 提交的资源链接仍属于外部来源边界，不能因为页面 URL 合法就绕过 origin allowlist。
    if (block.kind === "asset_ref") assertAllowed(block.sourceUrl, allowedOrigins);
  }
}

function catalogContent(
  item: SourceCollectionWorkItem,
  page: Extract<JdPageObservation, { kind: "catalog" }>,
  allowedOrigins: string[],
) {
  if (page.cards.length === 0) {
    throw new SourceAccessError("source_abnormal", "京东目录页没有商品卡片");
  }
  for (const card of page.cards) assertAllowed(card.sourceUrl, allowedOrigins);
  return {
    kind: "catalog" as const,
    title: item.object.externalKey,
    taxonomyPath: [],
    facets: [{
      name: "pagination",
      options: [{ label: "page", value: String(page.pageNumber) }, { label: "pages", value: String(page.pageCount) }],
    }],
    entries: page.cards.map((card, index) => ({
      position: index + 1,
      label: card.title,
      target: {
        sourceIdentity: item.object.sourceIdentity,
        objectKind: "product" as const,
        externalKey: card.sku,
      },
      sourceUrl: card.sourceUrl,
      fields: [{ name: "selfOperated", value: String(card.selfOperated) }],
    })),
  };
}

function detailContent(
  item: SourceCollectionWorkItem,
  page: Extract<JdPageObservation, { kind: "detail" }>,
) {
  const fieldGroups = [];
  if (page.categoryPath.length > 0) {
    fieldGroups.push({
      label: "categoryPath",
      fields: page.categoryPath.map((value) => ({ name: "层级", value })),
    });
  }
  const parameters = Object.entries(page.parameters).map(([name, value]) => ({ name, value }));
  if (parameters.length > 0) fieldGroups.push({ label: "parameters", fields: parameters });
  if (fieldGroups.length === 0) {
    throw new SourceAccessError("source_abnormal", `京东详情 ${page.sku} 没有可保存内容`);
  }
  return {
    kind: "ordered_record" as const,
    title: item.object.externalKey,
    fieldGroups,
    blocks: [],
  };
}

function failureResult(
  item: SourceCollectionWorkItem,
  accessStartedAt: string,
  accessFinishedAt: string,
  state: "not_found" | "access_denied" | "login_required" | "verification_required" | "rate_limited" | "source_abnormal",
) {
  return sourceCollectionProviderResultSchema.parse({
    accessStartedAt,
    accessFinishedAt,
    observation: {
      requestedUrl: item.requestedUrl,
      observedAt: accessFinishedAt,
      state,
      failureCode: state,
    },
    relations: [],
    stopRun: state !== "not_found",
  });
}

function requestKind(item: SourceCollectionWorkItem) {
  if (item.object.kind === "taxonomy") return "taxonomy" as const;
  if (item.object.kind === "organization") return "store" as const;
  if (item.object.kind === "catalog_entry") return "catalog" as const;
  if (item.object.kind === "product" || item.object.kind === "offer") return "product" as const;
  if (item.object.kind === "experience") return "reviews" as const;
  throw new SourceAccessError("source_abnormal", `京东来源不支持对象类型：${item.object.kind}`);
}

function failureState(error: SourceAccessError) {
  if (error.code === "evidence_not_found") return "not_found" as const;
  if (error.code === "origin_not_allowed") return "source_abnormal" as const;
  return error.code;
}

function registerController(active: Map<string, Set<AbortController>>, runId: string) {
  const controller = new AbortController();
  const controllers = active.get(runId) ?? new Set<AbortController>();
  controllers.add(controller);
  active.set(runId, controllers);
  return controller;
}

function unregisterController(
  active: Map<string, Set<AbortController>>,
  runId: string,
  controller: AbortController,
) {
  const controllers = active.get(runId);
  controllers?.delete(controller);
  if (controllers?.size === 0) active.delete(runId);
}

function assertAllowed(value: string, allowedOrigins: string[]) {
  const url = new URL(value);
  const allowed = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  if (url.protocol !== "https:" || !allowed.has(url.origin)) {
    throw new SourceAccessError("origin_not_allowed", `来源 origin 未获本地配置允许：${url.origin}`);
  }
}
