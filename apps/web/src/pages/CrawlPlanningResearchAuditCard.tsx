import type { CrawlPlanResearchAudit } from "@domain-analysis/shared";

const areaLabels: Record<CrawlPlanResearchAudit["passes"][number]["area"], string> = {
  brand_landscape: "品类品牌发现",
  official_source_mapping: "逐品牌官网映射",
  parameters_and_manuals: "参数与说明书入口",
  standards_and_principles: "标准监管与底层原理",
};

const lensLabels: Record<string, string> = {
  authoritative_directory: "权威目录",
  broad_market_catalog: "广覆盖市场目录",
  mainstream_brands: "主流品牌",
  long_tail_and_niche: "长尾与细分品牌",
  regional_and_imported: "区域与进口品牌",
  saturation_check: "饱和核查",
};

export function CrawlPlanningResearchAuditCard({ audit }: { audit: CrawlPlanResearchAudit }) {
  const planned = audit.brands.filter((brand) => brand.status === "planned").length;
  const unresolved = audit.brands.length - planned;
  const currentAudit = audit.strategyVersion !== 1 ? audit : undefined;
  return (
    <section className="mt-5 rounded-lg border border-line bg-panel p-4" aria-label="AI 深度来源调查">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">AI 深度来源调查</p>
          <p className="mt-1 text-xs leading-5 text-muted">{audit.marketScope}</p>
        </div>
        <span className="status-badge">{audit.completeness === "complete" ? "已对账" : "部分覆盖"}</span>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric label={currentAudit ? "覆盖分母" : "发现品牌"} value={audit.brands.length} />
        <Metric label="已规划官网" value={planned} />
        <Metric label="未解决品牌" value={unresolved} />
      </dl>
      <details className="mt-4 rounded-lg border border-line bg-surface p-3">
        <summary className="cursor-pointer text-sm font-semibold">查看深度搜索记录</summary>
        <div className="mt-3 space-y-4">
          {audit.passes.map((pass, index) => (
            <div key={`${pass.area}-${index}`}>
              <p className="text-xs font-semibold">{areaLabels[pass.area]}{
                "lens" in pass ? ` / ${lensLabels[pass.lens] ?? pass.lens}` : ""
              } · {pass.query}</p>
              <p className="mt-1 text-xs leading-5 text-muted">{pass.finding}</p>
              {"discoveredBrands" in pass && <p className="mt-1 text-xs leading-5 text-muted">本轮发现：{
                pass.discoveredBrands.join("、") || "无"
              }；首次新增：{pass.newlyAddedBrands.join("、") || "无"}</p>}
              <div className="mt-1 space-y-1">
                {pass.evidenceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"
                  className="block break-all text-xs text-muted underline underline-offset-2 hover:text-ink">{url}</a>)}
              </div>
            </div>
          ))}
        </div>
      </details>
      <details className="mt-3 rounded-lg border border-line bg-surface p-3">
        <summary className="cursor-pointer text-sm font-semibold">查看逐品牌对账</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {audit.brands.map((brand) => (
            <div key={brand.name} className="rounded border border-line p-3 text-xs leading-5">
              <p className="font-semibold">{brand.name} · {brand.status === "planned" ? "已规划官网" : "未解决"}</p>
              <p className="mt-1 text-muted">{brand.note}</p>
              {brand.officialSourceKeys.length > 0 && <p className="mt-1 text-muted">来源：{brand.officialSourceKeys.join("、")}</p>}
            </div>
          ))}
        </div>
      </details>
      {currentAudit && <p className="mt-3 text-xs leading-5 text-muted">覆盖分母：{
        currentAudit.denominator.method === "public_registry_or_directory" ? "公开注册表/完整目录" : "多来源并集"
      } · {currentAudit.denominator.description}</p>}
      <p className="mt-3 text-xs leading-5 text-muted">停止口径：{audit.stopReason}</p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-line bg-surface p-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-lg font-semibold">{value}</dd></div>;
}
