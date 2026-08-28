import type {
  SourceCollectionRun,
  SourceDatasetPlanBrand,
  SourceDatasetPlanSource,
} from "@domain-analysis/shared";

import { normalizeMapText as normalize, recordGroupLabel, resourceFormatLabel,
  sourceGroupDefinition, sourceKindGroup } from "./sourceDatasetMapLabels";

export type SourceDataMapMode = "brand" | "source" | "content";
export type SourceDataMapLineMode = "polyline" | "curve";
export type SourceDataMapNodeKind = "task" | "collection" | "brand" | "shared" | "topic" | "source" | "target" | "group";
export type SourceDataMapStatus = "neutral" | "attention" | "unknown" | "unresolved";
export type SourceDataMapTarget = SourceDatasetPlanSource["targets"][number];
export type SourceDataMapRecordGroup = SourceDataMapTarget["recordGroups"][number];

export type SourceDataMapEntity =
  | { kind: "task"; taskId: string; taskName: string; category?: string }
  | { kind: "collection"; title: string; description: string; itemCount: number }
  | { kind: "brand"; brand: SourceDatasetPlanBrand }
  | { kind: "shared"; sourceCount: number }
  | { kind: "topic"; topic: string; sourceCount: number }
  | { kind: "source"; source: SourceDatasetPlanSource; runs: SourceCollectionRun[]; recordCount: number }
  | { kind: "target"; source: SourceDatasetPlanSource; target: SourceDataMapTarget }
  | { kind: "group"; source: SourceDatasetPlanSource; target: SourceDataMapTarget; group: SourceDataMapRecordGroup };

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

export type SourceDataMapEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
};
export type SourceDataMapGraph = {
  rootId: string;
  nodes: SourceDataMapNode[];
  edges: SourceDataMapEdge[];
  planId?: string;
  planVersion?: number;
  stats: {
    sourceCount: number;
    recordCount: number;
    acceptedCount: number;
    attentionCount: number;
    lineageCount: number;
    unresolvedBrandCount: number;
    historicalRecordCount: number;
  };
};
export type VisibleSourceDataMapGraph = {
  nodes: Array<SourceDataMapNode & {
    searchMatched?: boolean;
    inlineChildren?: SourceDataMapNode[];
    recordsVisible?: boolean;
  }>;
  edges: SourceDataMapEdge[];
};

type BuildContext = {
  graph: SourceDataMapGraph;
  sources: SourceDatasetPlanSource[];
  runsBySource: Map<string, SourceCollectionRun[]>;
};

export function buildSourceDataGraph(view: {
  sources: SourceDatasetPlanSource[];
  brands: SourceDatasetPlanBrand[];
  runs: SourceCollectionRun[];
}, task: { id: string; name: string; category?: string }, mode: SourceDataMapMode): SourceDataMapGraph {
  const plan = currentConfirmedPlan(view);
  const sources = plan ? view.sources.filter((source) => source.planId === plan.id
    && source.planVersion === plan.version && source.planStatus === "confirmed") : [];
  const brands = plan ? view.brands.filter((brand) => brand.planId === plan.id
    && brand.planVersion === plan.version && brand.planStatus === "confirmed") : [];
  const currentRuns = plan ? view.runs.filter((run) => run.sourceCollectionPlanId === plan.id
    && run.sourceCollectionPlanVersion === plan.version) : [];
  const stats = graphStats(sources, brands, view.runs, currentRuns);
  const rootId = `task:${task.id}`;
  const graph: SourceDataMapGraph = { rootId, nodes: [], edges: [], planId: plan?.id,
    planVersion: plan?.version, stats };
  addNode(graph, { id: rootId, kind: "task", title: task.name, eyebrow: "采集任务",
    description: task.category, meta: plan ? `当前确认计划 v${plan.version}` : "尚无确认计划",
    status: plan ? "neutral" : "attention", expandable: false,
    searchText: [task.name, task.category, plan?.version].join(" "),
    entity: { kind: "task", taskId: task.id, taskName: task.name, category: task.category } });
  const context: BuildContext = { graph, sources, runsBySource: groupRunsBySource(sources, currentRuns) };
  if (mode === "brand") addBrandPerspective(context, brands, rootId);
  if (mode === "source") addSourcePerspective(context, rootId);
  if (mode === "content") addContentPerspective(context, rootId);
  addSourceDetails(context);
  return graph;
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
    for (const edge of incoming.get(id) ?? []) {
      if (visibleIds.has(edge.source)) continue;
      visibleIds.add(edge.source);
      queue.push(edge.source);
    }
  }
  visibleIds.add(graph.rootId);
  const matchedIds = new Set(matched.map((node) => node.id));
  return { nodes: graph.nodes.filter((node) => visibleIds.has(node.id))
    .map((node) => ({ ...node, searchMatched: matchedIds.has(node.id) })),
  edges: graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)) };
}

