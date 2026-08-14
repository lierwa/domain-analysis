# R-014 混乱资料加工与证据化候选知识 POC

状态：隔离 POC 已通过，阶段 1B contract 可接受
目标阶段：1B
调查日期：2026-08-14

## 1. 简单说明

同一台冰箱在官网是两个颜色页面，在说明书里是型号和尺寸图，在监管表里是备案记录，在京东又是销售参数。1B 要证明系统能把这些不同说法整理成同一型号的候选知识，同时保留“来自哪里、原文是什么、哪些冲突、哪些还不知道”。Codex 只生成受 Schema 约束的候选，不能替系统决定事实或发布。

## 2. 冻结输入

| ID | 输入 | 用途 |
| --- | --- | --- |
| I01 | S02 美的 MR-457WUSPZE 流苏白官网 HTML | 同型号销售变体、官网参数与证据定位 |
| I02 | S03 美的 MR-457WUSPZE 苍穹灰官网 HTML | 与 I01 合并型号、保留颜色差异 |
| I03 | F01 美的 MR-457WUSPZE 16 页 PDF 说明书 | 型号、尺寸、安装条件、图文证据 |
| I04 | F02 中 2023 年表 `结果!A479:G479` | 生产者、型号、备案号、一级能效 |
| I05 | S05 MR-531WSPZE `sanitized` 投影 | 登录态来源只能读白名单字段 |
| I06 | S06 BCD-505WGHTD14S8U1 `sanitized` 投影 | 下架状态、缺失资料和 `unknown` |
| I07 | I03 第 5 页渲染图 | 图片输入只能生成带页码证据的候选 |

I04 实测值为：`合肥美的电冰箱有限公司 / MR-457WUSPZE / 20230510-471100-10041683712260059 / 1`。同一附件还出现 `MR-457WUSPZEA`，必须保持为独立候选，不能因字符串相似自动合并。

## 3. 开源候选与处置

| 能力 | 候选与依据 | 当前处置 |
| --- | --- | --- |
| HTML | Cheerio 1.0.0-rc.12，已在 R-001 真实投影通过 | 接受用于 POC |
| XLSX | `read-excel-file` 9.3.10，MIT，Node 18+，只读 XLSX 并支持 Schema 解析 | 接受用于 POC；ExcelJS 因审计失败淘汰 |
| PDF | unpdf 1.8.1，MIT，Node 22，基于 Mozilla PDF.js，直接提供文本/链接/图片提取 | 接受用于 POC；不自写 PDF parser |
| 单位 | mathjs 15.2.0，Apache-2.0，稳定版且提供单位解析/换算 | 接受用于 POC；只导入单位所需能力并测量成本 |
| Codex | 项目已有 `@openai/codex-sdk@0.147.0`，官方支持本地 thread、恢复和每轮 `outputSchema` | 继续复用；不接外部模型 Provider |
| Schema | Zod 3.25.76＋SDK README 推荐的 `zod-to-json-schema` 3.25.2 | 接受；Zod 是唯一作者态 Schema |
| 型号候选 | Fuse.js 7.5.0 可做小数据模糊检索；Splink 4.0.16 可做多列概率记录链接 | 暂不安装；有强生产者＋型号键时直接精确归组，模糊结果只能进人工候选 |

`convert-units` 当前 npm 稳定版仍为 2.3.4，仓库 TypeScript v3 仍是 `3.0.0-beta.8`；`js-quantities` 最新稳定版 1.8.0 较旧。本轮因此选择维护活跃的 mathjs 稳定版，不用 beta，也不自己写换算表。UCUM 是更严格的标准候选，但本轮普通家电单位尚不需要承担其额外许可和映射复杂度。

ExcelJS 4.4.0 首次隔离安装被 npm audit 报告 2 个中危项：其直接依赖 `uuid<11.1.1` 存在 buffer bounds check 公告，同时带入多项已弃用包；官方没有安全升级版，npm 只建议倒退到 ExcelJS 3.4.0，因此拒绝。`read-excel-file` 当前稳定版无须写入工作簿，功能更贴合本 POC 的只读表格＋严格列 Schema，作为替代重新审计。

## 4. 候选知识最小 contract

每条候选必须包含：商品身份、知识层、属性键、原始值、可选标准值、来源对象、不可变快照哈希、具体定位、处理方式、处理版本、状态和时间。`Codex`、冲突、缺证据、近似型号和图片解释只能产生 `review_required`；确定性字段才允许进入 `candidate`。没有证据时必须输出带原因的 `unknown`，禁止补常识。

同一事实多来源一致时分别保留证据，不压成一个无来源值；多来源冲突时建立冲突组，不按来源数量投票。型号归并只接受显式强键或人工决定，Fuzzy/Splink 分数都不能直接发布身份结论。

## 5. 通过门

