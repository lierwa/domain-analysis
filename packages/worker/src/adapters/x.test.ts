import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalCollectorError } from "../collectors/externalCollector";
import { buildNitterSearchRssUrl, buildXSearchUrl, createXAdapter, createXExternalAdapter } from "./x";

const playwrightMock = vi.hoisted(() => {
  const contexts: Array<{
    context: any;
    page: any;
  }> = [];

  function createContext() {
    const page = {
      url: vi.fn(() => "https://x.com/home"),
      goto: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined)
    };
    const closeListeners: Array<() => void> = [];
    const context = {
      cookies: vi.fn(async () => []),
      close: vi.fn(async () => {
        closeListeners.forEach((listener) => listener());
      }),
      newPage: vi.fn(async () => page),
      pages: vi.fn(() => []),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "close") closeListeners.push(listener);
      })
    };
    contexts.push({ context, page });
    return context;
  }

  return {
    contexts,
    createContext,
    launchPersistentContext: vi.fn(async () => createContext()),
    connectOverCDP: vi.fn(async () => ({
      contexts: () => [createContext()],
      close: vi.fn(async () => undefined)
    })),
    reset() {
      contexts.length = 0;
      this.launchPersistentContext.mockClear();
      this.connectOverCDP.mockClear();
    }
  };
});

const childProcessMock = vi.hoisted(() => {
  type MockChildProcess = {
    exitCode: number | null;
    killed: boolean;
    on: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
  };
  const processes: MockChildProcess[] = [];

  return {
    processes,
    spawn: vi.fn(() => {
      const child: MockChildProcess = {
        exitCode: null,
        killed: false,
        on: vi.fn(),
        unref: vi.fn()
      };
      child.on.mockImplementation(() => child);
      processes.push(child);
      return child;
    }),
    reset() {
      processes.length = 0;
      this.spawn.mockClear();
    }
  };
});

vi.mock("playwright", () => ({
  chromium: {
    launchPersistentContext: playwrightMock.launchPersistentContext,
    connectOverCDP: playwrightMock.connectOverCDP
  }
}));

vi.mock("node:child_process", () => ({
  spawn: childProcessMock.spawn
}));

const query = {
  name: "tattoo",
  includeKeywords: ["tattoo design"],
  excludeKeywords: [],
  language: "en",
  limitPerRun: 10
};

function createCdpVersionResponse(ok = true) {
  return {
    ok,
    json: vi.fn(async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/browser/test" }))
  };
}

beforeEach(() => {
  playwrightMock.reset();
  childProcessMock.reset();
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(createCdpVersionResponse(false))
    .mockResolvedValue(createCdpVersionResponse()));
});

afterEach(async () => {
  for (const item of playwrightMock.contexts) {
    await item.context.close();
  }
  playwrightMock.reset();
  childProcessMock.reset();
  vi.unstubAllGlobals();
});

describe("createXAdapter", () => {
  it("does not default to third-party Nitter instances", async () => {
    const adapter = createXAdapter({});

    await expect(adapter.collect(query)).rejects.toMatchObject({
      code: "login_required",
      message: expect.stringContaining("Complete login")
    });
  });

  it("opens a normal dedicated X login browser when browser-profile collection is not logged in", async () => {
    const adapter = createXAdapter({});

    await expect(adapter.collect(query)).rejects.toMatchObject({ code: "login_required" });

    expect(playwrightMock.launchPersistentContext).not.toHaveBeenCalled();
    expect(playwrightMock.connectOverCDP).toHaveBeenCalledWith("ws://127.0.0.1:9223/devtools/browser/test", expect.any(Object));
    expect(childProcessMock.spawn).toHaveBeenCalledWith(
      expect.stringContaining("Google Chrome"),
      expect.arrayContaining([
        expect.stringContaining("--user-data-dir="),
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9223",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions"
      ]),
      expect.objectContaining({ detached: true, stdio: "ignore" })
    );
    expect(playwrightMock.contexts.some(({ page }) =>
      page.goto.mock.calls.some((call: unknown[]) => call[0] === "https://x.com/login")
    )).toBe(true);
    expect(childProcessMock.processes[0]?.unref).toHaveBeenCalledTimes(1);
  });

  it("allows explicitly enabling extensions for users who depend on a profile extension", async () => {
    const adapter = createXAdapter({ X_CHROME_ENABLE_EXTENSIONS: "1" });

    await expect(adapter.collect(query)).rejects.toMatchObject({ code: "login_required" });

    expect(childProcessMock.spawn).toHaveBeenCalledWith(
      expect.stringContaining("Google Chrome"),
      expect.not.arrayContaining(["--disable-extensions"]),
      expect.objectContaining({ detached: true, stdio: "ignore" })
    );
  });

  it("surfaces a recoverable login error when the profile is already open without DevTools", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const adapter = createXAdapter({ X_CHROME_DEBUG_WAIT_MS: "1" });

    await expect(adapter.collect(query)).rejects.toMatchObject({
      code: "login_required",
      message: expect.stringContaining("Close the existing X login browser")
    });
  });

  it("surfaces CDP attach failures as a recoverable login error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createCdpVersionResponse()));
    playwrightMock.connectOverCDP.mockRejectedValueOnce(new Error("Browser context management is not supported"));
    const adapter = createXAdapter({});

    await expect(adapter.collect(query)).rejects.toMatchObject({
      code: "login_required",
      message: expect.stringContaining("Close the existing X login browser")
    });
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  it("reuses the dedicated Chrome CDP session when X cookies already exist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createCdpVersionResponse()));
    playwrightMock.connectOverCDP.mockImplementationOnce(async () => {
      const resolved = playwrightMock.createContext();
      resolved.cookies.mockResolvedValueOnce([{ name: "auth_token" }] as any);
      resolved.pages.mockReturnValue([{
        locator: () => ({
          evaluateAll: vi.fn(async () => [])
        })
      }] as any);
      return { contexts: () => [resolved], close: vi.fn(async () => undefined) };
    });

    const adapter = createXAdapter({});
    await expect(adapter.collect(query)).resolves.toEqual([]);

    expect(childProcessMock.spawn).not.toHaveBeenCalled();
    expect(playwrightMock.launchPersistentContext).not.toHaveBeenCalled();
    expect(playwrightMock.connectOverCDP).toHaveBeenCalledWith("ws://127.0.0.1:9223/devtools/browser/test", expect.any(Object));
  });

  it("keeps Nitter RSS as explicit opt-in fallback only", () => {
    const url = buildNitterSearchRssUrl(
      { X_NITTER_BASE_URL: "https://nitter.example" },
      ["tattoo design"],
      ["spam"]
    );

    expect(url.origin).toBe("https://nitter.example");
    expect(url.pathname).toBe("/search/rss");
    expect(url.searchParams.get("q")).toContain('"tattoo design"');
  });

  it("uses stable collector error type for missing twscrape/twikit command", async () => {
    const adapter = createXExternalAdapter({ X_COLLECTION_MODE: "twscrape" });

    await expect(adapter.collect(query)).rejects.toBeInstanceOf(ExternalCollectorError);
    await expect(adapter.collect(query)).rejects.toMatchObject({ code: "login_required" });
  });

  it("builds the first-party X search URL for browser-profile collection", () => {
    const url = buildXSearchUrl(["tattoo design"], ["spam"]);

    expect(url.origin).toBe("https://x.com");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toContain('"tattoo design"');
  });
});
