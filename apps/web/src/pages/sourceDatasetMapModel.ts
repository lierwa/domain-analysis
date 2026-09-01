import type {
  SourceCaptureWorkItem,
  SourceCollectionBatch,
  SourceCollectionRun,
  SourceDatasetBrandSummary,
  SourceDatasetIssueSummary,
  SourceDatasetModelSummary,
  SourceDatasetPlanSource,
  SourceDatasetTaskView,
} from "@domain-analysis/shared";

import { normalizeMapText as normalize } from "./sourceDatasetMapLabels";

export type SourceDataMapMode = "product" | "audit";
export type SourceDataMapLineMode = "polyline" | "curve";
export type SourceDataMapNodeKind = "task" | "collection" | "brand" | "model" | "resource"
  | "source" | "batch" | "run" | "audit_group";
export type SourceDataMapStatus = "neutral" | "attention" | "unknown" | "unresolved";
type ResourceKind = NonNullable<SourceCaptureWorkItem["resourceKind"]>;

export type SourceDataMapEntity =
  | { kind: "task"; taskId: string; taskName: string; category?: string }
  | { kind: "collection"; title: string; description: string; itemCount: number }
  | { kind: "brand"; brand: SourceDatasetBrandSummary }
  | { kind: "model"; brand: SourceDatasetBrandSummary; model: SourceDatasetModelSummary;
    issues: SourceDatasetIssueSummary[] }
  | { kind: "resource"; brand: SourceDatasetBrandSummary; model: SourceDatasetModelSummary;
    resourceKind: ResourceKind; count: number }
  | { kind: "source"; source: SourceDatasetPlanSource; runCount: number }
  | { kind: "batch"; batch: SourceCollectionBatch; runs: SourceCollectionRun[] }
  | { kind: "run"; run: SourceCollectionRun }
  | { kind: "audit_group"; run: SourceCollectionRun; title: string; count: number };

export type SourceDataMapNode = {
  id: string;
  kind: SourceDataMapNodeKind;
  title: string;
  eyebrow: string;
  description?: string;
  meta?: string;
  status: SourceDataMapStatus;
  expandable: boolean;
  searchText: string;
  entity: SourceDataMapEntity;
};

export type SourceDataMapEdge = { id: string; source: string; target: string; sourceHandle?: string };
export type SourceDataMapGraph = {
  rootId: string;
  nodes: SourceDataMapNode[];
  edges: SourceDataMapEdge[];
  planId?: string;
  planVersion?: number;
  stats: { sourceCount: number; recordCount: number; acceptedCount: number; attentionCount: number;
    lineageCount: number; unresolvedBrandCount: number; historicalRecordCount: number };
};
export type VisibleSourceDataMapGraph = { nodes: Array<SourceDataMapNode & {
  searchMatched?: boolean; inlineChildren?: SourceDataMapNode[]; recordsVisible?: boolean;
}>; edges: SourceDataMapEdge[] };

export function buildSourceDataGraph(view: SourceDatasetTaskView,
  task: { id: string; name: string; category?: string }, mode: SourceDataMapMode): SourceDataMapGraph {
  const rootId = `task:${task.id}`;
  const current = view.currentExecution;
  const graph: SourceDataMapGraph = { rootId, nodes: [], edges: [],
    planVersion: current?.planVersion,
    stats: { sourceCount: mode === "product" ? view.capturedBrands.length : view.sources.length,
      recordCount: current?.snapshotCount ?? 0, acceptedCount: current?.completedModelCount ?? 0,
      attentionCount: current?.issueCount ?? 0, lineageCount: current?.snapshotCount ?? 0,
      unresolvedBrandCount: 0,
      historicalRecordCount: view.batches.slice(1).reduce((sum, batch) => sum
        + view.runs.filter((run) => run.executionBatchId === batch.id)
          .reduce((count, run) => count + run.snapshotCount, 0), 0) } };
  addNode(graph, { id: rootId, kind: "task", title: task.name, eyebrow: mode === "product" ? "采集任务" : "运行审计",
    description: task.category,
    meta: current ? mode === "product"
      ? `${current.brandCount} 个品牌 · ${current.modelCount} 个型号 · ${current.needsAttentionModelCount} 个型号需关注`
      : `${view.batches.length} 个 Batch · ${view.runs.length} 个 Run` : "尚无 Source Batch",
    status: "neutral", expandable: false, searchText: normalize([task.name, task.category].join(" ")),
    entity: { kind: "task", taskId: task.id, taskName: task.name, category: task.category } });
  if (mode === "product") addProductTree(graph, view, rootId);
  else addAuditTree(graph, view, rootId);
  return graph;
}

