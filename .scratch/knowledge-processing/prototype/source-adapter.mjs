import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import cacache from 'cacache';
import canonicalize from 'canonicalize';
import { sha } from './package-probe.mjs';

export async function extractHtml(root,input,ruleVersion='zol-source-fields-1') {
  const bytes=await fs.readFile(path.join(root,input.file));
  assert.equal(sha(bytes),input.sha256,'原件哈希');
  const cache=path.join(root,'cache');
  const key=sha(canonicalize({sha256:input.sha256,parser:'cheerio-1.1.2',ruleVersion}));
  const hit=await cacache.get(cache,key).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(hit) return {value:JSON.parse(hit.data),reused:true,key};
  const $=load(bytes.toString('utf8'));
  const fields=$('[id^=newPmName_]').toArray().map(node=>{
    const selector=`#${$(node).attr('id').replace('newPmName_','newPmVal_')}`;
    const value=$(selector).clone(); assert.equal(value.length,1);
    value.find('br').replaceWith('\n');
    return {label:$(node).text().trim(),text:value.text().trim(),locator:selector};
  });
  const title=$('title').text();
  const value={fields,title:title.match(/【(.+?)参数】/)?.[1] ?? title,noImages:$('p.nopic').text().trim()};
  await cacache.put(cache,key,JSON.stringify(value));
  return {value,reused:false,key};
}

export function htmlCandidates(input,value) {
  const fields=[...(input.kind==='parameters'?[{label:'来源型号',text:value.title,locator:'title'}]:[]),...value.fields];
  if(value.noImages) fields.push({label:'来源图片状态',text:value.noImages,locator:'p.nopic'});
  return fields.map(field=>({id:`${input.snapshotId}:${field.locator}`,subjectId:input.modelId,
    ...field,source:{snapshotId:input.snapshotId,sha256:input.sha256,url:input.url,locator:field.locator},
    decision:'accepted',dependsOn:[],reason:'来源字段与值一一对应；保留原标签、单位与缺失表达'}))
    .map(({locator,...candidate})=>candidate);
}

export function ocrCandidates(image) {
  return image.ocr.map((line,i)=>({id:`${image.id}:line-${i+1}`,subjectId:image.modelId,
    label:'图片文字',text:line.text,decision:'pending',dependsOn:[],reason:'文字与所属字段等待逐项复核',
    source:{snapshotId:image.snapshotId,assetId:image.assetId,sha256:image.sha256,url:image.url,
      locator:`OCR line ${i+1}; box ${JSON.stringify(line.box)}`}}));
}

export async function imageCandidate(root,image) {
  if(!image.derivative) return null;
  const d=image.derivative;
  const original=await fs.readFile(path.join(root,image.file)); assert.equal(sha(original),image.sha256);
  const bytes=await fs.readFile(path.join(root,d.file)); assert.equal(sha(bytes),d.sha256);
  return {id:image.id,subjectId:image.modelId,bytes,sha256:d.sha256,
    source:{snapshotId:image.snapshotId,assetId:image.assetId,sha256:image.sha256,url:image.url,locator:'full image'},
    visualApproved:true,contentApproved:false,factKeys:[],dependsOn:[],method:d.method,region:d.region};
}
