import type { ProductProjectView } from "@domain-analysis/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Database,
  FolderKanban,
  Factory,
  LayoutDashboard,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Rows3,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, confirmProductProject, fetchProductProject, fetchProductProjects } from "../lib/api";
import { ProductProjectForm } from "./ProductProjectForm";
import { CategoryInterviewTimeline } from "./CategoryInterviewTimeline";
import { ProjectEvidencePanel } from "./ProjectEvidencePanel";
import { SourceDatasetPanel } from "./SourceDatasetPanel";
import { KnowledgeFactoryPanel } from "./KnowledgeFactoryPanel";
import {
  accessModeLabels,
  refreshPolicyLabels,
  sourceAuthorityLabels,
  targetKindLabels
} from "./productKnowledgeLabels";

type ViewMode = "detail" | "edit";
type WorkspaceMode = "projects" | "interview";
type ProjectSection = "overview" | "sources" | "evidence" | "knowledge";

export function ProductProjectWorkspacePage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [mode, setMode] = useState<ViewMode>("detail");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("projects");
  const [projectSection, setProjectSection] = useState<ProjectSection>("overview");
  const projects = useQuery({ queryKey: ["product-projects"], queryFn: fetchProductProjects });
  const detail = useQuery({
    queryKey: ["product-project", selectedId],
    queryFn: () => fetchProductProject(selectedId!),
    enabled: Boolean(selectedId)
  });

  useEffect(() => {
    if (!selectedId && projects.data?.[0]) setSelectedId(projects.data[0].id);
  }, [projects.data, selectedId]);

  useEffect(() => {
    if (mode !== "detail") window.scrollTo(0, 0);
  }, [mode]);

  function showProject(projectId: string) {
    setSelectedId(projectId);
    setMode("detail");
    setWorkspaceMode("projects");
    setProjectSection("overview");
  }

  function handleSaved(project: ProductProjectView) {
    queryClient.setQueryData(["product-project", project.project.id], project);
    queryClient.invalidateQueries({ queryKey: ["product-projects"] });
    setSelectedId(project.project.id);
    setMode("detail");
    setWorkspaceMode("projects");
    setProjectSection("overview");
  }

  if (mode === "edit") {
    return (
      <ProductProjectForm
        project={detail.data!}
        onCancel={() => setMode("detail")}
        onSaved={handleSaved}
      />
    );
  }

  return (
    <div className="mx-auto grid max-w-[1440px] min-w-0 gap-6 lg:grid-cols-[288px_minmax(0,1fr)]">
      <aside aria-label="知识工作区导航" className="rounded-xl border border-line bg-panel p-3 lg:sticky lg:top-6 lg:self-start">
        <div className="px-2 pb-3 pt-1">
          <p className="text-xs font-medium text-muted">商品知识生产</p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">项目工作区</h1>
        </div>
        <button
          type="button"
          onClick={() => { setWorkspaceMode("interview"); setMode("detail"); }}
          className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${workspaceMode === "interview" ? "bg-ink text-surface" : "bg-surface hover:bg-line/50"}`}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />开启新品类
        </button>
        <div className="my-3 border-t border-line" />
        <div className="mb-2 flex min-h-9 items-center justify-between px-2"><h2 className="text-xs font-semibold text-muted">知识项目</h2><span className="text-xs tabular-nums text-muted">{projects.data?.length ?? 0}</span></div>
          {projects.isLoading && <ListSkeleton />}
          {projects.isError && <QueryError label="项目列表加载失败" onRetry={() => projects.refetch()} />}
          {projects.data?.length === 0 && <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center"><FolderKanban className="mx-auto h-6 w-6 text-muted" aria-hidden="true" /><p className="mt-3 text-sm font-medium">还没有知识项目</p><p className="mt-1 text-xs leading-5 text-muted">从一个商品类型开始建立可复用模板。</p></div>}
          <div className="space-y-1">
            {projects.data?.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => showProject(project.id)}
                className={`flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${workspaceMode === "projects" && selectedId === project.id ? "bg-ink text-surface" : "hover:bg-surface"}`}
              >
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{project.name}</span><span className={`mt-0.5 block text-xs ${workspaceMode === "projects" && selectedId === project.id ? "text-surface/70" : "text-muted"}`}>{project.status === "ready" ? "已确认" : "草稿"} · v{project.revision}</span></span>
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
            ))}
          </div>
      </aside>

      <main className="min-w-0" aria-label={workspaceMode === "interview" ? "新品类采访" : "项目工作区"}>
        {workspaceMode === "interview" ? (
          <div>
            <PageHeading eyebrow="新品类研究" title="开启新品类" description="通过一次一问确定负责人取舍；品牌、型号、参数、部件、原理和来源由系统主动调查。" />
            <CategoryInterviewTimeline onProjectCreated={handleSaved} />
          </div>
        ) : (
          <>
            {!selectedId && !projects.isLoading && <WelcomePanel onStart={() => setWorkspaceMode("interview")} />}
            {selectedId && detail.isLoading && <DetailSkeleton />}
            {selectedId && detail.isError && <QueryError label="项目详情加载失败" onRetry={() => detail.refetch()} />}
            {detail.data && (
              <ProjectWorkspace
                key={detail.data.project.id}
                project={detail.data}
                section={projectSection}
                onSectionChange={setProjectSection}
                onEdit={() => setMode("edit")}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ProjectWorkspace({
  project,
  section,
  onSectionChange,
  onEdit,
}: {
  project: ProductProjectView;
  section: ProjectSection;
  onSectionChange: (section: ProjectSection) => void;
  onEdit: () => void;
}) {
  const isReady = project.project.status === "ready";
  const sections: Array<{ id: ProjectSection; label: string; icon: typeof LayoutDashboard; disabled?: boolean }> = [
    { id: "overview", label: "概览", icon: LayoutDashboard },
    { id: "sources", label: "来源数据", icon: Rows3, disabled: !isReady },
    { id: "evidence", label: "原始证据", icon: Database, disabled: !isReady },
    { id: "knowledge", label: "知识加工", icon: Factory, disabled: !isReady },
  ];
  return (
    <div>
      <header className="rounded-xl border border-line bg-surface px-5 pb-0 pt-5 sm:px-7 sm:pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{project.project.name}</h1><span className="status-badge">{isReady ? "已确认" : "草稿"}</span></div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{project.project.knowledgeTopic}</p>
            <p className="mt-2 text-xs text-muted">{project.project.market} 市场 · 版本 {project.project.revision}</p>
          </div>
          <button type="button" className="button-secondary" onClick={onEdit}><Pencil className="h-4 w-4" aria-hidden="true" />编辑项目</button>
        </div>
        <nav className="mt-6 flex gap-5 overflow-x-auto" aria-label="项目阶段">
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSectionChange(item.id)}
                disabled={item.disabled}
                aria-current={section === item.id ? "page" : undefined}
                className={`flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${section === item.id ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"} disabled:cursor-not-allowed disabled:opacity-35`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />{item.label}
              </button>
            );
          })}
        </nav>
      </header>
      <div className="pt-5">
        {section === "overview" && <ProjectOverview project={project} />}
        {section === "sources" && isReady && <SourceDatasetPanel projectId={project.project.id} />}
        {section === "evidence" && isReady && <ProjectEvidencePanel projectId={project.project.id} />}
        {section === "knowledge" && isReady && <KnowledgeFactoryPanel projectId={project.project.id} categoryDefinitionVersionId={project.categoryDefinition.id} />}
      </div>
    </div>
  );
}

