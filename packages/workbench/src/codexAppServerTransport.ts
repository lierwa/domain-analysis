import { execa } from "execa";
import ndjson from "ndjson";

export interface CodexAppServerTransport {
  next(): Promise<IteratorResult<unknown>>;
  send(method: string, id: number, params: object): void;
  notify(method: string, params?: object): void;
  kill(): void;
  close(): Promise<void>;
  result(): Promise<{ exitCode?: number; signal?: unknown; stderr: string }>;
}

export function startCodexAppServerTransport(options: {
  cwd: string;
  executable?: string;
  packageRoot?: string;
}): CodexAppServerTransport {
  const args = [
    "app-server", "--stdio",
    "--disable", "plugins",
    "--disable", "hooks",
    "--disable", "memories",
    "--disable", "shell_tool",
    "--disable", "unified_exec",
  ];
  const executable = options.executable ?? "npm";
  const executableArgs = options.executable
    ? args
    : ["--prefix", options.packageRoot ?? options.cwd, "exec", "--", "codex", ...args];
  // WHY：进程连接跨多个业务回合复用；单回合超时和取消由官方 turn/interrupt 管理，不能交给进程总超时。
  const subprocess = execa(executable, executableArgs, {
    cwd: options.cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    reject: false,
    cleanup: true,
    buffer: false,
    forceKillAfterDelay: 2_000,
  });
  if (!subprocess.stdin || !subprocess.stdout || !subprocess.stderr) {
    subprocess.kill("SIGTERM");
    throw new Error("Codex app-server stdio 未建立管道");
  }
  const iterator = subprocess.stdout.pipe(ndjson.parse())[Symbol.asyncIterator]();
  let stderr = "";
  subprocess.stderr.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4_000);
  });
  const result = subprocess.then((value) => ({
    exitCode: value.exitCode,
    signal: value.signal,
    stderr,
  }));
  return {
    next: () => iterator.next(),
    send: (method, id, params) => subprocess.stdin!.write(`${JSON.stringify({ method, id, params })}\n`),
    notify: (method, params = {}) => subprocess.stdin!.write(`${JSON.stringify({ method, params })}\n`),
    kill: () => { subprocess.kill("SIGTERM"); },
    close: async () => {
      subprocess.stdin?.end();
      subprocess.kill("SIGTERM");
      await result;
    },
    result: () => result,
  };
}
