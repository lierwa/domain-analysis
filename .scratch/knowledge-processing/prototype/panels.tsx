import {useState} from 'react';
import {Dialog} from 'radix-ui';
import {ArrowRight,CheckCircle2,Clock3,Download,FileText,Image,Pause,Play,ShieldCheck,TriangleAlert} from 'lucide-react';
import {useLocalStorage} from 'usehooks-ts';
import type {Evidence,Page,Scenario} from './main';

export function Materials({evidence,scenario,start}:{evidence:Evidence;scenario:Scenario;start:()=>void}){
  const [selection,setSelection]=useState(scenario==='empty'?[]:['html','image']);
  const [budget,setBudget]=useLocalStorage('knowledge-prototype-budget','120');
  const [required,setRequired]=useState(false);
  const rows=[{id:'html',title:'微波炉 · 参数与图集页面',scope:'已冻结的 4 个来源型号',amount:'11 HTML',state:'支持结构提取'},
    {id:'image',title:'微波炉 · 来源图片',scope:'保留型号、分类与父页面关系',amount:'12 图片',state:'有限 OCR / 副本审核'},
    {id:'additional',title:`新增来源型号 ${evidence.report.input.additionalModel}`,scope:'同一来源的新输入，用于下一版',amount:'1 HTML',state:'同入口提取已验证'},
    {id:'pdf',title:'品牌说明书与技术论文',scope:'保留页码与文字位置，等待版面复核',amount:'2 PDF',state:'解析候选'}];
  function toggle(id:string){setSelection(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);}
  return <><section className="section"><div className="section-heading"><div><h2>选择原料</h2><p className="muted">启动时固定本版输入；后续新资料可加入下一版。</p></div><span className="badge">本机样例选料</span></div>
    <table><thead><tr><th>采用</th><th>来源资料</th><th>数量</th><th>处理方式</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><input type="checkbox" aria-label={`选择${row.title}`} checked={selection.includes(row.id)} onChange={()=>toggle(row.id)}/></td><td><strong>{row.title}</strong><small>{row.scope}</small></td><td>{row.amount}</td><td><span className="badge">{row.state}</span></td></tr>)}</tbody></table></section>
    <div className="two-columns"><section className="section"><h2>加工设置</h2><label className="field">内容组织<select defaultValue="source"><option value="source">按来源型号保留字段与上下文</option></select></label>
      <label className="check-label"><input type="checkbox" defaultChecked/>对入选图片提取文字</label><label className="check-label"><input type="checkbox" checked={required} onChange={e=>setRequired(e.target.checked)}/>将图片设为本版必需内容</label>
      <p className="muted">{required?'必需图片未通过检查时，本版保持待处理。':'允许合格内容先形成候选版本，图片缺口写入发布摘要。'}</p><div className="note"><ShieldCheck size={17}/>内容准入与来源完整性检查始终执行</div></section>
      <section className="section"><h2>工作量与预算</h2><label className="field">本次加工时间上限（秒）<input type="number" min="30" max="600" value={budget} onChange={e=>setBudget(e.target.value)}/></label>
        <dl className="facts"><dt>已选资料组</dt><dd>{selection.length} 组</dd><dt>生成式模型调用</dt><dd>0 次</dd><dt>机器耗时参考</dt><dd>本次原型 {evidence.report.seconds.toFixed(2)} 秒</dd><dt>人工审核成本</dt><dd>待记录</dd></dl>
        <small>参考值来自固定小样；资料变化后重新估算，时间上限到达时暂停。</small></section></div>
    <div className="bottom-action"><p>{selection.length?'选料与设置将保存为一次加工记录。':'请选择至少一组原料。'}</p><button className="primary" disabled={!selection.length||Number(budget)<30||Number(budget)>600} onClick={start}><Play size={16}/>演示开始加工</button></div></>;
}