export function initialSourceDataMapExpansion(graph: SourceDataMapGraph) {
  // WHY：地图默认承担全局审阅，来源、目标与记录组一次展开；每个记录组仍只读取首批摘要行，单条正文按选择读取。
  return new Set(graph.nodes.filter((node) => node.expandable).map((node) => node.id));
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
    addVisibleEdge(context, edge);
    addVisibleNode(context, child);
    revealVisibleChildren(context, child);
  }
  return { nodes: [...visibleNodes.values()], edges: [...visibleEdges.values()] };
}

type VisibleBuildContext = {
  expanded: ReadonlySet<string>;
  nodeById: Map<string, SourceDataMapNode>;
  outgoing: Map<string, SourceDataMapEdge[]>;
  visibleNodes: Map<string, VisibleSourceDataMapGraph["nodes"][number]>;
  visibleEdges: Map<string, SourceDataMapEdge>;
};

function revealVisibleChildren(context: VisibleBuildContext, node: SourceDataMapNode) {
  if (!context.expanded.has(node.id)) return;
  if (node.kind === "group") {
    context.visibleNodes.set(node.id, { ...node, recordsVisible: true });
    return;
  }
  const children = childNodes(context, node.id);
  if (children.length === 0) return;
  // WHY：根来源组本身就是可见列表容器；其余层级始终向右新增列表节点，避免点击后原卡变形。
  if (node.kind === "collection" || node.kind === "shared") {
    context.visibleNodes.set(node.id, { ...node, inlineChildren: children });
    for (const child of children) revealFromListRow(context, node.id, child);
    return;
  }
  revealNextLevel(context, node.id, undefined, node, children);
}

function revealFromListRow(context: VisibleBuildContext, listNodeId: string, row: SourceDataMapNode) {
  if (!context.expanded.has(row.id)) return;
  if (row.kind === "group") {
    const recordsNode = recordListNode(row);
    context.visibleNodes.set(recordsNode.id, recordsNode);
    addVisibleEdge(context, { id: `${listNodeId}::${row.id}->${recordsNode.id}`,
      source: listNodeId, sourceHandle: row.id, target: recordsNode.id });
    return;
  }
  if (row.kind === "source") {
    revealSourceComposite(context, listNodeId, row.id, row);
    return;
  }
  const children = childNodes(context, row.id);
  if (children.length === 0) return;
  revealNextLevel(context, listNodeId, row.id, row, children);
}

function revealNextLevel(context: VisibleBuildContext, originId: string, sourceHandle: string | undefined,
  owner: SourceDataMapNode, children: SourceDataMapNode[]) {
  if (children.length === 1) {
    const child = children[0]!;
    if (child.kind === "source") {
      revealSourceComposite(context, originId, sourceHandle, child);
      return;
    }
    addVisibleNode(context, child);
    addVisibleEdge(context, { id: `${originId}::${sourceHandle ?? owner.id}->${child.id}`,
      source: originId, ...(sourceHandle ? { sourceHandle } : {}), target: child.id });
    revealVisibleChildren(context, child);
    return;
  }
  const list = childListNode(owner, children);
  context.visibleNodes.set(list.id, list);
  addVisibleEdge(context, { id: `${originId}::${sourceHandle ?? owner.id}->${list.id}`,
    source: originId, ...(sourceHandle ? { sourceHandle } : {}), target: list.id });
  for (const child of children) revealFromListRow(context, list.id, child);
}

