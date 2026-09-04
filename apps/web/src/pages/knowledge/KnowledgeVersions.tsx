import type { KnowledgePackView, KnowledgeRunView, KnowledgeVersion } from "@domain-analysis/shared";
import { useQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-alert-dialog";
import { useEffect, useState } from "react";
import { apiErrorFromResponse } from "../../lib/apiClient";
import { knowledgeApi, versionUrl } from "../../lib/knowledgeApi";
import type { KnowledgeAction } from "../KnowledgeWorkspace";

const labels = { building: "正在生成", ready: "等待发布", failed: "生成失败", published: "已发布" };

export function KnowledgeVersions({ view, run, action, busy }: { view: KnowledgePackView; run?: KnowledgeRunView;
  action: KnowledgeAction; busy: boolean }) {
  const [selected, setSelected] = useState("");
  const version = view.versions.find(row => row.id === selected) ?? view.versions[0];
  const [file, setFile] = useState(version?.artifact?.entrypoint ?? "");
  useEffect(() => { setFile(version?.artifact?.entrypoint ?? version?.artifact?.resources[0]?.path ?? ""); }, [version?.id]);
  const ready = run && run.run.status === "completed" && !run.admission.gaps.length;
  const frozen = run && view.versions.find(row => ["ready", "published"].includes(row.status)
    && row.runId === run.run.id && row.packRevision === view.pack.revision
    && row.generation === run.run.generation && row.reviewRevision === run.run.reviewRevision
    && row.inputHash === run.versionInputHash);
  return <div className="kp-stack"><section className="kp-card"><div className="kp-section-heading"><div><h3>生成标准 Agent Skill</h3>
    <p>把当前审核结果冻结成一个版本，并校验目录、SKILL.md、查询脚本、数据引用、图片和文件哈希。</p></div>
    <button className="kp-primary" disabled={busy || !ready || !!frozen} onClick={() => void action(async () => {
      const value = await knowledgeApi.build(view.pack.id, run!.run.id, view.pack.revision); setSelected(value.id);
    }, "Skill 版本已进入生成队列")}>{frozen ? `当前结果已冻结为版本 ${frozen.number}` : "生成 Skill 版本"}</button></div>
    <div className="kp-gates"><span className={run?.run.status === "completed" ? "is-pass" : ""}>加工完成</span>
      <span className="is-pass">未决内容保持隔离</span>
      <span className={!run?.admission.gaps.length ? "is-pass" : ""}>可用内容满足建包门</span></div>
    {!!run?.admission.openIssues && <p className="kp-muted">当前 {run.admission.openIssues} 个问题不会进入本版 Skill；处理后可生成包含更多内容的新版本。</p>}
    {run?.admission.gaps.map(gap => <p key={gap} className="kp-warning">{gap}</p>)}</section>
    <div className="kp-version-grid"><aside className="kp-card"><h3>版本记录</h3>{view.versions.map(row => <button key={row.id} className={`kp-pack ${version?.id === row.id ? "is-active" : ""}`}
      onClick={() => setSelected(row.id)}><strong>版本 {row.number} · {labels[row.status]}</strong><span>{new Date(row.createdAt).toLocaleString()}</span></button>)}
      {!view.versions.length && <p className="kp-muted">审核门通过后生成第一个版本。</p>}</aside>
      {version && <section className="kp-card"><div className="kp-section-heading"><div><p className="kp-eyebrow">VERSION {version.number}</p><h3>{version.artifact?.format === "agent-skill" ? "Agent Skill 包" : "历史资料包"}</h3></div>
        <span className={`kp-badge ${version.status === "published" ? "is-approved" : ""}`}>{labels[version.status]}</span></div>
        {version.error && <p className="kp-warning">{version.error}</p>}
        {version.artifact && <><div className="kp-artifact-summary"><div><span>Skill</span><strong>{version.artifact.skillName ?? view.pack.skillName}</strong></div>
          <div><span>内容</span><strong>{version.artifact.accepted} 项 / {version.artifact.images} 图</strong></div>
          <div><span>大小</span><strong>{(version.artifact.bytes / 1024).toFixed(0)} KiB</strong></div></div>
          <div className="kp-version-meta"><span>新增 {version.artifact.changes.added}</span><span>移除 {version.artifact.changes.removed}</span>
            <span>变化 {version.artifact.changes.modified}</span><code>SHA-256 {version.artifact.sha256}</code></div>
          <div className="kp-actions kp-version-actions">{version.status === "ready" && <Publish version={version} busy={busy} publish={() => action(() =>
            knowledgeApi.publish(view.pack.id, version.id, view.pack.revision), "Skill 版本已发布，可以下载")} />}
            {version.status === "published" && <a className="kp-button kp-primary" href={versionUrl(view.pack.id, version.id)} download>下载 Skill ZIP</a>}</div>
          <div className="kp-artifact-browser">
            <nav className="kp-file-list" aria-label="Skill 包文件">
              <p>包内文件</p>
              {version.artifact.resources.map(resource => <button key={resource.path} type="button"
                className={file === resource.path ? "is-active" : undefined} onClick={() => setFile(resource.path)}>
                <strong>{fileLabel(resource.path)}</strong><span>{fileFolder(resource.path)}
                  <small>{fileType(resource.mediatype)} · {formatBytes(resource.bytes)}</small></span>
              </button>)}
              {version.artifact.format === "data-package-2" && <button type="button"
                className={file === "datapackage.json" ? "is-active" : undefined}
                onClick={() => setFile("datapackage.json")}><strong>datapackage.json</strong>
                <span>datapackage.json<small>JSON</small></span></button>}
            </nav>
            <section className="kp-file-viewer" aria-label="包内文件预览">
              <header><strong>{file}</strong></header>
              <div className="kp-preview-frame">{file && <ArtifactPreview packId={view.pack.id} version={version} file={file} />}</div>
            </section>
          </div>
        </>}
      </section>}</div>
  </div>;
}

function Publish({ version, busy, publish }: { version: KnowledgeVersion; busy: boolean; publish(): Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger asChild><button className="kp-primary" disabled={busy}>发布此版本</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="kp-dialog-overlay" /><Dialog.Content className="kp-dialog">
      <Dialog.Title>发布 Skill 版本 {version.number}</Dialog.Title><Dialog.Description>发布会冻结这份 ZIP 及其 SHA-256。后续批次将生成新版本，当前版本继续保留。</Dialog.Description>
      <div className="kp-actions"><Dialog.Cancel asChild><button>继续检查</button></Dialog.Cancel><button className="kp-primary" disabled={busy} onClick={() => void publish().then(ok => { if (ok) setOpen(false); })}>确认发布</button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function ArtifactPreview({ packId, version, file }: { packId: string; version: KnowledgeVersion; file: string }) {
  const image = /\.(png|jpe?g|webp)$/i.test(file);
  const preview = useQuery({ queryKey: ["knowledge", "preview", version.id, file], enabled: !image,
    queryFn: async () => { const response = await fetch(versionUrl(packId, version.id, file));
      if (!response.ok) throw await apiErrorFromResponse(response); return response.text(); } });
  if (image) return <img className="kp-artifact-image" alt="Skill 包中的合格图片" src={versionUrl(packId, version.id, file)} />;
  if (preview.error) return <p role="alert">{preview.error.message}</p>;
  return <pre className="kp-preview">{preview.data ?? "正在读取包内文件…"}</pre>;
}

function fileType(mediaType: string) {
  if (mediaType.startsWith("image/")) return "图片";
  if (mediaType.includes("json")) return "JSON";
  if (mediaType.includes("markdown")) return "Markdown";
  if (mediaType.includes("javascript")) return "脚本";
  return "文本";
}

function formatBytes(bytes: number) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(bytes >= 10_240 ? 0 : 1)} KiB` : `${bytes} B`;
}

function fileLabel(path: string) { return path.split("/").at(-1) ?? path; }
function fileFolder(path: string) { return path.split("/").slice(0, -1).join("/") || "Skill 根目录"; }