function addProductTree(graph: SourceDataMapGraph, view: SourceDatasetTaskView, rootId: string) {
  for (const brand of view.capturedBrands) {
    const id = `brand:${brand.subjectId}`;
    addNode(graph, { id, kind: "brand", title: brand.displayName, eyebrow: "品牌",
      meta: `${brand.counts.completed}/${brand.counts.total} 个型号完成${brand.counts.needsAttention > 0
        ? ` · ${brand.counts.needsAttention} 个需关注` : ""}`,
      status: "neutral", expandable: brand.models.length > 0,
      searchText: normalize(`${brand.displayName} ${brand.sourceEntityId}`), entity: { kind: "brand", brand } });
    addEdge(graph, rootId, id);
    for (const model of brand.models) addModelBranch(graph, view, brand, model, id);
  }
}

function addModelBranch(graph: SourceDataMapGraph, view: SourceDatasetTaskView,
  brand: SourceDatasetBrandSummary, model: SourceDatasetModelSummary, brandId: string) {
  const id = `model:${model.subjectId}`;
  const issues = view.issues.filter((issue) => issue.subjectId === model.subjectId);
  const sourceHasNoImages = model.status === "completed" && model.resources.images === 0;
  addNode(graph, { id, kind: "model", title: model.displayName, eyebrow: "型号",
    description: `源站型号 ${model.sourceEntityId}`,
    meta: `${resourceTotal(model)} 条资源${sourceHasNoImages ? " · 来源无图片" : ""}${model.issueCount > 0
      ? ` · ${model.issueCount} 个问题` : ""}`,
    status: model.status === "needs_attention" ? "attention" : "neutral", expandable: resourceTotal(model) > 0,
    searchText: normalize(`${brand.displayName} ${model.displayName} ${model.sourceEntityId}`),
    entity: { kind: "model", brand, model, issues } });
  addEdge(graph, brandId, id);
  for (const [kind, count] of resourceEntries(model)) {
    if (count === 0) continue;
    const resourceId = `${id}:resource:${kind}`;
    addNode(graph, { id: resourceId, kind: "resource", title: resourceKindLabel(kind), eyebrow: "原始资源",
      description: "展开后按页读取不可变原始记录", meta: `${count} 条`, status: "neutral",
      expandable: true, searchText: normalize(`${model.displayName} ${resourceKindLabel(kind)} ${kind}`),
      entity: { kind: "resource", brand, model, resourceKind: kind, count } });
    addEdge(graph, id, resourceId);
  }
}

function addAuditTree(graph: SourceDataMapGraph, view: SourceDatasetTaskView, rootId: string) {
  const sources = view.sources.filter((source) => source.planStatus === "confirmed");
  for (const source of sources) {
    const id = `source:${source.planId}:${source.planVersion}:${source.sourceKey}`;
    const batches = view.batches.filter((batch) => batch.sourceCollectionPlanId === source.planId
      && batch.sourceCollectionPlanVersion === source.planVersion);
    const runs = view.runs.filter((run) => run.sourceCollectionPlanId === source.planId
      && run.sourceCollectionPlanVersion === source.planVersion
      && run.sourceCollectionPlanSourceKey === source.sourceKey);
    addNode(graph, { id, kind: "source", title: source.name, eyebrow: "计划来源", description: source.role,
      meta: `${batches.length} 个 Batch · ${runs.length} 个 Run`, status: "neutral", expandable: batches.length > 0,
      searchText: normalize(`${source.name} ${source.sourceKey} ${source.role ?? ""}`),
      entity: { kind: "source", source, runCount: runs.length } });
    addEdge(graph, rootId, id);
    for (const batch of batches) addBatchBranch(graph, batch,
      runs.filter((run) => run.executionBatchId === batch.id), id);
  }
}

