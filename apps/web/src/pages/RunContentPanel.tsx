import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PaginationControls } from "../components/PaginationControls";
import { fetchInsightCandidates, fetchRunContents, type AiInsightCandidate, type RunContent } from "../lib/api";
import { formatDateTime, shortId } from "../lib/format";

interface RunContentPanelProps {
  runId: string;
}

const PAGE_SIZE = 20;

// WHY: RunContentPanel 只查询当前 run 的内容，禁止跨 run 混用，保证分析可追溯。
export function RunContentPanel({ runId }: RunContentPanelProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [author, setAuthor] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [authorInput, setAuthorInput] = useState("");

  const contentsQuery = useQuery({
    queryKey: ["run-contents", runId, page, search, author],
    queryFn: () =>
      fetchRunContents(runId, {
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        author: author || undefined
      })
  });
  const candidatesQuery = useQuery({
    queryKey: ["run-insights", runId, "content-candidates"],
    queryFn: () => fetchInsightCandidates(runId, { page: 1, pageSize: 100 })
  });
  const candidateByRawId = new Map((candidatesQuery.data?.items ?? []).map((candidate) => [candidate.rawContentId, candidate]));

  function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    setSearch(searchInput);
    setAuthor(authorInput);
    setPage(1);
  }

  function handleReset() {
    setSearch("");
    setAuthor("");
    setSearchInput("");
    setAuthorInput("");
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search content…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="input-base flex-1 min-w-36"
        />
        <input
          type="text"
          placeholder="Author"
          value={authorInput}
          onChange={(e) => setAuthorInput(e.target.value)}
          className="input-base w-36"
        />
        <button
          type="submit"
          className="rounded border border-line px-3 py-1.5 text-sm hover:bg-surface"
        >
          Filter
        </button>
        {(search || author) && (
          <button
            type="button"
            onClick={handleReset}
            className="rounded border border-line px-3 py-1.5 text-sm text-muted hover:text-ink"
          >
            Reset
          </button>
        )}
      </form>

      {/* Content list */}
      {contentsQuery.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {contentsQuery.isError && <p className="text-sm text-red-600">Failed to load contents.</p>}

      {contentsQuery.data?.items.length === 0 && (
        <p className="text-sm text-muted">No content found for this run.</p>
      )}

      <div className="flex flex-col gap-3">
        {contentsQuery.data?.items.map((content) => (
          <ContentCard key={content.id} content={content} aiCandidate={candidateByRawId.get(content.id)} />
        ))}
      </div>

      {contentsQuery.data && contentsQuery.data.page.total > PAGE_SIZE && (
        <PaginationControls
          page={contentsQuery.data.page}
          onPageChange={setPage}
          disabled={contentsQuery.isFetching}
        />
      )}

      {contentsQuery.data && (
        <p className="text-xs text-muted">
          {contentsQuery.data.page.total} items in this run
        </p>
      )}
    </div>
  );
}

// Content Card

