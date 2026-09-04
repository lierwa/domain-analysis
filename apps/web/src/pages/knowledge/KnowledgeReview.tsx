import type { KnowledgeAiRecommendation, KnowledgeCandidate, KnowledgeItem, KnowledgeReviewIssue,
  KnowledgeRunView } from "@domain-analysis/shared";
import { useEffect, useMemo, useState } from "react";
import { sourceAssetUrl } from "../../lib/api";
import { imageUrl, knowledgeApi } from "../../lib/knowledgeApi";
import type { KnowledgeAction } from "../KnowledgeWorkspace";

const issueLabels: Record<KnowledgeReviewIssue["code"], string> = {
  processing_failed: "加工失败", empty_content: "提取为空", unstructured_content: "内容归属",
  ocr_requires_review: "OCR 自动核验", image_requires_processing: "图片自动处理",
  image_requires_review: "图片自动验收", conflicting_values: "来源冲突",
};
type Lane = "human" | "automatic" | "processing" | "resolved";

export function KnowledgeReview({ view, action, busy }: { view: KnowledgeRunView; action: KnowledgeAction; busy: boolean }) {
  const buckets = useMemo(() => splitIssues(view.issues), [view.issues]);
  const automaticReview = currentAutomaticReview(view.aiReview);
  const [lane, setLane] = useState<Lane>(buckets.human.length ? "human" : buckets.automatic.length ? "automatic" : "resolved");
  const [selectedId, setSelectedId] = useState("");
  const visible = buckets[lane];
  const issue = visible.find(row => row.id === selectedId) ?? visible[0];
  useEffect(() => { if (!visible.some(row => row.id === selectedId)) setSelectedId(visible[0]?.id ?? ""); }, [selectedId, visible]);
  return <div className="kp-stack"><section className="kp-review-toolbar">
    <div className="kp-review-lanes" role="tablist" aria-label="审核队列">
      <LaneButton active={lane === "human"} count={buckets.human.length} label="需要人工" onClick={() => setLane("human")} />
      <LaneButton active={lane === "automatic"} count={buckets.automatic.length} label="自动处理中" onClick={() => setLane("automatic")} />
      <LaneButton active={lane === "processing"} count={buckets.processing.length} label="加工异常" onClick={() => setLane("processing")} />
      <LaneButton active={lane === "resolved"} count={buckets.resolved.length} label="已处理" onClick={() => setLane("resolved")} />
    </div>
    <AutomaticReviewStatus view={view} review={automaticReview} action={action} busy={busy} count={buckets.automatic.length} />
  </section>
  <div className="kp-review-workbench">
    <aside className="kp-review-queue" aria-label="问题列表">
      <header><strong>{laneTitle(lane)}</strong><span>{visible.length}</span></header>
      {visible.map(row => <button key={row.id} className={row.id === issue?.id ? "is-active" : ""}
        onClick={() => setSelectedId(row.id)}><span>{displayKind(row, isAutomaticallyHandled(row, automaticReview))}</span>
        <strong>{displayTitle(row, isAutomaticallyHandled(row, automaticReview))}</strong>
        <small>{issueSummary(row, isAutomaticallyHandled(row, automaticReview))}</small></button>)}
      {!visible.length && <p>当前队列为空</p>}
    </aside>
    <main className="kp-review-canvas">
      {issue ? <IssueWorkspace key={issue.id} issue={issue} view={view} action={action} busy={busy}
        automated={isAutomaticallyHandled(issue, automaticReview)}
        recommendation={automaticReview?.status === "completed"
          ? automaticReview.recommendations.find(row => row.issueId === issue.id) : undefined} />
        : <div className="kp-review-empty"><strong>当前没有需要处理的内容</strong></div>}
    </main>
  </div></div>;
}

function AutomaticReviewStatus({ view, review, action, busy, count }: { view: KnowledgeRunView; review?: KnowledgeRunView["aiReview"];
  action: KnowledgeAction; busy: boolean; count: number }) {
  const status = review?.status;
  if (status === "completed") return <div className="kp-ai-review-action"><span>自动判断完成 · {review!.model}</span></div>;
  if (status === "queued" || status === "running") return <div className="kp-ai-review-action"><span>正在自动判断与处理图片…</span></div>;
  if (!count) return null;
  return <div className="kp-ai-review-action">
    {status === "failed" && <span className="is-error">自动判断失败：{review?.error}</span>}
    <button disabled={busy} onClick={() => void action(() =>
      knowledgeApi.aiReview(view.run.packId, view.run.id, view.run.reviewRevision), "自动判断已进入队列")}>开始自动判断</button>
  </div>;
}

