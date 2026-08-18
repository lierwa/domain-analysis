import type { CaptureTask } from "@domain-analysis/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Database, MessageSquareText, PencilLine, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchCaptureTask, fetchCaptureTaskInterview, fetchCaptureTasks } from "../lib/api";
import {
  ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY,
  CategoryInterviewTimeline,
} from "./CategoryInterviewTimeline";
import { CaptureTaskContentView } from "./CaptureTaskContentView";
import { SourceDatasetPanel } from "./SourceDatasetPanel";

type WorkspaceMode = "tasks" | "new";
type TaskSection = "scope" | "data";

export function CaptureTaskWorkspacePage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<WorkspaceMode>("tasks");
  const [section, setSection] = useState<TaskSection>("scope");
  const [selectedId, setSelectedId] = useState<string>();
  const [newTaskKey, setNewTaskKey] = useState(0);
  const [editingSessionId, setEditingSessionId] = useState<string>();
  const [revisionError, setRevisionError] = useState<string>();
  const [revisingTaskId, setRevisingTaskId] = useState<string>();
  const tasks = useQuery({ queryKey: ["capture-tasks"], queryFn: fetchCaptureTasks });
  const detail = useQuery({
    queryKey: ["capture-task", selectedId],
    queryFn: () => fetchCaptureTask(selectedId!),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (!selectedId && tasks.data?.[0]) setSelectedId(tasks.data[0].id);
  }, [selectedId, tasks.data]);

  function showTask(taskId: string) {
    setSelectedId(taskId);
    setMode("tasks");
    setSection("scope");
  }

  function handleTaskCreated(task: CaptureTask) {
    queryClient.setQueryData(["capture-task", task.id], task);
    void queryClient.invalidateQueries({ queryKey: ["capture-tasks"] });
    setEditingSessionId(undefined);
    showTask(task.id);
  }

  function startNewTask() {
    window.localStorage.removeItem(ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY);
    setEditingSessionId(undefined);
    setRevisionError(undefined);
    setNewTaskKey((value) => value + 1);
    setMode("new");
  }

  async function reviseTask(task: CaptureTask) {
    setRevisionError(undefined);
    setRevisingTaskId(task.id);
    try {
      const interview = await fetchCaptureTaskInterview(task.id);
      window.localStorage.setItem(ACTIVE_CATEGORY_INTERVIEW_STORAGE_KEY, interview.session.id);
      setEditingSessionId(interview.session.id);
      setNewTaskKey((value) => value + 1);
      setMode("new");
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : "抓取任务修订入口打开失败");
    } finally {
      setRevisingTaskId(undefined);
    }
  }

  return (
    <div className="mx-auto grid min-h-0 w-full max-w-[1440px] min-w-0 flex-1 self-stretch gap-6 lg:grid-cols-[288px_minmax(0,1fr)] lg:overflow-hidden">
      <CaptureTaskSidebar
        tasks={tasks.data ?? []}
        selectedId={selectedId}
        mode={mode}
        isError={tasks.isError}
        onRetry={() => void tasks.refetch()}
        onNew={startNewTask}
        onSelect={showTask}
      />

      <main className={`flex min-h-0 min-w-0 flex-col ${mode === "new" ? "lg:overflow-hidden" : "lg:overflow-y-auto"}`}>
        {mode === "new" ? (
          <InterviewWorkspace
            instanceKey={`${newTaskKey}-${editingSessionId ?? "new"}`}
            sessionId={editingSessionId}
            onTaskCreated={handleTaskCreated}
          />
        ) : detail.data ? (
          <TaskWorkspace
            task={detail.data}
            section={section}
            onSectionChange={setSection}
            onRevise={() => void reviseTask(detail.data!)}
            isRevising={revisingTaskId === detail.data.id}
            revisionError={revisionError}
          />
        ) : !tasks.isLoading && !selectedId ? (
          <Welcome onStart={startNewTask} />
        ) : detail.isError ? (
          <ErrorPanel label="抓取任务加载失败" onRetry={() => detail.refetch()} />
        ) : <div className="h-48 animate-pulse rounded-xl bg-line/30" />}
      </main>
    </div>
  );
}

function InterviewWorkspace({
  instanceKey,
  sessionId,
  onTaskCreated,
}: {
  instanceKey: string;
  sessionId?: string;
  onTaskCreated: (task: CaptureTask) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mb-5 shrink-0">
        <p className="text-xs font-medium text-muted">{sessionId ? "修订已确认抓取任务" : "第一步：确定抓取任务"}</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">{sessionId ? "继续完善抓取范围" : "你要抓什么？"}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{sessionId
          ? "直接说明要增加、删除或调整的内容。确认后生成新版本，已经确认的历史版本不会被覆盖。"
          : "直接输入商品门类。系统负责调查内容范围和候选来源，只把必须由你决定的取舍交给你。"}</p>
      </header>
      <CategoryInterviewTimeline
        key={instanceKey}
        initialSessionId={sessionId}
        onTaskCreated={onTaskCreated}
      />
    </div>
  );
}

