import {
  sourceCollectionProviderResultSchema,
  type SourceCollectionProviderPort,
  type SourceCollectionWorkItem,
} from "@domain-analysis/shared";

import type { EnergyLabelRecordSource } from "./energyLabelRecordSource";
import { SourceAccessError } from "./sourceAccessError";

export interface EnergyLabelSourceCollectionProviderOptions {
  source: EnergyLabelRecordSource;
  now?: () => Date;
}

export function createEnergyLabelSourceCollectionProvider(
  options: EnergyLabelSourceCollectionProviderOptions,
): SourceCollectionProviderPort {
  const active = new Map<string, Set<AbortController>>();
  const now = options.now ?? (() => new Date());
  return {
    collect: async ({ sourceRun, item, abortSignal }) => {
      const startedAt = now().toISOString();
      const lookup = modelLookup(item);
      if (!lookup || !canPersist(item)) {
        return failure(item, startedAt, now().toISOString(), "source_abnormal");
      }
      const controller = register(active, sourceRun.id);
      const signal = abortSignal
        ? AbortSignal.any([abortSignal, controller.signal])
        : controller.signal;
      try {
        const capture = await options.source.captureByModel({
          productModel: lookup.value,
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
            title: `中国能效标识备案：${lookup.value}`,
            fieldGroups: [],
            // TRADE-OFF：首轮来源层保留官方 JSON 原文，不在 Provider 中另造监管字段字典。
            blocks: [{
              kind: "text",
              role: "other",
              text: capture.content,
              locator: capture.locator,
            }],
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

function modelLookup(item: SourceCollectionWorkItem) {
  if (item.request?.kind !== "structured_record_lookup" || item.request.fields.length !== 1) return null;
  const field = item.request.fields[0]!;
  return field.code === "manufacturer_model"
    ? { ...field, maximumBytes: item.request.maximumBytes }
    : null;
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
