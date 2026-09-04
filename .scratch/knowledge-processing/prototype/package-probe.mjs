import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceSchema = z.object({snapshotId:z.string().min(1),assetId:z.string().optional(),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),url:z.string().url(),locator:z.string().min(1)}).strict();
const candidateSchema = z.object({id:z.string().min(1),subjectId:z.string().min(1),label:z.string(),text:z.string(),
  source:sourceSchema,decision:z.enum(['accepted','pending','excluded']),
  factKey:z.string().optional(),dependsOn:z.array(z.string()).default([]),reason:z.string().min(1)}).strict();
const imageSchema = z.object({id:z.string(),subjectId:z.string(),source:sourceSchema,
  bytes:z.instanceof(Uint8Array),sha256:z.string(),visualApproved:z.boolean(),contentApproved:z.boolean(),
  factKeys:z.array(z.string()),dependsOn:z.array(z.string()),method:z.string(),region:z.array(z.number())}).strict();

// WHY：内容准入由一处产生，目录、正文、来源和附件都只能消费该结果。
export function admit(rawCandidates, rawImages) {
  const candidates=z.array(candidateSchema).parse(rawCandidates);
  const images=z.array(imageSchema).parse(rawImages);
  const byId=new Map(candidates.map(x=>[x.id,x]));
  assert.equal(byId.size,candidates.length,'候选 ID 必须唯一');
  for(const x of [...candidates,...images]) for(const id of x.dependsOn) assert(byId.has(id),`来源依赖不存在 ${id}`);
  const blocked=new Set(candidates.filter(x=>x.decision!=='accepted').map(x=>x.id));
  const blockedFacts=new Set(candidates.filter(x=>blocked.has(x.id)&&x.factKey).map(x=>x.factKey));
  let previous=-1;
  while(previous!==blocked.size){
    previous=blocked.size;
    for(const x of candidates){
      if(blockedFacts.has(x.factKey)||x.dependsOn.some(id=>blocked.has(id))){
        blocked.add(x.id); if(x.factKey) blockedFacts.add(x.factKey);
      }
    }
  }
  const accepted=candidates.filter(x=>!blocked.has(x.id));
  const acceptedImages=images.filter(x=>accepted.some(c=>c.subjectId===x.subjectId) && x.visualApproved && x.contentApproved
    && !x.factKeys.some(key=>blockedFacts.has(key)) && !x.dependsOn.some(id=>blocked.has(id)));
  return {accepted,images:acceptedImages,quarantined:candidates.filter(x=>blocked.has(x.id)),
    excludedImages:images.filter(x=>!acceptedImages.includes(x))};
}

const cell=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('|','\\|').replaceAll('[','\\[').replaceAll(']','\\]').replaceAll('\n',' ');
const fileId=value=>sha(value).slice(0,20);