function CaptureTaskSidebar({
  tasks,
  selectedId,
  mode,
  isError,
  onRetry,
  onNew,
  onSelect,
}: {
  tasks: CaptureTask[];
  selectedId?: string;
  mode: WorkspaceMode;
  isError: boolean;
  onRetry: () => void;
  onNew: () => void;
  onSelect: (taskId: string) => void;
}) {
  return (
    <aside aria-label="抓取任务导航" className="rounded-xl border border-line bg-panel p-3 lg:sticky lg:top-0 lg:self-start lg:overflow-y-auto">
      <div className="px-2 pb-3 pt-1">
        <p className="text-xs font-medium text-muted">数据抓取</p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">抓取任务</h1>
      </div>
      <button type="button" onClick={onNew}
        className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium ${mode === "new" ? "bg-ink text-surface" : "bg-surface hover:bg-line/50"}`}>
        <Plus className="h-4 w-4" aria-hidden="true" />新建抓取任务
      </button>
      <div className="my-3 border-t border-line" />
      <div className="mb-2 flex items-center justify-between px-2 text-xs font-semibold text-muted">
        <span>任务记录</span><span>{tasks.length}</span>
      </div>
      {isError && <ErrorPanel label="任务列表加载失败" onRetry={onRetry} />}
      <div className="space-y-1">
        {tasks.map((task) => (
          <button key={task.id} type="button" onClick={() => onSelect(task.id)}
            className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left ${mode === "tasks" && selectedId === task.id ? "bg-ink text-surface" : "hover:bg-surface"}`}>
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{task.name}</span>
              <span className={`mt-0.5 block text-xs ${mode === "tasks" && selectedId === task.id ? "text-surface/70" : "text-muted"}`}>{task.status === "ready" ? "已确认" : "需重新确认"} · v{task.revision}</span></span>
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        ))}
      </div>
    </aside>
  );
}

function TaskWorkspace({
  task,
  section,
  onSectionChange,
  onRevise,
  isRevising,
  revisionError,
}: {
  task: CaptureTask;
  section: TaskSection;
  onSectionChange: (section: TaskSection) => void;
  onRevise: () => void;
  isRevising: boolean;
  revisionError?: string;
}) {
  return (
    <div>
      <header className="rounded-xl border border-line bg-surface px-5 pb-0 pt-5 sm:px-7 sm:pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-2xl font-semibold tracking-tight">{task.name}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{task.content.originalRequest}</p></div>
          <span className="status-badge">{task.status === "ready" ? "已确认" : "需重新确认"}</span>
        </div>
        <nav className="mt-6 flex gap-5" aria-label="抓取任务内容">
          <Tab active={section === "scope"} onClick={() => onSectionChange("scope")} label="抓取范围" />
          <Tab active={section === "data"} onClick={() => onSectionChange("data")} label="原始数据" />
        </nav>
      </header>
      <div className="pt-5">{section === "scope" ? (
        <TaskScope
          task={task}
          onRevise={onRevise}
          isRevising={isRevising}
          revisionError={revisionError}
        />
      ) : <SourceDatasetPanel taskId={task.id} />}</div>
    </div>
  );
}

function TaskScope({
  task,
  onRevise,
  isRevising,
  revisionError,
}: {
  task: CaptureTask;
  onRevise: () => void;
  isRevising: boolean;
  revisionError?: string;
}) {
  return (
    <article className="rounded-xl border border-line bg-surface p-5 sm:p-7">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
        <div>
          <p className="text-sm font-semibold">当前确认版本 v{task.revision}</p>
          <p className="mt-1 text-xs leading-5 text-muted">范围不够时可以继续原对话，生成新的草稿和确认版本。</p>
        </div>
        <button type="button" className="button-secondary" disabled={isRevising} onClick={onRevise}>
          <PencilLine className="h-4 w-4" aria-hidden="true" />{isRevising ? "正在打开…" : "继续对话修改范围"}
        </button>
        {revisionError && <p className="w-full text-sm text-danger" role="alert">{revisionError}</p>}
      </div>
      <CaptureTaskContentView content={task.content} />
    </article>
  );
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button type="button" onClick={onClick} className={`min-h-11 border-b-2 px-1 text-sm font-medium ${active ? "border-ink text-ink" : "border-transparent text-muted"}`}>{label}</button>;
}
function ErrorPanel({ label, onRetry }: { label: string; onRetry: () => void }) { return <div className="rounded-lg border border-danger/30 p-4 text-sm text-danger"><p>{label}</p><button type="button" className="button-secondary mt-3" onClick={onRetry}><RefreshCw className="h-4 w-4" />重试</button></div>; }
function Welcome({ onStart }: { onStart: () => void }) { return <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface p-8 text-center"><Database className="h-8 w-8 text-muted" /><h2 className="mt-4 font-semibold">还没有抓取任务</h2><p className="mt-2 text-sm text-muted">先通过对话生成并确认一份抓取任务。</p><button type="button" className="button-primary mt-5" onClick={onStart}><MessageSquareText className="h-4 w-4" />新建抓取任务</button></div>; }
