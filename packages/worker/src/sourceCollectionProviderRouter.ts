import {
  sourceCollectionProviderResultSchema,
  type SourceCollectionProviderPort,
} from "@domain-analysis/shared";

export function createSourceCollectionProviderRouter(
  providers: Readonly<Record<string, SourceCollectionProviderPort>>,
): SourceCollectionProviderPort {
  const active = new Map<string, SourceCollectionProviderPort>();
  return {
    collect: async (context) => {
      const provider = providers[context.sourceRun.providerKey];
      if (!provider) {
        const observedAt = new Date().toISOString();
        return sourceCollectionProviderResultSchema.parse({
          accessStartedAt: observedAt,
          accessFinishedAt: observedAt,
          observation: {
            requestedUrl: context.item.requestedUrl,
            observedAt,
            state: "source_abnormal",
            failureCode: "source_abnormal",
          },
          relations: [],
          stopRun: true,
        });
      }
      active.set(context.sourceRun.id, provider);
      try {
        return await provider.collect(context);
      } finally {
        active.delete(context.sourceRun.id);
      }
    },
    cancel: (sourceRunId, reason) => {
      active.get(sourceRunId)?.cancel(sourceRunId, reason);
    },
  };
}
