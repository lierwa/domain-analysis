import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { load } from 'cheerio';

const { values } = parseArgs({ options: { root: { type: 'string' } } });
if (!values.root) throw new Error('--root 必填');
const root = path.resolve(values.root);
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
const build = await readJson('build.json');
const questions = await readJson('evaluation/questions-gold.json');
const available = await fs.readdir(path.join(root, 'evaluation'), { withFileTypes: true });
const runs = [];
for (const entry of available.filter((item) => item.isDirectory())) {
  const files = await fs.readdir(path.join(root, 'evaluation', entry.name));
  if (files.includes('run.json')) runs.push(await readJson(`evaluation/${entry.name}/run.json`));
}
let grading = {};
if (available.some((entry) => entry.name === 'grading.json')) grading = await readJson('evaluation/grading.json');
const $ = load(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>知识包样本验证</title><style>
body{font:16px/1.7 system-ui,sans-serif;color:#18212e;background:#f5f7fa;margin:0}main{max-width:1120px;margin:36px auto;padding:0 24px}
h1{font-size:32px;line-height:1.3}h2{font-size:21px;margin-top:32px}.muted{color:#637083}a{color:#1461ad}table{width:100%;border-collapse:collapse;background:white}
th,td{padding:12px 16px;border-bottom:1px solid #e0e5eb;text-align:left;vertical-align:top}th{background:#edf2f7}details{background:white;border:1px solid #dce3eb;border-radius:8px;margin:12px 0;padding:14px 18px}
summary{cursor:pointer;font-weight:650}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}.answer,pre{white-space:pre-wrap;overflow-wrap:anywhere}.answer{font-size:15px}pre{font-size:12px;line-height:1.6}
.metric{display:inline-block;margin:0 12px 12px 0;padding:12px 18px;background:white;border:1px solid #dce3eb;border-radius:8px}small{color:#637083}@media(max-width:760px){.pair{grid-template-columns:1fr}}
</style></head><body><main><div class="muted">阶段二 · 固定样本验证</div><h1>原始资料 → 文字知识包 → Codex</h1>
<p id="intro"></p><div id="metrics"></div><p><a href="knowledge-sample.zip">下载 Skill 样包</a> · <a href="consumer/pack/.agents/skills/product-source-sample/SKILL.md">查看 Skill 入口</a> · <a href="../results/watermark-boundary/review.html">查看图片与 OCR 对照</a></p>
<h2>消费对照</h2><p id="conditions" class="muted"></p><table id="totals"><thead><tr><th>资料形式</th><th>已完成问题</th><th>输入 token</th><th>其中缓存</th><th>输出 token</th><th>耗时</th></tr></thead><tbody></tbody></table>
<p id="verdict"></p><h2>逐题答案与证据</h2><div id="questions"></div><h2>包内资料</h2><p class="muted">按型号展开查看原字段、OCR 文字与来源记录。OCR 的识别置信度不作为事实正确率。</p><div id="references"></div>
<h2 id="ocr-review">待确认的两处图片文字</h2><p class="muted">下方原图仅用于负责人复核，未放入文字消费目录。确认前，两项专项问答保持待测。</p><div class="pair"><figure><figcaption>1406333-I2 · OCR：46道自动菜单</figcaption><a href="../images/1406333-I2.jpg"><img src="../images/1406333-I2.jpg" alt="松下菜单文字原图" style="max-width:100%"></a></figure><figure><figcaption>1406483-I4 · 待确认对应：蒸汽功率 1600W、微波输出功率 1000W</figcaption><a href="../images/1406483-I4.jpg"><img src="../images/1406483-I4.jpg" alt="东芝功率文字原图" style="max-width:100%"></a></figure></div>
<p class="muted">本轮结论限于 4 个型号的固定文字小样。金标与测试结果未提供给消费者；原始数据、模型和完整运行轨迹保留在本机。</p></main></body></html>`);
$('#intro').text('用同一组问题比较原始文字与加工包的回答、引用和读取成本。');
for (const label of [`${build.htmlCount} 份 HTML`, `${build.parameterFields} 个参数字段`, `${build.ocrLines} 行 OCR`, '加工 LLM 调用 0 次']) {
  $('#metrics').append($('<span class="metric">').text(label));
}
$('#conditions').text('Codex CLI 0.147.0 · gpt-5.6-sol / low · 每题独立 ephemeral 上下文 · 只读文字 · 关闭搜索和图片工具。输入 token 含多次工具往返的重复上下文；缓存单独列出。');
for (const variant of ['raw', 'pack']) {
  const selected = runs.filter((run) => run.variant === variant);
  const sum = (field) => selected.reduce((total, run) => total + (run.usage?.[field] ?? 0), 0);
  const row = $('<tr>');
  for (const value of [variant === 'raw' ? '原始文字' : 'Skill 加工包', `${selected.filter((run) => run.executionPassed).length} / 8`,
    sum('input_tokens').toLocaleString('en-US'), sum('cached_input_tokens').toLocaleString('en-US'),
    sum('output_tokens').toLocaleString('en-US'), `${selected.reduce((sum, run) => sum + run.seconds, 0).toFixed(1)} 秒`]) row.append($('<td>').text(value));
  $('#totals tbody').append(row);
}
$('#verdict').text(grading.conclusion ?? '测试与证据复核进行中；执行成功与答案合格分别统计。');
for (const question of questions) {
  const detail = $('<details>');
  detail.append($('<summary>').text(`${question.id} · ${question.question}`));
  const pair = $('<div class="pair">');
  for (const variant of ['raw', 'pack']) {
    const run = runs.find((item) => item.question === question.id && item.variant === variant);
    const column = $('<div>');
    column.append($('<h3>').text(variant === 'raw' ? '原始文字' : 'Skill 加工包'));
    column.append($('<p class="answer">').text(run?.answer?.answer ?? '待完成'));
    column.append($('<pre>').text(run?.answer?.evidence.map((item) => `${item.source_id} · ${item.locator}\n${item.quote}`).join('\n\n') ?? ''));
    column.append($('<small>').text(grading.runs?.[`${question.id}-${variant}`]?.note ?? '待逐项复核'));
    pair.append(column);
  }
  detail.append(pair); $('#questions').append(detail);
}
const references = path.join(root, 'consumer', 'pack', '.agents', 'skills', 'product-source-sample', 'references');
for (const file of (await fs.readdir(references)).sort()) {
  const content = await fs.readFile(path.join(references, file), 'utf8');
  const detail = $('<details>'); detail.append($('<summary>').text(content.split('\n')[0].replace(/^# /, '')));
  detail.append($('<pre>').text(content)); $('#references').append(detail);
}
await fs.writeFile(path.join(root, 'review.html'), $.html());
console.log(JSON.stringify({ report: path.join(root, 'review.html'), completedRuns: runs.length }));
