import { knowledgeAdmissionSchema, knowledgeReviewIssueSchema, type KnowledgeCandidate, type KnowledgeDecision,
  type KnowledgeAiReview, type KnowledgeItem, type KnowledgeReviewIssue, type KnowledgeRun } from "@domain-analysis/shared";
import { digest } from "./storage";

type IssueCode = KnowledgeReviewIssue["code"];

export function candidateIndex(items: KnowledgeItem[]) {
  return new Map(items.flatMap(item => (item.result?.candidates ?? [])
    .map(candidate => [candidate.id, { candidate, item }] as const)));
}

export function assessAdmission(run: KnowledgeRun, items: KnowledgeItem[], decisions: KnowledgeDecision[], aiReview?: KnowledgeAiReview) {
  const index = candidateIndex(items);
  const latest = latestDecisions(index, decisions);
  const { issues, candidateIssues } = detectIssues(items, index, latest);
  // WHY：AI 结果只对生成它的加工代次和审核修订有效，避免历史建议覆盖后续人工决定或重加工结果。
  const currentAiReview = aiReview?.generation === run.generation && aiReview.reviewRevision === run.reviewRevision
    ? aiReview : undefined;
  const automatic = automaticDecisions(issues, currentAiReview);
  const groups = decisionRelations(decisions, "factKey");
  const dependencies = decisionRelations(decisions, "dependsOn");
  const rows = [...index].map(([id, { candidate, item }]) => {
    const review = latest.get(id);
    const machine = automatic.get(id);
    // WHY：自动生成的是一份新图片内容，旧像素上的人工决定不能覆盖本轮视觉模型验收。
    const applicableReview = candidate.kind === "image" && item.derivative?.automation ? undefined : review;
    const issueCodes = candidateIssues.get(id) ?? new Set<IssueCode>();
    const decision = applicableReview?.decision ?? machine?.decision ?? (issueCodes.size ? "pending" as const : "accepted" as const);
    const reason = baseReason(candidate, item, applicableReview, machine, issueCodes);
    return { candidateId: id, decision, admitted: !reason, automatic: !applicableReview && !reason,
      reason: reason ?? (applicableReview ? "人工问题已处理" : machine?.reason ?? "结构校验通过"),
      factKeys: [...(groups.get(id) ?? [])], dependsOn: [...(dependencies.get(id) ?? [])] };
  });
  propagateIsolation(rows);
  const admitted = rows.filter(row => row.admitted);
  const resolvedIssues = issues.map(issue => knowledgeReviewIssueSchema.parse({ ...issue,
    status: issueResolved(issue, rows, index) ? "resolved" : "open" }));
  const openIssues = resolvedIssues.filter(issue => issue.status === "open");
  const gaps: string[] = [];
  if (items.some(item => item.status !== "completed")) gaps.push("所选批次仍有原件未完成加工");
  if (!admitted.length) gaps.push("至少需要一项通过校验的内容");
  const admission = knowledgeAdmissionSchema.parse({ candidates: rows, accepted: admitted.length,
    images: admitted.filter(row => index.get(row.candidateId)!.candidate.kind === "image").length,
    autoAccepted: admitted.filter(row => row.automatic).length,
    reviewAccepted: admitted.filter(row => !row.automatic).length,
    excluded: rows.filter(row => row.decision === "excluded").length,
    openIssues: openIssues.length, quarantined: rows.length - admitted.length, gaps });
  return { ...admission, issues: resolvedIssues };
}