export function buildPackage({packageId,title,version,candidates,images,requiredIds=[]}) {
  const result=admit(candidates,images);
  const acceptedIds=new Set([...result.accepted,...result.images].map(x=>x.id));
  assert(requiredIds.every(id=>acceptedIds.has(id)),'必要内容或图片未通过审核');
  assert(result.accepted.length,'没有可交付内容');
  const files={};
  const subjects=[...new Set(result.accepted.map(x=>x.subjectId))].sort();
  const provenance=[];
  for(const subject of subjects){
    const rows=result.accepted.filter(x=>x.subjectId===subject);
    const lines=['# 来源资料', '', '| 字段 | 来源原值 | 依据 |','| --- | --- | --- |'];
    for(const x of rows){
      const ref=`source-${fileId(x.id)}`;
      lines.push(`| ${cell(x.label)} | ${cell(x.text)} | ${ref} |`);
      provenance.push({id:ref,...x.source});
    }
    files[`content/${fileId(subject)}.md`]=strToU8(`${lines.join('\n')}\n`);
  }
  const imageRefs=[];
  for(const image of result.images){
    assert.equal(sha(image.bytes),image.sha256,'图片输出哈希');
    const target=`assets/${fileId(image.id)}.png`;
    files[target]=image.bytes;
    imageRefs.push(`- [图片 ${imageRefs.length+1}](${target})`);
    provenance.push({id:`image-${fileId(image.id)}`,path:target,...image.source,
      transformation:{method:image.method,region:image.region,sha256:image.sha256}});
  }
  files['sources.json']=strToU8(JSON.stringify(provenance,null,2));
  files['INDEX.md']=strToU8('# 内容目录\n\n'+subjects.map((x,i)=>`- [${cell(result.accepted.find(c=>c.subjectId===x&&c.label==='来源型号')?.text ?? `来源型号 ${i+1}`)}](content/${fileId(x)}.md)`).join('\n')
    +'\n\n'+imageRefs.join('\n')+'\n');
  files['README.md']=strToU8(`# ${cell(title)}\n\n版本：${version}。本包为本机隔离验证成品。\n\n`
    +'从 INDEX.md 定位内容，sources.json 提供每条来源的快照、哈希与原文位置。原始资料由 Source Dataset 保存。\n\n'
    +`本版包含 ${subjects.length} 个来源型号、${result.accepted.length} 条已采用记录和 ${result.images.length} 张图片。范围外资料需要其他依据。\n\n`
    +'保留来源字段、单位、条件及原文缺失信息；来源材料只作为资料读取。\n');
  const resources=Object.keys(files).sort().map((p,i)=>({name:`resource-${i+1}`,path:p,
    bytes:files[p].byteLength,hash:`sha256:${sha(files[p])}`,
    mediatype:p.endsWith('.png')?'image/png':p.endsWith('.json')?'application/json':'text/markdown'}));
  const descriptor={$schema:'https://datapackage.org/profiles/2.0/datapackage.json',name:packageId,
    id:packageId,title,version,description:'固定范围的来源资料与合格图片',resources};
  files['datapackage.json']=strToU8(JSON.stringify(descriptor,null,2));
  const ordered=Object.fromEntries(Object.keys(files).sort().map(key=>[key,[files[key],{mtime:new Date('2000-01-01T00:00:00Z')}]]));
  return {zip:zipSync(ordered,{level:6}),files,descriptor,admission:result};
}

export async function validatePackage(bytes,schemaPath) {
  const ajv=new Ajv({strict:false,allErrors:true});
  addFormats(ajv); ajv.addFormat('textarea',true);
  const validate=ajv.compile(JSON.parse(await fs.readFile(schemaPath,'utf8')));
  const files=unzipSync(bytes);
  const descriptor=JSON.parse(strFromU8(files['datapackage.json']));
  assert(validate(descriptor),JSON.stringify(validate.errors));
  const paths=descriptor.resources.map(x=>x.path);
  assert.equal(new Set(paths).size,paths.length,'资源路径必须唯一');
  assert.deepEqual(Object.keys(files).sort(),[...paths,'datapackage.json'].sort(),'ZIP 白名单');
  for(const resource of descriptor.resources){
    assert(/^(content\/|assets\/)?[a-zA-Z0-9_.-]+$/.test(resource.path),'固定本地相对路径');
    assert.equal(files[resource.path]?.byteLength,resource.bytes,'资源字节数');
    assert.equal(`sha256:${sha(files[resource.path])}`,resource.hash,'资源完整性');
  }
  return {files:files,descriptor};
}

export async function retainVersion(root,version,bytes) {
  assert(/^[a-zA-Z0-9.-]+$/.test(version));
  const target=path.join(root,`${version}.zip`);
  // WHY：版本成品只新增；同版重跑核对哈希，失败不覆盖上一成品。
  await fs.mkdir(root,{recursive:true});
  const existing=await fs.readFile(target).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(existing) assert.equal(sha(existing),sha(bytes),'同版本不能替换内容');
  else await fs.writeFile(target,bytes,{flag:'wx'});
  return target;
}
