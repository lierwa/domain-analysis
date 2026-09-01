import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

const execaMock = vi.hoisted(() => vi.fn());

vi.mock("execa", () => ({ execa: execaMock }));

import { startCodexAppServerTransport } from "../src/codexAppServerTransport";

const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
  execaMock.mockReset();
});

describe("Codex app-server 进程环境", () => {
  it("让项目 npm 始终能找到当前运行 API 的 Node", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const completed = Promise.resolve({ exitCode: 0, signal: undefined });
    execaMock.mockReturnValue({
      stdin,
      stdout,
      stderr,
      kill: vi.fn(),
      then: completed.then.bind(completed),
    });
    process.env.PATH = ["/usr/bin", "/bin"].join(path.delimiter);

    const transport = startCodexAppServerTransport({
      cwd: "/tmp/category-interview",
      packageRoot: "/workspace/domain-analysis",
    });

    const options = execaMock.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
    expect(Object.keys(options?.env ?? {}).filter((key) => key.toLowerCase() === "path"))
      .toEqual(["PATH"]);
    expect(options?.env?.PATH?.split(path.delimiter)).toEqual([
      path.dirname(process.execPath),
      "/usr/bin",
      "/bin",
    ]);
    await transport.close();
  });
});
