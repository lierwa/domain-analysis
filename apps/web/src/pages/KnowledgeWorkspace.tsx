import type { KnowledgePackView, KnowledgeRunView } from "@domain-analysis/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { knowledgeApi } from "../lib/knowledgeApi";
import { KnowledgeSelection } from "./knowledge/KnowledgeSelection";
import { KnowledgeReview } from "./knowledge/KnowledgeReview";
import { KnowledgeVersions } from "./knowledge/KnowledgeVersions";
import "./knowledge/knowledge.css";

export type KnowledgeAction = (operation: () => Promise<unknown>, success?: string) => Promise<boolean>;
const runLabels = { queued: "等待加工", running: "正在加工", completed: "加工完成", partial: "部分完成", stopped: "已停止", failed: "加工失败" };

export function KnowledgeWorkspace() {
  const cache = useQueryClient();
  const [packId, setPackId] = useState("");
  const [tab, setTab] = useState("选料");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const packs = useQuery({ queryKey: ["knowledge", "packs"], queryFn: knowledgeApi.list });
  const view = useQuery({ queryKey: ["knowledge", packId], queryFn: () => knowledgeApi.get(packId), enabled: !!packId,
    refetchInterval: query => query.state.data?.versions.some(row => row.status === "building")
      || query.state.data?.runs.some(row => ["queued", "running"].includes(row.status)) ? 1_500 : false });
  const runId = view.data?.runs[0]?.id ?? "";
  const run = useQuery({ queryKey: ["knowledge", packId, runId], queryFn: () => knowledgeApi.run(packId, runId),
    enabled: !!packId && !!runId, refetchInterval: query => ["queued", "running"].includes(query.state.data?.run.status ?? "")
      || ["queued", "running"].includes(query.state.data?.aiReview?.status ?? "") ? 1_000 : false });
  const action: KnowledgeAction = async (operation, success = "已保存") => {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); setMessage(success); return true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : "操作失败，请稍后重试"); return false; }
    finally { await cache.invalidateQueries({ queryKey: ["knowledge"] }); setBusy(false); }
  };
  function choose(id: string) { setPackId(id); setTab("选料"); setError(""); setMessage(""); }
  return <div className="kp-workspace">
    <aside className="kp-sidebar"><div className="kp-title-row"><h1>知识包</h1><button onClick={() => setCreating(true)}>新建</button></div>
      <p className="kp-muted">把采集批次生产成可安装的 Agent Skill</p>
      {packs.error && <p role="alert">{packs.error.message}</p>}
      {packs.data?.length === 0 && <p className="kp-empty">创建知识包后，从已完成的采集批次开始。</p>}
      {packs.data?.map(pack => <button className={`kp-pack ${packId === pack.id ? "is-active" : ""}`} key={pack.id} onClick={() => choose(pack.id)}>
        <strong>{pack.name}</strong><span>{pack.selection.length} 个批次 · {pack.skillName}</span></button>)}
    </aside>
    <section className="kp-main" aria-busy={busy}>
      {creating && <CreatePack busy={busy} cancel={() => setCreating(false)} create={(name, skillName, scope) => action(async () => {
        const pack = await knowledgeApi.create(name, skillName, scope); choose(pack.id); setCreating(false);
      }, "知识包已创建")} />}
      {!view.data && !creating && <div className="kp-empty kp-welcome"><h2>建设知识产线</h2><p>固定采集批次，处理问题，发布标准 Skill。</p>
        <button className="kp-primary" onClick={() => setCreating(true)}>创建知识包</button></div>}
      {(error || view.error || run.error) && <p className="kp-alert" role="alert">{error || view.error?.message || run.error?.message}</p>}
      {message && <p className="kp-message" role="status">{message}</p>}
      {view.data && <><header className="kp-heading"><div><p className="kp-eyebrow">KNOWLEDGE SKILL FACTORY</p><h2>{view.data.pack.name}</h2>
        <p className="kp-muted">{view.data.pack.scope}</p></div><div className="kp-heading-meta"><code>{view.data.pack.skillName}</code>
          <span>{view.data.versions.filter(version => version.status === "published").length} 个已发布版本</span></div></header>
        <nav className="kp-tabs" aria-label="知识包流程">{["选料", "加工", "审核", "版本与发布"].map((label, index) =>
          <button key={label} aria-current={tab === label ? "page" : undefined} onClick={() => setTab(label)}><span>{index + 1}</span>{label}</button>)}</nav>
        {tab === "选料" && <KnowledgeSelection pack={view.data.pack} action={action} busy={busy} onSaved={() => setTab("加工")} />}
        {tab === "加工" && <Processing view={view.data} run={run.data} action={action} busy={busy} />}
        {tab === "审核" && (run.data ? <KnowledgeReview view={run.data} action={action} busy={busy} />
          : <EmptyStep title="尚无审核对象" detail="先选择采集批次并完成加工，系统才会生成问题清单。" />)}
        {tab === "版本与发布" && <KnowledgeVersions view={view.data} run={run.data} action={action} busy={busy} />}
      </>}
    </section>
  </div>;
}

