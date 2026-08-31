import dagre from "@dagrejs/dagre";
import ELK from "elkjs/lib/elk.bundled.js";

import type {
  SourceDataMapEdge,
  SourceDataMapLineMode,
  VisibleSourceDataMapGraph,
} from "./sourceDatasetMapModel";

export type SourceDataMapLayout = {
  positions: Map<string, { x: number; y: number }>;
  edgePaths: Map<string, string>;
};
export type SourceDataMapViewportAnchor = {
  nodeId: string;
  screenX: number;
  screenY: number;
  zoom: number;
};

type MapNode = VisibleSourceDataMapGraph["nodes"][number];
type ElkPoint = { x: number; y: number };
type ElkSection = { startPoint?: ElkPoint; bendPoints?: ElkPoint[]; endPoint?: ElkPoint };
type ElkResult = {
  children?: Array<{ id: string; x?: number; y?: number }>;
  edges?: Array<{ id: string; sections?: ElkSection[] }>;
};

const elk = new ELK();
const HEADER_HEIGHT = 68;
const INLINE_ROW_HEIGHT = 42;
const RECORD_ROW_HEIGHT = 42;
const NODE_FRAME_HEIGHT = 2;
const PORT_SIZE = 10;

export async function layoutSourceDataMap(graph: VisibleSourceDataMapGraph,
  mode: SourceDataMapLineMode): Promise<SourceDataMapLayout> {
  if (mode === "curve") return layoutWithDagre(graph);
  const ports = graph.nodes.flatMap((node) => elkPorts(node, graph.edges));
  const portByKey = new Map(ports.map((item) => [item.key, item.id]));
  const result = await elk.layout({
    id: "source-data-map",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      // WHY：列表行就是独立电路端口；正交路由配合边间距才能让每一路都有可追踪的水平/垂直轨道。
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "28",
      "elk.spacing.edgeEdge": "14",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
      "elk.layered.spacing.nodeNodeBetweenLayers": "112",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.layered.nodePlacement.favorStraightEdges": "true",
      "elk.randomSeed": "7",
    },
    children: graph.nodes.map((node) => {
      const size = sourceDataMapNodeSize(node);
      return { id: node.id, ...size,
        layoutOptions: { "elk.portConstraints": "FIXED_POS" },
        ports: ports.filter((port) => port.nodeId === node.id).map(({ key: _key, nodeId: _nodeId, ...port }) => port) };
    }),
    edges: graph.edges.map((edge) => ({ id: edge.id,
      sources: [portByKey.get(sourcePortKey(edge)) ?? edge.source],
      targets: [portByKey.get(targetPortKey(edge.target)) ?? edge.target] })),
  }) as ElkResult;
  return layoutFromElkResult(result);
}

export function sourceDataMapNodeSize(node: MapNode) {
  if (node.kind === "task") return { width: 232, height: 82 };
  if (node.recordsVisible && node.entity.kind === "resource") {
    const rows = Math.max(1, Math.min(node.entity.count, 6));
    return { width: 360, height: HEADER_HEIGHT + rows * RECORD_ROW_HEIGHT + 48 + NODE_FRAME_HEIGHT };
  }
  if (node.inlineChildren) return { width: 350,
    height: HEADER_HEIGHT + node.inlineChildren.length * INLINE_ROW_HEIGHT + NODE_FRAME_HEIGHT };
  if (node.kind === "resource" || node.kind === "audit_group") return { width: 292, height: 86 };
  if (node.kind === "model" || node.kind === "run") return { width: 276, height: 82 };
  return { width: 236, height: 78 };
}

export function sourceDataMapAnchorPoint(graph: VisibleSourceDataMapGraph,
  layout: SourceDataMapLayout, nodeId: string) {
  for (const owner of graph.nodes) {
    const rowIndex = owner.inlineChildren?.findIndex((child) => child.id === nodeId) ?? -1;
    if (rowIndex < 0) continue;
    const position = layout.positions.get(owner.id);
    if (!position) return undefined;
    return { x: position.x + sourceDataMapNodeSize(owner).width,
      y: position.y + HEADER_HEIGHT + rowIndex * INLINE_ROW_HEIGHT + INLINE_ROW_HEIGHT / 2 };
  }
  const node = graph.nodes.find((item) => item.id === nodeId);
  const position = node ? layout.positions.get(node.id) : undefined;
  if (!node || !position) return undefined;
  const size = sourceDataMapNodeSize(node);
  return { x: position.x + size.width / 2, y: position.y + size.height / 2 };
}

