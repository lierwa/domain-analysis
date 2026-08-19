import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { InterviewThread } from "../src/pages/InterviewThread";

describe("采访输入恢复门", () => {
  it("历史会话恢复完成前禁用 Composer，避免新输入写入错误会话", () => {
    const consoleErrors: string[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((message) => {
      consoleErrors.push(String(message));
    });
    const html = renderToString(
      <InterviewThread messages={[]} isRunning={false} isRestoring awaitingDecision={false}
        onNew={vi.fn()} onCancel={vi.fn()}>
        {null}
      </InterviewThread>,
    );
    consoleError.mockRestore();

    expect(html).toContain("正在恢复采访");
    expect(html).toContain("disabled=\"\"");
    expect(consoleErrors.every((message) => message.includes("useLayoutEffect does nothing on the server"))).toBe(true);
  });
});
