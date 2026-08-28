import { describe, expect, it } from "vitest";

import {
  layoutSourceDataMap,
  sourceDataMapAnchorPoint,
  viewportForAnchoredPoint,
} from "../src/pages/sourceDatasetMapLayout";
import { buildFlow } from "../src/pages/SourceDatasetMapCanvas";
import type {
  SourceDataMapNode,
  VisibleSourceDataMapGraph,
} from "../src/pages/sourceDatasetMapModel";

describe("原始数据地图布局", () => {
  it("转折线布局按列表行端口排列子节点，分支之间既不相交也不重叠", async () => {
    const graph = listGraph(10);
    const layout = await layoutSourceDataMap(graph, "polyline");
    const targetY = Array.from({ length: 10 }, (_, index) => layout.positions.get(`target-${index}`)!.y);

    expect(targetY).toEqual([...targetY].sort((left, right) => left - right));
    expect(layout.edgePaths.size).toBe(graph.edges.length);
    const branchPaths = graph.edges.filter((edge) => edge.sourceHandle)
      .map((edge) => layout.edgePaths.get(edge.id)!);
    expect(branchPaths.flatMap(pathSegments).every(isOrthogonal)).toBe(true);
    expect(branchPaths.some((path) => pathSegments(path).length > 1)).toBe(true);
    expect(countPathIntersections(branchPaths)).toBe(0);
    expect(countPathOverlaps(branchPaths)).toBe(0);
  });

  it("切换为曲线时同时切换节点布局，而不只是改 SVG 线型", async () => {
    const graph = listGraph(6);
    const polyline = await layoutSourceDataMap(graph, "polyline");
    const curve = await layoutSourceDataMap(graph, "curve");
    const polylinePositions = graph.nodes.map((node) => polyline.positions.get(node.id));
    const curvePositions = graph.nodes.map((node) => curve.positions.get(node.id));

    expect(polyline.edgePaths.size).toBeGreaterThan(0);
    expect(curve.edgePaths.size).toBe(0);
    expect(polylinePositions).not.toEqual(curvePositions);
  });

  it("曲线保留 Bezier，转折线使用 ELK 计算的独立路径", async () => {
    const graph = listGraph(3);
    const curveGeometry = await layoutSourceDataMap(graph, "curve");
    const curveFlow = buildFlow(graph, curveGeometry, "curve", undefined, undefined, new Set(), "task-1",
      () => undefined, () => undefined, () => undefined);
    const routedGeometry = await layoutSourceDataMap(graph, "polyline");
    const routedFlow = buildFlow(graph, routedGeometry, "polyline", undefined, undefined, new Set(), "task-1",
      () => undefined, () => undefined, () => undefined);

    expect(curveFlow.edges.every((edge) => edge.type === "default")).toBe(true);
    expect(routedFlow.edges.every((edge) => edge.type === "routed")).toBe(true);
  });

  it("重新布局后保持刚点击列表行的屏幕坐标", async () => {
    const graph = listGraph(6);
    const before = await layoutSourceDataMap(graph, "polyline");
    const after = await layoutSourceDataMap(graph, "curve");
    const beforePoint = sourceDataMapAnchorPoint(graph, before, "row-3")!;
    const afterPoint = sourceDataMapAnchorPoint(graph, after, "row-3")!;
    const viewport = { x: 74, y: -31, zoom: 0.68 };
    const anchor = { nodeId: "row-3", zoom: viewport.zoom,
      screenX: beforePoint.x * viewport.zoom + viewport.x,
      screenY: beforePoint.y * viewport.zoom + viewport.y };
    const next = viewportForAnchoredPoint(anchor, afterPoint);

    expect(afterPoint).not.toEqual(beforePoint);
    expect(afterPoint.x * next.zoom + next.x).toBeCloseTo(anchor.screenX);
    expect(afterPoint.y * next.zoom + next.y).toBeCloseTo(anchor.screenY);
  });
});

function listGraph(rowCount: number): VisibleSourceDataMapGraph {
  const rows = Array.from({ length: rowCount }, (_, index) => mapNode(`row-${index}`, `来源 ${index}`));
  const root = mapNode("root", "任务", "task");
  const list = { ...mapNode("list", "品牌官网"), inlineChildren: rows };
  const targets = rows.map((_, index) => mapNode(`target-${index}`, `目标 ${index}`, "target"));
  return {
    nodes: [root, list, ...targets],
    edges: [
      { id: "root->list", source: root.id, target: list.id },
      ...rows.map((row, index) => ({ id: `list:${index}->target:${index}`,
        source: list.id, sourceHandle: row.id, target: targets[index]!.id })),
    ],
  };
}

function mapNode(id: string, title: string, kind: "task" | "collection" | "target" = "collection"):
  SourceDataMapNode {
  if (kind === "task") return { id, kind, title, eyebrow: "采集任务", status: "neutral",
    expandable: false, searchText: title, entity: { kind, taskId: id, taskName: title } };
  if (kind === "target") return { id, kind, title, eyebrow: "捕获目标", status: "neutral",
    expandable: false, searchText: title,
    entity: { kind, source: {} as never, target: {} as never } };
  return { id, kind, title, eyebrow: "节点组", status: "neutral", expandable: true,
    searchText: title, entity: { kind, title, description: "测试列表", itemCount: 1 } };
}

function countPathIntersections(paths: string[]) {
  const segments = paths.map(pathSegments);
  let intersections = 0;
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      if (segments[left]!.some((a) => segments[right]!.some((b) => segmentsIntersect(a, b)))) intersections += 1;
    }
  }
  return intersections;
}

function countPathOverlaps(paths: string[]) {
  const segments = paths.map(pathSegments);
  let overlaps = 0;
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      if (segments[left]!.some((a) => segments[right]!.some((b) => segmentsOverlap(a, b)))) overlaps += 1;
    }
  }
  return overlaps;
}

type Segment = [{ x: number; y: number }, { x: number; y: number }];

function pathSegments(path: string): Segment[] {
  const values = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const points = Array.from({ length: values.length / 2 }, (_, index) => ({
    x: values[index * 2]!, y: values[index * 2 + 1]!,
  }));
  return points.slice(1).map((point, index) => [points[index]!, point]);
}

function segmentsIntersect([a, b]: Segment, [c, d]: Segment) {
  if ([a, b].some((left) => [c, d].some((right) => left.x === right.x && left.y === right.y))) return false;
  const direction = (p: Segment[0], q: Segment[0], r: Segment[0]) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return direction(a, b, c) !== direction(a, b, d) && direction(c, d, a) !== direction(c, d, b);
}

function segmentsOverlap([a, b]: Segment, [c, d]: Segment) {
  if (a.x === b.x && c.x === d.x && a.x === c.x) return intervalOverlap(a.y, b.y, c.y, d.y) > 0.5;
  if (a.y === b.y && c.y === d.y && a.y === c.y) return intervalOverlap(a.x, b.x, c.x, d.x) > 0.5;
  return false;
}

function isOrthogonal([start, end]: Segment) {
  return start.x === end.x || start.y === end.y;
}

function intervalOverlap(a: number, b: number, c: number, d: number) {
  return Math.max(0, Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d)));
}