function revealSourceComposite(context: VisibleBuildContext, originId: string,
  sourceHandle: string | undefined, source: SourceDataMapNode) {
  const targets = childNodes(context, source.id);
  // WHY：Source 与 Target 仍是两层事实，但阅读表面把一个来源的执行目标收进同一张卡，避免同名中转节点。
  context.visibleNodes.set(source.id, { ...source, expandable: false,
    ...(targets.length > 0 ? { inlineChildren: targets } : {}) });
  addVisibleEdge(context, { id: `${originId}::${sourceHandle ?? source.id}->${source.id}`,
    source: originId, ...(sourceHandle ? { sourceHandle } : {}), target: source.id });
  for (const target of targets) revealFromListRow(context, source.id, target);
}

function childListNode(owner: SourceDataMapNode, children: SourceDataMapNode[]) {
  const title = owner.title;
  const description = `${children[0]?.eyebrow ?? "下一级"}列表`;
  return { id: `list:${owner.id}`, kind: "collection" as const, title, eyebrow: description,
    description, meta: `${children.length} 项`, status: aggregateStatus(children), expandable: false,
    searchText: [owner.searchText, ...children.map((child) => child.searchText)].join(" "),
    entity: { kind: "collection" as const, title, description, itemCount: children.length },
    inlineChildren: children };
}

function recordListNode(group: SourceDataMapNode) {
  return { ...group, id: `records:${group.id}`, recordsVisible: true, expandable: false };
}

function childNodes(context: VisibleBuildContext, id: string) {
  return (context.outgoing.get(id) ?? []).flatMap((edge) => {
    const child = context.nodeById.get(edge.target);
    return child ? [child] : [];
  });
}

function addVisibleNode(context: VisibleBuildContext,
  node: VisibleSourceDataMapGraph["nodes"][number]) {
  context.visibleNodes.set(node.id, node);
}

function addVisibleEdge(context: VisibleBuildContext, edge: SourceDataMapEdge) {
  context.visibleEdges.set(edge.id, edge);
}

function aggregateStatus(nodes: SourceDataMapNode[]): SourceDataMapStatus {
  if (nodes.some((node) => node.status === "attention")) return "attention";
  if (nodes.some((node) => node.status === "unresolved")) return "unresolved";
  if (nodes.some((node) => node.status === "unknown")) return "unknown";
  return "neutral";
}

function addBrandPerspective(context: BuildContext, brands: SourceDatasetPlanBrand[], rootId: string) {
  const officialKeys = new Set(brands.flatMap((brand) => brand.officialSourceKeys));
  for (const status of ["planned", "unresolved"] as const) {
    const members = brands.filter((brand) => brand.status === status);
    if (members.length === 0) continue;
    const collectionId = `collection:brand:${status}`;
    addCollectionNode(context.graph, collectionId, status === "planned" ? "官网来源已规划" : "来源待解决",
      status === "planned" ? "已关联品牌官网来源" : "尚未关联可用官网来源", members.length,
      status === "planned" ? "neutral" : "unresolved");
    addEdge(context.graph, rootId, collectionId);
    for (const brand of members) addBrandNode(context, brand, collectionId);
  }
  const sharedSources = context.sources.filter((source) => !officialKeys.has(source.sourceKey));
  if (sharedSources.length === 0) return;
  const id = "shared:cross-brand";
  addNode(context.graph, { id, kind: "shared", title: "跨品牌与专业资料", eyebrow: "公共来源组",
    description: "市场目录、标准、监管与技术资料", meta: `${sharedSources.length} 个来源`,
    status: "neutral", expandable: true, searchText: "跨品牌 专业资料 市场目录 标准 监管 技术",
    entity: { kind: "shared", sourceCount: sharedSources.length } });
  addEdge(context.graph, rootId, id);
  for (const source of sharedSources) addEdge(context.graph, id, sourceId(source));
}

function addBrandNode(context: BuildContext, brand: SourceDatasetPlanBrand, parentId: string) {
  const id = `brand:${encodeURIComponent(brand.name)}`;
  const linkedSources = context.sources.filter((source) => brand.officialSourceKeys.includes(source.sourceKey));
  addNode(context.graph, { id, kind: "brand", title: brand.name, eyebrow: "品牌",
    description: brand.aliases.length > 0 ? `别名：${brand.aliases.join("、")}` : undefined,
    meta: brand.status === "unresolved" ? "来源待解决" : `${linkedSources.length} 个官网来源`,
    status: brand.status === "unresolved" ? "unresolved" : "neutral", expandable: linkedSources.length > 0,
    searchText: [brand.name, ...brand.aliases, brand.status].map(normalize).join(" "), entity: { kind: "brand", brand } });
  addEdge(context.graph, parentId, id);
  for (const source of linkedSources) addEdge(context.graph, id, sourceId(source));
}