function addBatchBranch(graph: SourceDataMapGraph, batch: SourceCollectionBatch,
  runs: SourceCollectionRun[], sourceId: string) {
  const id = `batch:${batch.id}`;
  addNode(graph, { id, kind: "batch", title: `Batch · ${shortId(batch.id)}`, eyebrow: "执行批次",
    description: `计划 v${batch.sourceCollectionPlanVersion}`, meta: `${runs.length} 个 Run · ${batch.status}`,
    status: batch.status === "failed" || batch.status === "partial" ? "attention" : "neutral",
    expandable: runs.length > 0, searchText: normalize(`${batch.id} ${batch.status}`),
    entity: { kind: "batch", batch, runs } });
  addEdge(graph, sourceId, id);
  for (const run of runs) {
    const runId = `run:${run.id}`;
    addNode(graph, { id: runId, kind: "run", title: `Run · ${shortId(run.id)}`, eyebrow: "来源运行",
      meta: `${run.snapshotCount} 快照 · ${run.assetCount} 图片`,
      status: run.status === "failed" ? "attention" : "neutral", expandable: run.snapshotCount > 0,
      searchText: normalize(`${run.id} ${run.status}`), entity: { kind: "run", run } });
    addEdge(graph, id, runId);
    addAuditGroup(graph, run, runId, "原始快照", run.snapshotCount);
    addAuditGroup(graph, run, runId, "图片附件", run.assetCount);
  }
}

function addAuditGroup(graph: SourceDataMapGraph, run: SourceCollectionRun,
  runId: string, title: string, count: number) {
  if (count === 0) return;
  const id = `${runId}:audit:${title}`;
  addNode(graph, { id, kind: "audit_group", title, eyebrow: "原始记录组", meta: `${count} 条`,
    status: "neutral", expandable: false, searchText: normalize(`${title} ${run.id}`),
    entity: { kind: "audit_group", run, title, count } });
  addEdge(graph, runId, id);
}

export function visibleSourceDataGraph(graph: SourceDataMapGraph, expanded: ReadonlySet<string>, rawQuery: string) {
  const query = normalize(rawQuery);
  if (!query) return visibleExpandedGraph(graph, expanded);
  const matched = graph.nodes.filter((node) => node.searchText.includes(query)).slice(0, 80);
  const visibleIds = new Set(matched.map((node) => node.id));
  const incoming = groupIncomingEdges(graph.edges);
  const queue = [...visibleIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of incoming.get(id) ?? []) if (!visibleIds.has(edge.source)) {
      visibleIds.add(edge.source); queue.push(edge.source);
    }
  }
  visibleIds.add(graph.rootId);
  const matchedIds = new Set(matched.map((node) => node.id));
  return { nodes: graph.nodes.filter((node) => visibleIds.has(node.id))
    .map((node) => ({ ...node, searchMatched: matchedIds.has(node.id) })),
  edges: graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)) };
}

export function initialSourceDataMapExpansion(_graph: SourceDataMapGraph) {
  // WHY：品牌摘要已经提供全局完成度；详情必须由负责人主动展开，避免 247 个型号首屏同时进入布局。
  return new Set<string>();
}

export function sourceDataMapExpansionPath(graph: SourceDataMapGraph, nodeId: string) {
  const incoming = new Map(graph.edges.map((edge) => [edge.target, edge.source]));
  const path = new Set<string>();
  let current: string | undefined = nodeId;
  while (current && current !== graph.rootId) { path.add(current); current = incoming.get(current); }
  return path;
}

function visibleExpandedGraph(graph: SourceDataMapGraph, expanded: ReadonlySet<string>) {
  const visibleNodes = new Map<string, VisibleSourceDataMapGraph["nodes"][number]>();
  const visibleEdges = new Map<string, SourceDataMapEdge>();
  const outgoing = groupOutgoingEdges(graph.edges);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const context = { expanded, nodeById, outgoing, visibleNodes, visibleEdges };
  const root = nodeById.get(graph.rootId);
  if (!root) return { nodes: [], edges: [] };
  visibleNodes.set(root.id, root);
  for (const edge of outgoing.get(root.id) ?? []) {
    const child = nodeById.get(edge.target);
    if (!child) continue;
    addVisibleEdge(context, edge); addVisibleNode(context, child); revealVisibleChildren(context, child);
  }
  return { nodes: [...visibleNodes.values()], edges: [...visibleEdges.values()] };
}

type VisibleContext = { expanded: ReadonlySet<string>; nodeById: Map<string, SourceDataMapNode>;
  outgoing: Map<string, SourceDataMapEdge[]>; visibleNodes: Map<string, VisibleSourceDataMapGraph["nodes"][number]>;
  visibleEdges: Map<string, SourceDataMapEdge> };

