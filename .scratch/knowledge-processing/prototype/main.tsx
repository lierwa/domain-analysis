/// <reference types="vite/client" />
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Database,BookOpen,Plus,ArrowUpRight,CheckCircle2,ArrowRight,Layers,FileCheck2,Info} from 'lucide-react';
import {Dialog} from 'radix-ui';
import {useLocalStorage} from 'usehooks-ts';
import {z} from 'zod';
import {Materials,Execution,Review,Versions} from './panels';
import './styles.css';

const evidenceSchema=z.object({report:z.object({createdAt:z.string(),seconds:z.number(),
  input:z.object({html:z.number(),images:z.number(),pdfs:z.number(),additionalModel:z.string()}),
  admission:z.object({accepted:z.number(),quarantined:z.number(),acceptedImages:z.number(),pendingImageContent:z.number(),uncalibratedImages:z.number()}),
  pdf:z.array(z.object({title:z.string(),exitCode:z.number(),seconds:z.number().optional(),totalPages:z.number().optional(),processedPages:z.number().optional()})),
  versions:z.array(z.object({version:z.string(),sha256:z.string(),bytes:z.number(),accepted:z.number(),images:z.number(),files:z.array(z.string())}))}),
  candidates:z.array(z.object({id:z.string(),subjectId:z.string(),label:z.string(),text:z.string(),decision:z.string(),reason:z.string(),
    factKey:z.string().optional(),source:z.object({snapshotId:z.string(),assetId:z.string().optional(),url:z.string(),locator:z.string()})})),
  previews:z.array(z.object({version:z.string(),files:z.array(z.object({name:z.string(),text:z.string()}))}))});
export type Evidence=z.infer<typeof evidenceSchema>;
export type Scenario='ready'|'empty'|'running'|'stopped'|'failed'|'required'|'update';
export type Page='overview'|'materials'|'execution'|'review'|'versions';
const tabs:{id:Page;label:string}[]=[{id:'overview',label:'总览'},{id:'materials',label:'原料与设置'},
  {id:'execution',label:'加工记录'},{id:'review',label:'质量审核'},{id:'versions',label:'版本与导出'}];

function Prototype(){
  const [evidence,setEvidence]=useState<Evidence>();const [error,setError]=useState('');
  const [page,setPage]=useState<Page>('overview');const [scenario,setScenario]=useState<Scenario>('ready');
  const [name,setName]=useLocalStorage('knowledge-prototype-name','标准商品来源资料');
  const [draftName,setDraftName]=useState('');const [createOpen,setCreateOpen]=useState(false);
  const [released,setReleased]=useState<string[]>([]);
  useEffect(()=>{fetch('/evidence.json').then(r=>{if(!r.ok)throw Error('请先运行组件原型生成样包');return r.json();})
    .then(v=>setEvidence(evidenceSchema.parse(v))).catch(e=>setError(e.message));},[]);
  function go(next:Page){setPage(next);history.replaceState(null,'',`#${next}`);}
  function changeScenario(next:Scenario){setScenario(next);}
  if(error)return <main className="loading" role="alert">{error}</main>;
  if(!evidence)return <main className="loading" role="status">正在读取本机原型证据…</main>;
  return <>
    <header className="app-header"><div className="brand"><span className="brand-icon"><Database size={22}/></span><div><strong>Data Collection Workbench</strong><small>商品资料与知识加工</small></div></div>
      <nav aria-label="工作台"><a href="http://127.0.0.1:6173" target="_blank" rel="noreferrer">抓取任务 <ArrowUpRight size={14}/></a><span className="active"><BookOpen size={16}/>知识加工</span></nav></header>
    <div className="prototype-bar"><span><Info size={15}/> 操作原型 · 界面操作为情景演示，样包检查来自真实运行</span>
      <label>情景 <select aria-label="查看情景" value={scenario} onChange={e=>changeScenario(e.target.value as Scenario)}>
        <option value="ready">待审核与发布</option><option value="empty">空包</option><option value="running">加工中</option>
        <option value="stopped">已停止</option><option value="failed">局部失败</option><option value="required">必需内容未通过</option><option value="update">发现新资料</option>
      </select></label></div>
    <div className="workspace"><aside><div className="aside-title"><BookOpen size={17}/><strong>知识包</strong></div>
      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}><Dialog.Trigger asChild><button className="secondary create"><Plus size={16}/>创建知识包</button></Dialog.Trigger>
        <Dialog.Portal><Dialog.Overlay className="overlay"/><Dialog.Content className="dialog"><Dialog.Title>创建知识包</Dialog.Title>
          <Dialog.Description>按品类或主题维护明确的知识范围。创建后选择原料。</Dialog.Description>
          <form onSubmit={e=>{e.preventDefault();if(!draftName.trim())return;setName(draftName.trim());setReleased([]);changeScenario('empty');go('materials');setCreateOpen(false);}}>
            <label className="field">知识包名称<input autoFocus value={draftName} onChange={e=>setDraftName(e.target.value)} required maxLength={60}/></label>
            <div className="actions"><Dialog.Close asChild><button type="button" className="secondary">取消</button></Dialog.Close><button className="primary" type="submit">创建并选料</button></div>
          </form></Dialog.Content></Dialog.Portal></Dialog.Root>
      <p className="overline">当前工作空间</p><button className="pack-selected" onClick={()=>go('overview')}><strong>{name}</strong><span>{scenario==='empty'?'待选料':released.length?`${released.length} 版已确认 · 演示`:'候选版本 · 待审核'}</span></button>
      <div className="aside-note"><Layers size={17}/><p>每次更新生成新版本<br/>保留历史内容与来源</p></div></aside>
      <main id="main-content"><div className="page-heading"><div><p className="eyebrow">知识加工</p><h1>{name}</h1><p className="muted">选择原料，审核内容，交付可追溯的知识包。</p></div>
        <div className="heading-right"><span className="badge">{released.length?`已保留 ${released.length} 版（演示）`:scenario==='empty'?'待选料':'候选版本'}</span><small>本地工作空间</small></div></div>
        <nav className="tabs" aria-label="知识包详情">{tabs.map(tab=><button key={tab.id} aria-current={page===tab.id?'page':undefined} className={page===tab.id?'selected':''} onClick={()=>go(tab.id)}>{tab.label}{tab.id==='review'&&<span>{evidence.report.admission.quarantined}</span>}</button>)}</nav>
        <div className="page-content">
          {page==='overview'&&<Overview evidence={evidence} scenario={scenario} go={go}/>}
          {page==='materials'&&<Materials evidence={evidence} scenario={scenario} start={()=>{changeScenario('running');go('execution');}}/>}
          {page==='execution'&&<Execution evidence={evidence} scenario={scenario} setScenario={changeScenario} go={go}/>}
          {page==='review'&&<Review evidence={evidence} go={go}/>}
          {page==='versions'&&<Versions evidence={evidence} blocked={scenario==='required'||scenario==='running'||scenario==='empty'} released={released} release={v=>setReleased(old=>[...new Set([...old,v])])}/>}
        </div></main></div>
  </>;
}

