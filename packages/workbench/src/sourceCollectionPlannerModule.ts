import {
  collectionAccessModes,
  sourceAccessPolicySchema,
  sourceAuthorityTypes,
  sourceClaimScopes,
  sourceObjectKinds,
  sourceParsingSchema,
  sourceUsagePermissionSchema,
  type CategoryResearchBriefVersion,
  type SourceCollectionPipelineRun,
  type SourceCollectionPlan,
  type SourceCollectionPlanIssue,
  type SourceCollectionWorkItem,
  type SourceCollectionRun,
} from "@domain-analysis/shared";
import { z } from "zod";

import { contentHash } from "./contentHash";
import type { CategoryInterviewModule } from "./categoryInterviewModule";
import { ProductProjectError, type ProductProjectModule } from "./productProjectModule";
import type { SourceCollectionPipelineModule } from "./sourceCollectionPipelineModule";
import type { SourceDatasetModule } from "./sourceDatasetModule";

const planningRuleSchema = z.object({
  id: z.string().min(1).max(240),
  providerKey: z.string().min(1).max(240),
  sourceIdentity: z.string().min(1).max(240),
  sourceAuthorityType: z.enum(sourceAuthorityTypes),
  accessMode: z.enum(collectionAccessModes),
  requestKinds: z.array(z.enum([
    "full_resource",
    "document_excerpt",
    "structured_record_lookup",
  ])).min(1).default(["full_resource"]),
  urlMatch: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("exact_url"), url: z.string().url() }).strict(),
    z.object({ kind: z.literal("origin"), origin: z.string().url() }).strict(),
  ]),
  objectKind: z.enum(sourceObjectKinds),
  parsing: sourceParsingSchema,
  claimScopes: z.array(z.enum(sourceClaimScopes)).min(1),
  usagePermission: sourceUsagePermissionSchema,
  accessPolicy: sourceAccessPolicySchema,
}).strict().superRefine((rule, context) => {
  const value = rule.urlMatch.kind === "origin" ? rule.urlMatch.origin : rule.urlMatch.url;
  const url = new URL(value);
  if (url.protocol !== "https:") {
    context.addIssue({ code: "custom", path: ["urlMatch"], message: "来源规则必须使用 HTTPS" });
  }
  if (rule.urlMatch.kind === "origin" && url.origin !== rule.urlMatch.origin) {
    context.addIssue({ code: "custom", path: ["urlMatch"], message: "origin 规则不能包含路径" });
  }
});

type PlanningRule = z.infer<typeof planningRuleSchema>;
type BriefLane = CategoryResearchBriefVersion["content"]["collectionLanes"][number];
type BriefReference = CategoryResearchBriefVersion["content"]["factReferences"][number];

export interface SourceCollectionPlannerModule {
  plan(projectId: string): Promise<SourceCollectionPlan>;
  start(projectId: string): Promise<SourceCollectionPlanLaunch>;
}

export interface SourceCollectionPlanLaunch {
  plan: SourceCollectionPlan;
  executions: SourceCollectionPlanExecution[];
}

export interface SourceCollectionPlanExecution {
  collectionLaneId: string;
  batchKey: string;
  providerKey: string;
  status: "started" | "reused" | "failed";
  sourceRun?: SourceCollectionRun;
  pipelineRun?: SourceCollectionPipelineRun;
  error?: string;
}

export interface SourceCollectionPlannerOptions {
  recipeVersion: string;
  rules: SourceCollectionPlanningRule[];
}

export type SourceCollectionPlanningRule = z.input<typeof planningRuleSchema>;

export class SourceCollectionPlannerError extends Error {
  constructor(
    readonly code: "confirmed_brief_missing" | "no_executable_work",
    message: string,
  ) {
    super(message);
    this.name = "SourceCollectionPlannerError";
  }
}

export function createSourceCollectionPlannerModule(
  projects: ProductProjectModule,
  interviews: CategoryInterviewModule,
  sourceDatasets: SourceDatasetModule,
  pipeline: SourceCollectionPipelineModule,
  options: SourceCollectionPlannerOptions,
): SourceCollectionPlannerModule {
  const recipeVersion = z.string().min(1).max(240).parse(options.recipeVersion);
  const rules = options.rules.map((rule) => planningRuleSchema.parse(rule));
  return {
    plan: (projectId) => planProject(projectId, projects, interviews, sourceDatasets, recipeVersion, rules),
    start: async (projectId) => {
      const plan = await planProject(
        projectId,
        projects,
        interviews,
        sourceDatasets,
        recipeVersion,
        rules,
      );
      const batches = plan.content.lanes.flatMap((lane) => lane.batches.map((batch) => ({ lane, batch })));
      if (batches.length === 0) {
        throw new SourceCollectionPlannerError("no_executable_work", "来源计划没有可执行批次");
      }
      const executions: SourceCollectionPlanExecution[] = [];
      // WHY：一个来源失败不能阻断其他独立来源；每个批次单独落来源运行和 typed 结果。
      for (const { lane, batch } of batches) {
        executions.push(await startBatch(
          projectId,
          plan,
          lane.collectionLaneId,
          batch,
          sourceDatasets,
          pipeline,
        ));
      }
      return { plan, executions };
    },
  };
}

