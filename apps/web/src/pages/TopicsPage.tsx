import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { createTopic, deleteTopic, fetchQueries, fetchTopics, updateTopic, type Topic } from "../lib/api";
import { formatDateTime, humanizeStatus } from "../lib/format";
import { PageHeader } from "./PageHeader";

export function TopicsPage({
  workspaceTopicId,
  onWorkspaceTopicChange
}: {
  workspaceTopicId: string;
  onWorkspaceTopicChange: (topicId: string) => void;
}) {
  const queryClient = useQueryClient();
  const topicsQuery = useQuery({ queryKey: ["topics"], queryFn: fetchTopics });
  const queryLookups = useQueries({
    queries:
      topicsQuery.data?.map((topic) => ({
        queryKey: ["queries", topic.id],
        queryFn: () => fetchQueries(topic.id)
      })) ?? []
  });
  const createMutation = useMutation({
    mutationFn: createTopic,
    onSuccess: (topic) => {
      queryClient.invalidateQueries({ queryKey: ["topics"] });
      onWorkspaceTopicChange(topic.id);
    }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Topic["status"] }) => updateTopic(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["topics"] })
  });
  const deleteMutation = useMutation({
    mutationFn: deleteTopic,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["topics"] })
  });
  const [form, setForm] = useState({
    name: "",
    description: "",
    language: "en",
    market: "US"
  });

  function submitTopic(event: FormEvent) {
    event.preventDefault();
    createMutation.mutate({
      name: form.name,
      description: form.description || undefined,
      language: form.language,
      market: form.market
    });
    setForm((current) => ({ ...current, name: "", description: "" }));
  }

  return (
    <section>
      <PageHeader
        title="Topics"
        description="Create and manage the main analysis units for trends, brands, products, markets, or content directions."
      />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <form onSubmit={submitTopic} className="rounded-md border border-line bg-panel p-4">
          <h2 className="text-sm font-semibold">Create Topic</h2>
          <div className="mt-4 space-y-3">
            <Field label="Name">
              <input
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Description">
              <textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                className="min-h-24 w-full rounded border border-line bg-surface px-3 py-2 text-sm"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Language">
                <input
                  required
                  value={form.language}
                  onChange={(event) => setForm({ ...form, language: event.target.value })}
                  className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Market">
                <input
                  required
                  value={form.market}
                  onChange={(event) => setForm({ ...form, market: event.target.value })}
                  className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
                />
              </Field>
            </div>
            <button
              type="submit"
              className="w-full rounded bg-ink px-3 py-2 text-sm font-medium text-surface"
            >
              Create
            </button>
          </div>
        </form>
        <div className="rounded-md border border-line bg-surface">
          <ListState loading={topicsQuery.isLoading} error={topicsQuery.isError} empty={!topicsQuery.data?.length}>
            <div className="divide-y divide-line">
              {topicsQuery.data?.map((topic) => (
                <article key={topic.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">{topic.name}</h2>
                      <p className="mt-2 text-sm text-muted">{topic.description || "No description"}</p>
                    </div>
                    <span className="rounded border border-line px-2 py-1 text-xs text-muted">
                      {humanizeStatus(topic.status)}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                    <Fact label="Market" value={`${topic.market} · ${topic.language.toUpperCase()}`} />
                    <Fact label="Queries" value={String(queryCountForTopic(queryLookups, topic.id))} />
                    <Fact label="Updated" value={formatDateTime(topic.updatedAt)} />
                    <Fact label="Next Step" value={queryCountForTopic(queryLookups, topic.id) ? "Run a crawl" : "Create a query"} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {workspaceTopicId !== topic.id ? (
                      <button
                        type="button"
                        onClick={() => onWorkspaceTopicChange(topic.id)}
                        className="rounded border border-line px-3 py-1.5 text-xs"
                      >
                        Use as working topic
                      </button>
                    ) : (
                      <span className="rounded border border-ink px-3 py-1.5 text-xs">Current working topic</span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        updateMutation.mutate({
                          id: topic.id,
                          status: topic.status === "active" ? "paused" : "active"
                        })
                      }
                      className="rounded border border-line px-3 py-1.5 text-xs"
                    >
                      {topic.status === "active" ? "Pause" : "Activate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(topic.id)}
                      className="rounded border border-line px-3 py-1.5 text-xs text-muted"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </ListState>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

function queryCountForTopic(
  lookups: Array<{ data?: Array<{ topicId: string }> }>,
  topicId: string
) {
  return lookups.flatMap((lookup) => lookup.data ?? []).filter((query) => query.topicId === topicId).length;
}

function ListState({
  loading,
  error,
  empty,
  children
}: {
  loading: boolean;
  error: boolean;
  empty: boolean;
  children: React.ReactNode;
}) {
  if (loading) return <div className="p-6 text-sm text-muted">Loading topics</div>;
  if (error) return <div className="p-6 text-sm text-muted">Failed to load topics</div>;
  if (empty) return <div className="p-6 text-sm text-muted">No topics yet</div>;
  return children;
}
