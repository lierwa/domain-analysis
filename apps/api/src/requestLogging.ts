import type { FastifyInstance, FastifyRequest } from "fastify";

export interface RequestLoggingOptions {
  summaryIntervalMs?: number;
  summaryMinCount?: number;
  slowThresholdMs?: number;
}

interface RequestSummary {
  method: string;
  route: string;
  status: number;
  count: number;
  totalMs: number;
  maxMs: number;
}

const DEFAULT_SUMMARY_INTERVAL_MS = 10_000;
const DEFAULT_SUMMARY_MIN_COUNT = 3;
const DEFAULT_SLOW_THRESHOLD_MS = 1000;

export function registerRequestLogging(app: FastifyInstance, options: RequestLoggingOptions = {}) {
  const startedAtByRequest = new WeakMap<FastifyRequest, number>();
  const summaries = new Map<string, RequestSummary>();
  const summaryIntervalMs = options.summaryIntervalMs ?? DEFAULT_SUMMARY_INTERVAL_MS;
  const summaryMinCount = options.summaryMinCount ?? DEFAULT_SUMMARY_MIN_COUNT;
  const slowThresholdMs = options.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS;

  app.addHook("onRequest", (request, _reply, done) => {
    startedAtByRequest.set(request, performance.now());
    done();
  });

  app.addHook("onResponse", (request, reply, done) => {
    const durationMs = getDurationMs(request, startedAtByRequest);
    const method = request.method;
    const route = getRoutePattern(request);
    const status = reply.statusCode;
    const logPayload = {
      method,
      route,
      status,
      durationMs,
      reqId: request.id
    };

    // WHY: 错误和慢请求必须逐条保留；普通 GET 聚合，避免前端刷新把控制台刷屏。
    // TRADE-OFF: 聚合窗口内的单次成功 GET 不再实时可见，换取更清晰的业务日志信号。
    if (status >= 400) {
      app.log.error(logPayload, "request.error");
      done();
      return;
    }

    if (durationMs >= slowThresholdMs) {
      app.log.info(logPayload, "request.slow");
      done();
      return;
    }

    if (method === "GET") {
      addSummary(summaries, { method, route, status, durationMs });
      done();
      return;
    }

    app.log.info(logPayload, "request.completed");
    done();
  });

  const interval = setInterval(() => {
    flushRequestSummaries(app, summaries, summaryMinCount);
  }, summaryIntervalMs);
  interval.unref();

  app.addHook("onClose", (_instance, done) => {
    clearInterval(interval);
    flushRequestSummaries(app, summaries, summaryMinCount);
    done();
  });
}

function addSummary(
  summaries: Map<string, RequestSummary>,
  input: { method: string; route: string; status: number; durationMs: number }
) {
  const key = `${input.method} ${input.route} ${input.status}`;
  const current = summaries.get(key);
  if (current) {
    current.count += 1;
    current.totalMs += input.durationMs;
    current.maxMs = Math.max(current.maxMs, input.durationMs);
    return;
  }
  summaries.set(key, {
    method: input.method,
    route: input.route,
    status: input.status,
    count: 1,
    totalMs: input.durationMs,
    maxMs: input.durationMs
  });
}

function flushRequestSummaries(
  app: FastifyInstance,
  summaries: Map<string, RequestSummary>,
  summaryMinCount: number
) {
  for (const summary of summaries.values()) {
    if (summary.count < summaryMinCount) continue;
    app.log.info(
      {
        method: summary.method,
        route: summary.route,
        status: summary.status,
        count: summary.count,
        avgMs: roundDuration(summary.totalMs / summary.count),
        maxMs: roundDuration(summary.maxMs)
      },
      "request.summary"
    );
  }
  summaries.clear();
}

function getDurationMs(request: FastifyRequest, startedAtByRequest: WeakMap<FastifyRequest, number>) {
  const startedAt = startedAtByRequest.get(request);
  return roundDuration(startedAt === undefined ? 0 : performance.now() - startedAt);
}

function getRoutePattern(request: FastifyRequest) {
  const routeOptions = request.routeOptions as { url?: string } | undefined;
  return routeOptions?.url ?? request.url.split("?")[0] ?? request.url;
}

function roundDuration(value: number) {
  return Math.round(value * 10) / 10;
}