function automaticDecisions(issues: Omit<KnowledgeReviewIssue, "status">[], aiReview?: KnowledgeAiReview) {
  const decisions = new Map<string, { decision: "accepted" | "excluded"; reason: string }>();
  if (aiReview?.status !== "completed") return decisions;
  const recommendations = new Map(aiReview.recommendations.map(value => [value.issueId, value]));
  for (const issue of issues.filter(value => ["unstructured_content", "ocr_requires_review", "image_requires_processing",
    "image_requires_review"].includes(value.code))) {
    const recommendation = recommendations.get(issue.id);
    if (recommendation?.protocol !== "automatic-review-2") continue;
    const accepted = recommendation.confidence === "high" && recommendation.recommendation === "accept"
      ? new Set(recommendation.candidateIds) : new Set<string>();
    for (const id of issue.candidateIds) decisions.set(id, accepted.has(id)
      ? { decision: "accepted", reason: `自动核验通过：${recommendation.rationale}` }
      : { decision: "excluded", reason: `自动隔离：${recommendation.rationale}` });
  }
  return decisions;
}

function latestDecisions(index: ReturnType<typeof candidateIndex>, decisions: KnowledgeDecision[]) {
  const latest = new Map<string, KnowledgeDecision>();
  for (const decision of decisions) for (const id of decision.candidateIds) {
    if (decision.contentHashes[id] === index.get(id)?.candidate.contentHash) latest.set(id, decision);
  }
  return latest;
}

function decisionRelations(decisions: KnowledgeDecision[], field: "factKey" | "dependsOn") {
  const relations = new Map<string, Set<string>>();
  for (const decision of decisions) for (const id of decision.candidateIds) {
    const values = field === "factKey" ? (decision.factKey ? [decision.factKey] : []) : decision.dependsOn;
    relations.set(id, new Set([...(relations.get(id) ?? []), ...values]));
  }
  return relations;
}

function detectIssues(items: KnowledgeItem[], index: ReturnType<typeof candidateIndex>, latest: Map<string, KnowledgeDecision>) {
  const issues: Omit<KnowledgeReviewIssue, "status">[] = [];
  const candidateIssues = new Map<string, Set<IssueCode>>();
  const add = (code: IssueCode, title: string, summary: string, action: string,
    itemIds: string[], candidateIds: string[], key: string) => {
    issues.push({ id: digest({ code, key, candidateIds }), code, title, summary, action, itemIds, candidateIds });
    for (const id of candidateIds) candidateIssues.set(id, new Set([...(candidateIssues.get(id) ?? []), code]));
  };
  for (const item of items) {
    const candidates = item.result?.candidates ?? [];
    if (item.status !== "completed" || candidates.length === 0) add("processing_failed", "原件没有形成可用内容",
      item.error ?? item.result?.notes.join("；") ?? "加工未完成", "检查原件状态或加工规则后重试", [item.id], [], item.id);
    const empty = candidates.filter(candidate => candidate.kind === "text" && !candidate.text.trim());
    if (empty.length) add("empty_content", "发现空内容", `${empty.length} 个字段只有标签，没有可用值`,
      "确认来源确实为空，或排除这些字段", [item.id], empty.map(row => row.id), item.id);
    const unstructured = item.input.format === "text" ? candidates.filter(candidate => candidate.kind === "text") : [];
    if (unstructured.length) add("unstructured_content", "原文片段需要确认归属", `${unstructured.length} 个片段尚未映射为稳定字段`,
      "确认这些片段属于当前 Skill 范围，或排除", [item.id], unstructured.map(row => row.id), item.id);
    const ocr = candidates.filter(candidate => candidate.kind === "text" && candidate.locator.startsWith("OCR line "));
    if (ocr.length) add("ocr_requires_review", "图片文字需要核对", `OCR 从图片中识别出 ${ocr.length} 行文字`,
      "对照原图后整组确认或排除", [item.id], ocr.map(row => row.id), item.id);
    const image = candidates.find(candidate => candidate.kind === "image");
    if (image && !item.derivative && latest.get(image.id)?.decision !== "excluded") add("image_requires_processing", "图片尚未形成合格副本",
      "图片只有原件，尚未完成水印区域处理与像素边界校验", "在图片处理区生成副本，或排除此图", [item.id], [image.id], item.id);
    if (image && item.derivative) {
      const review = latest.get(image.id);
      if (item.derivative.automation || !review || review.decision === "pending"
        || (review.decision === "accepted" && (!review.visualApproved || !review.contentApproved))) {
        add("image_requires_review", "图片副本需要验收", "系统对照原图与副本，检查内容完整性、修补痕迹和水印残留",
          "由视觉模型对照原图与副本，合格则入包，否则隔离", [item.id], [image.id], item.id);
      }
    }
  }
  const fields = new Map<string, { itemIds: Set<string>; candidates: KnowledgeCandidate[] }>();
  for (const { item, candidate } of index.values()) {
    // WHY：冲突比较只适用于已映射的结构化字段；OCR 行和原文段落共用标签但不是同一事实。
    if (candidate.kind !== "text" || !candidate.text.trim() || item.input.format !== "html") continue;
    const key = `${item.input.ref.taskId}:${item.input.subjectKey}:${candidate.label.trim().toLocaleLowerCase()}`;
    const group = fields.get(key) ?? { itemIds: new Set<string>(), candidates: [] };
    group.itemIds.add(item.id); group.candidates.push(candidate); fields.set(key, group);
  }
  for (const [key, group] of fields) {
    const values = new Set(group.candidates.map(candidate => normalizeValue(candidate.text)));
    if (values.size > 1) add("conflicting_values", "同一字段存在不同来源值", `${group.candidates.length} 条记录形成 ${values.size} 个不同值`,
      "比较来源与适用条件，只确认可同时成立的值", [...group.itemIds], group.candidates.map(row => row.id), key);
  }
  return { issues, candidateIssues };
}

