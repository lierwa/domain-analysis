import { sourceExecutionFailureCategorySchema } from "@domain-analysis/shared";

export function classifySourceExecutionFailure(error: unknown) {
  const candidate = error && typeof error === "object" && "category" in error
    ? sourceExecutionFailureCategorySchema.safeParse(error.category) : undefined;
  if (candidate?.success) return candidate.data;
  const message = boundedMessage(error);
  if (/execution_process_lost|request_outcome_unknown/.test(message)) return "execution_process_lost" as const;
  if (/login_required|verification_required|access_denied|rate_limited|HTTP (401|403|429)/i.test(message)) {
    return "source_restricted" as const;
  }
  if (/not_found|HTTP 404|只允许 HTTPS|跨 origin|origin 未获|DNS 没有返回地址/i.test(message)) {
    return "plan_revision_required" as const;
  }
  if (/内容验收未达标|target 数量未对账/i.test(message)) return "content_not_accepted" as const;
  if (/ECONNRESET|EAI_AGAIN|ETIMEDOUT|HTTP\/2.*internal|socket disconnected|请求超时/i.test(message)) {
    return "transient_transport" as const;
  }
  return "contract_fault" as const;
}

export function observationFailureCategory(state: string) {
  if (state === "login_required" || state === "verification_required" || state === "access_denied") {
    return "source_restricted" as const;
  }
  if (state === "not_found") return "plan_revision_required" as const;
  return "contract_fault" as const;
}

function boundedMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_500) || "Provider 校验失败";
}
