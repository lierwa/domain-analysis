import path from "node:path";
import { fileURLToPath } from "node:url";
import concurrently from "concurrently";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const nodeExecutable = quoteCommandArgument(process.execPath);
const waitOnCli = quoteCommandArgument(
  path.join(repositoryRoot, "node_modules", "wait-on", "bin", "wait-on"),
);
const viteCli = quoteCommandArgument(
  path.join(repositoryRoot, "node_modules", "vite", "bin", "vite.js"),
);

// WHY：各服务必须在所属 workspace 中启动，Vite 才能读取 Web 自己的 Tailwind/PostCSS 配置。
// TRADE-OFF：默认整套启动不启用 API watcher，避免 Windows 只停止监听子进程后遗留 watcher；独立 dev:api 仍保留热重载。
const { result } = concurrently(
  [
    {
      command: `${nodeExecutable} --env-file=../../.env.example --env-file-if-exists=../../.env.local --import=tsx src/index.ts`,
      name: "api",
      prefixColor: "black",
      cwd: path.join(repositoryRoot, "apps", "api"),
    },
    {
      command: `${nodeExecutable} ${waitOnCli} --config ../../wait-on.api.config.cjs && ${nodeExecutable} ${viteCli} --host 127.0.0.1`,
      name: "web",
      prefixColor: "white",
      cwd: path.join(repositoryRoot, "apps", "web"),
    },
  ],
  {
    prefix: "name",
    restartTries: 3,
    restartDelay: 1_000,
    // WHY：任一开发服务正常结束时统一关闭其余服务，避免留下占用端口的孤立进程。
    killOthersOn: ["success"],
  },
);

try {
  await result;
} catch {
  // WHY：子进程错误已经由 concurrently 原样输出；直接抛出会把含环境变量的 Command 对象完整打印到终端。
  // TRADE-OFF：仍保留非零退出码，但不重复输出可能包含本地凭据的进程上下文。
  process.exitCode = 1;
}

function quoteCommandArgument(value) {
  if (process.platform === "win32") {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return `'${value.replaceAll("'", `'\\''`)}'`;
}
