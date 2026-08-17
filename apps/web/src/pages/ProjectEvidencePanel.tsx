import { useQuery } from "@tanstack/react-query";
import { Database, ExternalLink, RefreshCw } from "lucide-react";

import { fetchProjectEvidence } from "../lib/api";

export function ProjectEvidencePanel({ projectId }: { projectId: string }) {
  const evidence = useQuery({
    queryKey: ["project-evidence", projectId],
    queryFn: () => fetchProjectEvidence(projectId),
  });

  return (
    <section className="rounded-xl border border-line bg-surface p-5 sm:p-7" aria-label="原始证据">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4" aria-hidden="true" />原始证据</h3>
          <p className="mt-1 text-xs leading-5 text-muted">这里展示独立证据区中的原始最小片段；尚未清洗、映射或成为发布事实。</p>
        </div>
        <button type="button" className="button-secondary" onClick={() => evidence.refetch()} disabled={evidence.isFetching}>
          <RefreshCw className={`h-4 w-4 ${evidence.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />刷新
        </button>
      </div>
      {evidence.isError && <p className="mt-4 text-sm text-danger" role="alert">原始证据加载失败，请检查本地服务。</p>}
      {!evidence.isLoading && evidence.data?.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-line p-5 text-sm text-muted">尚未提交原始证据。</div>
      )}
      <div className="mt-4 space-y-4">
        {evidence.data?.map((request) => (
          <article key={request.request.id} className="min-w-0 rounded-lg border border-line bg-panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-sm font-medium">{request.request.question}</p><p className="mt-1 break-all text-xs text-muted">{request.request.id}</p></div>
              <span className="status-badge">{statusLabel(request.assessment.status)}</span>
            </div>
            {request.evidenceItems.map(({ item, contentText }) => (
              <div key={item.id} className="mt-4 min-w-0 border-t border-line pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span>{item.contentBytes} bytes · {item.contentIntegrity}</span>
                  {sourceUrl(request.sourceObservations, item.observationId) && <a className="inline-flex items-center gap-1 text-ink underline underline-offset-2" href={sourceUrl(request.sourceObservations, item.observationId)} target="_blank" rel="noreferrer">来源 <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
                </div>
                <pre className="mt-3 max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-ink p-3 text-xs leading-5 text-surface">{contentText}</pre>
              </div>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}

function statusLabel(status: string) {
  return ({ sufficient: "已满足", insufficient: "证据不足", waiting: "等待处理", failed: "失败", not_started: "未开始" } as Record<string, string>)[status] ?? status;
}

function sourceUrl(
  observations: Array<{ id: string; finalUrl?: string; requestedUrl: string }>,
  observationId: string,
) {
  const observation = observations.find((item) => item.id === observationId);
  return observation?.finalUrl ?? observation?.requestedUrl;
}