async function planProject(
  projectId: string,
  projects: ProductProjectModule,
  interviews: CategoryInterviewModule,
  sourceDatasets: SourceDatasetModule,
  recipeVersion: string,
  rules: PlanningRule[],
) {
  const project = await projects.get(projectId);
  if (!project) throw new ProductProjectError("not_found", `项目不存在：${projectId}`);
  if (project.project.status !== "ready") {
    throw new ProductProjectError("incomplete", "来源计划只能从已确认项目生成");
  }
  const brief = await interviews.getConfirmedBriefForProject(projectId);
  if (!brief) {
    throw new SourceCollectionPlannerError(
      "confirmed_brief_missing",
      "项目没有绑定已确认品类调研任务书",
    );
  }
  const content = {
    recipeVersion,
    confirmedBriefId: brief.id,
    lanes: project.collectionBoard.lanes.map((lane) => planLane(lane, brief, rules)),
  };
  return sourceDatasets.savePlan({ projectId, content });
}

function planLane(lane: BriefLane, brief: CategoryResearchBriefVersion, rules: PlanningRule[]) {
  const issues: SourceCollectionPlanIssue[] = [];
  const assignments = brief.content.sourceAssignments
    .filter((assignment) => assignment.collectionLaneId === lane.id);
  if (assignments.length === 0) {
    issues.push({
      code: "source_assignment_missing",
      message: `搜集路线 ${lane.id} 没有来源到知识需求的显式分配`,
    });
    return laneResult(lane, [], issues);
  }

  const resolved = assignments.flatMap((assignment) => {
    const reference = brief.content.factReferences.find(({ id }) => id === assignment.factReferenceId);
    if (!reference) {
      issues.push({
        code: "source_entrypoint_missing",
        message: `搜集路线 ${lane.id} 的来源分配没有对应入口`,
        sourceReferenceId: assignment.factReferenceId,
      });
      return [];
    }
    const knownNeedIds = new Set(brief.content.knowledgeNeeds.map(({ id }) => id));
    if (assignment.knowledgeNeedIds.some((id) => !knownNeedIds.has(id))) {
      issues.push({
        code: "knowledge_need_missing",
        message: `来源 ${reference.label} 的分配包含未知知识需求`,
        sourceReferenceId: reference.id,
        requestedUrl: reference.url,
      });
      return [];
    }
    const requestKind = assignment.request?.kind ?? "full_resource";
    const matches = matchingRules(reference, lane, requestKind, rules);
    if (matches.length !== 1) {
      issues.push(ruleIssue(reference, matches.length));
      return [];
    }
    const rule = matches[0]!;
    if (rule.usagePermission.localRead !== "allowed") {
      issues.push({
        code: "local_read_not_allowed",
        message: `来源 ${reference.label} 未取得本地读取许可`,
        sourceReferenceId: reference.id,
        requestedUrl: reference.url,
      });
      return [];
    }
    if (rule.usagePermission.evidenceStorage !== "allowed") {
      issues.push({
        code: "evidence_storage_not_allowed",
        message: `来源 ${reference.label} 未取得证据保存许可`,
        sourceReferenceId: reference.id,
        requestedUrl: reference.url,
      });
      return [];
    }
    return [{
      rule,
      item: workItem(
        lane,
        reference,
        assignment.knowledgeNeedIds,
        assignment.request,
        rule,
        brief.id,
      ),
    }];
  });

  const batchGroups = new Map<string, { rule: PlanningRule; workItems: SourceCollectionWorkItem[] }>();
  for (const item of resolved) {
    const groupKey = contentHash({
      providerKey: item.rule.providerKey,
      accessPolicy: item.rule.accessPolicy,
    });
    const group = batchGroups.get(groupKey) ?? { rule: item.rule, workItems: [] };
    group.workItems.push(item.item);
    batchGroups.set(groupKey, group);
  }
  const batches = [...batchGroups.entries()].map(([key, group]) => ({
    key: `batch-${key}`,
    providerKey: group.rule.providerKey,
    accessPolicy: group.rule.accessPolicy,
    workItems: group.workItems,
  }));
  return laneResult(lane, batches, issues);
}

