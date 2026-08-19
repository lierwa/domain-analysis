import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const dataDirectory = path.join(repositoryRoot, "data", "postgresql");
const logFile = path.join(repositoryRoot, "data", "postgresql-server.log");
const databaseUrl = process.env.POSTGRES_DATABASE_URL;

if (!databaseUrl) throw new Error("POSTGRES_DATABASE_URL 未配置");

const target = new URL(databaseUrl);
const host = target.hostname;
const port = Number(target.port || 5432);

if (await isPortOpen(host, port)) {
  console.log(`本地 PostgreSQL 已运行：${host}:${port}`);
  process.exit(0);
}

if (!isLocalHost(host)) {
  throw new Error(`PostgreSQL ${host}:${port} 不可连接；非本机数据库不会自动启动`);
}
if (!existsSync(dataDirectory)) {
  throw new Error(`本地 PostgreSQL 数据目录不存在：${dataDirectory}`);
}

const pgCtl = resolvePgCtl();
const status = spawnSync(pgCtl, ["status", "-D", dataDirectory], {
  stdio: "ignore",
  windowsHide: true,
});

if (status.status === 0) {
  await waitUntilReady(host, port);
  console.log(`本地 PostgreSQL 已运行：${host}:${port}`);
  process.exit(0);
}

// WHY：dev 入口只在端口和数据目录状态都证明未运行时启动，避免每次启动应用都重复拉起 PostgreSQL。
const started = spawnSync(
  pgCtl,
  [
    "start",
    "-D",
    dataDirectory,
    "-l",
    logFile,
    "-o",
    `-h ${host} -p ${port}`,
    "-w",
    "-t",
    "30",
  ],
  { stdio: "inherit", windowsHide: true },
);

if (started.error) throw started.error;
if (started.status !== 0 && !await isPortOpen(host, port)) {
  throw new Error(`本地 PostgreSQL 启动失败，退出码：${started.status ?? "unknown"}`);
}

console.log(`本地 PostgreSQL 已启动：${host}:${port}`);

function resolvePgCtl() {
  if (process.env.POSTGRES_PG_CTL) return process.env.POSTGRES_PG_CTL;

  const optionsFile = path.join(dataDirectory, "postmaster.opts");
  if (existsSync(optionsFile)) {
    const options = readFileSync(optionsFile, "utf8").trim();
    const executable = options.match(/^"([^"]+)"|^(\S+)/)?.slice(1).find(Boolean);
    if (executable) {
      const candidate = path.join(
        path.dirname(executable),
        process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl",
      );
      if (existsSync(candidate)) return candidate;
    }
  }

  return process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl";
}

function isLocalHost(value) {
  return value === "127.0.0.1" || value === "localhost" || value === "::1";
}

function isPortOpen(targetHost, targetPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: targetHost, port: targetPort });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitUntilReady(targetHost, targetPort) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isPortOpen(targetHost, targetPort)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`PostgreSQL 进程存在，但 ${targetHost}:${targetPort} 未在 30 秒内就绪`);
}
