export interface BusinessLogger {
  info(payload: Record<string, unknown>, message?: string): void;
  error(payload: Record<string, unknown>, message?: string): void;
}

export interface ServiceLoggingOptions {
  logger?: BusinessLogger;
}

export function logBusinessInfo(
  logger: BusinessLogger | undefined,
  message: string,
  payload: Record<string, unknown>
) {
  // WHY: service 可在测试中不传 logger；生产环境复用 Fastify/Pino，避免引入第二套日志基础设施。
  logger?.info(payload, message);
}

export function logBusinessError(
  logger: BusinessLogger | undefined,
  message: string,
  payload: Record<string, unknown>
) {
  logger?.error(payload, message);
}
