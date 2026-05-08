import { useQuery } from "@tanstack/react-query";
import { fetchProjectCollectionPlans } from "../lib/api";
import { formatDateTime } from "../lib/format";

export function CollectionPlansPanel({ projectId }: { projectId: string }) {
  const plansQuery = useQuery({
    queryKey: ["collection-plans", projectId],
    queryFn: () => fetchProjectCollectionPlans(projectId),
    enabled: Boolean(projectId)
  });

  if (plansQuery.isLoading) return <p className="text-sm text-muted">Loading collection plans...</p>;

  const plans = plansQuery.data ?? [];
  if (plans.length === 0) {
    return (
      <div className="rounded-lg border border-line p-4 text-sm text-muted">
        No background collection plans yet. Create one after the project workflow is enabled.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {plans.map((plan) => (
        <div key={plan.id} className="rounded-lg border border-line p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{plan.name}</h3>
            <span className="rounded-full bg-panel px-2 py-0.5 text-xs">{plan.status}</span>
          </div>
          <p className="mt-2 text-xs text-muted">
            {(plan.platforms?.length ? plan.platforms : [plan.platform]).join(", ")} · {plan.cadence} · {plan.batchLimit} per batch
          </p>
          <p className="mt-1 text-xs text-muted">
            Browser: {plan.browserMode} · {plan.maxScrollsPerPlatform} scrolls · {plan.maxItemsPerPlatform} items/platform
          </p>
          <p className="mt-1 text-xs text-muted">
            Next run: {plan.nextRunAt ? formatDateTime(plan.nextRunAt) : "manual only"}
          </p>
        </div>
      ))}
    </div>
  );
}
