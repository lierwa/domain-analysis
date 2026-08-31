import type { SourceDatasetRecordSummary } from "@domain-analysis/shared";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  useViewport,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import { AlertTriangle, ChevronRight, CircleHelp, Maximize2, Minus, Plus } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  layoutSourceDataMap,
  sourceDataMapAnchorPoint,
  sourceDataMapNodeSize,
  viewportForAnchoredPoint,
  type SourceDataMapLayout,
  type SourceDataMapViewportAnchor,
} from "./sourceDatasetMapLayout";
import type {
  SourceDataMapEntity,
  SourceDataMapLineMode,
  SourceDataMapNode,
  SourceDataMapStatus,
  VisibleSourceDataMapGraph,
} from "./sourceDatasetMapModel";
import { SourceDatasetRecordList } from "./SourceDatasetRecordList";

export { sourceDataMapNodeSize } from "./sourceDatasetMapLayout";

type CanvasNodeData = {
  node: VisibleSourceDataMapGraph["nodes"][number];
  selected: boolean;
  selectedNodeId?: string;
  activeRowId?: string;
  expanded: boolean;
  expandedIds: ReadonlySet<string>;
  hasIncoming: boolean;
  hasCenteredOutgoing: boolean;
  taskId: string;
  onSelect: (entity: SourceDataMapEntity, nodeId: string) => void;
  onToggle: (nodeId: string) => void;
  onRecord: (record: SourceDatasetRecordSummary) => void;
};
type CanvasNode = Node<CanvasNodeData, "lineageCard">;
type RoutedEdge = Edge<{ path: string }, "routed">;
type CanvasEdge = Edge | RoutedEdge;
type LayoutResult = { graph: VisibleSourceDataMapGraph;
  mode: SourceDataMapLineMode; geometry: SourceDataMapLayout };

export function SourceDatasetMapCanvas({ taskId, graph, lineMode, selectedNodeId, activeRowId, expanded, onSelect, onToggle,
  onSelectRecord }: {
  taskId: string;
  graph: VisibleSourceDataMapGraph;
  lineMode: SourceDataMapLineMode;
  selectedNodeId?: string;
  activeRowId?: string;
  expanded: ReadonlySet<string>;
  onSelect: (entity: SourceDataMapEntity, nodeId: string) => void;
  onToggle: (nodeId: string) => void;
  onSelectRecord: (record: SourceDatasetRecordSummary) => void;
}) {
  const layout = useSourceDataMapLayout(graph, lineMode);
  const instance = useRef<ReactFlowInstance<CanvasNode, CanvasEdge>>();
  const anchor = useRef<SourceDataMapViewportAnchor>();
  const toggleAnchored = useCallback((nodeId: string) => {
    const point = layout ? sourceDataMapAnchorPoint(layout.graph, layout.geometry, nodeId) : undefined;
    const viewport = instance.current?.getViewport();
    if (point && viewport) anchor.current = { nodeId,
      screenX: point.x * viewport.zoom + viewport.x,
      screenY: point.y * viewport.zoom + viewport.y, zoom: viewport.zoom };
    onToggle(nodeId);
  }, [layout, onToggle]);
  const flow = useMemo(() => layout ? buildFlow(layout.graph, layout.geometry, layout.mode, selectedNodeId, activeRowId,
    expanded, taskId, onSelect, toggleAnchored, onSelectRecord) : undefined,
  [activeRowId, expanded, layout, onSelect, onSelectRecord, selectedNodeId, taskId, toggleAnchored]);

  useLayoutEffect(() => {
    const saved = anchor.current;
    if (!saved || !layout || layout.graph !== graph || layout.mode !== lineMode) return;
    const point = sourceDataMapAnchorPoint(layout.graph, layout.geometry, saved.nodeId);
    if (!point || !instance.current) return;
    // WHY：布局可以重新分配全图坐标，但刚点击的行必须留在原屏幕位置，避免用户重新找回操作对象。
    void instance.current.setViewport(viewportForAnchoredPoint(saved, point), { duration: 0 });
    anchor.current = undefined;
  }, [graph, layout, lineMode]);

  if (!flow) return <div className="source-map-canvas h-full min-h-0 w-full animate-pulse bg-panel/50"
    aria-label="正在排列原始数据血缘画布" />;
  return <div className="source-map-canvas h-full min-h-0 w-full" aria-label="原始数据血缘画布">
    <ReactFlow<CanvasNode, CanvasEdge>
      nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable panOnDrag zoomOnScroll zoomOnPinch
      zoomOnDoubleClick minZoom={0.05} maxZoom={2} defaultViewport={{ x: 24, y: 24, zoom: 1 }}
      fitView fitViewOptions={{ padding: 0.08, maxZoom: 0.9 }}
      elevateNodesOnSelect={false} edgesFocusable={false} deleteKeyCode={null}
      selectionKeyCode={null} multiSelectionKeyCode={null}
      onInit={(next) => { instance.current = next; }}
      onNodeClick={(_, node) => onSelect(node.data.node.entity, node.id)}
      aria-label="原始数据血缘关系图；缩放只改变画布比例，不改变节点内容"
    >
      <CanvasGrid />
      <MiniMap className="source-map-minimap" pannable zoomable
        ariaLabel="画布缩略图，可拖动定位"
        nodeColor="rgb(var(--color-muted))" nodeStrokeColor="rgb(var(--color-surface))"
        nodeStrokeWidth={1} nodeBorderRadius={2} offsetScale={12}
        maskColor="rgb(var(--color-panel) / 0.68)" maskStrokeColor="rgb(var(--color-ink) / 0.34)" />
      <CanvasZoomControls />
    </ReactFlow>
  </div>;
}