function CreatePack({ busy, cancel, create }: { busy: boolean; cancel(): void;
  create(name: string, skillName: string, scope: string): Promise<boolean> }) {
  const [name, setName] = useState(""); const [skillName, setSkillName] = useState(""); const [scope, setScope] = useState("");
  return <form className="kp-card kp-create" onSubmit={event => { event.preventDefault(); void create(name, skillName, scope); }}><h2>创建知识包</h2>
    <p className="kp-muted">这三个字段分别用于产线识别、Skill 安装和 Agent 触发。</p>
    <label className="kp-field">知识包名称<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} />
      <small>只用于产线里识别这项工作。</small></label>
    <label className="kp-field">Skill 标识<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={64} value={skillName}
      onChange={event => setSkillName(event.target.value.toLowerCase())} placeholder="microwave-knowledge" />
      <small>将成为目录名和 SKILL.md 的 name，只能使用小写字母、数字和连字符。</small></label>
    <label className="kp-field">使用范围<textarea required maxLength={2000} value={scope} onChange={event => setScope(event.target.value)}
      placeholder="说明这个 Skill 在什么问题下应被使用，以及资料覆盖到哪里" />
      <small>这段内容会形成 Skill 的触发描述和使用边界。</small></label>
    <div className="kp-actions"><button className="kp-primary" disabled={busy}>创建</button><button type="button" onClick={cancel}>取消</button></div></form>;
}

function Processing({ view, run, action, busy }: { view: KnowledgePackView; run?: KnowledgeRunView;
  action: KnowledgeAction; busy: boolean }) {
  const active = view.runs.some(row => ["queued", "running"].includes(row.status));
  const current = run?.run.sourceRevision === view.pack.selectionRevision;
  const canStart = view.pack.selection.length > 0 && !active && !current;
  const completed = run?.items.filter(item => item.status === "completed").length ?? 0;
  const candidates = run?.items.reduce((total, item) => total + (item.result?.candidates.length ?? 0), 0) ?? 0;
  const failed = run?.items.filter(item => item.status === "failed") ?? [];
  return <div className="kp-stack"><section className="kp-card kp-processing-overview"><div className="kp-section-heading"><div><h3>把完整批次生产成 Skill 内容</h3>
    <p>系统逐份校验原件、提取结构并复用缓存；内容归属、OCR 和图片随后进入批量自动判断。</p></div>
    {canStart && <button className="kp-primary" disabled={busy} onClick={() => void action(() => knowledgeApi.start(view.pack.id, view.pack.revision),
      "所选批次已进入加工队列")}>加工所选批次</button>}</div>
    {!view.pack.selection.length && <p className="kp-warning">先到选料页选择一个完整采集批次。</p>}
    {run && !current && <p className="kp-warning">批次选择已变化；当前展示的是上一批加工记录。</p>}
    <div className="kp-stage-strip"><Stage number="1" label="固定原件" state={view.pack.selection.length ? "done" : "idle"} />
      <Stage number="2" label="提取与整理" state={run && current ? run.run.status === "completed" ? "done" : active ? "active" : "attention" : "idle"} />
      <Stage number="3" label="检测问题" state={run?.run.status === "completed" ? "done" : "idle"} />
      <Stage number="4" label="自动判断与审核" state={run?.run.status === "completed" ? run.admission.openIssues ? "attention" : "done" : "idle"} /></div>
  </section>
  {run && <section className="kp-card"><div className="kp-section-heading"><div><h3>{runLabels[run.run.status]}</h3>
    <p>{completed}/{run.items.length} 份原件已处理，形成 {candidates} 条结构化内容。</p></div><div className="kp-actions">
      {active && <button disabled={busy || run.run.stopRequested} onClick={() => void action(() => knowledgeApi.stop(view.pack.id, run.run.id), "停止请求已记录")}>停止</button>}
      {["partial", "failed", "stopped"].includes(run.run.status) && <button disabled={busy} onClick={() => void action(() =>
        knowledgeApi.retry(view.pack.id, run.run.id, run.run.generation), "继续处理未完成原件")}>继续未完成加工</button>}</div></div>
    <div className="kp-metrics kp-metrics-four"><div><strong>{completed}</strong><span>已处理原件</span></div><div><strong>{run.items.filter(item => item.result?.reused).length}</strong><span>缓存复用</span></div>
      <div><strong>{run.admission.accepted}</strong><span>当前可入包内容</span></div><div><strong>{run.admission.openIssues}</strong><span>待审核问题</span></div></div>
    <p className="kp-muted">每份原件最长处理 {run.run.settings.budgetSeconds} 秒；单份超时只标记该原件，不中止整个批次。语言模型调用 {run.run.llmCalls} 次。</p>
    {run.run.error && <p className="kp-warning">{run.run.error}</p>}
  </section>}
  {failed.length > 0 && <section className="kp-card"><h3>需要重新处理的原件</h3><div className="kp-compact-list">{failed.map(item =>
    <div key={item.id}><strong>{item.input.label}</strong><span>{item.error}</span></div>)}</div></section>}
  {view.runs.length > 0 && <details className="kp-card kp-history"><summary>运行记录（{view.runs.length}）</summary><div className="kp-compact-list">{view.runs.map(row =>
    <div key={row.id}><strong>{new Date(row.createdAt).toLocaleString()}</strong><span>{runLabels[row.status]} · 输入哈希 {row.inputHash.slice(0, 12)} · 工具 {row.toolVersion}</span></div>)}</div></details>}
  </div>;
}

function Stage({ number, label, state }: { number: string; label: string; state: "idle" | "active" | "done" | "attention" }) {
  return <div className={`kp-stage is-${state}`}><span>{state === "done" ? "✓" : number}</span><strong>{label}</strong></div>;
}

function EmptyStep({ title, detail }: { title: string; detail: string }) {
  return <div className="kp-empty kp-card"><h3>{title}</h3><p>{detail}</p></div>;
}
