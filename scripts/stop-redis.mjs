import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const redisPidPath = resolve("data/redis/redis.pid");

try {
  const pid = Number((await readFile(redisPidPath, "utf8")).trim());
  if (!Number.isFinite(pid)) throw new Error("invalid_pid");
  process.kill(pid, "SIGTERM");
  await rm(redisPidPath, { force: true });
  console.log(`Stopped project-managed Redis pid=${pid}`);
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    console.log("No project-managed Redis pid file found.");
  } else {
    console.error("Could not stop project-managed Redis. It may already be stopped or managed by the OS.");
    process.exitCode = 1;
  }
}
