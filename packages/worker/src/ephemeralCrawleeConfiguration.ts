import { Configuration, LogLevel, RequestQueue } from "@crawlee/core";
import { MemoryStorage } from "@crawlee/memory-storage";

export function createEphemeralCrawleeConfiguration() {
  const configuration = new Configuration({ logLevel: LogLevel.WARNING });
  // WHY：每次来源访问必须重新执行；独立内存队列既避免默认持久队列误去重，也不清理用户已有 Crawlee 数据。
  configuration.useStorageClient(new MemoryStorage({ persistStorage: false, writeMetadata: false }));
  return configuration;
}

export function createPersistentCrawleeConfiguration(storageDirectory: string) {
  if (!storageDirectory.trim()) throw new Error("持久 Crawlee storage 路径不能为空");
  const configuration = new Configuration({
    logLevel: LogLevel.WARNING,
    persistStorage: true,
    purgeOnStart: false,
  });
  // WHY：命名 RequestQueue 只保存本机派发 mechanics；Source Dataset 仍是工作状态事实源，
  // 因此不复用全局 storage，也不允许启动时 purge 掩盖未完成工作。
  configuration.useStorageClient(new MemoryStorage({
    localDataDirectory: storageDirectory,
    persistStorage: true,
    writeMetadata: true,
  }));
  return configuration;
}

export async function openPersistentRequestQueue(
  name: string,
  configuration: Configuration,
  requestLockSeconds: number,
) {
  if (!name.trim()) throw new Error("持久 RequestQueue 名称不能为空");
  if (!Number.isInteger(requestLockSeconds) || requestLockSeconds < 1) {
    throw new Error("RequestQueue lock 秒数必须为正整数");
  }
  const queue = await RequestQueue.open(name, { config: configuration });
  // WHY：RequestQueue 会预取并锁住未派发项；显式 lock 期限既避免活进程重复领取，
  // 也让强杀后的负责人恢复有确定等待上限，而不是依赖库默认值。
  queue.requestLockSecs = requestLockSeconds;
  return queue;
}

export function requestLockRecoveryWaitMs(requestLockSeconds: number) {
  if (!Number.isInteger(requestLockSeconds) || requestLockSeconds < 1) {
    throw new Error("RequestQueue lock 秒数必须为正整数");
  }
  // WHY：Crawlee 3.18.1 RequestQueue v2 先在 listAndLockHead 锁一次，随后水合请求时又把
  // 到期时间延长一个 lock 周期；强杀恢复必须按两个周期计算，额外 1 秒吸收调度误差。
  return requestLockSeconds * 2_000 + 1_000;
}