function matchingRules(
  reference: BriefReference,
  lane: BriefLane,
  requestKind: PlanningRule["requestKinds"][number],
  rules: PlanningRule[],
) {
  let url: URL;
  try {
    url = new URL(reference.url);
  } catch {
    return [];
  }
  return rules.filter((rule) => rule.sourceAuthorityType === lane.sourceAuthorityType
    && rule.accessMode === lane.accessMode
    && rule.requestKinds.includes(requestKind)
    && matchesUrl(rule, url));
}

function matchesUrl(rule: PlanningRule, url: URL) {
  return rule.urlMatch.kind === "origin"
    ? rule.urlMatch.origin === url.origin
    : rule.urlMatch.url === url.href;
}

function ruleIssue(reference: BriefReference, count: number): SourceCollectionPlanIssue {
  return {
    code: count === 0 ? "planning_rule_missing" : "planning_rule_ambiguous",
    message: count === 0
      ? `来源 ${reference.label} 没有匹配的访问规则`
      : `来源 ${reference.label} 匹配了多个访问规则`,
    sourceReferenceId: reference.id,
    requestedUrl: reference.url,
  };
}

function workItem(
  lane: BriefLane,
  reference: BriefReference,
  knowledgeNeedIds: string[],
  request: SourceCollectionWorkItem["request"],
  rule: PlanningRule,
  briefId: string,
): SourceCollectionWorkItem {
  const identity = contentHash({
    briefId,
    laneId: lane.id,
    referenceId: reference.id,
    targetKeys: lane.targetKeys,
    knowledgeNeedIds,
    request,
    ruleId: rule.id,
  });
  return {
    id: `source-item-${identity}`,
    object: {
      sourceIdentity: rule.sourceIdentity,
      kind: rule.objectKind,
      externalKey: reference.id,
    },
    requestedUrl: reference.url,
    request,
    targetKeys: lane.targetKeys,
    knowledgeNeedIds,
    parsing: rule.parsing,
    claimScopes: rule.claimScopes,
    usagePermission: rule.usagePermission,
  };
}

function laneResult(
  lane: BriefLane,
  batches: Array<{
    key: string;
    providerKey: string;
    accessPolicy: PlanningRule["accessPolicy"];
    workItems: SourceCollectionWorkItem[];
  }>,
  issues: SourceCollectionPlanIssue[],
) {
  const status = batches.length === 0 ? "waiting" : issues.length === 0 ? "ready" : "partial";
  return {
    collectionLaneId: lane.id,
    sourceAuthorityType: lane.sourceAuthorityType,
    status,
    batches,
    issues,
  } as const;
}

async function startBatch(
  projectId: string,
  plan: SourceCollectionPlan,
  collectionLaneId: string,
  batch: SourceCollectionPlan["content"]["lanes"][number]["batches"][number],
  sourceDatasets: SourceDatasetModule,
  pipeline: SourceCollectionPipelineModule,
): Promise<SourceCollectionPlanExecution> {
  let sourceRun: SourceCollectionRun | undefined;
  try {
    sourceRun = await sourceDatasets.startRun({
      projectId,
      sourceCollectionPlanId: plan.id,
      sourceCollectionPlanBatchKey: batch.key,
      collectionLaneId,
      providerKey: batch.providerKey,
      accessPolicy: batch.accessPolicy,
    });
    if (sourceRun.status === "completed") {
      return {
        collectionLaneId,
        batchKey: batch.key,
        providerKey: batch.providerKey,
        status: "reused",
        sourceRun,
      };
    }
    const pipelineRun = await pipeline.start({
      sourceRunId: sourceRun.id,
      workItems: batch.workItems,
    });
    return {
      collectionLaneId,
      batchKey: batch.key,
      providerKey: batch.providerKey,
      status: pipelineRun.lifecycleStatus === "succeeded" ? "reused" : "started",
      sourceRun,
      pipelineRun,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (sourceRun?.status === "running") {
      await sourceDatasets.finishRun({
        runId: sourceRun.id,
        status: "failed",
        terminationReason: `planner_launch_failed:${message}`.slice(0, 2000),
      });
    }
    return {
      collectionLaneId,
      batchKey: batch.key,
      providerKey: batch.providerKey,
      status: "failed",
      sourceRun,
      error: message.slice(0, 2000),
    };
  }
}