function revealVisibleChildren(context: VisibleContext, node: SourceDataMapNode) {
  if (!context.expanded.has(node.id)) return;
  if (node.kind === "resource") {
    context.visibleNodes.set(node.id, { ...node, recordsVisible: true }); return;
  }
  const children = childNodes(context, node.id);
  if (children.length === 0) return;
  if (children.length === 1) {
    const child = children[0]!;
    addVisibleNode(context, child);
    addVisibleEdge(context, { id: `${node.id}->${child.id}`, source: node.id, target: child.id });
    revealVisibleChildren(context, child);
    return;
  }
  const list = childListNode(node, children);
  context.visibleNodes.set(list.id, list);
  addVisibleEdge(context, { id: `${node.id}->${list.id}`, source: node.id, target: list.id });
  for (const child of children) revealFromListRow(context, list.id, child);
}

function revealFromListRow(context: VisibleContext, listId: string, row: SourceDataMapNode) {
  if (!context.expanded.has(row.id)) return;
  if (row.kind === "resource") {
    const records = { ...row, id: `records:${row.id}`, recordsVisible: true, expandable: false };
    context.visibleNodes.set(records.id, records);
    addVisibleEdge(context, { id: `${listId}::${row.id}->${records.id}`,
      source: listId, sourceHandle: row.id, target: records.id });
    return;
  }
  const children = childNodes(context, row.id);
  if (children.length === 0) return;
  const list = childListNode(row, children);
  context.visibleNodes.set(list.id, list);
  addVisibleEdge(context, { id: `${listId}::${row.id}->${list.id}`,
    source: listId, sourceHandle: row.id, target: list.id });
  for (const child of children) revealFromListRow(context, list.id, child);
}

function childListNode(owner: SourceDataMapNode, children: SourceDataMapNode[]) {
  const description = `${children[0]?.eyebrow ?? "下一级"}列表`;
  return { id: `list:${owner.id}`, kind: "collection" as const, title: owner.title, eyebrow: description,
    description, meta: `${children.length} 项`, status: aggregateStatus(children), expandable: false,
    searchText: [owner.searchText, ...children.map((child) => child.searchText)].join(" "),
    entity: { kind: "collection" as const, title: owner.title, description, itemCount: children.length },
    inlineChildren: children };
}

function childNodes(context: VisibleContext, id: string) {
  return (context.outgoing.get(id) ?? []).flatMap((edge) => {
    const child = context.nodeById.get(edge.target); return child ? [child] : [];
  });
}

function addVisibleNode(context: VisibleContext, node: VisibleSourceDataMapGraph["nodes"][number]) {
  context.visibleNodes.set(node.id, node);
}
function addVisibleEdge(context: VisibleContext, edge: SourceDataMapEdge) { context.visibleEdges.set(edge.id, edge); }
function aggregateStatus(nodes: SourceDataMapNode[]): SourceDataMapStatus {
  return nodes.some((node) => node.status === "attention") ? "attention" : "neutral";
}
function addNode(graph: SourceDataMapGraph, node: SourceDataMapNode) { graph.nodes.push(node); }
function addEdge(graph: SourceDataMapGraph, source: string, target: string) {
  graph.edges.push({ id: `${source}->${target}`, source, target });
}
function groupIncomingEdges(edges: SourceDataMapEdge[]) {
  const grouped = new Map<string, SourceDataMapEdge[]>();
  for (const edge of edges) grouped.set(edge.target, [...(grouped.get(edge.target) ?? []), edge]);
  return grouped;
}
function groupOutgoingEdges(edges: SourceDataMapEdge[]) {
  const grouped = new Map<string, SourceDataMapEdge[]>();
  for (const edge of edges) grouped.set(edge.source, [...(grouped.get(edge.source) ?? []), edge]);
  return grouped;
}
function resourceTotal(model: SourceDatasetModelSummary) {
  return Object.values(model.resources).reduce((sum, count) => sum + count, 0);
}
function resourceEntries(model: SourceDatasetModelSummary): Array<[ResourceKind, number]> {
  return [["parameters", model.resources.parameterPages], ["gallery", model.resources.galleryPages],
    ["picture_set", model.resources.pictureSets], ["image", model.resources.images]];
}
export function resourceKindLabel(kind: ResourceKind) {
  return ({ brand_catalog: "品牌目录", model_bundle: "型号入口", parameters: "参数页",
    gallery: "图集页", picture_set: "图片分组", image: "图片" } as const)[kind];
}
function shortId(value: string) { return value.slice(-8); }
