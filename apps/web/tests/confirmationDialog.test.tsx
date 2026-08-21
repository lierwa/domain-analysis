/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ConfirmationDialog } from "../src/components/ConfirmationDialog";

describe("页面内确认框", () => {
  it("打开后把焦点放在取消按钮，Esc 关闭并把焦点还给触发按钮", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmationDialog
        trigger={<button type="button">显式继续</button>}
        title="继续这个来源？"
        description="冷却窗口和总请求预算不会重置。"
        confirmLabel="确认继续"
        onConfirm={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "显式继续" });
    await user.click(trigger);

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBe(document.activeElement);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger).toBe(document.activeElement);
  });

  it("只有点击确认操作才执行回调", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmationDialog
        trigger={<button type="button">删除记录</button>}
        title="删除这条记录？"
        description="删除后无法恢复。"
        confirmLabel="确认删除"
        tone="danger"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "删除记录" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "删除记录" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("生产 Web 源码不再调用原生系统弹窗", () => {
    const sourceRoot = path.resolve(import.meta.dirname, "../src");
    const files = sourceFiles(sourceRoot);

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/\b(?:window|globalThis)\.(?:alert|confirm|prompt)\s*\(/);
      expect(source, file).not.toMatch(/\b(?:alert|prompt)\s*\(/);
    }
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}
