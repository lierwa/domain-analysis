import type {
  SourceDatasetRecordGroupKey,
  SourceDatasetRecordSummary,
  SourceDatasetResourceFormat,
} from "@domain-analysis/shared";

export function sourceKindGroup(kind?: string) {
  if (kind === "brand_official") return "brand_official";
  if (kind === "retailer") return "market";
  if (kind === "standards_body" || kind === "regulator") return "standards_regulation";
  if (kind === "technical_publisher" || kind === "industry_organization") return "technical_industry";
  return "other";
}

export function sourceGroupDefinition(key: string) {
  if (key === "brand_official") return { title: "品牌官网", description: "品牌官方产品目录、参数、商城与说明书" };
  if (key === "market") return { title: "市场目录", description: "跨品牌公开市场目录" };
  if (key === "standards_regulation") return { title: "标准与监管", description: "标准状态、全文与监管依据" };
  if (key === "technical_industry") return { title: "技术与行业资料", description: "技术原理、路线与行业资料" };
  return { title: "其他计划来源", description: "计划中未归入上述类型的来源" };
}

export function normalizeMapText(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("zh-CN");
}

export function normalizeMapUrl(value: string) {
  try { return new URL(value).href; } catch { return value; }
}

export function mapUrlLabel(value: string) {
  try {
    const url = new URL(value);
    const tail = url.pathname.split("/").filter(Boolean).at(-1);
    return decodeURIComponent(tail ?? url.hostname);
  } catch { return value; }
}

export function lineageLabel(kind: NonNullable<SourceDatasetRecordSummary["lineage"]>["discoveryKind"]) {
  if (kind === "planned_entry") return "计划入口";
  if (kind === "sitemap_document") return "Sitemap 原件";
  if (kind === "sitemap_entry") return "Sitemap 发现";
  return "页面链接发现";
}

export function outcomeLabel(outcome: SourceDatasetRecordSummary["outcome"]) {
  if (outcome === "accepted") return "内容通过";
  if (outcome === "supporting") return "发现支撑";
  if (outcome === "rejected") return "内容不合格";
  return "采集失败";
}

export function recordGroupLabel(groupKey: SourceDatasetRecordGroupKey) {
  if (groupKey === "unrecorded") return "路径未记录";
  const [kind, depth] = groupKey.split(":");
  if (kind === "planned_entry") return "计划入口";
  if (kind === "sitemap_document") return `Sitemap 原件 · 第 ${Number(depth) + 1} 层`;
  if (kind === "sitemap_entry") return `Sitemap 发现 · 深度 ${depth}`;
  return `页面链接发现 · 深度 ${depth}`;
}

export function resourceFormatLabel(format: SourceDatasetResourceFormat) {
  const labels: Record<SourceDatasetResourceFormat, string> = {
    html: "HTML", json: "JSON", xml: "XML", csv: "CSV", text: "TEXT", pdf: "PDF",
    word: "WORD", spreadsheet: "XLSX", image: "IMAGE", video: "VIDEO", binary: "FILE",
    legacy: "LEGACY", unknown: "UNKNOWN",
  };
  return labels[format];
}

export function resourceFormatClass(format: SourceDatasetResourceFormat) {
  if (format === "html") return "border-orange-200 bg-orange-100 text-orange-900";
  if (format === "json") return "border-sky-200 bg-sky-100 text-sky-900";
  if (format === "xml") return "border-cyan-200 bg-cyan-100 text-cyan-900";
  if (format === "csv" || format === "spreadsheet") return "border-emerald-200 bg-emerald-100 text-emerald-900";
  if (format === "pdf") return "border-rose-200 bg-rose-100 text-rose-900";
  if (format === "word") return "border-blue-200 bg-blue-100 text-blue-900";
  if (format === "image") return "border-violet-200 bg-violet-100 text-violet-900";
  if (format === "video") return "border-fuchsia-200 bg-fuchsia-100 text-fuchsia-900";
  return "border-stone-300 bg-stone-100 text-stone-800";
}

export function formatMapBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
