import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import waitOn from "wait-on";

const apiHost = process.env.API_HOST ?? "127.0.0.1";
const apiPort = process.env.API_PORT ?? "43117";
const healthUrl = `http-get://${apiHost}:${apiPort}/health`;
const npmCliPath = resolveNpmCliPath();

const apiProcess = spawnNpm(["run", "dev:api"]);
let webProcess = null;
let shuttingDown = false;

attachChildLifecycle(apiProcess, "api");
await startWebAfterApiReady();
if (!shuttingDown) {
  webProcess = spawnNpm(["run", "dev:web"]);
  attachChildLifecycle(webProcess, "web");
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function startWebAfterApiReady() {
  try {
    // WHY: 使用成熟的 wait-on 检测 API 健康状态，避免手写轮询带来的边界错误。
    await waitOn({
      resources: [healthUrl],
      timeout: 300_000,
      interval: 500
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dev] API not ready: ${message}`);
    shutdown(1);
  }
}

function spawnNpm(args) {
  return spawn(process.execPath, [npmCliPath, ...args], {
    stdio: "inherit"
  });
}

function attachChildLifecycle(child, name) {
  child.once("error", (error) => {
    console.error(`[dev] failed to start ${name}: ${error.message}`);
    shutdown(1);
  });

  child.once("exit", (code) => {
    if (shuttingDown) return;
    const exitCode = code ?? 1;
    if (exitCode !== 0) {
      console.error(`[dev] ${name} exited with code ${exitCode}`);
    }
    shutdown(exitCode);
  });
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  // TRADE-OFF: dev 编排层用强制终止保证退出可预期，代价是子进程不执行自定义优雅收尾。
  if (apiProcess && !apiProcess.killed) apiProcess.kill("SIGTERM");
  if (webProcess && !webProcess.killed) webProcess.kill("SIGTERM");
  process.exit(exitCode);
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

  throw new Error("[dev] npm-cli.js not found; please ensure Node.js npm installation is complete.");
}
