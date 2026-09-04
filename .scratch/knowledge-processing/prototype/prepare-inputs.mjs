import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import ndjson from 'ndjson';
import { z } from 'zod';

const root = path.resolve(import.meta.dirname, '../../../data/knowledge-processing-prototype');
assert.equal(process.versions.node.split('.')[0], '24', '原型使用仓库 Node 24');
const sample = path.resolve(root, '../knowledge-pack-ocr-20260903');
const manifest = JSON.parse(await fs.readFile(path.join(sample, 'sample-pack/input-manifest.json')));
const base = `http://127.0.0.1:4000/api/capture-tasks/${manifest.taskId}/source-runs`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const selected = new Map(manifest.html.map(x => [x.snapshotId, x]));
const recordSchema = z.object({snapshot: z.object({id:z.string(), contentHash:z.string(),
  payload:z.object({kind:z.string(), contentHash:z.string(), bytes:z.number(), text:z.string().optional()}).passthrough()
}).passthrough(), assets:z.array(z.object({id:z.string(),contentHash:z.string(),bytes:z.number(),mediaType:z.string()}).passthrough())}).passthrough();
await fs.mkdir(path.join(root, 'inputs'), {recursive:true});

async function records(runId, visit) {
  const response = await fetch(`${base}/${runId}/export?format=jsonl`, {signal:AbortSignal.timeout(30_000)});
  assert(response.ok && response.body, `Source Dataset ${response.status}`);
  const stream = Readable.fromWeb(response.body).pipe(ndjson.parse());
  for await (const value of stream) await visit(recordSchema.parse(value));
}

async function save(name, bytes, hash) {
  assert(Buffer.byteLength(bytes)<=20*1024*1024,'单资源不超过 20 MiB');
  assert.equal(sha(bytes), hash, `输入哈希 ${name}`);
  const target = path.join(root, 'inputs', name);
  // WHY：冻结输入可重复核验；已有副本只比较，保留先前实验现场。
  const existing = await fs.readFile(target).catch(e => {if(e.code !== 'ENOENT') throw e;});
  if (existing) assert.equal(sha(existing), hash); else await fs.writeFile(target, bytes, {flag:'wx'});
  return {file:`inputs/${name}`,sha256:hash};
}

const html = [];
let extra;
for (const runId of [...new Set(manifest.html.map(x=>x.runId))]) {
  await records(runId, async record => {
    const meta = selected.get(record.snapshot.id);
    const p = record.snapshot.payload;
    const url = record.snapshot.observation.requestedUrl;
    const newModel = !extra && p.kind === 'inline_text' && p.mediaType === 'text/html'
      && p.text?.includes('newPmName_') && /\/\d+\/param\.shtml$/.test(url)
      && !Object.keys(manifest.models).some(id => url.includes(`/${id}/`));
    if (!meta && !newModel) return;
    if (meta) assert.equal(record.snapshot.contentHash, meta.contentHash);
    assert(p.text && Buffer.byteLength(p.text) === p.bytes);
    const input = await save(`${record.snapshot.id}.html`,p.text,p.contentHash);
    const entry = {...input, snapshotId:record.snapshot.id,runId,
      modelId:meta?.modelId ?? url.match(/\/(\d+)\/param\.shtml$/)[1],title:meta?.title ?? '新增来源型号',
      kind:meta?.resourceKind ?? 'parameters',subjectId:meta?.subjectId ?? `source-url:${url}`,
      url,lineage:record.snapshot.lineage,
      capturedAt:record.snapshot.createdAt};
    if(meta) html.push(entry); else extra=entry;
  });
}
assert.equal(html.length,11); assert(extra,'需有小样之外的参数页');

const pdfs=[];
for(const runId of ['source-run-795d7b97-23d2-4061-811d-7d4faa7aaa1e','source-run-0ad20065-157e-4928-98ec-c730789e5159']) {
  await records(runId,async record=>{
    const asset=record.assets.find(x=>x.mediaType==='application/pdf');
    assert(asset && asset.bytes<=20*1024*1024);
    const r=await fetch(`${base}/${runId}/assets/${asset.id}`,{signal:AbortSignal.timeout(30_000)});
    assert(r.ok); const bytes=Buffer.from(await r.arrayBuffer()); assert.equal(bytes.length,asset.bytes);
    const input=await save(`${asset.id}.pdf`,bytes,asset.contentHash);
    pdfs.push({...input,assetId:asset.id,snapshotId:record.snapshot.id,runId,url:asset.sourceUrl,title:asset.filename});
  });
}
const images=[];
const watermark=JSON.parse(await fs.readFile(path.join(sample,'results/watermark-boundary/watermark.json')));
for(const entry of manifest.images){
  const raw=await fs.readFile(path.join(sample,'images',`${entry.sampleId}.jpg`));
  const input=await save(`${entry.sampleId}.jpg`,raw,entry.asset.contentHash);
  const w=watermark.find(x=>x.sampleId===entry.sampleId);
  const variant=w.variants.find(x=>x.method==='telea');
  let derivative;
  if(variant) derivative={...await save(`${entry.sampleId}.png`,await fs.readFile(path.join(sample,'results/watermark-boundary',variant.path)),variant.sha256),
    method:variant.method,region:w.location.bounds,visualEvidence:'OCR-SAMPLE-REPORT.md: 2026-09-03 负责人确认 2 图效果',
    outsideMaskChangedPixels:variant.outsideMaskChangedPixels,edgeCheck:variant.edgeCheck};
  images.push({...input,id:entry.sampleId,modelId:entry.modelId,snapshotId:entry.snapshotId,
    assetId:entry.asset.id,url:entry.asset.sourceUrl,section:entry.section,parentUrl:entry.parentUrl,
    derivative,ocr:w.originalOcr.lines});
}
const schemaResponse=await fetch('https://datapackage.org/profiles/2.0/datapackage.json',{signal:AbortSignal.timeout(20_000)});
assert(schemaResponse.ok);
const schema=await schemaResponse.text();
await fs.writeFile(path.join(root,'datapackage-schema.json'),schema);
await fs.writeFile(path.join(root,'input.json'),JSON.stringify({taskId:manifest.taskId,html,extra,pdfs,images,schemaSha256:sha(schema)},null,2));
console.log(JSON.stringify({html:html.length,additionalHtml:1,images:images.length,derivatives:images.filter(x=>x.derivative).length,pdfs:pdfs.length,schemaSha256:sha(schema)}));