function addSourcePerspective(context: BuildContext, rootId: string) {
  const groups = new Map<string, SourceDatasetPlanSource[]>();
  for (const source of context.sources) {
    const key = sourceKindGroup(source.sourceKind);
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  for (const [key, sources] of groups) {
    const definition = sourceGroupDefinition(key);
    const id = `collection:source-kind:${key}`;
    addCollectionNode(context.graph, id, definition.title, definition.description, sources.length, "neutral");
    addEdge(context.graph, rootId, id);
    for (const source of sources) addEdge(context.graph, id, sourceId(source));
  }
}

function addContentPerspective(context: BuildContext, rootId: string) {
  const topics = new Map<string, Set<string>>();
  for (const source of context.sources) for (const target of source.targets) {
    for (const topic of target.taskTopics.length > 0 ? target.taskTopics : ["未标注内容主题"]) {
      const sourceKeys = topics.get(topic) ?? new Set<string>();
      sourceKeys.add(source.sourceKey); topics.set(topic, sourceKeys);
    }
  }
  if (topics.size === 0) return;
  const collectionId = "collection:content-topics";
  addCollectionNode(context.graph, collectionId, "计划内容主题", "来源计划中持久化的任务主题", topics.size, "neutral");
  addEdge(context.graph, rootId, collectionId);
  for (const [topic, sourceKeys] of topics) {
    const id = `topic:${encodeURIComponent(topic)}`;
    addNode(context.graph, { id, kind: "topic", title: topic, eyebrow: "内容主题", meta: `${sourceKeys.size} 个来源`,
      status: topic === "未标注内容主题" ? "unknown" : "neutral", expandable: sourceKeys.size > 0,
      searchText: normalize(topic), entity: { kind: "topic", topic, sourceCount: sourceKeys.size } });
    addEdge(context.graph, collectionId, id);
    for (const source of context.sources.filter((item) => sourceKeys.has(item.sourceKey))) {
      addEdge(context.graph, id, sourceId(source));
    }
  }
}

function addSourceDetails(context: BuildContext) {
  for (const source of context.sources) {
    const runs = context.runsBySource.get(source.sourceKey) ?? [];
    const summaries = source.targets.flatMap((target) => target.recordGroups);
    const recordCount = summaries.reduce((sum, group) => sum + group.totalCount, 0);
    const attention = summaries.reduce((sum, group) => sum + group.outcomes.failed + group.outcomes.rejected, 0);
    addNode(context.graph, { id: sourceId(source), kind: "source", title: source.name,
      eyebrow: source.sourceKind ?? "计划来源", description: source.role,
      meta: `${recordCount} 条 · ${runs.length} 次运行`, status: attention > 0 ? "attention" : "neutral",
      expandable: source.targets.length > 0,
      searchText: [source.name, source.publisher, source.sourceKey, source.role].map(normalize).join(" "),
      entity: { kind: "source", source, runs, recordCount } });
    for (const target of source.targets) addTarget(context.graph, source, target);
  }
}

function addTarget(graph: SourceDataMapGraph, source: SourceDatasetPlanSource, target: SourceDataMapTarget) {
  const id = targetId(source, target.targetKey);
  const count = target.recordGroups.reduce((sum, group) => sum + group.totalCount, 0);
  const attention = target.recordGroups.reduce((sum, group) => sum + group.outcomes.failed + group.outcomes.rejected, 0);
  addNode(graph, { id, kind: "target", title: target.name, eyebrow: "捕获目标", description: target.captureUnit,
    meta: `${count} 条 · ${target.recordGroups.length} 个记录组`, status: attention > 0 ? "attention" : "neutral",
    expandable: target.recordGroups.length > 0,
    searchText: [target.name, target.targetKey, target.captureUnit, ...target.taskTopics].map(normalize).join(" "),
    entity: { kind: "target", source, target } });
  addEdge(graph, sourceId(source), id);
  for (const group of target.recordGroups) addRecordGroup(graph, source, target, group, id);
}

function addRecordGroup(graph: SourceDataMapGraph, source: SourceDatasetPlanSource, target: SourceDataMapTarget,
  group: SourceDataMapRecordGroup, parentId: string) {
  const title = recordGroupLabel(group.groupKey);
  const attention = group.outcomes.failed + group.outcomes.rejected;
  const id = `${parentId}:group:${group.groupKey}`;
  addNode(graph, { id, kind: "group", title, eyebrow: "原始记录组",
    description: "展开后按页读取单条不可变快照",
    meta: `${group.totalCount} 条 · ${group.formats.map((item) => `${resourceFormatLabel(item.format)} ${item.count}`).join(" · ")}`,
    status: group.groupKey === "unrecorded" ? "unknown" : attention > 0 ? "attention" : "neutral",
    expandable: group.totalCount > 0,
    searchText: [title, ...group.formats.map((item) => resourceFormatLabel(item.format))].map(normalize).join(" "),
    entity: { kind: "group", source, target, group } });
  addEdge(graph, parentId, id);
}

function graphStats(sources: SourceDatasetPlanSource[], brands: SourceDatasetPlanBrand[],
  allRuns: SourceCollectionRun[], currentRuns: SourceCollectionRun[]) {
  const groups = sources.flatMap((source) => source.targets.flatMap((target) => target.recordGroups));
  const currentRunIds = new Set(currentRuns.map((run) => run.id));
  return { sourceCount: sources.length,
    recordCount: groups.reduce((sum, group) => sum + group.totalCount, 0),
    acceptedCount: groups.reduce((sum, group) => sum + group.outcomes.accepted, 0),
    attentionCount: groups.reduce((sum, group) => sum + group.outcomes.rejected + group.outcomes.failed, 0),
    lineageCount: groups.filter((group) => group.groupKey !== "unrecorded")
      .reduce((sum, group) => sum + group.totalCount, 0),
    unresolvedBrandCount: brands.filter((brand) => brand.status === "unresolved").length,
    historicalRecordCount: allRuns.filter((run) => !currentRunIds.has(run.id))
      .reduce((sum, run) => sum + run.snapshotCount, 0) };
}

function addCollectionNode(graph: SourceDataMapGraph, id: string, title: string, description: string,
  itemCount: number, status: SourceDataMapStatus) {
  addNode(graph, { id, kind: "collection", title, eyebrow: "节点组", description, meta: `${itemCount} 项`, status,
    expandable: itemCount > 0, searchText: [title, description].map(normalize).join(" "),
    entity: { kind: "collection", title, description, itemCount } });
}

function groupRunsBySource(sources: SourceDatasetPlanSource[], runs: SourceCollectionRun[]) {
  const grouped = new Map(sources.map((source) => [source.sourceKey, [] as SourceCollectionRun[]]));
  for (const run of runs) {
    const sourceKey = run.sourceCollectionPlanSourceKey;
    if (sourceKey && grouped.has(sourceKey)) grouped.get(sourceKey)!.push(run);
  }
  return grouped;
}

function currentConfirmedPlan(view: { sources: SourceDatasetPlanSource[]; brands: SourceDatasetPlanBrand[] }) {
  const plans = new Map<string, { id: string; version: number }>();
  for (const item of [...view.sources, ...view.brands]) if (item.planStatus === "confirmed") {
    plans.set(`${item.planId}:${item.planVersion}`, { id: item.planId, version: item.planVersion });
  }
  return [...plans.values()].sort((left, right) => right.version - left.version)[0];
}

function addNode(graph: SourceDataMapGraph, node: SourceDataMapNode) {
  if (!graph.nodes.some((item) => item.id === node.id)) graph.nodes.push(node);
}

function addEdge(graph: SourceDataMapGraph, source: string, target: string) {
  const id = `${source}->${target}`;
  if (!graph.edges.some((edge) => edge.id === id)) graph.edges.push({ id, source, target });
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

function sourceId(source: SourceDatasetPlanSource) {
  return `source:${source.planId}:${source.planVersion}:${source.sourceKey}`;
}

function targetId(source: SourceDatasetPlanSource, targetKey: string) {
  return `${sourceId(source)}:target:${targetKey}`;
}