function LaneButton({ active, count, label, onClick }: { active: boolean; count: number; label: string; onClick(): void }) {
  return <button role="tab" aria-selected={active} onClick={onClick}><strong>{count}</strong><span>{label}</span></button>;
}

function IssueWorkspace({ issue, view, action, busy, automated, recommendation }: { issue: KnowledgeReviewIssue; view: KnowledgeRunView;
  action: KnowledgeAction; busy: boolean; automated: boolean; recommendation?: KnowledgeAiRecommendation }) {
  const candidates = useMemo(() => findCandidates(view.items, issue.candidateIds), [view.items, issue.candidateIds]);
  const [selected, setSelected] = useState<string[]>(recommendation?.candidateIds ?? issue.candidateIds.slice(0, 1));
  const [reason, setReason] = useState(recommendation?.rationale ?? "");
  const [openedAt] = useState(Date.now());
  const imageItem = view.items.find(item => issue.itemIds.includes(item.id) && item.input.format === "image");
  const admission = new Map(view.admission.candidates.map(row => [row.candidateId, row]));
  const imageCandidateId = issue.candidateIds[0];
  const imageAdmitted = imageCandidateId ? admission.get(imageCandidateId)?.admitted : undefined;
  const lane = route(issue);
  async function decide(decision: "accepted" | "excluded") {
    const humanSeconds = Math.max(1, Math.round((Date.now() - openedAt) / 1_000));
    await action(async () => {
      const chosen = issue.code === "conflicting_values" ? selected : issue.candidateIds;
      const first = await knowledgeApi.review(view.run.packId, view.run.id, { expectedRevision: view.run.reviewRevision,
        candidateIds: chosen, decision, reason, visualApproved: issue.code === "image_requires_review" && decision === "accepted",
        contentApproved: issue.code === "image_requires_review" && decision === "accepted", humanSeconds });
      const removed = issue.code === "conflicting_values" && decision === "accepted"
        ? issue.candidateIds.filter(id => !chosen.includes(id)) : [];
      if (removed.length) await knowledgeApi.review(view.run.packId, view.run.id, { expectedRevision: first.revision,
        candidateIds: removed, decision: "excluded", reason: `同组未采用：${reason}`,
        visualApproved: false, contentApproved: false, humanSeconds: 0 });
    }, decision === "accepted" ? "审核决定已保存" : "排除决定已保存");
  }
  return <div className="kp-review-detail"><header><div><span className="kp-issue-kind">{displayKind(issue, automated)}</span>
    <h3>{displayTitle(issue, automated)}</h3><p>{issue.summary}</p></div><span className={`kp-review-route is-${lane}`}>
      {issue.status === "resolved" && !automated ? "历史审核结果" : routeLabel(lane)}</span></header>
    {recommendation && <div className="kp-ai-recommendation"><strong>{automaticAction(recommendation, issue.code)}</strong>
      <span>{confidenceLabel(recommendation.confidence)} · {recommendation.rationale}</span></div>}
    {issue.code === "ocr_requires_review" && imageItem && <div className="kp-evidence-split">
      <SourceImage item={imageItem} title="原图" /><AutomaticOcrSummary candidates={candidates} admission={admission}
        pending={issue.status === "open"} automated={automated} />
    </div>}
    {issue.code === "image_requires_processing" && imageItem && <div className="kp-evidence-split">
      <SourceImage item={imageItem} title="原图" /><AutomaticImageSummary item={imageItem} admitted={imageAdmitted}
        pending={issue.status === "open"} automated={automated} />
    </div>}
    {issue.code === "image_requires_review" && imageItem && <div className="kp-image-compare"><SourceImage item={imageItem} title="原图" />
      <figure><figcaption>处理副本</figcaption><img alt="处理后的图片" src={`${imageUrl(view.run.packId, view.run.id, imageItem.id)}?revision=${view.run.reviewRevision}`} /></figure></div>}
    {issue.code === "conflicting_values" && <ConflictChoices issue={issue} candidates={candidates} selected={selected} busy={busy} onChange={setSelected} />}
    {issue.code === "unstructured_content" && <AutomaticGroupSummary candidates={candidates} admission={admission}
      pending={issue.status === "open"} automated={automated} />}
    {lane === "processing" && <div className="kp-review-processing"><strong>需要重新加工</strong><p>{issue.action}</p></div>}
    {lane === "human" && issue.status === "open" && <footer className="kp-review-decision">
      <label>判断依据<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={2000}
        placeholder="记录来源对照、适用条件和判断依据" /></label>
      <div className="kp-actions"><button className="kp-primary" disabled={busy || !selected.length || !reason.trim()}
        onClick={() => void decide("accepted")}>{issue.code === "conflicting_values" ? "保留所选值" : "确认图片可用"}</button>
        <button disabled={busy || !reason.trim()} onClick={() => void decide("excluded")}>排除整组</button></div>
    </footer>}
  </div>;
}

