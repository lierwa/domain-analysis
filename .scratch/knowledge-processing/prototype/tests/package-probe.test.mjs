import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zipSync,strToU8 } from 'fflate';
import { admit,buildPackage,validatePackage,retainVersion,sha } from '../package-probe.mjs';

const source={snapshotId:'snapshot-a',sha256:'a'.repeat(64),url:'https://example.org/source',locator:'#capacity'};
const candidate=(id,text,overrides={})=>({id,subjectId:'model-a',label:'容量',text,source,
  decision:'accepted',dependsOn:[],reason:'原文明确对应',...overrides});
const image={id:'image-a',subjectId:'model-a',source,bytes:new Uint8Array([1,2]),sha256:sha(new Uint8Array([1,2])),
  visualApproved:true,contentApproved:true,factKeys:[],dependsOn:[],method:'verified-copy',region:[]};
const common={packageId:'acceptance-pack',title:'隔离验证',version:'0.1.0',images:[]};

test('冲突隔离传播到同事实副本、衍生摘要与承载值的图片，其他功率保持原标签',()=>{
  const values=[candidate('capacity','20L'),candidate('disputed','58道菜单',{factKey:'menu',decision:'pending'}),
    candidate('copy','46道自动菜单',{factKey:'menu'}),candidate('summary','菜单介绍',{dependsOn:['copy']}),
    candidate('power','700W',{label:'产品功率'})];
  const result=admit(values,[{...image,factKeys:['menu']}]);
  assert.deepEqual(result.accepted.map(x=>x.id),['capacity','power']);
  assert.equal(result.accepted[1].label,'产品功率');
  assert.equal(result.images.length,0);
  const built=buildPackage({...common,candidates:values,images:[{...image,factKeys:['menu']}]});
  for(const bytes of Object.values(built.files))assert(!/58道菜单|46道自动菜单|菜单介绍/.test(Buffer.from(bytes).toString()));
});

test('执行成功不代替 OCR 内容审核；图片效果通过不代替内容准入',()=>{
  const result=admit([candidate('ocr','置信度很高',{decision:'pending'}),candidate('stable','20L')],
    [{...image,contentApproved:false}]);
  assert.deepEqual(result.accepted.map(x=>x.id),['stable']);assert.equal(result.images.length,0);
  assert.throws(()=>buildPackage({...common,candidates:[candidate('stable','20L')],images:[{...image,contentApproved:false}],requiredIds:['image-a']}),/必要/);
});

test('同一接口拒绝重复 ID、来源断链与损坏图片',()=>{
  assert.throws(()=>admit([candidate('a','20L'),candidate('a','30L')],[]),/唯一/);
  assert.throws(()=>admit([candidate('a','20L',{dependsOn:['missing']})],[]),/不存在/);
  assert.throws(()=>buildPackage({...common,candidates:[candidate('a','20L')],images:[{...image,sha256:'0'.repeat(64)}]}),/哈希/);
});

test('重建产物一致，输入缩减生成仅包含当前材料的新版本',()=>{
  const a=candidate('a','20L');const b=candidate('b','30L',{subjectId:'model-b'});
  const first=buildPackage({...common,candidates:[a,b]});
  const replay=buildPackage({...common,candidates:[a,b]});assert.equal(sha(first.zip),sha(replay.zip));
  const next=buildPackage({...common,version:'0.2.0',candidates:[a]});
  assert.equal(Object.keys(next.files).filter(x=>x.startsWith('content/')).length,1);
  assert(!Object.values(next.files).some(x=>Buffer.from(x).toString().includes('30L')));
});

test('已保留版本不能同名替换，新版本失败不损坏既有 bytes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'knowledge-version-test-'));
  try {
    const first=buildPackage({...common,candidates:[candidate('a','20L')]});
    const file=await retainVersion(root,'0.1.0',first.zip);
    await assert.rejects(()=>retainVersion(root,'0.1.0',new Uint8Array([3])),/不能替换/);
    assert.throws(()=>buildPackage({...common,candidates:[candidate('a','20L')],requiredIds:['missing']}),/必要/);
    assert.equal(sha(await fs.readFile(file)),sha(first.zip));
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('官方 schema、资源哈希与白名单分别校验，拒绝缺件和额外审核文件',async()=>{
  const root=path.resolve(import.meta.dirname,'../../../../data/knowledge-processing-prototype');
  const schema=path.join(root,'datapackage-schema.json');
  const pack=buildPackage({...common,candidates:[candidate('a','20L')]});
  await validatePackage(pack.zip,schema);
  await assert.rejects(()=>validatePackage(zipSync({...pack.files,'review.json':strToU8('{"value":"58"}')}),schema),/白名单/);
  const files={...pack.files};delete files['INDEX.md'];
  await assert.rejects(()=>validatePackage(zipSync(files),schema),/白名单/);
  await assert.rejects(()=>validatePackage(zipSync({...pack.files,'sources.json':strToU8('[]')}),schema),/字节数|完整性/);
});