- I01～I04 能归到同一稳定型号，I01/I02 颜色仍作为不同销售变体；
- I04 的备案事实能精确回到工作簿、工作表和单元格行；I03/I07 能回到 PDF 页码；
- 原始值和标准值同时保留，单位转换可重放；
- 至少一条冲突、一条 `unknown`、一条 Codex 候选进入例外审核；
- 相同输入与处理版本可复现结构化结果，Codex 事件和 thread ID 可审计；
- 登录态整页、Cookie、Profile、地址和账户信息不进入 POC 输入；
- 任一模型输出不能绕过 Zod、证据和人工发布门。

真实样本没有同一身份、同一属性、不同值的事实冲突。流苏白/苍穹灰是销售变体，分室容积只在一页出现是缺失；两者都不得伪装成冲突。冲突处理能力后续用明确标注的受控 contract fixture 验证，不能往真实知识样本中编造矛盾。

## 6. 停止条件

- 必须自写 PDF/XLSX/单位/模型协议或通用记录链接引擎；
- 只能靠提示词保存冰箱知识定义；
- 页面、表格、PDF 或图片候选无法给出具体证据定位；
- 近似型号被自动合并，或缺失内容被补成事实；
- 为一个原型引入生产数据库、生产 migration 或全面 worker 重构。

## 7. 调研来源

- OpenAI Codex SDK：https://developers.openai.com/codex/sdk/
- read-excel-file：https://github.com/catamphetamine/read-excel-file
- unpdf：https://github.com/unjs/unpdf
- Mozilla PDF.js：https://github.com/mozilla/pdf.js
- mathjs Units：https://mathjs.org/docs/datatypes/units.html
- Fuse.js：https://github.com/krisk/fuse
- Splink：https://github.com/moj-analytical-services/splink

## 8. 首轮真实结果

- 确定性加工读取 2 个同型号官网页面、16 页说明书和监管表精确行，生成 63 条证据；两个销售变体分别有 30/27 个官网字段，共同值 26 项、颜色差异 1 项、单页缺失 3 项。
- 当前确定性产物 SHA-256 为 `763778f71f74216554296d42e93ef747d9227bc97e3f49e47577e0f99c0cb4e5`。同输入复跑后，删除唯一的 `createdAt` 运行时间，两份排序 JSON 的 SHA-256 均为 `a612c316e9ab500dabaa64361dcb7b5b56172c64aa7142316c8cde8080d8cb6a`，内容完全一致。
- unpdf 正确定位说明书第 2/5/8/10/14 页；`read-excel-file` 精确读取 `结果!A479:G479`；mathjs 生成 11 个带标准单位值。近似型号 `MR-457WUSPZEA` 没有被合并。
- 最终 Codex 图片＋文本真实轮次生成 10 条 `review_required` 候选、0 条冲突、3 条 `unknown`，所有证据引用均通过输入 tuple 白名单。thread ID 为 `019fffca-0bc6-7480-8f70-e716e908a1e2`，产物 SHA-256 为 `8f5480924c90fd3190cf792627ef434ea3a3a911a80e3d99846bf4fc79104dbe`。
- 首次 structured output 因嵌套 `$ref` 被官方接口拒绝；改用 `zod-to-json-schema` 的展开策略后通过，没有手写第二份 Schema。SDK 又把用户级旧 `features.connectors` 配置迁移提示作为非致命 error item 返回；程序现在只允许这一条精确匹配的环境告警并原文入库，任何其他 error item 继续失败关闭。
- 两次模型结果都是 10 条候选、0 条冲突、3 条未知项，但属性拆分和措辞不同。结论是：模型可重放的是输入哈希、Schema、证据门、thread 和结果记录，不是字节级相同文案；字节确定性只属于规则抽取部分。
- R-014 隔离依赖使用 Node 22，生产依赖审计为 0；ExcelJS 的 2 个中危项和过多弃用传递依赖已通过换用 `read-excel-file` 消除。

## 9. 剩余通过门

以上通过门已经完成：

- I05 实测归为独立 `MIDEA:MR-531WSPZE`，状态 `loaded`、34 个白名单属性；I06 归为独立 `HAIER:BCD-505WGHTD14S8U1`，状态 `discontinued`、26 个属性并明确缺少 description。两者都没有进入 MR-457 的 Codex 输入。
- 受控通用品类双值 fixture 生成 `X001` 待审核冲突；真实样本继续保持 0 冲突，没有为过门污染知识。
- 候选 contract 增加稳定 `conflictId`/`unknownId`；真实轮次生成 `C001～C010` 和 `U001～U003`。审核 contract 覆盖接受、拒绝、冲突解决和 unknown 确认；缺少任一决定都失败关闭。
- 最终 Codex thread 为 `019fffe0-50c0-7772-a102-e5b780d806d6`，候选产物 SHA-256 为 `41d25e527d3f41d2b3ec1deefbfa48af58a75e0c5c507bd77eed6742e24d73e9`；发布门实测返回“未经审核，禁止发布：claim:C001”，验证产物 SHA-256 为 `3e41f3c9490a5974130dc422278e0ca20ce6fd95deb2820dffb2ca5e335efaad`。
- R-014 Node 测试 11/11 通过。阶段 1B 接受的是加工、证据、主体隔离、冲突和人工发布 contract，不把隔离脚本直接提升为生产实现。