function ProjectOverview({ project }: { project: ProductProjectView }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const confirm = useMutation({
    mutationFn: () => confirmProductProject(project.project.id, project.project.revision),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["product-project", project.project.id], snapshot);
      queryClient.invalidateQueries({ queryKey: ["product-projects"] });
      setConfirming(false);
    }
  });
  const confirmationError = confirm.error instanceof ApiError && confirm.error.code === "revision_conflict"
    ? "项目已有更新，请刷新后再确认。"
    : confirm.error instanceof Error ? confirm.error.message : undefined;

  return (
    <article className="rounded-xl border border-line bg-surface p-5 sm:p-7">
      <div className="grid gap-3 pb-5 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="统一参数" value={project.categoryDefinition.attributes.length} />
        <Metric label="判断维度" value={project.categoryDefinition.decisionDimensions.length} />
        <Metric label="覆盖对象" value={project.confirmedScope.targets.filter((target) => target.disposition === "included").length} />
        <Metric label="搜集路线" value={project.collectionBoard.lanes.length} />
      </div>

      <div className="grid gap-5 border-t border-line pt-5 lg:grid-cols-2">
        <DetailBlock title="商品类型"><p>{project.categoryDefinition.label}</p><p className="detail-code">{project.categoryDefinition.categoryCode}</p><p className="mt-3 text-xs text-muted">权威来源：{project.categoryDefinition.sourceAuthorityPolicy.map((source) => sourceAuthorityLabels[source]).join("、")}</p></DetailBlock>
        <DetailBlock title="覆盖对象"><ul className="space-y-2">{project.confirmedScope.targets.map((target) => <li key={target.key} className="flex items-start justify-between gap-3"><span><span className="font-medium">{target.label}</span><span className="ml-2 text-xs text-muted">{targetKindLabels[target.kind]}</span></span><span className="text-xs text-muted">{target.disposition === "included" ? "纳入" : "排除"}</span></li>)}</ul></DetailBlock>
        <DetailBlock title="主要参数"><ul className="space-y-2">{project.categoryDefinition.attributes.map((attribute) => <li key={attribute.code}><span className="font-medium">{attribute.label}</span><span className="ml-2 detail-code">{attribute.code}</span><p className="mt-0.5 text-xs text-muted">{attribute.description}</p></li>)}</ul></DetailBlock>
        <DetailBlock title="搜集路线"><ul className="space-y-2">{project.collectionBoard.lanes.map((lane) => <li key={lane.id}><span className="font-medium">{sourceAuthorityLabels[lane.sourceAuthorityType]}</span><p className="mt-0.5 text-xs text-muted">{accessModeLabels[lane.accessMode]} · {refreshPolicyLabels[lane.refreshPolicy]} · {lane.targetKeys.length} 个对象</p></li>)}</ul></DetailBlock>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        {project.project.status === "ready" ? (
          <div className="rounded-lg border border-line bg-panel p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-success"><Check className="h-5 w-5" aria-hidden="true" />这份知识范围和来源政策已经冻结。</div>
            <p className="mt-2 text-xs leading-5 text-muted">下一步会围绕明确问题生成证据请求；当前不会保存整页，也不会调用旧的官网字段解析器。</p>
          </div>
        ) : confirming ? (
          <div className="rounded-lg border border-line bg-panel p-4">
            <p className="text-sm font-medium">确认后，这个版本会成为后续搜集的固定输入。</p>
            <p className="mt-1 text-xs leading-5 text-muted">如果以后需要调整，仍可编辑并产生新的草稿版本。</p>
            {confirmationError && <p className="mt-2 text-sm text-danger" role="alert">{confirmationError}</p>}
            <div className="mt-4 flex flex-wrap gap-3"><button type="button" className="button-secondary" onClick={() => setConfirming(false)}>先不确认</button><button type="button" className="button-primary" disabled={confirm.isPending} onClick={() => confirm.mutate()}>{confirm.isPending ? "正在确认…" : "确认并冻结"}</button></div>
          </div>
        ) : (
          <button type="button" className="button-primary" onClick={() => setConfirming(true)}><Check className="h-4 w-4" aria-hidden="true" />确认这份输入</button>
        )}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-panel px-4 py-3"><div className="text-2xl font-semibold tabular-nums">{value}</div><div className="mt-1 text-xs text-muted">{label}</div></div>; }
function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3 className="mb-3 text-sm font-semibold">{title}</h3><div className="text-sm leading-6">{children}</div></section>; }
function QueryError({ label, onRetry }: { label: string; onRetry: () => void }) { return <div className="rounded-xl border border-danger/30 bg-danger/5 p-5"><p className="text-sm text-danger">{label}，请检查服务后重试。</p><button type="button" className="button-secondary mt-4" onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden="true" />重试</button></div>; }
function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <header className="mb-5"><p className="text-xs font-medium text-muted">{eyebrow}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p></header>; }
function WelcomePanel({ onStart }: { onStart: () => void }) { return <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface p-8 text-center"><FolderKanban className="h-8 w-8 text-muted" aria-hidden="true" /><h2 className="mt-4 text-base font-semibold">选择项目，或开启新品类</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted">新品类采访与项目生产分开进行；确认任务书后会自动回到新项目概览。</p><button type="button" className="button-primary mt-5" onClick={onStart}><MessageSquareText className="h-4 w-4" aria-hidden="true" />开启新品类</button></div>; }
function ListSkeleton() { return <div className="space-y-2" aria-label="正在加载项目"><div className="h-12 animate-pulse rounded-lg bg-line/50" /><div className="h-12 animate-pulse rounded-lg bg-line/30" /></div>; }
function DetailSkeleton() { return <div className="space-y-4 rounded-xl border border-line p-6" aria-label="正在加载项目详情"><div className="h-7 w-1/3 animate-pulse rounded bg-line/50" /><div className="h-20 animate-pulse rounded bg-line/30" /><div className="h-40 animate-pulse rounded bg-line/30" /></div>; }