export function ContentCard({ content, aiCandidate }: { content: RunContent; aiCandidate?: AiInsightCandidate }) {
  const score = (content.metricsJson?.score as number | undefined) ?? null;
  const comments = getCommentCount(content.metricsJson);
  const detail = content.rawJson?.detail;
  const mediaState = content.rawJson?.media?.status ?? null;
  const mediaAssets = content.rawJson?.media?.assets ?? [];
  const detailReady = detail?.fetchStatus === "success";
  const title = pickDisplayTitle(content);
  const summary = pickDisplaySummary(content, title);
  const detailBody = detailReady ? cleanDisplayText(detail.body ?? "") : "";
  const mediaLinks = collectMediaUrls(content, detail);
  const topComments = detailReady
    ? (detail.topComments ?? [])
      .map((comment) => ({
        ...comment,
        text: normalizeCommentForDisplay(comment.text, comment.author)
      }))
      .filter((comment) => comment.text)
      .slice(0, 3)
    : [];
  const showDetailBody = detailBody && !isSummaryCoveredByDetail(summary, detailBody);
  const hasDetailSection = Boolean(detail) || mediaLinks.length > 0 || mediaAssets.length > 0;

  return (
    <article className="rounded-lg border border-line p-4">
      {/* Meta */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {content.authorName && <span className="font-medium text-ink">u/{content.authorName}</span>}
        {content.publishedAt && <span>{formatDateTime(content.publishedAt)}</span>}
        {score !== null && <span>Score {score}</span>}
        {comments !== null && <span>Comments {comments}</span>}
        {mediaState === "processing" && <span>Media processing</span>}
        {mediaState === "ready" && mediaAssets.length > 0 && <span>Media ready</span>}
        {content.crawlTaskId && (
          <span className="font-mono opacity-60">task #{shortId(content.crawlTaskId)}</span>
        )}
        {aiCandidate && <AiStatusBadge candidate={aiCandidate} />}
      </div>

      {title && <h4 className="text-sm font-semibold text-ink">{title}</h4>}
      {!detailReady && <p className="mt-1 text-sm leading-relaxed text-muted line-clamp-3">{summary}</p>}

      {/* Footer */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {content.matchedKeywords.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {content.matchedKeywords.map((kw) => (
              <span
                key={kw}
                className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700"
              >
                {kw}
              </span>
            ))}
          </div>
        )}
        <a
          href={content.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs text-muted underline hover:text-ink"
        >
          View source ↗
        </a>
      </div>

      {hasDetailSection && (
        <details className="mt-3 rounded border border-line/70 p-2">
          <summary className="cursor-pointer text-xs text-muted">
            Detail: {detailReady ? "ready" : detail ? `failed${detail.error ? ` (${detail.error})` : ""}` : "collected"}
          </summary>
          <div className="mt-2 space-y-2 text-xs">
            {showDetailBody && <p className="text-muted whitespace-pre-line">{detailBody}</p>}
            {renderMediaBlock(mediaState, mediaAssets, mediaLinks)}
            {topComments.length > 0 && (
              <div className="space-y-2">
                <p className="text-ink">Top comments</p>
                {topComments.map((comment, index) => (
                  <div
                    key={`${comment.author ?? "anon"}-${index}`}
                    className="rounded-md bg-slate-100 p-2 text-muted"
                  >
                    {comment.author && (
                      <span className="mr-1 inline-block rounded bg-slate-200 px-1 py-0.5 text-[11px] text-slate-700">
                        {comment.author}
                      </span>
                    )}
                    <span>{comment.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}

      <p className="mt-2 text-xs text-muted">
        Captured {formatDateTime(content.capturedAt)}
      </p>
    </article>
  );
}

function AiStatusBadge({ candidate }: { candidate: AiInsightCandidate }) {
  if (candidate.selected) {
    return <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-700">Selected for AI</span>;
  }
  const label =
    candidate.excludedReason === "duplicate"
      ? "Excluded: duplicate"
      : candidate.excludedReason === "budget_cap"
        ? "Excluded: budget cap"
        : "Excluded: low signal";
  return <span className="rounded bg-surface px-1.5 py-0.5 text-muted">{label}</span>;
}

function getCommentCount(metrics: Record<string, unknown> | null) {
  const comments = metrics?.comments;
  if (typeof comments === "number") return comments;
  const legacyComments = metrics?.num_comments;
  return typeof legacyComments === "number" ? legacyComments : null;
}

function collectMediaUrls(content: RunContent, detail?: NonNullable<RunContent["rawJson"]>["detail"]) {
  const urls = new Set<string>();
  for (const url of content.mediaUrls ?? []) {
    if (typeof url === "string" && url.startsWith("http")) urls.add(url);
  }
  for (const url of detail?.mediaUrls ?? []) {
    if (typeof url === "string" && url.startsWith("http")) urls.add(url);
  }
  return Array.from(urls);
}

function renderMediaBlock(
  status: "pending" | "processing" | "ready" | "failed" | "skipped" | undefined | null,
  assets: Array<{
    originalUrl: string;
    thumbnailUrl: string;
    thumbnailPath: string;
    width: number;
    height: number;
    format: "jpeg" | "png";
  }>,
  links: string[]
) {
  if (assets.length > 0) {
    return (
      <div className="space-y-2">
        <p className="text-ink">Media</p>
        <div className="grid grid-cols-3 gap-2">
          {assets.map((asset) => (
            <a
              key={asset.thumbnailUrl}
              href={asset.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded border border-line"
            >
              <img
                src={asset.thumbnailUrl}
                alt="media thumbnail"
                className="h-24 w-full object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      </div>
    );
  }

  if (status === "processing" || status === "pending") {
    return <p className="text-muted">Media: processing thumbnails...</p>;
  }

  if (links.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-ink">Media links</p>
      {links.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-muted underline hover:text-ink"
        >
          {url}
        </a>
      ))}
    </div>
  );
}

function pickDisplayTitle(content: RunContent) {
  const detailTitle = asText(content.rawJson?.detail?.title);
  if (detailTitle) return detailTitle;
  const searchCardTitle = asText(content.rawJson?.searchCard?.title);
  if (searchCardTitle) return searchCardTitle;
  const lines = cleanDisplayText(content.text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines[0] ?? "";
}

function pickDisplaySummary(content: RunContent, title: string) {
  const detailBody = asText(content.rawJson?.detail?.body);
  const sourceText = detailBody || content.text;
  const cleaned = cleanDisplayText(sourceText);
  if (!title) return cleaned;
  const escapedTitle = escapeRegExp(title);
  // WHY: 列表摘要要避免和标题重复，用户应一眼看到“主题 + 新信息”。
  // TRADE-OFF: 只在开头剔除一次标题，避免误删正文中同词句。
  return cleaned.replace(new RegExp(`^${escapedTitle}\\s*`, "i"), "").trim() || cleaned;
}

function normalizeCommentForDisplay(text: string, author?: string) {
  const cleaned = cleanDisplayText(text).replace(/\s+\d+\s*$/, "").trim();
  if (!cleaned) return "";
  const generic = cleaned.replace(/^[^\s:]{1,60}\s*•\s*[^ ]+\s+ago\s+/i, "");
  if (!author) return generic.trim();
  const escapedAuthor = escapeRegExp(author);
  return generic.replace(new RegExp(`^${escapedAuthor}\\s*:\\s*`, "i"), "").trim();
}

function cleanDisplayText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/SML\.load\([\s\S]*?\);\s*/gi, "")
    .replace(/\bRead more\b/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeForCompare(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isSummaryCoveredByDetail(summary: string, detailBody: string) {
  const normalizedSummary = normalizeForCompare(summary);
  const normalizedDetail = normalizeForCompare(detailBody);
  if (!normalizedSummary || !normalizedDetail) return false;
  return normalizedDetail.includes(normalizedSummary);
}

function asText(value: unknown) {
  return typeof value === "string" ? cleanDisplayText(value) : "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