function Overview({evidence,scenario,go}:{evidence:Evidence;scenario:Scenario;go:(p:Page)=>void}){
  const a=evidence.report.admission;
  if(scenario==='empty')return <section className="empty"><BookOpen size={32}/><h2>从一批原料开始</h2><p>为知识包选择现有采集资料，并确认本版要覆盖的范围。</p><button className="primary" onClick={()=>go('materials')}>选择原料 <ArrowRight size={16}/></button></section>;
  return <><section className="next-action"><div><span className="eyebrow">下一步</span><h2>{scenario==='update'?'有新资料可以加入下一版':'核对本版内容与缺口'}</h2><p>{scenario==='update'?'新增型号已用同一提取入口验证，可调整下一版的选料范围。':'合格内容已形成候选包；待核内容保留在质量审核中。'}</p></div><button className="primary" onClick={()=>go(scenario==='update'?'materials':'review')}>{scenario==='update'?'查看更新':'查看质量审核'} <ArrowRight size={16}/></button></section>
    <div className="metrics"><Metric value={a.accepted} label="可用记录" detail="77 个原字段，另含型号与来源状态；歧义字段已隔离"/><Metric value={a.acceptedImages} label="入包图片" detail="2 张效果合格副本中，1 张仍需内容复核"/><Metric value={a.quarantined} label="待核记录" detail="92 行 OCR 与 1 个 HTML 字段"/><Metric value="2" label="样例版本" detail="覆盖重建、缩减输入与新增型号"/></div>
    <section className="section"><div className="section-heading"><h2>本版交付范围</h2><span className="badge">固定小样</span></div><div className="scope-grid"><div><h3>内容</h3><p>4 个来源型号的参数、来源图片状态和合格图片。不同功率保持各自原标签，原文缺失单位按缺失保留。</p></div><div><h3>待核与缺口</h3><p>菜单数量冲突整体隔离。10 张图片待标定，1 张性能图待内容复核；PDF 保留为版面审核候选。</p></div></div></section>
    <section className="section"><div className="section-heading"><h2>成品检查</h2><FileCheck2 size={18}/></div><div className="check-grid">{['官方包描述校验通过','已知歧义泄漏 0','同输入 ZIP 哈希一致','旧版保留与缩减输入通过'].map(t=><div key={t}><CheckCircle2 size={17}/>{t}</div>)}</div><button className="text-button" onClick={()=>go('versions')}>查看文件清单与版本预览 <ArrowRight size={14}/></button></section>
  </>;
}
function Metric({value,label,detail}:{value:string|number;label:string;detail:string}){return <section className="metric"><p>{label}</p><strong>{value}</strong><small>{detail}</small></section>;}
const root=createRoot(document.getElementById('root')!);
root.render(<Prototype/>);
// WHY：入口也会被热更新重新执行，交还旧根节点的所有权后再挂载新一版。
if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount());
