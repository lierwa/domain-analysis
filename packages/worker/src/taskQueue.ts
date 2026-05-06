import PQueue from "p-queue";
import { runJob, type JobResult, type WorkerJob } from "./jobs";

export interface TaskQueueOptions {
  concurrency?: number;
}

export class TaskQueue {
  private readonly queue: PQueue;

  constructor(options: TaskQueueOptions = {}) {
    this.queue = new PQueue({
      // WHY: 2核2G 服务器上 Playwright 和 AI 请求都可能吃内存，默认单并发优先保证稳定性。
      // TRADE-OFF: 吞吐会慢一些，但后续可以通过环境变量或迁移 BullMQ 横向扩展。
      concurrency: options.concurrency ?? 1
    });
  }

  add(job: WorkerJob): Promise<JobResult | void> {
    return this.queue.add(() => runJob(job));
  }

  get size() {
    return this.queue.size;
  }

  get pending() {
    return this.queue.pending;
  }

  onIdle() {
    return this.queue.onIdle();
  }
}
