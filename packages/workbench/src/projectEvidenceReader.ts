import {
  evidenceRequestSchema,
  projectEvidenceRequestViewSchema,
} from "@domain-analysis/shared";
import { evidenceRequests, sourceObservations, type ProductKnowledgeDb } from "@domain-analysis/db";
import { asc, eq } from "drizzle-orm";

import type { EvidenceModule } from "./evidenceModule";
import { EvidenceError } from "./evidenceError";

export async function listProjectEvidence(
  db: ProductKnowledgeDb,
  evidence: Pick<EvidenceModule, "assess" | "read">,
  projectId: string,
) {
  const rows = await db.select().from(evidenceRequests)
    .where(eq(evidenceRequests.projectId, projectId))
    .orderBy(asc(evidenceRequests.createdAt));
  return Promise.all(rows.map(async (row) => {
    const request = evidenceRequestSchema.parse(row.request);
    const assessment = await evidence.assess(request.id);
    const observations = await db.select().from(sourceObservations)
      .where(eq(sourceObservations.requestId, request.id))
      .orderBy(asc(sourceObservations.observedAt));
    const items = await Promise.all(assessment.evidenceItemIds.map(async (itemId) => {
      const result = await evidence.read(itemId);
      if (!result) throw new EvidenceError("not_found", `证据不存在：${itemId}`);
      return { item: result.item, contentText: new TextDecoder().decode(result.content) };
    }));
    return projectEvidenceRequestViewSchema.parse({
      request,
      assessment,
      sourceObservations: observations.map((row) => row.observation),
      evidenceItems: items,
    });
  }));
}
