import { Configuration, LogLevel } from "@crawlee/core";
import { MemoryStorage } from "@crawlee/memory-storage";

export function createEphemeralCrawleeConfiguration() {
  const configuration = new Configuration({ logLevel: LogLevel.WARNING });
  // WHY：每次来源访问必须重新执行；独立内存队列既避免默认持久队列误去重，也不清理用户已有 Crawlee 数据。
  configuration.useStorageClient(new MemoryStorage({ persistStorage: false, writeMetadata: false }));
  return configuration;
}