function AutomaticOcrSummary({ candidates, admission, pending, automated }: { candidates: ReturnType<typeof findCandidates>;
  admission: Map<string, KnowledgeRunView["admission"]["candidates"][number]>; pending: boolean; automated: boolean }) {
  const accepted = candidates.filter(({ candidate }) => admission.get(candidate.id)?.admitted).length;
  return <section className="kp-automatic-summary"><strong>{candidates.length} 行 OCR 文字</strong>
    <div><span><b>{accepted}</b> 行入包</span><span><b>{candidates.length - accepted}</b> 行自动隔离</span></div>
    <p>{pending ? "系统正在结合识别置信度、原图和内容归属完成整组判断。"
      : automated ? "本组已经批量处理，结果按当前版本冻结。" : "本组按已保存的历史审核决定冻结。"}</p></section>;
}

function AutomaticImageSummary({ item, admitted, pending, automated }: { item: KnowledgeItem; admitted?: boolean; pending: boolean; automated: boolean }) {
  const action = item.derivative?.automation?.action;
  return <section className="kp-automatic-summary"><strong>图片自动处理</strong>
    <p>{pending ? "系统正在判断原图可直接保留、需要自动处理水印，还是应当隔离。"
      : !automated ? (admitted ? "历史副本已按已保存决定入包" : "历史决定已隔离此图")
        : admitted && action === "keep" ? imageActionLabel("keep")
        : admitted && action === "remove_watermark" ? imageActionLabel("remove_watermark") : imageActionLabel("exclude")}</p>
    <small>处理结果保留原图哈希、处理方式与遮罩来源，可在版本中重复验证。</small></section>;
}

function AutomaticGroupSummary({ candidates, admission, pending, automated }: { candidates: ReturnType<typeof findCandidates>;
  admission: Map<string, KnowledgeRunView["admission"]["candidates"][number]>; pending: boolean; automated: boolean }) {
  const accepted = candidates.filter(({ candidate }) => admission.get(candidate.id)?.admitted).length;
  return <section className="kp-automatic-summary"><strong>{candidates.length} 个内容片段</strong>
    <div><span><b>{accepted}</b> 个入包</span><span><b>{candidates.length - accepted}</b> 个自动隔离</span></div>
    <p>{pending ? "系统正在判断内容是否属于当前知识包范围。"
      : automated ? "本组已经批量处理，结果按当前版本冻结。" : "本组按已保存的历史审核决定冻结。"}</p></section>;
}

function ConflictChoices({ issue, candidates, selected, busy, onChange }: { issue: KnowledgeReviewIssue;
  candidates: ReturnType<typeof findCandidates>; selected: string[]; busy: boolean; onChange(ids: string[]): void }) {
  return <div className="kp-review-candidates">{candidates.map(({ item, candidate }) => <label key={candidate.id}>
    <input type="radio" name={issue.id} checked={selected.includes(candidate.id)} disabled={busy}
      onChange={() => onChange([candidate.id])} />
    <span><strong>{candidate.text || candidate.label}</strong><small>{item.input.subjectName} · {candidate.locator} · <a href={item.input.url}
      target="_blank" rel="noreferrer">来源</a></small></span></label>)}</div>;
}