export function viewportForAnchoredPoint(anchor: SourceDataMapViewportAnchor,
  nextPoint: { x: number; y: number }) {
  return { x: anchor.screenX - nextPoint.x * anchor.zoom,
    y: anchor.screenY - nextPoint.y * anchor.zoom, zoom: anchor.zoom };
}

function layoutWithDagre(graph: VisibleSourceDataMapGraph): SourceDataMapLayout {
  const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 92, marginx: 40, marginy: 40 });
  for (const node of graph.nodes) layout.setNode(node.id, sourceDataMapNodeSize(node));
  for (const edge of graph.edges) layout.setEdge(edge.source, edge.target);
  dagre.layout(layout);
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of graph.nodes) {
    const point = layout.node(node.id);
    const size = sourceDataMapNodeSize(node);
    positions.set(node.id, { x: point.x - size.width / 2, y: point.y - size.height / 2 });
  }
  return { positions, edgePaths: new Map() };
}

function elkPorts(node: MapNode, edges: SourceDataMapEdge[]) {
  const size = sourceDataMapNodeSize(node);
  const ports = [{ key: targetPortKey(node.id), id: portId(node.id, "in"), nodeId: node.id,
    x: -PORT_SIZE / 2, y: size.height / 2 - PORT_SIZE / 2, width: PORT_SIZE, height: PORT_SIZE,
    layoutOptions: { "elk.port.side": "WEST", "elk.port.index": "0" } }];
  const sourceHandles = [...new Set(edges.filter((edge) => edge.source === node.id)
    .map((edge) => edge.sourceHandle).filter((id): id is string => Boolean(id)))];
  if (sourceHandles.length === 0) {
    ports.push({ key: sourcePortKey({ source: node.id, target: "" } as SourceDataMapEdge),
      id: portId(node.id, "out"), nodeId: node.id, x: size.width - PORT_SIZE / 2,
      y: size.height / 2 - PORT_SIZE / 2, width: PORT_SIZE, height: PORT_SIZE,
      layoutOptions: { "elk.port.side": "EAST", "elk.port.index": "0" } });
    return ports;
  }
  for (const [index, handle] of sourceHandles.entries()) {
    const rowIndex = node.inlineChildren?.findIndex((child) => child.id === handle) ?? index;
    ports.push({ key: sourcePortKey({ source: node.id, sourceHandle: handle, target: "" } as SourceDataMapEdge),
      id: portId(node.id, `row-${index}`), nodeId: node.id, x: size.width - PORT_SIZE / 2,
      y: HEADER_HEIGHT + Math.max(0, rowIndex) * INLINE_ROW_HEIGHT + INLINE_ROW_HEIGHT / 2 - PORT_SIZE / 2,
      width: PORT_SIZE, height: PORT_SIZE,
      layoutOptions: { "elk.port.side": "EAST", "elk.port.index": String(index) } });
  }
  return ports;
}

function layoutFromElkResult(result: ElkResult): SourceDataMapLayout {
  const positions = new Map((result.children ?? []).map((node) => [node.id,
    { x: node.x ?? 0, y: node.y ?? 0 }]));
  const edgePaths = new Map<string, string>();
  for (const edge of result.edges ?? []) {
    const section = edge.sections?.[0];
    if (!section?.startPoint || !section.endPoint) continue;
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    edgePaths.set(edge.id, points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" "));
  }
  return { positions, edgePaths };
}

function sourcePortKey(edge: Pick<SourceDataMapEdge, "source" | "sourceHandle">) {
  return `${edge.source}::${edge.sourceHandle ?? "center"}`;
}

function targetPortKey(nodeId: string) {
  return `${nodeId}::target`;
}

function portId(nodeId: string, suffix: string) {
  return `${nodeId}::port:${suffix}`;
}
