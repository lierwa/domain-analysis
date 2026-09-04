import { knowledgeAiReviewSchema, knowledgeCapabilitiesSchema, knowledgeDecisionSchema,
  knowledgePackSchema, knowledgePackViewSchema, knowledgeRunSchema, knowledgeRunViewSchema, knowledgeVersionSchema,
  type KnowledgeBatchRef, type KnowledgeReviewRequest } from "@domain-analysis/shared";
import { z } from "zod";
import { buildQueryString, request } from "./apiClient";

export const packUrl = (id: string) => `/api/knowledge-packs/${encodeURIComponent(id)}`;
export const runUrl = (packId: string, runId: string) => `${packUrl(packId)}/runs/${encodeURIComponent(runId)}`;
export const imageUrl = (packId: string, runId: string, itemId: string) => `${runUrl(packId, runId)}/items/${encodeURIComponent(itemId)}/image`;
export const versionUrl = (packId: string, versionId: string, path?: string) =>
  `${packUrl(packId)}/versions/${encodeURIComponent(versionId)}/files${buildQueryString({ path })}`;

async function item<S extends z.ZodTypeAny>(url: string, schema: S, method?: string, value?: unknown): Promise<z.infer<S>> {
  const result = await request<{ item: unknown }>(url, { method, body: value === undefined ? undefined : JSON.stringify(value) });
  return schema.parse(result.item);
}
export const knowledgeApi = {
  capabilities: () => item("/api/knowledge-processing/capabilities", knowledgeCapabilitiesSchema),
  async list() { return z.array(knowledgePackSchema).parse((await request<{ items: unknown }>("/api/knowledge-packs")).items); },
  create: (name: string, skillName: string, scope: string) => item("/api/knowledge-packs", knowledgePackSchema, "POST", { name, skillName, scope }),
  get: (id: string) => item(packUrl(id), knowledgePackViewSchema),
  select: (id: string, expectedRevision: number, skillName: string, selection: KnowledgeBatchRef[]) =>
    item(`${packUrl(id)}/selection`, knowledgePackSchema, "PUT", { expectedRevision, skillName, selection }),
  start: (id: string, expectedRevision: number) => item(`${packUrl(id)}/runs`, knowledgeRunSchema, "POST", { expectedRevision }),
  run: (id: string, runId: string) => item(runUrl(id, runId), knowledgeRunViewSchema),
  stop: (id: string, runId: string) => item(`${runUrl(id, runId)}/stop`, knowledgeRunSchema, "POST"),
  retry: (id: string, runId: string, expectedGeneration: number) =>
    item(`${runUrl(id, runId)}/retry`, knowledgeRunSchema, "POST", { expectedGeneration }),
  review: (id: string, runId: string, value: KnowledgeReviewRequest) => item(`${runUrl(id, runId)}/reviews`, knowledgeDecisionSchema, "POST", value),
  aiReview: (id: string, runId: string, expectedRevision: number) =>
    item(`${runUrl(id, runId)}/ai-review`, knowledgeAiReviewSchema, "POST", { expectedRevision }),
  build: (id: string, runId: string, expectedRevision: number) =>
    item(`${runUrl(id, runId)}/versions`, knowledgeVersionSchema, "POST", { expectedRevision }),
  publish: (id: string, versionId: string, expectedRevision: number) =>
    item(`${packUrl(id)}/versions/${encodeURIComponent(versionId)}/publish`, knowledgeVersionSchema, "POST", { expectedRevision }),
};