const nodeTypes = { lineageCard: memo(LineageCard) };
const edgeTypes = { routed: RoutedLineEdge };

function LineageCard({ data }: NodeProps<CanvasNode>) {
  const node = data.node;
  return <article className={`source-map-node source-map-node--kind-${node.kind} source-map-node--${node.status} ${data.selected ? "source-map-node--selected" : ""} ${node.searchMatched ? "source-map-node--matched" : ""}`}>
    {data.hasIncoming && <Handle type="target" position={Position.Left}
      className="source-map-handle source-map-handle--target" />}
    <header className="source-map-node-header">
      <div className="min-w-0 flex-1">
        <p className="source-map-node-eyebrow">{node.eyebrow}</p>
        <h4 className="source-map-node-title" title={node.title}>{node.title}</h4>
        {node.meta && <p className="source-map-node-meta">{node.meta}</p>}
      </div>
      <StatusGlyph status={node.status} />
      {node.expandable && <button type="button" className="source-map-expand-button nodrag nopan"
        aria-label={data.expanded ? `收起${node.title}` : `展开${node.title}`}
        aria-expanded={data.expanded}
        onClick={(event) => { event.stopPropagation(); data.onToggle(node.id); }}>
        <ChevronRight className={`h-4 w-4 transition-transform ${data.expanded ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>}
    </header>
    {node.recordsVisible && node.entity.kind === "resource"
      && <SourceDatasetRecordList taskId={data.taskId} entity={node.entity} onSelect={data.onRecord} />}
    {node.inlineChildren && <InlineChildrenList children={node.inlineChildren}
      activeRowId={data.activeRowId} expanded={data.expandedIds} onSelect={data.onSelect}
      onToggle={data.onToggle} />}
    {data.hasCenteredOutgoing && <Handle type="source" position={Position.Right}
      className="source-map-handle source-map-handle--source" />}
  </article>;
}

export function InlineChildrenList({ children, activeRowId, expanded, onSelect, onToggle }: {
  children: SourceDataMapNode[];
  activeRowId?: string;
  expanded: ReadonlySet<string>;
  onSelect: (entity: SourceDataMapEntity, nodeId: string) => void;
  onToggle: (nodeId: string) => void;
}) {
  return <ol className="source-map-inline-children nodrag nopan nowheel">{children.map((child) => {
    const active = expanded.has(child.id);
    const selected = activeRowId === child.id;
    return <li key={child.id}
      className={selected ? "source-map-inline-child--active" : undefined}>
      <button type="button" className="source-map-inline-title"
        aria-pressed={selected}
        {...(child.expandable ? { "aria-expanded": active } : {})}
        onClick={(event) => {
          event.stopPropagation();
          if (child.expandable) onToggle(child.id);
          else onSelect(child.entity, child.id);
        }}>
        <span className="source-map-inline-title-text" title={child.title}>{child.title}</span>
        {child.meta && <span className="source-map-inline-meta" title={child.meta}>{child.meta}</span>}
        <StatusGlyph status={child.status} />
      </button>
      {child.expandable && <Handle id={child.id} type="source" position={Position.Right}
        className={`source-map-row-handle ${active ? "source-map-row-handle--active" : ""}`} />}
    </li>;
  })}</ol>;
}

function useSourceDataMapLayout(graph: VisibleSourceDataMapGraph, lineMode: SourceDataMapLineMode) {
  const [result, setResult] = useState<LayoutResult>();
  useEffect(() => {
    let active = true;
    void layoutSourceDataMap(graph, lineMode).then((geometry) => {
      if (active) setResult({ graph, mode: lineMode, geometry });
    });
    return () => { active = false; };
  }, [graph, lineMode]);
  // WHY：重排期间保留上一帧画布，React Flow viewport 才不会因为临时卸载而回到默认位置。
  return result;
}

function CanvasZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow<CanvasNode, CanvasEdge>();
  const { zoom } = useViewport();
  return <div className="source-map-zoom-controls nodrag nopan" role="group" aria-label="地图缩放与适应视图">
    <button type="button" onClick={() => void zoomIn({ duration: 120 })} aria-label="放大地图">
      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
    <output aria-label="当前缩放比例">{Math.round(zoom * 100)}%</output>
    <button type="button" onClick={() => void zoomOut({ duration: 120 })} aria-label="缩小地图">
      <Minus className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
    <button type="button" onClick={() => void fitView({ padding: 0.1, maxZoom: 1, duration: 160 })}
      aria-label="适应画布">
      <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  </div>;
}

function CanvasGrid() {
  const { zoom } = useViewport();
  const safeZoom = Math.max(zoom, 0.05);
  // WHY：React Flow 会把 pattern 随 viewport 缩放；反算世界尺寸后，整图和近看都保持稳定的屏幕密度。
  return <Background variant={BackgroundVariant.Dots} color="rgb(184 184 184)"
    gap={24 / safeZoom} size={2 / safeZoom} />;
}

export function buildFlow(graph: VisibleSourceDataMapGraph, geometry: SourceDataMapLayout,
  lineMode: SourceDataMapLineMode, selectedNodeId: string | undefined,
  activeRowId: string | undefined,
  expanded: ReadonlySet<string>, taskId: string,
  onSelect: (entity: SourceDataMapEntity, nodeId: string) => void,
  onToggle: (nodeId: string) => void, onRecord: (record: SourceDatasetRecordSummary) => void) {
  const incoming = new Set(graph.edges.map((edge) => edge.target));
  const centeredOutgoing = new Set(graph.edges.filter((edge) => !edge.sourceHandle).map((edge) => edge.source));
  const nodes: CanvasNode[] = graph.nodes.map((node) => {
    const position = geometry.positions.get(node.id) ?? { x: 0, y: 0 };
    const size = sourceDataMapNodeSize(node);
    return { id: node.id, type: "lineageCard", position,
      // WHY：布局尺寸在进入 React Flow 前已确定；显式初始尺寸让官方 MiniMap 首帧即可绘制节点。
      initialWidth: size.width, initialHeight: size.height,
      data: { node, selected: node.id === selectedNodeId, expanded: expanded.has(node.id),
        selectedNodeId, activeRowId, expandedIds: expanded, hasIncoming: incoming.has(node.id),
        hasCenteredOutgoing: centeredOutgoing.has(node.id), taskId, onSelect, onToggle, onRecord },
      selectable: true, draggable: false,
      ariaLabel: `${node.eyebrow}：${node.title}。${node.meta ?? ""}。${statusLabel(node.status)}`,
      style: { width: size.width, height: size.height } };
  });
  const edges: CanvasEdge[] = graph.edges.map((edge) => {
    const selected = edge.source === selectedNodeId || edge.sourceHandle === selectedNodeId
      || edge.target === selectedNodeId;
    const path = geometry.edgePaths.get(edge.id);
    return { id: edge.id, source: edge.source, sourceHandle: edge.sourceHandle,
      target: edge.target, type: lineMode === "polyline" && path ? "routed" : "default",
      ...(path ? { data: { path } } : {}), interactionWidth: 18,
      selectable: false, focusable: false,
      className: selected ? "source-map-edge source-map-edge--selected" : "source-map-edge",
      style: { stroke: selected ? "rgb(var(--color-ink) / 0.82)" : "rgb(var(--color-muted) / 0.5)",
        strokeWidth: selected ? 2 : 1.35, strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const } } as CanvasEdge;
  });
  return { nodes, edges };
}

function RoutedLineEdge({ id, data, style, markerEnd, interactionWidth,
  sourceX, sourceY, targetX, targetY }: EdgeProps<RoutedEdge>) {
  const path = data?.path ?? `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd}
    interactionWidth={interactionWidth} />;
}

function StatusGlyph({ status }: { status: SourceDataMapStatus }) {
  if (status === "attention") return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" role="img"
    aria-label="这个型号有内容未通过验收" />;
  if (status === "unresolved") return <CircleHelp className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="信息待解决" />;
  return null;
}

function statusLabel(status: SourceDataMapStatus) {
  if (status === "attention") return "含需关注记录";
  if (status === "unknown") return "路径未记录";
  if (status === "unresolved") return "来源待解决";
  return "结构与计数来自当前事实";
}