function SourceImage({ item, title }: { item: KnowledgeItem; title: string }) {
  const ref = item.input.ref;
  return <figure className="kp-source-image"><figcaption>{title}</figcaption><img alt={`${item.input.subjectName}${title}`}
    src={sourceAssetUrl(ref.taskId, ref.runId, ref.assetId!, "inline")} /></figure>;
}

function splitIssues(issues: KnowledgeReviewIssue[]) {
  return issues.reduce((groups, issue) => {
    if (issue.status === "resolved") groups.resolved.push(issue);
    else groups[route(issue)].push(issue);
    return groups;
  }, { human: [], automatic: [], processing: [], resolved: [] } as Record<Lane, KnowledgeReviewIssue[]>);
}
function route(issue: KnowledgeReviewIssue): Exclude<Lane, "resolved"> {
  if (["processing_failed", "empty_content"].includes(issue.code)) return "processing";
  if (issue.code === "conflicting_values") return "human";
  return "automatic";
}
function laneTitle(lane: Lane) { return ({ human: "需要人判断的整组问题", automatic: "系统正在批量判断", processing: "加工失败或缺失",
  resolved: "已自动处理或已确认" })[lane]; }
function routeLabel(lane: Exclude<Lane, "resolved">) { return ({ human: "人工整组判断", automatic: "系统批量处理", processing: "重新加工" })[lane]; }
function issueSummary(issue: KnowledgeReviewIssue, automated: boolean) { return issue.status === "resolved" && !automated
  ? "历史处置结果" : issue.code === "ocr_requires_review"
    ? `${issue.candidateIds.length} 行，整组自动处理` : issue.code === "image_requires_processing"
    ? "整图自动处理" : issue.code === "image_requires_review" ? "原图与处理副本自动对照" : issue.action; }
function displayTitle(issue: KnowledgeReviewIssue, automated: boolean) {
  if (issue.status !== "resolved") return issue.title;
  if (!automated) return issue.title;
  if (issue.code === "ocr_requires_review") return "图片文字已完成批量判断";
  if (issue.code === "image_requires_processing") return "图片处理已完成";
  if (issue.code === "image_requires_review") return "图片副本已完成自动验收";
  if (issue.code === "unstructured_content") return "内容归属已完成批量判断";
  return issue.title;
}
function displayKind(issue: KnowledgeReviewIssue, automated: boolean) {
  return issue.status === "resolved" && !automated ? "历史审核" : issueLabels[issue.code];
}
function currentAutomaticReview(review?: KnowledgeRunView["aiReview"]) {
  if (!review || review.status !== "completed") return review;
  return review.recommendations.every(value => value.protocol === "automatic-review-2") ? review : undefined;
}
function isAutomaticallyHandled(issue: KnowledgeReviewIssue, review?: KnowledgeRunView["aiReview"]) {
  return !!review && ["unstructured_content", "ocr_requires_review", "image_requires_processing",
    "image_requires_review"].includes(issue.code);
}
function automaticAction(value: KnowledgeAiRecommendation, code: KnowledgeReviewIssue["code"]) {
  if (code === "image_requires_review") return value.recommendation === "accept" ? "图片副本验收通过" : "图片副本已隔离";
  if (value.imageAction) return imageActionLabel(value.imageAction);
  return value.recommendation === "accept" ? "自动采用可靠内容" : value.recommendation === "exclude" ? "自动隔离" : "需要整组判断";
}
function imageActionLabel(value?: KnowledgeAiRecommendation["imageAction"]) {
  return value === "keep" ? "原图合格，自动生成标准 PNG 副本" : value === "remove_watermark"
    ? "已按识别坐标自动处理水印" : value === "exclude" ? "图片不合格，已隔离" : "等待自动图片判断";
}
function confidenceLabel(value: KnowledgeAiRecommendation["confidence"]) {
  return value === "high" ? "高置信" : value === "medium" ? "中置信" : "低置信";
}
function findCandidates(items: KnowledgeItem[], ids: string[]) {
  const wanted = new Set(ids);
  return items.flatMap(item => (item.result?.candidates ?? []).filter(candidate => wanted.has(candidate.id))
    .map(candidate => ({ item, candidate: candidate as KnowledgeCandidate })));
}
