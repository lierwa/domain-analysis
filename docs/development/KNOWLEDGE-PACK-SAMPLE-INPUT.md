# 知识包样本输入核验

核验日期：2026-09-03。数据范围：本机 Source Dataset 的微波炉 ZOL 历史完成批次。

## 简单说明

已选定 4 个型号、11 份 HTML 和 12 张去重图片。已有型号关联、来源分类和血缘可以复用；图片分类包含用途和颜色两种信息，需要原样保留、分别使用。12 张附件完整性和来源引用均通过核对，可用于下一轮有限 OCR 与文字加工实验。

目标是用很小的真实样本检查“原始资料能否加工成 Codex Skill 可读取、可回查的文字知识包”。本报告交付输入清单与检查规格；后续 OCR 运行证据见 [OCR-SAMPLE-REPORT.md](OCR-SAMPLE-REPORT.md)。当前完成度与下一步统一记录在 [PROGRESS.md](PROGRESS.md)，技术候选与实验门统一记录在 [RESEARCH.md](RESEARCH.md#r-014-agent-知识包产线市场调研)。

## 数据与核验口径

- Git 基线：master，93a57b6219229796f811ca45cea142f93097ae4d。
- Capture Task：capture-task-f3db0719-1fdf-45e7-814a-e74c8b946f51。
- Source Batch：source-batch-476fab42-4a67-4a7b-bf8e-00a594378cb4；该批次聚合状态为 completed，历史 Run 的失败/停止记录继续保留。
- Crawl Plan：crawl-plan-5aa3b862-d09a-4773-b947-fcf23d91871a，version 2。
- 本机 API：http://127.0.0.1:4000；通过 Source Run JSONL 导出在本地程序中统计元数据，使用项目已有 Cheerio 读取参数表与来源“暂无图片”标记。
- 本机数据与 MICROWAVE-REAL-CAPTURE-REPORT.md 的 Windows Task/Batch 分属不同执行；以下数字仅属于本报告指定范围。
- 来源页面与图片保留于 Source Dataset。本报告仅记录来源标识、哈希、计数和少量验收字段；没有复制原始 HTML 或图片进入 Git。

本次遍历的非空 ZOL Run：

| 别名 | Run ID |
| --- | --- |
| R1 | source-run-c5fc9e3c-8249-494a-bf22-9f8febd1c96e |
| R2 | source-run-ce8291f0-1550-48da-8d47-7d7372a7bb3a |
| R3 | source-run-133bf9a6-046a-4dc0-a63c-f84ffd57c5ca |
| R4 | source-run-8e76eae2-de80-47e0-9022-88fbab337376 |
| R5 | source-run-ee8e471f-b748-4625-acd7-82dac85578bd |

| 输入统计 | 实测结果 |
| --- | --- |
| 原始记录 | 3,800 条；含历史重复捕获 |
| 格式 | 877 条 HTML、2,907 条 JPEG、11 条 GIF、5 条纯文本 |
| 图片记录的型号关联、分类、父页面 URL | 2,918 / 2,918 均存在；这是字段存在性核验 |
| 不同图片内容哈希 | 2,685 个；同内容可复用一次 OCR 结果，各来源关系仍分别保留 |
| 同内容出现不同来源分类 | 3 个哈希；分类属于来源关系，不能写成图片内容的唯一分类 |
| 抽样附件 | 12 张 JPEG，12 个不同哈希，合计 1,269,951 bytes |
| 抽样附件本地读取 | 12 / 12 返回 200，实际 bytes 与 SHA-256 均匹配持久记录 |
| 抽样引用 | 12 / 12 的图片 URL、序号、分类与大图分区 resourceReferences 匹配 |

本次 ZOL 统计范围没有 PDF；同一任务的公开资料批次另有 PDF 附件。当前小样先覆盖实际占多数的 HTML 与图片，不据此推断全部资源只有这两种格式，也不把结果外推到 PDF、跨来源冲突或跨品类加工。

## 分类可复用的程度

| 来源原始分类 | 图片记录数 | 本轮用途 |
| --- | --- | --- |
| 评测图解 | 1,449 | 有限 OCR 候选；标签本身不能证明含可用文字 |
| 官方图 | 403 | 有限 OCR 候选；此处仅为 ZOL 的分类名称 |
| 整体外观图 / 外观图 / 局部细节图 | 226 / 216 / 25 | 附件与低文字量对照候选；实际文字量尚未测量 |
| 配件及其它 / 实拍图 / 其他 | 11 / 6 / 36 | 按来源分类留存，用途不明确时保留待判状态 |
| 黑色 / 白色 / 纳瓦白 / 青绿色 / 米白色 | 184 / 217 / 94 / 24 / 20 | 颜色线索，选少量 OCR 探针验证文字收益 |
| 亮红色 / 复古红 / 白黑色 / 【新升级烧烤功能】纳瓦白 | 4 / 1 / 1 / 1 | 保留完整原标签，避免猜测用途或把标签提升为已核实参数 |

现有采集把分区标题和图片条目的 className/name 写入资源分类，同时记录型号、来源 URL、父页面和序号。依据：packages/worker/src/zolGalleryParsing.ts 与 zolCatalogGalleryProvider.ts。本轮只读取这些已有信息。

## 固定小样

| 来源型号 ID | 型号 | 该型号现存图片记录 / 不同哈希 | 本轮选择 | 验收价值 |
| --- | --- | --- | --- | --- |
| 334331 | 格兰仕 P70F23P-G5 SO | 17 / 17 | 3 HTML，4 图 | 同型号多种图片分类；参数缺单位 |
| 1228243 | 方太 W25800K-01AG | 0 / 0 | 2 HTML，0 图 | 来源明确无图片；区分缺失与处理失败 |
| 1406333 | 松下 NN-DS2000XPE | 45 / 22 | 3 HTML，4 图 | 颜色标签不能代表图片用途；区分烧烤与烘烤功率 |
| 1406483 | 东芝 ER-VT7230 | 55 / 28 | 3 HTML，4 图 | 评测图解较多；区分输入、输出、烧烤与蒸汽功率 |

### HTML 快照

同一型号和来源 URL 存在多次捕获时，本样本固定核验范围中 createdAt 最新的一条。下表标识用于重复取样；不随之后的新抓取自动变动。

| 型号 ID | 资源 | Run | Snapshot ID |
| --- | --- | --- | --- |
| 334331 | 参数页 | R2 | source-snapshot-84fdb124-5a67-4d78-b8fb-882ca15c5b75 |
| 334331 | 图集目录 | R2 | source-snapshot-d94c46bf-4e66-49e6-ab01-ae9c947bd2f2 |
| 334331 | 大图分区 | R2 | source-snapshot-98f44642-15e4-469b-8afc-b51c3eda7a48 |
| 1228243 | 参数页 | R4 | source-snapshot-5a5098d3-9b1f-4ada-95a3-1e5f1bf3542d |
| 1228243 | 图集目录 | R4 | source-snapshot-954d99cc-5b22-49d7-b6a6-df37fa4f0c77 |
| 1406333 | 参数页 | R2 | source-snapshot-630866de-6260-49fd-8736-fa835ea98be8 |
| 1406333 | 图集目录 | R2 | source-snapshot-0d443268-22b4-46be-8908-b8aa1e7fac8f |
| 1406333 | 大图分区 | R2 | source-snapshot-3520a7e3-8f53-4c0e-87b4-b780b51d4ec6 |
| 1406483 | 参数页 | R1 | source-snapshot-872c4d89-1c3f-469d-8138-bc60ba03f5fe |
| 1406483 | 图集目录 | R1 | source-snapshot-3050bd6c-cfb8-4d96-950c-2afa69de6b27 |
| 1406483 | 大图分区 | R1 | source-snapshot-2c6316b8-0fb9-4ea4-be66-872f5c86e21c |

### 图片附件

序号为原始 ordinal，从 0 开始。完整哈希直接来自已与附件字节核对的 SHA-256。

| 样本 ID | 原分类 / 序号 | Run | Asset ID | SHA-256 |
| --- | --- | --- | --- | --- |
| 334331-I1 | 整体外观图 / 0 | R2 | source-asset-255caf34-33e2-4e3d-a57d-cff6915ea082 | c77f45ecbbf7a72044e1627c1d5b9c28c79ccbb528949951b69e60695d858065 |
| 334331-I2 | 官方图 / 6 | R2 | source-asset-1f724951-f1af-48f8-9838-f6a35c1f40e0 | 039b3a45b1f280e5f12900d03cadb0887779f3458b030ae336c6f0d087f9c9b9 |
| 334331-I3 | 评测图解 / 11 | R2 | source-asset-ea3a9600-2348-44b6-b184-7fc8c5cc7934 | d9500e15beeff0c0e45e65dd6fed6645d5127401862fa8cdbc17cae2f15a19fe |
| 334331-I4 | 官方图 / 8 | R2 | source-asset-16755c0f-629a-402e-8969-20a914c2dab4 | d2734b44305c23cb4796d98ba53df1baed42873b7237a94b47ce9f0e54b0f687 |
| 1406333-I1 | 黑色 / 0 | R2 | source-asset-ba94900e-b19f-42c8-9824-00567630a006 | 4b5a3bce1d056245028da8d6c78bc8ee14ca9bf74999c951b0a2bb855b80f21d |
| 1406333-I2 | 黑色 / 11 | R2 | source-asset-f44a0f16-7335-4f4b-b606-6815508fd6a3 | d2b06f00b5066cdab785876ec0f3e40bf6357dc1f392558f67d7bcd8ec6f1114 |
| 1406333-I3 | 黑色 / 22 | R2 | source-asset-33e74e43-9668-4639-a472-02382eb2224e | 82c6d7ea46abbd3600c80f4fd5e68224deff78a84af3d4cd6442a40996a9c74d |
| 1406333-I4 | 黑色 / 1 | R2 | source-asset-b621f8f3-ab8f-49e4-b522-cf1dab459947 | 4e96ca8295f6a88e247dcc3150193a66c17dc885678e99dc1a2f605ff2097bed |
| 1406483-I1 | 官方图 / 0 | R1 | source-asset-5e93f761-50b8-47cc-8210-d9065d79ec36 | e2429eae90eb76fe7d6ff7df83106da01369edbb0b553bbc5543ee09afd8d0b1 |
| 1406483-I2 | 评测图解 / 1 | R1 | source-asset-cbd74593-df97-49a6-bf9a-a9db6169e2af | 5a6e0309d59b0ec9d1e3e9ad6537fee373a2fd9413c6a83cac65147ede45570d |
| 1406483-I3 | 评测图解 / 14 | R1 | source-asset-1e435a50-53af-4106-ae56-cef0b95a2561 | 25ee8317248e22ebee395513d45e07a870f474aca7e3fb607f83eb29e1a98e69 |
| 1406483-I4 | 评测图解 / 27 | R1 | source-asset-692aab9d-38cf-402d-8257-9efdc0abc944 | c38d0733e703dd235921222ac35b31a53e20cb9289b0b4e0fee5eadaead8b019 |

### 血缘核验边界

12 张图片均可按 subjectId 与 parentUrl 回查到同型号的大图分区、图集目录和参数页；大图分区中的图片 URL、分类及序号也逐项相符。

原始父关系保存的是 URL，不能直接证明某次抓取使用了哪个父快照版本。本样本显式固定上述 HTML 快照，作为本次读取依据；报告中的链路完整表示“来源关系可回查”，并不扩大为采集时父快照版本已严格绑定。

## 每一步的输出与检查规格

以下为本样本的实验规格，公共包格式与生产模块仍按调研门确认。

| 步骤 | 做什么、交付什么 | 怎么判断合格 | 加工 LLM |
| --- | --- | --- | --- |
| 固定输入 | 按上表取 11 份 HTML、12 个附件，保留来源 ID、分类与哈希，形成输入清单 | 本轮已核对选定快照、型号归属、图片引用及 12 张附件实际哈希；HTML 另核对下表原行 | 不需要 |
| HTML 提取 | 用成熟解析库读取标题、参数表和来源缺失标记，输出带 Snapshot 与表格/字段定位的文字记录 | 下表验收锚点全部保留；去除“纠错”等操作文案，数值、标签、单位、条件不串位 | 不需要 |
| 图片有限 OCR | 按哈希去重读取 12 张图，输出文字、位置、Asset ID、引擎/模型版本、处理状态与耗时 | 人工核对拟采用的文字片段；无文字、未处理、识别失败分别记账；不从图形或布局猜测含义 | 不需要生成式 LLM；需要 OCR 模型 |
| 组织文字知识 | 依据已有型号归属组合参数和通过复核的 OCR 文本，形成可按型号查找的 references 与来源索引 | 每条记录可回查；来源字段名与缺失信息保留；不同功率分别记录；同图多来源关系不丢失 | 本小样先用规则与人工复核 |
| Skill 入口 | 用 Agent Skills 的 SKILL.md 指向文字目录，说明读取、引用和资料不足时的行为 | 本地新消费目录只靠包内文字即可定位资料；原图留在 Source Dataset 供人工回查 | 文件组装不需要 |
| Codex 实测 | 在 Codex 新任务中显式使用该 Skill，回答冻结的问题集并输出来源 ID | 核对答案、引用、拒绝补猜和读取轨迹；原件文字基线与加工包使用相同任务和模型设置 | 需要；单独计入消费 token |

### 已从参数 HTML 核实的验收锚点

以下是“来源如何表述”的检查基准，不表示已独立验证商品事实。完整答案基准在实测时放在 Skill 目录外。

| 检查项 | 必须保留的来源信息 | 失败示例 |
| --- | --- | --- |
| 4 型号的容量 | 格兰仕 23L、方太 25L、松下 27L、东芝 23L，分别绑定对应型号 | 型号串位或单位丢失 |
| 格兰仕功率字段 | 原字段“产品功率”，值 700W | 将字段改成“输出功率” |
| 格兰仕噪音 | 原字段“产品噪音”，值 60，原行无单位 | 自行补写 dB |
| 松下不同加热功率 | 输出功率 1000W、烧烤功率 1350W；其他性能另含蒸汽输出功率 1000W、烘烤输出功率 1450W | 把烧烤与烘烤视为同一字段并覆盖 |
| 东芝不同功率 | 输入 1550W、输出 1000W、烧烤 1500W；其他性能中蒸汽 1600W | 只留一个“功率”值 |
| 方太图片状态 | 图集 HTML 的 p.nopic 明确显示“暂无图片” | 写成 OCR 失败，或断言该商品在所有来源均无图片 |

输入核验时尚未进行文字转写；后续 OCR 候选及其状态见 OCR-SAMPLE-REPORT.md。仍需由人工对照原图确认可读文字与所属区域，再将合格片段纳入 Skill；Codex 仅消费文字。视觉模型不参与加工或消费验收。

## 复核方法与证据限制

1. GET /api/capture-tasks/:taskId/source-runs 核对指定 Batch 与 Run；按上表固定 Run 枚举，避免误用任务的最新公开资料批次。
2. GET /api/capture-tasks/:taskId/source-runs/:runId/export?format=jsonl 在本地读取；结合该 Run 的审计工作项取得 subjectId、resourceKind、resourceSection、ordinal 与 lineage。
3. 对指定 HTML 用 Cheerio 检查表格行和 p.nopic；仅输出验收所需字段。
4. GET /api/capture-tasks/:taskId/source-runs/:runId/assets/:assetId 读取附件，用 node:crypto 计算 SHA-256，并比较 bytes。
5. 本轮附件核验时间：2026-09-03T05:13:09.012Z；12 个实际哈希与上表一致。

本报告对应的输入核验仅执行只读 API/本地解析与附件完整性检查。后续 OCR 的耗时、内存和结果证据独立记录于 OCR-SAMPLE-REPORT.md；输入数量与血缘完整度本身不能证明文字质量或 Agent 效果。

## Baseline Impact

- touched modules: Source Dataset 只读核验；本报告及 RESEARCH.md / PROGRESS.md 文档登记
- owning fact source: 原始 Snapshot、Asset、Subject 与来源关系仍归 Source Dataset
- public interface changed: no
- new protocol/adapter/fallback: no
- compatibility or legacy path changed: no
- research update required: yes，记录已确认的 Skill 消费与有限 OCR 实验边界
- architecture or ADR update required: no；本轮架构影响为“澄清”，生产模块与公共契约未改变
- tests and real-surface validation to run: 本轮完成只读输入核验、12 个附件 bytes/SHA-256 与引用比对；文档执行 diff 检查；加工与消费门见 RESEARCH.md
