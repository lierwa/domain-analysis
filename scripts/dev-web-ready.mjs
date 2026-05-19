import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import waitOn from "wait-on";

const apiHost = process.env.API_HOST ?? "127.0.0.1";
const apiPort = process.env.API_PORT ?? "43117";
const healthUrl = `http-get://${apiHost}:${apiPort}/health`;
const npmCliPath = resolveNpmCliPath();

await startWaitOn();
startWebDevServer();

async function startWaitOn() {
  // WHY: 直接使用 wait-on 官方 Node API，避免再起一层 npm 子进程，减少 Windows 下进程链复杂度。
  // TRADE-OFF: 增加了少量脚本代码，但换来更稳定的跨平台启动行为和更清晰的错误边界。
  try {
    await waitOn({
      resources: [healthUrl],
      timeout: 300_000,
      interval: 500
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[boot] API not ready: ${message}`);
    process.exit(1);
  }
}

function startWebDevServer() {
  const webProcess = spawnNpm(["run", "dev:web"]);

  webProcess.once("error", (error) => {
    console.error(`[boot] failed to start web dev server: ${error.message}`);
    process.exit(1);
  });

  webProcess.once("exit", (code) => {
    process.exit(code ?? 1);
  });
}

function spawnNpm(args) {
  return spawn(process.execPath, [npmCliPath, ...args], {
    stdio: "inherit"
  });
}

function resolveNpmCliPath() {
  const bundledNpmCliPath = join(
    dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js"
  );
  if (existsSync(bundledNpmCliPath)) return bundledNpmCliPath;

  const workspaceNpmCliPath = join(process.cwd(), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(workspaceNpmCliPath)) return workspaceNpmCliPath;

  throw new Error("[boot] npm-cli.js not found; please ensure Node.js npm installation is complete.");
}
