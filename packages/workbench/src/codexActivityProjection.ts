interface CodexWebSearchPayload {
  query?: string | null;
  action?: {
    type: string;
    query?: string | null;
    queries?: string[] | null;
    url?: string | null;
  } | null;
  results?: unknown[] | null;
}

export function extractCodexWebSearchProjection(payload: CodexWebSearchPayload) {
  const queryCandidates = [payload.query, payload.action?.query, ...(payload.action?.queries ?? [])];
  const detail = queryCandidates
    .filter((value): value is string => typeof value === "string" && !safeWebUrl(value))
    .join("；") || undefined;
  const urlCandidates = [
    payload.query,
    payload.action?.url,
    payload.action?.query,
    ...(payload.action?.queries ?? []),
  ];
  const urls = new Set(urlCandidates.map((value) => value ? safeWebUrl(value) : undefined)
    .filter((value): value is string => Boolean(value)));

  // WHY：官方把 results 明确定义为可演进的 opaque JSON；这里只在外部 seam 有界提取 URL，不把未知结果结构扩散进领域 contract。
  collectWebUrls(payload.results, urls);
  return { detail, urls: [...urls] };
}

export function sanitizeCodexDisplayDetail(value: string) {
  return value
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\b(authorization|cookie|password|secret|token|api[_-]?key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[已隐藏]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[已隐藏]@")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function collectWebUrls(value: unknown, urls: Set<string>, depth = 0) {
  if (value === null || value === undefined || depth > 5 || urls.size >= 50) return;
  if (typeof value === "string") {
    const url = safeWebUrl(value);
    if (url) urls.add(url);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 100)) collectWebUrls(entry, urls, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const entry of Object.values(value).slice(0, 100)) collectWebUrls(entry, urls, depth + 1);
}

function safeWebUrl(value: string) {
  if (value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return undefined;
  }
}
