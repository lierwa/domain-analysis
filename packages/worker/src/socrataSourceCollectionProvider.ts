import {
  sourceCollectionProviderResultSchema,
  type SourceCollectionProviderPort,
  type SourceCollectionWorkItem,
} from "@domain-analysis/shared";

import type { SocrataOpenDataSource } from "./socrataOpenDataSource";
import { SourceAccessError } from "./sourceAccessError";

export function createSocrataSourceCollectionProvider(options: {
  source: SocrataOpenDataSource;
  now?: () => Date;
}): SourceCollectionProviderPort {
  const active = new Map<string, Set<AbortController>>();
  const now = options.now ?? (() => new Date());
  return {
    collect: async ({ sourceRun, item, abortSignal }) => {
      const startedAt = now().toISOString();
      const lookup = recordLookup(item);
      if (!lookup || !canPersist(item)) return failure(item, startedAt, now().toISOString(), "source_abnormal");
      const controller = register(active, sourceRun.id);
      const signal = abortSignal ? AbortSignal.any([abortSignal, controller.signal]) : controller.signal;
      try {
        const capture = await options.source.capture({
          requestedUrl: item.requestedUrl,
          lookup: { fieldCode: lookup.fieldCode, value: lookup.value },
          maximumBytes: lookup.maximumBytes,
        }, signal);
        return sourceCollectionProviderResultSchema.parse({
          accessStartedAt: startedAt,
          accessFinishedAt: now().toISOString(),
          observation: {
            requestedUrl: capture.requestedUrl,
            finalUrl: capture.finalUrl,
            observedAt: capture.observedAt,
            state: "accessible",
            httpValidation: capture.httpValidation,
          },
          content: {
            kind: "ordered_record",
            title: `官方开放数据记录：${lookup.value}`,
            fieldGroups: [{
              label: "Open Data Record",
              fields: Object.entries(capture.record).map(([name, value]) => ({
                name,
                value: value === null ? "null" : String(value),
              })),
            }],
            blocks: [],
          },
          relations: [],
          stopRun: false,
        });
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        return failure(item, startedAt, now().toISOString(), failureState(error));
      } finally {
        unregister(active, sourceRun.id, controller);
      }
    },
    cancel: (sourceRunId, reason) => {
      for (const controller of active.get(sourceRunId) ?? []) {
        controller.abort(new SourceAccessError("source_abnormal", reason));
      }
    },
  };
}

function recordLookup(item: SourceCollectionWorkItem) {
  if (item.request?.kind !== "structured_record_lookup" || item.request.fields.length !== 1) return null;
  const field = item.request.fields[0]!;
  return { fieldCode: field.code, value: field.value, maximumBytes: item.request.maximumBytes };
}

function canPersist(item: SourceCollectionWorkItem) {
  return item.object.kind === "regulatory_record"
    && item.usagePermission.localRead === "allowed"
    && item.usagePermission.evidenceStorage === "allowed";
}

function failure(
  item: SourceCollectionWorkItem,
  accessStartedAt: string,
  accessFinishedAt: string,
  state: "not_found" | "access_denied" | "login_required" | "verification_required" | "rate_limited" | "source_abnormal",
) {
  return sourceCollectionProviderResultSchema.parse({
    accessStartedAt,
    accessFinishedAt,
    observation: { requestedUrl: item.requestedUrl, observedAt: accessFinishedAt, state, failureCode: state },
    relations: [],
    stopRun: state !== "not_found",
  });
}

function failureState(error: unknown) {
  if (!(error instanceof SourceAccessError)) return "source_abnormal" as const;
  if (error.code === "evidence_not_found") return "not_found" as const;
  if (error.code === "origin_not_allowed") return "source_abnormal" as const;
  return error.code;
}

function register(active: Map<string, Set<AbortController>>, runId: string) {
  const controller = new AbortController();
  const controllers = active.get(runId) ?? new Set<AbortController>();
  controllers.add(controller);
  active.set(runId, controllers);
  return controller;
}

function unregister(active: Map<string, Set<AbortController>>, runId: string, controller: AbortController) {
  const controllers = active.get(runId);
  controllers?.delete(controller);
  if (controllers?.size === 0) active.delete(runId);
}
