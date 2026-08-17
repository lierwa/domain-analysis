import {
  materializeSourceEvidenceInputSchema,
  type EvidenceCandidate,
  type EvidenceItem,
  type EvidenceRequest,
  type MaterializeSourceEvidenceInput,
  type SourceEvidenceSelection,
  type SourceSnapshotRecord,
} from "@domain-analysis/shared";

import { contentHash } from "./contentHash";
import type { EvidenceModule } from "./evidenceModule";
import { EvidenceError } from "./evidenceModule";
import type { SourceDatasetModule } from "./sourceDatasetModule";

export interface SourceEvidenceModule {
  materialize(input: MaterializeSourceEvidenceInput): Promise<EvidenceItem>;
}

export function createSourceEvidenceModule(
  sourceDatasets: Pick<SourceDatasetModule, "getRun" | "getSnapshot">,
  evidence: Pick<EvidenceModule, "getRequest" | "recordObservation" | "commit">,
): SourceEvidenceModule {
  return {
    materialize: async (rawInput) => {
      const input = materializeSourceEvidenceInputSchema.parse(rawInput);
      const [request, record] = await Promise.all([
        evidence.getRequest(input.requestId),
        sourceDatasets.getSnapshot(input.snapshotId),
      ]);
      if (!request) throw new EvidenceError("not_found", `证据请求不存在：${input.requestId}`);
      if (!record) throw new EvidenceError("not_found", `来源快照不存在：${input.snapshotId}`);
      const runView = await sourceDatasets.getRun(record.snapshot.runId);
      if (!runView) throw new EvidenceError("not_found", `来源运行不存在：${record.snapshot.runId}`);
      validateBinding(request, record, runView.run.collectionLaneId);
      const selected = selectEvidence(record, input.selection);
      const subjectKeys = request.targetKeys.filter((key) => record.snapshot.targetKeys?.includes(key));
      const observation = await evidence.recordObservation({
        requestId: request.id,
        sourceSnapshotId: record.snapshot.id,
        subjectKeys,
        sourceIdentity: record.object.sourceIdentity,
        sourceAuthorityType: runView.run.sourceAuthorityType,
        usagePermission: record.snapshot.usagePermission,
        ...record.snapshot.observation,
      });
      return evidence.commit({
        requestId: request.id,
        observationId: observation.id,
        idempotencyKey: `source-selection-${contentHash(input)}`,
        kind: selected.locator.kind,
        mediaType: "text/plain;charset=utf-8",
        privacyClass: record.snapshot.usagePermission.sourceRedistribution === "allowed"
          ? "public"
          : "restricted",
        subjectKeys,
        relationProof: selected.relationProof,
        locator: selected.locator,
      }, new TextEncoder().encode(selected.content));
    },
  };
}

function validateBinding(
  request: EvidenceRequest,
  record: SourceSnapshotRecord,
  collectionLaneId: string,
) {
  const snapshot = record.snapshot;
  if (record.object.projectId !== request.projectId) reject("来源快照与证据请求不属于同一项目");
  if (snapshot.observation.state !== "accessible" || !snapshot.content) {
    reject("只有可访问且有内容的来源快照可以形成证据");
  }
  if (!snapshot.targetKeys || request.targetKeys.every((key) => !snapshot.targetKeys!.includes(key))) {
    reject("来源快照没有覆盖证据请求目标");
  }
  if (!snapshot.knowledgeNeedIds?.includes(request.knowledgeNeed.id)) {
    reject("来源快照没有绑定该知识需求");
  }
  if (!request.collectionLaneIds.includes(collectionLaneId)) {
    reject("来源运行路线不属于证据请求");
  }
  if (snapshot.usagePermission.evidenceStorage !== "allowed") {
    reject("来源许可不允许保存最小证据");
  }
}

function selectEvidence(record: SourceSnapshotRecord, selection: SourceEvidenceSelection) {
  const content = record.snapshot.content!;
  if (selection.kind === "ordered_field") {
    if (content.kind !== "ordered_record") reject("字段选择只能用于 ordered_record");
    const group = content.fieldGroups[selection.groupIndex];
    const field = group?.fields[selection.fieldIndex];
    if (!group || !field) reject("字段选择超出来源内容范围");
    const prefix = `${group.label}\n${field.name}: `;
    const suffix = field.unit ? ` ${field.unit}` : undefined;
    return {
      content: `${prefix}${field.value}${suffix ?? ""}`,
      locator: {
        kind: "web_text" as const,
        quote: { prefix, exact: field.value, ...(suffix ? { suffix } : {}) },
        structuralHint: `fieldGroups[${selection.groupIndex}].fields[${selection.fieldIndex}]`,
      },
      relationProof: {
        method: "structured_data" as const,
        detail: `来源快照 ${record.snapshot.id} 的有序字段`,
      },
    };
  }
  const block = selectedTextBlock(content, selection);
  const locator = block.locator ?? quoteLocator(selection, block.text);
  const selectedContent = `${locator.quote.prefix ?? ""}${locator.quote.exact}${locator.quote.suffix ?? ""}`;
  if (!block.text.includes(selectedContent)) reject("所选 TextQuote 不存在于来源文本块");
  return {
    content: selectedContent,
    locator,
    relationProof: {
      method: content.kind === "document" ? "document_identity" as const : "structured_data" as const,
      detail: `来源快照 ${record.snapshot.id} 的文本块`,
    },
  };
}

function selectedTextBlock(
  content: NonNullable<SourceSnapshotRecord["snapshot"]["content"]>,
  selection: Exclude<SourceEvidenceSelection, { kind: "ordered_field" }>,
) {
  const block = selection.kind === "ordered_text_block"
    ? content.kind === "ordered_record" ? content.blocks[selection.blockIndex] : undefined
    : content.kind === "document"
      ? content.sections[selection.sectionIndex]?.blocks[selection.blockIndex]
      : undefined;
  if (!block || block.kind !== "text") reject("文本块选择超出来源内容范围或不是文本");
  return block;
}

function quoteLocator(
  selection: Exclude<SourceEvidenceSelection, { kind: "ordered_field" }>,
  blockText: string,
) {
  if (!selection.quote) reject("没有 Provider locator 的文本块必须显式选择 TextQuote");
  return {
    kind: "web_text" as const,
    quote: selection.quote,
    structuralHint: selection.kind === "ordered_text_block"
      ? `blocks[${selection.blockIndex}]`
      : `sections[${selection.sectionIndex}].blocks[${selection.blockIndex}]`,
  };
}

function reject(message: string): never {
  throw new EvidenceError("candidate_rejected", message);
}