function baseReason(candidate: KnowledgeCandidate, item: KnowledgeItem, review: KnowledgeDecision | undefined,
  machine: { decision: "accepted" | "excluded"; reason: string } | undefined,
  issueCodes: Set<IssueCode>) {
  if (item.status !== "completed") return "原件加工尚未完成";
  if (review?.decision === "excluded") return "审核已排除";
  if (!review && machine?.decision === "excluded") return machine.reason;
  if (review?.decision === "pending") return "问题等待处理";
  if (issueCodes.size && review?.decision !== "accepted" && machine?.decision !== "accepted") return "检测到需要处理的问题";
  if (candidate.kind === "image" && !item.derivative) return "图片尚未形成合格副本";
  if (candidate.kind === "image" && !item.derivative?.automation
    && (!review?.visualApproved || !review.contentApproved)) {
    return "图片副本尚未同时通过效果与内容验收";
  }
  return undefined;
}

function propagateIsolation(rows: ReturnType<typeof knowledgeAdmissionSchema.parse>["candidates"]) {
  const byId = new Map(rows.map(row => [row.candidateId, row]));
  let changed = true;
  while (changed) {
    changed = false;
    const blockedGroups = new Set(rows.filter(row => !row.admitted).flatMap(row => row.factKeys));
    for (const row of rows.filter(value => value.admitted)) {
      if (row.factKeys.some(key => blockedGroups.has(key)) || row.dependsOn.some(id => !byId.get(id)?.admitted)) {
        row.admitted = false; row.automatic = false; row.reason = "关联内容仍有未决问题"; changed = true;
      }
    }
  }
}

function issueResolved(issue: Omit<KnowledgeReviewIssue, "status">,
  rows: ReturnType<typeof knowledgeAdmissionSchema.parse>["candidates"], index: ReturnType<typeof candidateIndex>) {
  if (!issue.candidateIds.length) return false;
  const affected = rows.filter(row => issue.candidateIds.includes(row.candidateId));
  if (affected.some(row => row.decision === "pending")) return false;
  if (issue.code !== "conflicting_values") return affected.every(row => row.admitted || row.decision === "excluded");
  const admittedValues = new Set(affected.filter(row => row.admitted)
    .map(row => normalizeValue(index.get(row.candidateId)!.candidate.text)));
  return admittedValues.size <= 1 && affected.every(row => row.admitted || row.decision === "excluded");
}

const normalizeValue = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
