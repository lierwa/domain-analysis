import type { SourceDatasetRecordSummary } from "@domain-analysis/shared";
import { AlertTriangle, ChevronRight, CircleHelp } from "lucide-react";

import type { SourceDataMapEntity, SourceDataMapNode,
  VisibleSourceDataMapGraph } from "./sourceDatasetMapModel";
import { SourceDatasetRecordList } from "./SourceDatasetRecordList";

type OutlineNode = VisibleSourceDataMapGraph["nodes"][number];
type OutlineRelations = ReturnType<typeof outlineRelations>;
type OutlineActions = {
  taskId: string;
  selectedNodeId?: string;
  activeRowId?: string;
  expanded: ReadonlySet<string>;
  onSelect: (entity: SourceDataMapEntity, nodeId: string) => void;
  onToggle: (nodeId: string) => void;
  onSelectRecord: (record: SourceDatasetRecordSummary) => void;
};

export function SourceDatasetMapOutline({ taskId, graph, selectedNodeId, activeRowId, expanded, onSelect, onToggle,
  onSelectRecord }: OutlineActions & { graph: VisibleSourceDataMapGraph }) {
  const relations = outlineRelations(graph);
  const actions = { taskId, selectedNodeId, activeRowId, expanded, onSelect, onToggle, onSelectRecord };
  return <section className="h-full min-h-0 overflow-auto bg-panel/45 px-3 pb-3 pt-14 sm:px-5 sm:pb-5"
    aria-label="原始数据可访问大纲">
    <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        <h4 className="text-sm font-semibold">可访问大纲</h4>
        <p className="mt-1 text-xs text-muted">每一级直接展开在所属行下方；展开分支与当前选中分别表达。</p>
      </header>
      <ol role="tree" className="divide-y divide-line">
        {relations.roots.map((node) => <OutlineNodeBranch key={node.id} node={node} depth={0}
          relations={relations} actions={actions} path={new Set()} />)}
      </ol>
      {relations.roots.length === 0 && <p className="p-8 text-center text-sm text-muted">没有匹配节点。</p>}
    </div>
  </section>;
}

function OutlineNodeBranch({ node, depth, relations, actions, path }: {
  node: OutlineNode;
  depth: number;
  relations: OutlineRelations;
  actions: OutlineActions;
  path: ReadonlySet<string>;
}) {
  if (path.has(node.id)) return null;
  const nextPath = new Set(path).add(node.id);
  const children = relations.centered.get(node.id) ?? [];
  const hasChildren = Boolean(node.inlineChildren?.length || children.length || node.recordsVisible);
  const selected = actions.selectedNodeId === node.id;
  return <li role="treeitem" aria-label={`${node.eyebrow} ${node.title}`}
    aria-current={selected ? "true" : undefined} aria-expanded={hasChildren ? true : undefined}>
    <OutlineNodeRow node={node} depth={depth} selected={selected} expanded={actions.expanded.has(node.id)}
      onSelect={actions.onSelect} onToggle={actions.onToggle} />
    {node.inlineChildren && <ol role="group" className="border-t border-line bg-panel/25">
      {node.inlineChildren.map((child) => <OutlineInlineBranch key={child.id} child={child} ownerId={node.id}
        depth={depth + 1} relations={relations} actions={actions} path={nextPath} />)}
    </ol>}
    {children.length > 0 && <ol role="group" className="border-t border-line bg-panel/20">
      {children.map((child) => <OutlineNodeBranch key={`${node.id}:${child.id}`} node={child} depth={depth + 1}
        relations={relations} actions={actions} path={nextPath} />)}
    </ol>}
    {node.recordsVisible && node.entity.kind === "resource" && <div className="border-t border-line bg-panel/30 p-3 sm:pl-16">
      <SourceDatasetRecordList taskId={actions.taskId} entity={node.entity}
        onSelect={actions.onSelectRecord} />
    </div>}
  </li>;
}

