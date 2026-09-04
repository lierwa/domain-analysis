import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { buildPackage,validatePackage,retainVersion,sha } from './package-probe.mjs';
import { extractHtml,htmlCandidates,ocrCandidates,imageCandidate } from './source-adapter.mjs';

assert.equal(process.versions.node.split('.')[0],'24');
const started=performance.now();
const root=path.resolve(import.meta.dirname,'../../../data/knowledge-processing-prototype');
const input=JSON.parse(await fs.readFile(path.join(root,'input.json')));
const output=await fs.mkdtemp(path.join(root,'run-'));
const schema=path.join(root,'datapackage-schema.json');
assert.equal(sha(await fs.readFile(schema)),input.schemaSha256);
const candidates=[]; const extraction=[];
for(const h of [...input.html,input.extra]){
  const result=await extractHtml(root,h);
  candidates.push(...htmlCandidates(h,result.value));
  const repeat=await extractHtml(root,h); assert(repeat.reused);
  assert.deepEqual(result.value,repeat.value);
  extraction.push({snapshotId:h.snapshotId,reused:result.reused,repeatReused:true,fields:result.value.fields.length});
}
const first=input.html.find(x=>x.kind==='parameters');
const changed=await extractHtml(output,{...first,file:path.relative(output,path.join(root,first.file))},'zol-source-fields-2');
assert(!changed.reused);
const originalKey=await extractHtml(output,{...first,file:path.relative(output,path.join(root,first.file))});
assert.notEqual(changed.key,originalKey.key);
for(const image of input.images)candidates.push(...ocrCandidates(image));

// WHY：此映射来自已记录的小样争议，只作为原型输入；通用准入函数不认识型号或菜单数字。
const menu=candidates.filter(x=>(x.subjectId==='1406333' && x.source.locator==='#newPmVal_11')
  || x.id==='1406333-I2:line-1');
assert.equal(menu.length,2);
for(const x of menu){x.factKey='sample:1406333:menu-count';x.decision='pending';x.reason='菜单数量的来源与适用版本尚未对齐';}
const derivatives=(await Promise.all(input.images.map(x=>imageCandidate(root,x)))).filter(Boolean);
// WHY：只复用已获效果认可且本轮对照型号明确的来源宣传图；性能文字图继续等待内容复核。
derivatives.find(x=>x.id==='1406483-I2').contentApproved=true;
const oldSubjects=new Set(input.html.map(x=>x.modelId));
const common={packageId:'product-source-prototype',title:'标准商品来源资料',images:derivatives};
const v1=buildPackage({...common,version:'0.1.0-prototype.1',candidates:candidates.filter(x=>oldSubjects.has(x.subjectId))});
const replay=buildPackage({...common,version:'0.1.0-prototype.1',candidates:candidates.filter(x=>oldSubjects.has(x.subjectId))});
assert.equal(sha(v1.zip),sha(replay.zip));
const v2=buildPackage({...common,version:'0.1.0-prototype.2',candidates:candidates.filter(x=>['1406483',input.extra.modelId].includes(x.subjectId))});
const checked=await validatePackage(v1.zip,schema);
await validatePackage(v2.zip,schema);
for(const [name,bytes] of Object.entries(checked.files)){
  if(name.endsWith('.png'))continue;
  assert(!/58道菜单|46道自动菜单/.test(Buffer.from(bytes).toString()),`歧义泄漏 ${name}`);
}
const versionRoot=path.join(output,'versions');
const retained=await retainVersion(versionRoot,'0.1.0-prototype.1',v1.zip);
await retainVersion(versionRoot,'0.1.0-prototype.2',v2.zip);
assert.throws(()=>buildPackage({...common,version:'0.1.0-prototype.3',candidates,requiredIds:['1406483-I3']}),/必要/);
assert.equal(sha(await fs.readFile(retained)),sha(v1.zip));
const oldOnly=Object.keys(v1.files).filter(x=>!Object.hasOwn(v2.files,x));
assert.equal(oldOnly.filter(x=>x.startsWith('content/')).length,3);

const pdf=[];
for(const p of input.pdfs){
  assert.equal(sha(await fs.readFile(path.join(root,p.file))),p.sha256);
  const target=path.join(output,`${p.assetId}.json`);
  const run=await execa(process.execPath,[path.join(import.meta.dirname,'pdf-probe.mjs'),path.join(root,p.file),target],
    {timeout:30_000,reject:false,env:{HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:''}});
  const result=run.exitCode===0?JSON.parse(await fs.readFile(target)):null;
  pdf.push({title:p.title,assetId:p.assetId,sha256:p.sha256,exitCode:run.exitCode,
    seconds:result?.seconds,totalPages:result?.totalPages,processedPages:result?.processedPages,
    textItems:result?.pages.reduce((n,p)=>n+p.items.length,0),peakRssBytes:result?.peakRssBytes,
    disposition:'pending_layout_review',diagnostic:run.stderr.slice(0,1000)});
}

const report={createdAt:new Date().toISOString(),input:{html:input.html.length,images:input.images.length,pdfs:input.pdfs.length,
  additionalModel:input.extra.modelId},extraction,
  admission:{accepted:v1.admission.accepted.length,quarantined:v1.admission.quarantined.length,
    acceptedImages:v1.admission.images.length,pendingImageContent:v1.admission.excludedImages.length,
    uncalibratedImages:input.images.filter(x=>!x.derivative).length},
  checks:{officialSchema:true,replayZipEqual:true,knownConflictLeaks:0,shrinkRemovedContentFiles:3,
    previousVersionRetainedAfterFailure:true,configCacheKeyChanged:true},pdf,
  versions:[v1,v2].map(v=>({version:v.descriptor.version,sha256:sha(v.zip),bytes:v.zip.length,
    files:Object.keys(v.files),accepted:v.admission.accepted.length,images:v.admission.images.length})),
  processingLlmCalls:0,modelTokens:0,seconds:(performance.now()-started)/1000,
  humanReviewMinutes:null,humanReviewNote:'既有标定与用户复核人时未记录；本轮工程检查不冒充人工签字',
  platform:{node:process.version,os:process.platform,arch:process.arch},output};
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
await fs.writeFile(path.join(output,'candidates.json'),JSON.stringify(candidates,null,2));
const publicRoot=path.join(root,'ui'); await fs.mkdir(publicRoot,{recursive:true});
await fs.writeFile(path.join(publicRoot,'evidence.json'),JSON.stringify({report,candidates,
  previews:[v1,v2].map(v=>({version:v.descriptor.version,files:Object.entries(v.files)
    .filter(([name])=>name.endsWith('.md')).map(([name,bytes])=>({name,text:Buffer.from(bytes).toString()}))}))}));
for(const image of input.images.filter(x=>x.derivative)){
  await fs.copyFile(path.join(root,image.file),path.join(publicRoot,`${image.id}-original.jpg`));
  await fs.copyFile(path.join(root,image.derivative.file),path.join(publicRoot,`${image.id}-processed.png`));
}
for(const v of [v1,v2])await fs.writeFile(path.join(publicRoot,`${v.descriptor.version}.zip`),v.zip);
await fs.writeFile(path.join(root,'latest-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
