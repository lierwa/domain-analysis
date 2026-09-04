import type { KnowledgeBatchRef, KnowledgePack, SourceCollectionBatch,
  SourceDatasetTaskView } from "@domain-analysis/shared";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { Select } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { fetchCaptureTasks, fetchSourceCollectionRuns } from "../../lib/api";
import { knowledgeApi } from "../../lib/knowledgeApi";
import type { KnowledgeAction } from "../KnowledgeWorkspace";

const statusLabels = { running: "采集中", completed: "已完成", partial: "部分完成", failed: "失败", stopped: "已停止" };

export function KnowledgeSelection({ pack, action, busy, onSaved }: { pack: KnowledgePack; action: KnowledgeAction;
  busy: boolean; onSaved(): void }) {
  const [selection, setSelection] = useState<KnowledgeBatchRef[]>(pack.selection);
  const [taskId, setTaskId] = useState(pack.selection[0]?.taskId ?? "");
  const tasks = useQuery({ queryKey: ["capture-tasks"], queryFn: fetchCaptureTasks });
  const chosenTask = taskId || tasks.data?.[0]?.id || "";
  const dataset = useQuery({ queryKey: ["source-dataset", chosenTask],
    queryFn: () => fetchSourceCollectionRuns(chosenTask), enabled: !!chosenTask });
  useEffect(() => { setSelection(pack.selection); }, [pack.id, pack.revision]);
  const versions = useMemo(() => new Map([...(dataset.data?.batches ?? [])].reverse()
    .map((batch, index) => [batch.id, index + 1])), [dataset.data?.batches]);
  function toggle(batchId: string, checked: boolean) {
    const ref = { taskId: chosenTask, batchId };
    setSelection(current => checked ? [...current.filter(row => row.batchId !== batchId), ref]
      : current.filter(row => row.batchId !== batchId));
  }
  const selectedHere = selection.filter(row => row.taskId === chosenTask);
  const selectedReady = selectedHere.length > 0 && selectedHere.every(ref =>
    dataset.data?.batches.some(row => row.id === ref.batchId && row.status === "completed"));
  const totals = selectedHere.reduce((sum, ref) => {
    const counts = batchContentCounts(dataset.data, ref.batchId);
    return { snapshots: sum.snapshots + counts.snapshots, assets: sum.assets + counts.assets };
  }, { snapshots: 0, assets: 0 });
  return <div className="kp-stack"><section className="kp-card kp-selection-toolbar">
    <div className="kp-task-select-field"><label id="kp-task-select-label">抓取任务</label>
      <Select.Root value={chosenTask || undefined} disabled={!tasks.data?.length} onValueChange={value => {
        setTaskId(value); setSelection([]);
      }}>
        <Select.Trigger className="kp-select-trigger" aria-labelledby="kp-task-select-label">
          <Select.Value placeholder="选择抓取任务" />
          <Select.Icon><ChevronDown className="h-4 w-4" aria-hidden="true" /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="kp-select-content" position="popper" sideOffset={6} align="start">
            <Select.Viewport className="kp-select-viewport">
              {tasks.data?.map(task => <Select.Item className="kp-select-item" key={task.id} value={task.id}>
                <Select.ItemText>{task.name}</Select.ItemText>
                <Select.ItemIndicator className="kp-select-indicator"><Check className="h-4 w-4" aria-hidden="true" /></Select.ItemIndicator>
              </Select.Item>)}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
    <div className="kp-selection-total"><span>已选 {selectedHere.length} 个批次</span>
      <strong>{totals.snapshots} 份记录 · {totals.assets} 个附件</strong></div>
    <button className="kp-primary" disabled={busy || !selectedReady}
      onClick={() => void action(() => knowledgeApi.select(pack.id, pack.revision, pack.skillName, selectedHere),
        "采集批次已固定，可以开始加工").then(ok => { if (ok) onSaved(); })}>保存并进入加工</button>
  </section>
  {selectedHere.length > 0 && !selectedReady && <p className="kp-warning">所选批次存在未完成来源，请改选状态为“已完成”的批次。</p>}
  <section className="kp-card kp-batch-list">
    <div className="kp-section-heading"><div><h3>采集批次</h3><p>每行是一轮完整采集；加工会读取所选批次中的全部合格原件。</p></div></div>
    {dataset.error && <p role="alert" className="kp-alert">{dataset.error.message}</p>}
    <div className="kp-batch-table"><div className="kp-batch-head"><span>批次</span><span>采集结果</span><span>来源执行</span><span>状态</span></div>
      {dataset.data?.batches.map(batch => {
        const execution = dataset.data?.executions.find(row => row.batchId === batch.id);
        const selected = selectedHere.some(row => row.batchId === batch.id);
        const available = batch.status === "completed";
        const counts = batchContentCounts(dataset.data, batch.id);
        return <label className={`kp-batch-row ${selected ? "is-selected" : ""}`} key={batch.id}>
          <span className="kp-batch-name"><input type="checkbox" checked={selected} disabled={!available && !selected}
            onChange={event => toggle(batch.id, event.target.checked)} />
            <span><strong>采集批次 {versions.get(batch.id)}</strong><small>{new Date(batch.startedAt).toLocaleString()}</small></span></span>
          <span><strong>{counts.snapshots}</strong> 份原始记录<br /><small>{counts.assets} 个附件</small></span>
          <span><strong>{batch.status === "completed" ? batch.plannedSourceCount : execution?.counts.completed ?? 0}/{batch.plannedSourceCount}</strong> 个来源完成<br /><small>方案 v{batch.sourceCollectionPlanVersion}</small></span>
          <span><span className={`kp-badge ${available ? "is-approved" : ""}`}>{statusLabels[batch.status]}</span>
            {!available && <small>完成来源验收后可用</small>}</span>
        </label>;
      })}</div>
    {dataset.data?.batches.length === 0 && <p className="kp-empty">这个任务还没有采集批次。</p>}
  </section></div>;
}

export function batchContentCounts(view: SourceDatasetTaskView | undefined, batchId: SourceCollectionBatch["id"]) {
  return (view?.runs ?? []).filter(run => run.executionBatchId === batchId).reduce((counts, run) => ({
    snapshots: counts.snapshots + run.snapshotCount,
    assets: counts.assets + run.assetCount,
  }), { snapshots: 0, assets: 0 });
}
