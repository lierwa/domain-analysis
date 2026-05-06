/**
 * WHY: 超时是「无响应挂死」与「慢但可完成」的权衡；默认偏宽松，避免误杀慢接口。
 * TRADE-OFF: 环境变量为 0 时关闭对应层；关闭后仍可能无限挂起，需自行接受运维/任务状态风险。
 */

const DEFAULT_CRAWL_COLLECT_MS = 900_000; // 15 分钟：慢接口可跑完，又大幅降低任务永远停在 running 的概率
const DEFAULT_OFFICIAL_FETCH_MS = 300_000; // 5 分钟：单次 OAuth/搜索通常远小于此；可调大或置 0 关闭

/** 返回 null 表示不包 Promise.race，整段 collect 不设总上限（仅依赖各 HTTP 的 signal，若也为 0 则无上限）。 */
export function crawlCollectTimeoutMsOrNull(): number | null {
  const raw = process.env.CRAWL_COLLECT_TIMEOUT_MS;
  if (raw === undefined) {
    return DEFAULT_CRAWL_COLLECT_MS;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return DEFAULT_CRAWL_COLLECT_MS;
  }
  if (trimmed === "0") {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_CRAWL_COLLECT_MS;
  }
  if (n === 0) {
    return null;
  }
  return n;
}

/** 返回 undefined 表示 fetch 不传 signal（不限制单次请求时长）。 */
export function officialApiFetchSignal(env: NodeJS.ProcessEnv): AbortSignal | undefined {
  const raw = env.OFFICIAL_API_FETCH_TIMEOUT_MS;
  if (raw === undefined) {
    return AbortSignal.timeout(DEFAULT_OFFICIAL_FETCH_MS);
  }
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "0") {
    return trimmed === "0" ? undefined : AbortSignal.timeout(DEFAULT_OFFICIAL_FETCH_MS);
  }
  const n = Number(trimmed);
  const ms = Number.isFinite(n) && n > 0 ? n : DEFAULT_OFFICIAL_FETCH_MS;
  return AbortSignal.timeout(ms);
}