export function Execution({evidence,scenario,setScenario,go}:{evidence:Evidence;scenario:Scenario;setScenario:(s:Scenario)=>void;go:(p:Page)=>void}){
  const running=scenario==='running';const stopped=scenario==='stopped';const failed=scenario==='failed';
  return <><section className="section"><div className="section-heading"><div><p className="eyebrow">执行控制 · 情景演示</p><h2>{running?'正在处理入选资料':stopped?'加工已停止':failed?'加工结束，部分资料失败':'加工完成，等待内容审核'}</h2></div>
      {running?<button className="secondary" onClick={()=>setScenario('stopped')}><Pause size={16}/>演示停止</button>:
        (stopped||failed)?<button className="secondary" onClick={()=>setScenario('running')}><Play size={16}/>{stopped?'演示受控继续':'演示重跑失败项'}</button>:<span className="badge good">结果已保存</span>}</div>
      <div className="steps">{['固定输入','提取内容','内容准入','成品检查'].map((x,i)=><div className={running&&i>1?'':'done'} key={x}><span>{i+1}</span>{x}</div>)}</div>
      <p className="muted">{stopped?'已完成的逐件结果保留；继续时校验输入与加工设置，复用可用结果。':failed?'失败项记录原因；合格材料可以继续，已发布版本保持可用。':'处理成功与内容可采用分别记录，疑点集中进入质量审核。'}</p>
      {failed&&<div className="note warning"><TriangleAlert size={18}/>情景示例：一份输入文件读取失败。重跑只处理失败项，完整性不足的必需资料阻止发布。</div>}
      <button className="text-button" onClick={()=>{setScenario('ready');go('review');}}>查看实际样包审核结果 <ArrowRight size={14}/></button></section>
    <section className="section"><div className="section-heading"><h2>最近一次实际组件原型</h2><small>{new Date(evidence.report.createdAt).toLocaleString('zh-CN')}</small></div>
      <table><thead><tr><th>工序</th><th>执行结果</th><th>内容去向</th></tr></thead><tbody>
        <tr><td>HTML 结构提取</td><td>12 份完成（含新增型号）</td><td>来源字段与原值进入准入检查</td></tr>
        <tr><td>OCR 结果复用</td><td>12 张原图 · 92 行历史转写</td><td>92 行等待逐项内容复核</td></tr>
        <tr><td>图片副本检查</td><td>2 张既有效果合格副本哈希一致</td><td>1 张入包，1 张等待内容复核</td></tr>
        {evidence.report.pdf.map(p=><tr key={p.title}><td>PDF · {p.title}</td><td>{p.exitCode===0?`前 ${p.processedPages} / ${p.totalPages} 页完成`:'本次执行失败'}</td><td>版面与文字关系待核</td></tr>)}
        <tr><td>版本封装</td><td>2 个版本校验通过</td><td>本机隔离样包</td></tr>
      </tbody></table><p className="muted">机器耗时 {evidence.report.seconds.toFixed(2)} 秒 · 模型 token 0 · 人工复核人时未记录</p></section></>;
}

export function Review({evidence,go}:{evidence:Evidence;go:(p:Page)=>void}){
  const [kind,setKind]=useState('conflict');const [note,setNote]=useLocalStorage('knowledge-prototype-review-note','');
  const [saved,setSaved]=useState(false);const [image,setImage]=useState('1406483-I2');
  const conflict=evidence.candidates.filter(x=>x.factKey);
  const groups=[{id:'conflict',title:'菜单数量冲突',count:'2 条依据',icon:TriangleAlert},
    {id:'ocr',title:'图片文字待核',count:'92 行',icon:FileText},{id:'images',title:'图片副本',count:'2 张',icon:Image},{id:'pdf',title:'PDF 版面审核',count:'2 份',icon:FileText}];
  return <><div className="review-intro"><div><h2>质量审核</h2><p className="muted">按问题处理受影响内容；合格资料继续保留。</p></div><button className="secondary" onClick={()=>go('versions')}>预览合格版本 <ArrowRight size={15}/></button></div>
    <div className="review-layout"><nav aria-label="审核分组" className="review-groups">{groups.map(g=><button key={g.id} className={kind===g.id?'selected':''} onClick={()=>setKind(g.id)}><g.icon size={17}/><span><strong>{g.title}</strong><small>{g.count}</small></span></button>)}</nav>
      <section className="section review-detail">{kind==='conflict'&&<><div className="section-heading"><div><p className="eyebrow">松下 NN-DS2000XPE</p><h2>菜单数量</h2></div><span className="badge warning">整体隔离</span></div>
        <p>来源给出的数量无法对齐。该字段的两种值及相关衍生内容均留在审核材料中。</p><div className="evidence-pair">{conflict.map(x=><article key={x.id}><small>{x.source.assetId?'原图 OCR 转写':'参数页原字段'}</small><strong>{x.text}</strong><p>{x.source.locator}</p><details><summary>来源定位</summary><code>{x.source.snapshotId}</code><a href={x.source.url} target="_blank" rel="noreferrer">打开来源页面</a></details></article>)}</div>
        <div className="note"><ShieldCheck size={18}/><div><strong>当前采用结果</strong><p>此字段已从正文、目录及可读附件中隔离。其余明确字段可以继续采用。</p></div></div>
        <label className="field">补充复核依据<textarea rows={3} value={note} onChange={e=>{setNote(e.target.value);setSaved(false);}} placeholder="记录来源版本、对象或条件差异，供下一次加工复核"/></label>
        <div className="actions"><span role="status">{saved?'意见已保存在本浏览器的演示记录中':'补充意见后仍需重新加工与检查'}</span><button className="secondary" disabled={!note.trim()} onClick={()=>setSaved(true)}>保存复核意见（演示）</button></div></>}
      {kind==='ocr'&&<><h2>图片文字待核</h2><p>转写结果保留位置与置信度。拟采用的数值、单位及所属字段需要一起复核。</p><table><thead><tr><th>文字</th><th>归属</th><th>处置</th></tr></thead><tbody>{evidence.candidates.filter(x=>x.label==='图片文字').slice(0,8).map(x=><tr key={x.id}><td>{x.text}</td><td>{x.subjectId}</td><td>待核</td></tr>)}</tbody></table><small>显示前 8 行，实际样包中全部 92 行保持隔离。</small></>}
      {kind==='images'&&<><div className="section-heading"><h2>图片对照</h2><select aria-label="选择图片" value={image} onChange={e=>setImage(e.target.value)}><option value="1406483-I2">来源宣传图 · 本版入包</option><option value="1406483-I3">性能文字图 · 内容待核</option></select></div>
        <div className="image-pair"><figure><img src={`/${image}-original.jpg`} alt="来源原图"/><figcaption>来源原图 · 用于 OCR 与回查</figcaption></figure><figure><img src={`/${image}-processed.png`} alt="去水印处理副本"/><figcaption>处理副本 · 既有效果审核通过</figcaption></figure></div>
        <div className={`note ${image==='1406483-I3'?'warning':''}`}><ShieldCheck size={18}/><p>{image==='1406483-I2'?'本轮核对型号、来源与副本哈希；以来源宣传图进入验证包。':'效果合格，图片仍含性能值。内容对应关系待核，本版保持隔离。'}</p></div><small>其余 10 张图片尚需定位与标定，不计作批量自动处理完成。</small></>}
      {kind==='pdf'&&<><h2>PDF 版面与内容关系</h2><p>两份 PDF 各处理前 5 页；保留页码、文字位置和原件哈希。</p><div className="note warning"><TriangleAlert size={18}/><p>中文说明书出现不可读字符和操作表格顺序错位。纯文字提取还不能作为直接入包依据。</p></div><p>后续比较具备版面解析能力的成熟组件；当前保留为审核候选。复杂表格、扫描页和全文处理需要补充验证。</p></>}
      </section></div></>;
}

