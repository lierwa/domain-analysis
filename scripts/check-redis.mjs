import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const url = new URL(redisUrl);
const host = url.hostname || "127.0.0.1";
const port = Number(url.port || 6379);
const isLocalRedis = host === "127.0.0.1" || host === "localhost";
const redisDir = resolve("data/redis");
const redisConfigPath = resolve(redisDir, "redis.conf");
const redisPidPath = resolve(redisDir, "redis.pid");
const redisLogPath = resolve(redisDir, "redis.log");

if (await canConnect(host, port)) {
  console.log(`Redis is reachable at ${redisUrl}`);
  process.exit(0);
}

if (!isLocalRedis) {
  failWithInstallHint(`Redis is not reachable at ${redisUrl}, and REDIS_URL points to a non-local host.`);
}

if (!hasRedisServer()) {
  failWithInstallHint("redis-server is not installed or not available in PATH.");
}

await mkdir(redisDir, { recursive: true });
await writeRedisConfig();

console.log(`Starting project-managed Redis at ${redisUrl}`);
const result = spawn("redis-server", [redisConfigPath], {
  detached: true,
  stdio: "ignore"
});
result.unref();

for (let attempt = 0; attempt < 30; attempt++) {
  if (await canConnect(host, port)) {
    console.log(`Redis started at ${redisUrl}`);
    process.exit(0);
  }
  await sleep(200);
}

failWithInstallHint(`Redis did not become reachable. Check ${redisLogPath}`);

function hasRedisServer() {
  const result = spawnSync("redis-server", ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

async function writeRedisConfig() {
  // WHY: 项目自己管理开发 Redis，限制 128MB，避免 2C2G 环境被队列服务吃掉过多内存。
  await mkdir(dirname(redisPidPath), { recursive: true });
  await writeFile(
    redisConfigPath,
    [
      `bind ${host}`,
      `port ${port}`,
      "daemonize yes",
      `pidfile ${redisPidPath}`,
      `dir ${redisDir}`,
      `logfile ${redisLogPath}`,
      "appendonly yes",
      "maxmemory 128mb",
      "maxmemory-policy noeviction",
      "save \"\""
    ].join("\n") + "\n"
  );
}

function canConnect(targetHost, targetPort) {
  return new Promise((resolveConnect) => {
    const socket = net.createConnection({ host: targetHost, port: targetPort });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolveConnect(false);
    }, 500);

    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      resolveConnect(true);
    });
    socket.once("error", () => {
      clearTimeout(timeout);
      resolveConnect(false);
    });
  });
}

function failWithInstallHint(reason) {
  console.error(`
${reason}

This project uses Redis as a lightweight BullMQ queue for background crawler jobs.
Docker is not required. Install native Redis once, then npm scripts will start it automatically.

macOS:
  brew install redis

Ubuntu/Debian server:
  sudo apt-get update
  sudo apt-get install -y redis-server

Then rerun:
  npm run dev
`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
