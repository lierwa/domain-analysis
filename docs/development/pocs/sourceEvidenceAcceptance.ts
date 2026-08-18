import type {
  EvidenceKind,
  EvidenceRequestDraft,
  ProductProjectView,
  SourceCollectionPipelineRun,
  SourceSnapshotRecord,
} from "@domain-analysis/shared";
import type { openProductKnowledgeWorkbench } from "@domain-analysis/workbench";
import type {
  SourceCollectionPipelineModule,
  SourceCollectionPlanExecution,
} from "@domain-analysis/workbench";

type ProductKnowledgeWorkbench = Awaited<ReturnType<typeof openProductKnowledgeWorkbench>>;

type AcceptanceEvidenceRequest = Pick<EvidenceRequestDraft,
  "collectionLaneIds" | "knowledgeNeed" | "question" | "knowledgeLayer" | "targetKeys"
  | "allowedSourceAuthorityTypes"> & {
    acceptedEvidenceKind?: EvidenceKind;
    evidencePolicyVersion: string;
  };

export function createAcceptanceEvidenceRequest(
  workbench: ProductKnowledgeWorkbench,
  project: ProductProjectView,
  input: AcceptanceEvidenceRequest,
) {
  const {
    acceptedEvidenceKind = "web_text",
    evidencePolicyVersion,
    ...requestScope
  } = input;
  const evidenceContract = acceptedEvidenceKind === "document_excerpt"
    ? {
      acceptedEvidenceKinds: ["document_excerpt" as const],
      evidenceByteLimits: { document_excerpt: 256 * 1024 },
    }
    : {
      acceptedEvidenceKinds: ["web_text" as const],
      evidenceByteLimits: { web_text: 32_000 },
    };
  return workbench.evidence.createRequest({
    projectId: project.project.id,
    categoryDefinitionVersionId: project.categoryDefinition.id,
    confirmedScopeVersionId: project.confirmedScope.id,
    collectionBoardVersionId: project.collectionBoard.id,
    ...requestScope,
    ...evidenceContract,
    freshness: { maxAgeDays: 3650 },
    minimumEvidenceItemsPerTarget: 1,
    minimumDistinctSourcesPerTarget: 1,
    evidencePolicyVersion,
    stopConditions: ["access_denied", "source_abnormal"],
    priority: 100,
  });
}

export function requireRecord(records: SourceSnapshotRecord[], externalKey: string) {
  const record = records.find(({ object }) => object.externalKey === externalKey);
  if (!record) throw new Error(`缺少来源快照：${externalKey}`);
  return record;
}

export async function materializeDocumentEvidence(
  workbench: ProductKnowledgeWorkbench,
  requestId: string,
  record: SourceSnapshotRecord,
  marker: string,
) {
  const content = record.snapshot.content;
  if (content?.kind !== "document") throw new Error("预期 document 来源内容");
  const block = content.sections[0]?.blocks[0];
  if (block?.kind !== "text") throw new Error("预期可定位文本块");
  return workbench.sourceEvidence.materialize({
    requestId,
    snapshotId: record.snapshot.id,
    selection: {
      kind: "document_text_block",
      sectionIndex: 0,
      blockIndex: 0,
      quote: quoteAround(block.text, marker),
    },
  });
}

export async function materializeFieldEvidence(
  workbench: ProductKnowledgeWorkbench,
  requestId: string,
  record: SourceSnapshotRecord,
  fieldName: string,
) {
  const content = record.snapshot.content;
  if (content?.kind !== "ordered_record") throw new Error("预期 ordered_record 来源内容");
  const fieldIndex = content.fieldGroups[0]?.fields.findIndex(({ name }) => name === fieldName) ?? -1;
  if (fieldIndex < 0) throw new Error(`开放数据缺少字段：${fieldName}`);
  return workbench.sourceEvidence.materialize({
    requestId,
    snapshotId: record.snapshot.id,
    selection: { kind: "ordered_field", groupIndex: 0, fieldIndex },
  });
}

export async function materializeOrderedTextEvidence(
  workbench: ProductKnowledgeWorkbench,
  requestId: string,
  record: SourceSnapshotRecord,
  blockIndex = 0,
) {
  const content = record.snapshot.content;
  if (content?.kind !== "ordered_record") throw new Error("预期 ordered_record 来源内容");
  const block = content.blocks[blockIndex];
  if (block?.kind !== "text" || !block.locator) throw new Error("有序记录缺少 Provider locator");
  return workbench.sourceEvidence.materialize({
    requestId,
    snapshotId: record.snapshot.id,
    selection: { kind: "ordered_text_block", blockIndex },
  });
}

export async function waitForTerminal(
  module: { get(id: string): Promise<SourceCollectionPipelineRun | null> },
  id: string,
  timeoutMs = 90_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await module.get(id);
    if (current && ["succeeded", "failed", "cancelled"].includes(current.lifecycleStatus)) return current;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`source pipeline timeout: ${id}`);
}

export async function settlePlannedExecution(
  module: Pick<SourceCollectionPipelineModule, "get">,
  execution: SourceCollectionPlanExecution,
) {
  if (execution.pipelineRun) {
    return (await waitForTerminal(module, execution.pipelineRun.id)).lifecycleStatus;
  }
  // WHY：Planner 的 completed Source Run 复用没有新 DBOS 执行；验收必须承认该幂等终态，
  // 同时继续拒绝 failed 或缺失运行，避免把未执行批次误报为成功。
  if (execution.status === "reused" && execution.sourceRun?.status === "completed") {
    return "reused" as const;
  }
  throw new Error(execution.error ?? `来源批次没有启动：${execution.batchKey}`);
}

function quoteAround(text: string, marker: string): {
  exact: string;
  prefix?: string;
  suffix?: string;
} {
  const markerIndex = text.toLowerCase().indexOf(marker.toLowerCase());
  if (markerIndex < 0) throw new Error(`来源正文缺少验收标记：${marker}`);
  const paragraphStart = Math.max(text.lastIndexOf("\n\n", markerIndex) + 2, markerIndex - 500);
  const nextBreak = text.indexOf("\n\n", markerIndex);
  const paragraphEnd = Math.min(nextBreak < 0 ? text.length : nextBreak, markerIndex + 1500);
  const exact = text.slice(paragraphStart, paragraphEnd).trim();
  const exactIndex = text.indexOf(exact, paragraphStart);
  const prefix = text.slice(Math.max(0, exactIndex - 80), exactIndex);
  const suffix = text.slice(exactIndex + exact.length, exactIndex + exact.length + 80);
  // WHY：最小证据必须带 exact/context 消歧；不能把整篇正文或仅有关键词当成可复核证据。
  if (!prefix && !suffix) throw new Error("TextQuote 缺少消歧上下文");
  return { exact, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) };
}