function OutlineInlineBranch({ child, ownerId, depth, relations, actions, path }: {
  child: SourceDataMapNode;
  ownerId: string;
  depth: number;
  relations: OutlineRelations;
  actions: OutlineActions;
  path: ReadonlySet<string>;
}) {
  const selected = actions.activeRowId === child.id;
  const open = actions.expanded.has(child.id);
  const descendants = relations.handled.get(`${ownerId}::${child.id}`) ?? [];
  const className = selected ? "bg-[#f8f4ec] ring-1 ring-inset ring-[#e6dac2]" : "hover:bg-panel";
  return <li role="treeitem" aria-label={`${child.eyebrow} ${child.title}`}
    aria-current={selected ? "true" : undefined}
    aria-expanded={child.expandable ? open : descendants.length > 0 ? true : undefined}>
    <button type="button" style={{ paddingLeft: `${16 + Math.min(depth, 5) * 24}px` }}
      className={`flex min-h-12 w-full items-center gap-3 py-2 pr-4 text-left ${className} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink`}
      onClick={() => {
        if (child.expandable) actions.onToggle(child.id);
        else actions.onSelect(child.entity, child.id);
      }}>
      <OutlineStatus status={child.status} />
      <span className="block text-[10px] font-semibold tracking-[0.08em] text-muted">{child.eyebrow}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium" title={child.title}>{child.title}</span>
        {child.meta && <span className="mt-0.5 block truncate text-xs tabular-nums text-muted">{child.meta}</span>}</span>
      {child.expandable && <ChevronRight className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
        aria-hidden="true" />}
    </button>
    {descendants.length > 0 && <ol role="group" className="border-t border-line bg-panel/20">
      {descendants.map((node) => <OutlineNodeBranch key={`${child.id}:${node.id}`} node={node} depth={depth + 1}
        relations={relations} actions={actions} path={path} />)}
    </ol>}
  </li>;
}

function OutlineNodeRow({ node, depth, selected, expanded, onSelect, onToggle }: {
  node: OutlineNode;
  depth: number;
  selected: boolean;
  expanded: boolean;
  onSelect: OutlineActions["onSelect"];
  onToggle: OutlineActions["onToggle"];
}) {
  return <div style={{ paddingLeft: `${16 + Math.min(depth, 5) * 24}px` }}
    className={`flex min-h-12 items-center gap-3 py-2 pr-4 ${selected
      ? "bg-panel ring-1 ring-inset ring-ink/25" : "hover:bg-panel"}`}>
    <OutlineStatus status={node.status} />
    <button type="button" onClick={() => onSelect(node.entity, node.id)}
      className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:underline">
      <span className="block text-[10px] font-semibold tracking-[0.08em] text-muted">{node.eyebrow}</span>
      <span className="mt-0.5 block truncate text-sm font-medium" title={node.title}>{node.title}</span>
    </button>
    {node.meta && <span className="hidden max-w-48 shrink-0 truncate text-xs tabular-nums text-muted sm:block"
      title={node.meta}>{node.meta}</span>}
    {node.expandable && <button type="button" onClick={() => onToggle(node.id)}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      aria-label={expanded ? `收起${node.title}` : `展开${node.title}`} aria-expanded={expanded}>
      <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden="true" />
    </button>}
  </div>;
}

function outlineRelations(graph: VisibleSourceDataMapGraph) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const centered = new Map<string, OutlineNode[]>();
  const handled = new Map<string, OutlineNode[]>();
  const incoming = new Set<string>();
  for (const edge of graph.edges) {
    const target = nodeById.get(edge.target);
    if (!target) continue;
    incoming.add(target.id);
    const map = edge.sourceHandle ? handled : centered;
    const key = edge.sourceHandle ? `${edge.source}::${edge.sourceHandle}` : edge.source;
    map.set(key, [...(map.get(key) ?? []), target]);
  }
  // WHY：大纲遵循当前视角的真实边递归展开；多父节点可以在各自路径中作为只读引用出现。
  const roots = graph.nodes.filter((node) => !incoming.has(node.id));
  return { roots, centered, handled };
}

function OutlineStatus({ status }: { status: string }) {
  if (status === "attention") return <AlertTriangle className="h-4 w-4 shrink-0 text-danger"
    aria-label="含需关注记录" />;
  if (status === "unknown" || status === "unresolved") return <CircleHelp className="h-4 w-4 shrink-0 text-warning"
    aria-label="信息待补充" />;
  return <span className="h-4 w-4 shrink-0" aria-hidden="true" />;
}