export function Versions({evidence,blocked,released,release}:{evidence:Evidence;blocked:boolean;released:string[];release:(v:string)=>void}){
  const [version,setVersion]=useState(0);const [preview,setPreview]=useState('INDEX.md');const [confirmed,setConfirmed]=useState(false);
  const v=evidence.report.versions[version];const files=evidence.previews.find(x=>x.version===v.version)?.files??[];
  const content=files.find(x=>x.name===preview);
  const isReleased=released.includes(v.version);
  return <><section className="section"><div className="section-heading"><div><p className="eyebrow">版本与导出</p><h2>本版内容与交付</h2></div><span className="badge">{isReleased?'已确认（演示）':'待确认'}</span></div>
    <p>先查看内容、变更与缺口，确认后交付确定版本。后续加工失败时，历史版本继续保留。</p>
    <div className="version-choices">{evidence.report.versions.map((x,i)=><button key={x.version} className={i===version?'selected':''} onClick={()=>{setVersion(i);setPreview('INDEX.md');setConfirmed(false);}}><Clock3 size={18}/><span><strong>{x.version}</strong><small>{x.accepted} 条记录 · {x.images} 张图片 · {(x.bytes/1024).toFixed(1)} KiB</small></span></button>)}</div>
    <div className="note"><CheckCircle2 size={18}/><p>{version===0?'固定 4 个型号，保留 81 条采用记录；菜单数量冲突与待核 OCR 均已隔离。':'本版保留东芝并加入新来源型号 1406343；移除 3 个旧型号内容文件，上一版本完整保留。'}</p></div>
    {blocked&&<div className="note warning" role="status"><TriangleAlert size={18}/>当前情景尚未满足发布条件：需完成加工并通过必需内容检查。</div>}
    <div className="actions"><small>下载的是实际生成的隔离样包。</small><Dialog.Root><Dialog.Trigger asChild><button className="primary" disabled={blocked||isReleased}>演示确认发布</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="overlay"/><Dialog.Content className="dialog"><Dialog.Title>确认交付本版内容</Dialog.Title><Dialog.Description>本地操作演示。实际系统将在确认时锁定内容、检查结果与文件哈希。</Dialog.Description>
      <p>{v.accepted} 条可用记录，{v.images} 张图片。待核内容和图片缺口保持在审核材料中。</p><label className="check-label"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>已查看内容范围、变更和缺口</label><div className="actions"><Dialog.Close asChild><button className="secondary">返回检查</button></Dialog.Close><Dialog.Close asChild><button className="primary" disabled={!confirmed} onClick={()=>release(v.version)}>确认发布（演示）</button></Dialog.Close></div></Dialog.Content></Dialog.Portal></Dialog.Root>
      {isReleased&&<a className="primary" href={`/${v.version}.zip`} download><Download size={16}/>下载本版样包</a>}</div></section>
    <div className="two-columns"><section className="section"><h2>文件清单</h2><ul className="file-list">{v.files.map(x=><li key={x}><FileText size={14}/>{x}</li>)}</ul><details><summary>完整性信息</summary><code>{v.sha256}</code><small>ZIP SHA-256；文件 bytes 与哈希见 datapackage.json。</small></details></section>
      <section className="section"><div className="section-heading"><h2>本版内容预览</h2><select aria-label="选择预览文件" value={preview} onChange={e=>setPreview(e.target.value)}>{files.map(x=><option key={x.name}>{x.name}</option>)}</select></div><pre>{content?.text}</pre></section></div></>;
}
