// @vitest-environment jsdom

import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InlineChildrenList } from "../src/pages/SourceDatasetMapCanvas";
import type { SourceDataMapNode } from "../src/pages/sourceDatasetMapModel";

afterEach(cleanup);

describe("原始数据地图节点组列表", () => {
  it("展开和选中分别表达，并把名称和统计放在同一行两端", () => {
    const child = collectionRow();
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const view = render(<ReactFlowProvider><InlineChildrenList children={[child]} activeRowId={undefined}
      expanded={new Set([child.id])} onSelect={onSelect} onToggle={onToggle} /></ReactFlowProvider>);

    const button = screen.getByRole("button", { name: /海信中国电视目录与官方商城/ });
    const title = screen.getByText("海信中国电视目录与官方商城");
    const meta = screen.getByText("4 条 · 4 次运行");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.parentElement?.className).not.toContain("source-map-inline-child--active");
    expect(title.parentElement).toBe(button);
    expect(meta.parentElement).toBe(button);
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith(child.id);

    view.rerender(<ReactFlowProvider><InlineChildrenList children={[child]} activeRowId={child.id}
      expanded={new Set([child.id])} onSelect={onSelect} onToggle={onToggle} /></ReactFlowProvider>);
    expect(screen.getByRole("button", { name: /海信中国电视目录与官方商城/ })
      .parentElement?.className).toContain("source-map-inline-child--active");
  });
});

function collectionRow(): SourceDataMapNode {
  return { id: "source:hisense", kind: "source", title: "海信中国电视目录与官方商城",
    eyebrow: "brand_official", meta: "4 条 · 4 次运行", status: "neutral", expandable: true,
    searchText: "海信", entity: { kind: "source", source: {} as never, runs: [], recordCount: 4 } };
}
