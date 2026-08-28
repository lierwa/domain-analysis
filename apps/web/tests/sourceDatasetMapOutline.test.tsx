// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceDatasetMapOutline } from "../src/pages/SourceDatasetMapOutline";
import type { SourceDataMapNode, VisibleSourceDataMapGraph } from "../src/pages/sourceDatasetMapModel";

afterEach(cleanup);

describe("原始数据地图大纲", () => {
  it("按真实父子关系把来源和捕获目标递归嵌套在对应行下", () => {
    render(<SourceDatasetMapOutline taskId="task-1" graph={outlineGraph()} selectedNodeId="brand:redmi"
      expanded={new Set(["brand:redmi", "source:redmi"])} onSelect={vi.fn()} onToggle={vi.fn()}
      onSelectRecord={vi.fn()} />);

    const brand = screen.getByRole("treeitem", { name: /品牌 Redmi/ });
    const source = within(brand).getByRole("treeitem", { name: /brand_official Redmi 官方来源/ });
    expect(within(source).getByRole("treeitem", { name: /捕获目标 产品与参数页/ })).toBeTruthy();
    expect(source.parentElement?.closest('[role="treeitem"]')).toBe(brand);
  });

  it("展开状态和当前选中状态分别表达", () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    render(<SourceDatasetMapOutline taskId="task-1" graph={outlineGraph()} selectedNodeId={undefined}
      activeRowId="brand:redmi"
      expanded={new Set(["brand:redmi", "source:redmi"])} onSelect={onSelect} onToggle={onToggle}
      onSelectRecord={vi.fn()} />);

    expect(screen.getByRole("treeitem", { name: /品牌 Redmi/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("treeitem", { name: /brand_official Redmi 官方来源/ })
      .getAttribute("aria-current")).toBeNull();
    screen.getByRole("treeitem", { name: /品牌 Redmi/ }).querySelector("button")?.click();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith("brand:redmi");
  });
});

function outlineGraph(): VisibleSourceDataMapGraph {
  const brand = node("brand:redmi", "Redmi", "brand", "品牌");
  const target = node("target:redmi", "产品与参数页", "target", "捕获目标");
  const source = { ...node("source:redmi", "Redmi 官方来源", "source", "brand_official"),
    inlineChildren: [target] };
  const collection = { ...node("collection:brands", "官网来源已规划", "collection", "节点组"),
    inlineChildren: [brand] };
  return { nodes: [node("task:1", "电视抓取任务", "task", "采集任务"), collection, source], edges: [
    { id: "task->collection", source: "task:1", target: collection.id },
    { id: "brand->source", source: collection.id, sourceHandle: brand.id, target: source.id },
  ] };
}

function node(id: string, title: string, kind: SourceDataMapNode["kind"], eyebrow: string): SourceDataMapNode {
  return { id, title, kind, eyebrow, status: "neutral", expandable: true, searchText: title,
    entity: entity(kind, title) };
}

function entity(kind: SourceDataMapNode["kind"], title: string): SourceDataMapNode["entity"] {
  if (kind === "task") return { kind, taskId: "task-1", taskName: title };
  if (kind === "brand") return { kind, brand: { name: title } as never };
  if (kind === "source") return { kind, source: {} as never, runs: [], recordCount: 0 };
  if (kind === "target") return { kind, source: {} as never, target: {} as never };
  return { kind: "collection", title, description: "测试", itemCount: 1 };
}
