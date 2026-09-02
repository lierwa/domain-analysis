# 数据抓取平台开发进度

更新日期：2026-09-03
当前阶段：Windows 真实采集可靠性 P1 收口；阶段 2 暂缓

## 简单说明

历史主线已经完成阶段 1 的最低输入门；2026-09-02 的新 Windows 真实 Batch 已完成 P0 无人值守验收：一次正式 Start 后，后台 Worker 在不改代码、不人工 Resume 的情况下进入终态。当前开发入口是 `.scratch/source-capture-reliability/PRD.md` 的 P1：把型号资源终态和商品目录 coverage/指标语义与真实 Batch 对齐。当前不进行数据清洗、知识包成品设计或导购 Agent 开发。

当前复验对象为 Capture Task `capture-task-326e80eb-b65f-4f51-9c29-26ce87a2fb62`、Confirmed Crawl Plan `crawl-plan-073d11a3-fd9b-469a-bd92-e4346acd9c21` version 6 和 Batch `source-batch-b2a25771-63c3-4b8a-8b77-4687989b6c28`。Batch 已以 `partial` 终态收口：21 个来源中 15 个完成、6 个受限；3,489 个 Snapshot、2,712 个 Asset。ZOL Run 完成 19 个品牌、247 个型号中的 234 个，13 个需关注；公开资料来源族与主题门均满足，但商品目录 coverage 因 Batch `partial` 仍为 gap。完整依据见 `MICROWAVE-REAL-CAPTURE-REPORT.md`。该结果不覆盖下文历史成功 Batch 的事实。

ZOL 微波炉验收已经完成：247 个型号全部处理，其中 1 个型号由 ZOL 明确标识为无图片。首次公开资料执行有 15 条 accepted，但专业技术资料为 0，因此系统没有把“执行结束”当成“资料达标”。随后只补抓 5 个新专业技术入口，5/5 完成；没有重抓 ZOL，也没有重复 17 个历史 URL。最终累计 20 条 accepted 公开资料，三个来源族和五个必需主题全部达到最低门。

系统目标链为“采访门类 → 确认 Capture Task 草稿 → 同一 Planning Run 调查商品目录，或引用已完成的 ZOL 数据，并调查其他公开专业来源 → 确认一份 Crawl Plan → Prepare / Start → Provider 执行未完成来源 → Source Dataset”。ZOL 完成引用必须来自同一 Capture Task 的完成 Batch 和完成 Run；公开来源的单个查询、URL 或网站失败只留痕，不阻断其他来源。

当前默认策略是：选择 ZOL 门类品牌排行榜中综合评分大于 0 的品牌，按榜单顺序最多 20 个；每批 3 个品牌；每品牌每轮 10 个型号；每品牌最多 20 个型号，品牌目录不足时以来源穷尽结束该品牌。

本轮已补齐瞬时 DNS/传输失败后的持久自动 Resume：Worker 完成命令后、API 启动时和 Graphile cron 扫描都会从 Source Dataset 查找可安全恢复的 Batch；自动恢复先验证当前 Confirmed Crawl Plan 仍可执行，历史旧计划回到人工规划门。型号图集或大图分区的局部结构异常按当前型号隔离，不阻断后续品牌；Target 在全部工作项进入完成或失败终态后正常收口。微波炉任务已完成终态对账。

Source Dataset 现在直接按品牌、型号和资源展示已抓到的数据，并把执行历史放在独立的运行审计视角。负责人可以从 19 个品牌逐级查看 247 个型号、单条原始记录和图片；当前问题数为 0，零图片型号显示“来源无图片”，历史失败仍留在 Run 审计。该工作服务 `ROADMAP.md` 的品牌执行验收，以及 `ARCHITECTURE.md` 的 Source Dataset 对账通过门。

首次公开资料 Batch `source-batch-abe119fd-f6be-4b40-b6f9-b36d4473aac7` 已完成终态对账：17 个 Source Run 中 15 个完成、2 个失败；USDA 为 robots.txt 403，专业期刊候选在真正发出请求前被持久访问门阻止。增量 Batch `source-batch-c370c3dd-9e51-428f-bacb-a4a2fd25349f` 5/5 完成，各保存 1 条 accepted 非空 Snapshot，WSU 另保存 1 个 PDF Asset。全部历史失败继续留在 Run 审计，不计入 accepted 覆盖。

## Git 与运行环境

- 主工作区：`/Users/guojunxi/Desktop/work/domain-analysis`，branch `master`
- 多来源阶段 1 基线已随 `4997e0b` 进入 `master`；Windows 正确性修复随本文件所在提交形成新的跨电脑接续点
- 常驻 `launchctl` API/Web 均从主工作区运行并监听 `4000`/`6173`；进程工作目录已核对为主工作区 `apps/api` 与 `apps/web`
- fcb1 worktree 已从 Git 登记和文件系统删除；其中 5,472 个正式内容寻址资产先按 checksum 无损合并到主工作区，原有 2 个文件保留
- PostgreSQL 与正式 Source Asset 保留在主工作区本地运行边界
- 数据库、浏览器状态、原始页面与图片资产只保留在本机，不进入 Git

## 产品链状态

| 环节 | 当前状态 | 权威事实源 |
| --- | --- | --- |
| 采集请求与品类采访 | 已接通 | Category Interview |
| 采访草稿版本与人工确认 | 已接通 | Versioned Markdown Capture Task Draft |
| Capture Task | 已接通 | Capture Task |
| 品类调查与多来源抓取规划 | 已完成微波炉真实验收 | Planning Run |
| 多来源审计、计划草稿与人工确认 | 已完成微波炉真实验收 | Crawl Plan |
| Prepare / Start / Resume | 已接通 | Source Execution |
| 原始页面、图片、血缘与导出 | 已接通并通过微波炉数据地图验收 | Source Dataset |
| 全部资料最低覆盖与缺口规划 | 已通过微波炉真实增量验收 | Source Coverage / Source Dataset |
| 新正式冰箱门类纵向验收 | 已形成终态报告 | Capture Task / Crawl Plan / Source Dataset |
| 瞬时传输失败无人值守恢复 | 已接通并通过回归测试 | Source Execution / Graphile Worker |
| 微波炉门类纵向验收 | Capture Task v2、Crawl Plan v2 已确认，Source Batch 已完成并完成终态对账 | Source Dataset |
| 公开网页/PDF Provider | 已接入生产 Provider 注册表并通过回归 | `public.web-resource@2.0.0` |
| 微波炉多来源 Capture Task | revision 3、已确认并执行 | Capture Task |
| 微波炉公开资料 Source Batch | 首批 15/17 完成，增量专业技术 5/5 完成；累计最低覆盖通过 | Source Dataset |

## 当前领域规则

- Capture Task 是负责人确认的覆盖策略事实源：榜单评分门槛、品牌上限、品牌批次、每轮型号数和每品牌型号上限都必须显式保存。
- Planning Run 在同一阶段调查 ZOL 品类入口、门类品牌排行榜、入选品牌目录和公开专业资料入口；两类结果只生成一份 Crawl Plan。
- 公开资料主题必须覆盖底层原理、核心部件、安全监管、性能测试和使用维护；具体术语、标准号、品牌和 URL 由当前任务调查，不写进通用规则。
- 标准监管、专业技术和品牌官方每一族至少需要 3 条 accepted 原始资料、来自至少 2 个独立网站；运行原理、核心部件、安全法规、性能测试、使用维护五个经确认计划标注的主题入口每项至少 2 条、来自至少 2 个独立网站。该门不冒充正文语义审核。
- accepted 只计算完成的 `public.web-resource` Run 中 accessible、accepted、非空、requested URL 与计划 exact URL 一致、带 lineage 的 Snapshot，并按规范化 exact URL 去重；失败留痕不计入覆盖。
- 商品目录门同时要求完成 ZOL Batch/Run、真实品牌与型号、全部型号完成关联和 accepted 原始快照；终态门深入检查 Batch、Run、Target、Work Item 与 Request Attempt。
- 单个查询和来源失败不构成全局停止；增量 Planning 只补当前缺口，排除已接受和已尝试 URL，并为每个缺口准备“缺少数量 + 2”个候选和至少 3 个新网站。
- 执行品牌只能由已验证榜单按“综合评分大于 0、榜单顺序、最多 20 个”确定；不得按品牌目录数量、字母顺序或临时样例替代。
- 没有可验证榜单、没有满足阈值的品牌或入选品牌无法映射到目录时，Crawl Plan 保存明确 blocker、保持空执行来源并停在计划确认门。
- 同一 Confirmed Crawl Plan 按每批 3 个品牌推进全部入选品牌；每品牌每轮 10 个型号，达到 20 个或目录穷尽即结束该品牌。
- Provider 只执行已确认的品牌目录与型号捕获，不决定入选品牌，不跨品牌补数；参数页分片由产品 ID 计算，不含品类固定 ID。

## 当前实现收口

- 两个项目 Skill 已改为通用品类语义，采访不向负责人索要可调查的品牌清单；规划不使用全品牌回退。
- Capture Task contract 已保存 `brandSelectionPolicy`、`executionCadencePolicy` 与 `modelCoveragePolicy`。
- Crawl Plan contract 已保存 `multi_source_planning` audit：其中商品目录审计继续校验榜单排序、评分阈值、目录映射、执行品牌和容量，v7 另保存规划前的 typed 覆盖快照和缺口。
- `SourceCoverageModule` 是唯一覆盖计算 seam；Planning 与 Source Dataset 页面通过同一个 interface 读取结果，不各自推导。它复用 PostgreSQL/Drizzle 和 Zod，没有引入新运行时或通用规则引擎。
- 规划运行时由 `createMultiSourceCategoryPlanningRuntime` 组装：ZOL adapter 确定性核验商品目录；Codex ephemeral web search 只调查当前缺口；最终只生成一份检查清单 v7 计划。
- Planning 从同一 Capture Task 的 Source Dataset 自动识别完成 ZOL Batch；调用方不能手工传引用。Workbench 核对 Batch 与 ZOL Provider Run 均为完成态，再在计划审计中记录引用并从新执行清单排除 ZOL。
- 生产 API 已同时注册 `zol.catalog-gallery` 与 `public.web-resource@2.0.0`；后者只抓已确认的 exact/site URL，不搜索、不清洗、不扩大计划。
- ZOL Provider 已按 `category_slug` 执行通用品类目录，并区分来源穷尽与访问失败。
- ZOL Provider 已按工作项隔离暂时性失败：请求有界重试耗尽后记录品牌/型号失败并继续；图片 404、非成功响应或格式不合格只结束当前型号。
- 型号图集无法枚举大图分区或大图详情无法识别来源图片字段时，Provider 保存拒绝快照并把当前型号标记为 `content_not_accepted`；参数页无法绑定型号身份、来源级目录结构变化和安全限制仍保留为 Run 级停止门。
- ZOL 图集页明确显示“暂无图片”时，Provider 以零图片完成型号；页面用 typed 型号状态与图片数显示“来源无图片”，不把历史失败快照计入当前问题。
- Source Dataset 完成 Target 时只等待 `pending` 或 `running` 工作项；已完成和已隔离失败的工作项都属于可对账终态。
- Source Execution 的访问限制熔断只响应登录、验证和拒绝访问；普通 `not_found/source_error` 快照保留后继续，`target_count` 作为计划最大覆盖边界允许实际结果因来源穷尽或隔离失败而更小。
- Source Execution 只将 `transient_transport` 和满足安全条件的进程丢失标记为自动 Resume 候选；请求使用同一 Confirmed Crawl Plan、同一 Source Run 恢复链和原 request budget，结构性失败保留为终态供人工处理。
- API 启动扫描未完成 Batch，Graphile cron 每分钟触发恢复扫描；自动 Resume 使用确定性 job key 和固定延迟，重放同一 Resume command 不会创建第二个 Source Run。
- 自动 Resume 候选生成前必须通过当前 Confirmed Crawl Plan 的可执行性校验；旧规划协议不会反复自动入队。
- Workbench 已展示排行榜证据、执行品牌、批次与型号边界；存在 blocker、无有效排行榜审计或旧检查清单的计划不能确认。
- 冰箱专用固定品牌验收 API 已删除；正式链路只有 Planning Run 生成 Crawl Plan 一个计划入口。
- Source Dataset 新增 Batch 内 typed Capture Subject，品牌和来源型号身份由 Provider 随 Work Item 提交；Workbench 隐藏幂等、父子关系、冲突和历史回填，Web 不解析 URL 或工作键。
- 商品数据投影聚合当前 Batch 的 19 个品牌、247 个型号、资源数、完成度和去重问题；运行审计投影只返回来源、Batch、Run、记录组和访问恢复摘要，不携带整批图片画廊。
- 单条资源列表按 `subjectId + resourceKind` 分页读取，图片 bytes 只在打开记录时通过 Asset 路由加载；地图展开保持一次一条记录请求和一次一项资源请求。
- Source Execution 汇总当前 Batch 的全部 Run；活动 Batch 再次启动返回既有 `already_running` 结果，完成态重新执行先显示页面内确认框。
- 商品地图的活动展开行、详情选择和 Run 审计分别建模；详情关闭后焦点返回首次地图触发器，键盘路径与画布/大纲行为一致。
- API 支持用 `SOURCE_ASSET_CACHE_PATH` 显式复用正式抓取所在 checkout 的内容寻址资产；默认仍使用当前仓库 `data/source-assets`，不复制附件或改写血缘。
- Codex App Server 子进程把当前 Node 目录写入唯一 `PATH` 键；同时覆盖 launchd 的精简环境与 Windows `Path`/`PATH` 大小写重复，原协议、模型与会话事实源不变。
- 多来源 Planning 在首次结构化研究仍有现有覆盖 blocker 时，把原样校验错误与上一轮完整结果反馈给同一研究 Runtime 一次；第二轮仍不达标即保留 blocker，不新增校验规则或无界重试。公开来源研究单 turn 上限为 5 分钟，其他 Codex 调用保持原边界。
- 持久请求准入按来源身份保持有界熔断：ZOL 页面与图片继续共享 Provider 级停止门；承载多个独立网站的 `public.web-resource` 只熔断真实受限的 origin gate，人工 Resume 也只解除前序 Run 实际请求过的公开来源 gate。

## 当前验证

截至 2026-09-02 的验证：

- `npm run typecheck`：shared、db、workbench、worker、api、web 六个 workspace 全部通过。
- `npm test`：44 个测试文件通过、2 个跳过；203 个测试通过、7 个跳过。
- 本轮自动恢复回归：2 个文件、16 个测试通过，覆盖瞬时失败候选、旧计划保护、启动扫描、完成回调、确定性 job key 与重复 Resume 幂等。
- `npm run build`：通过；Web 完成 2486 个模块构建。只有 Vite 大分块提示，不是 Node 异常退出或 OOM。
- 两个项目 Skill 的 `quick_validate.py` 校验通过。
- `git diff --check`：通过，仅有 Git 行尾转换提示。
- 最新 ZOL 排行榜 adapter、规划组装、自动恢复和确认门回归均通过；随后六个 workspace 全量类型检查、全量测试和生产构建再次通过。
- API 健康检查通过，Web 可访问；独立 `launchctl` API/Web 服务保持 `running`，Graphile Worker 已连接并消费 `execute_source_collection` 与 `schedule_source_recovery`。
- Workbench 真实页面已确认微波炉任务显示“后台执行中”。
- 型号图集局部结构异常回归：`zolCatalogGalleryProvider.test.ts` 11 个测试通过，覆盖图集入口与大图详情两类局部失败后继续后续型号。
- Worker 全量测试：8 个文件通过、2 个跳过；56 个测试通过、7 个跳过；Worker 类型检查通过。
- Source Dataset 终态收口集成回归：9 个测试通过，验证未结束工作项仍阻止完成、已失败工作项允许 Target 完成；Workbench 全量测试 15 个文件、66 个测试通过，类型检查通过。
- 微波炉真实 Batch 终态对账：无 `started` 请求或 `running` 工作项；19 个计划品牌均为完成、来源穷尽或隔离失败终态。
- `npm run backfill:zol-subjects -- --task capture-task-f3db0719-1fdf-45e7-814a-e74c8b946f51` 连续执行两次结果一致：19 个品牌、247 个型号、3,799 个 Snapshot 关联，证明回填幂等且不改写原始数据。
- 修正前真实页面验收保存为历史证据：当时显示 19 个品牌、246/247 个型号、3,799 个快照、2,918 个附件、1 个唯一问题和 4 个 Run。
- 真实请求验收：展开一个资源只请求一次带 `subjectId/resourceKind` 的记录页；打开一张图片只请求一次对应 Asset；打开 Run 审计只请求一次轻量 Run 详情，没有加载完整 Run 图片集合。
- 正式资产验收：常驻主工作区 API 直接读取本地正式内容寻址存储，单图记录与 Asset 均返回 HTTP 200；`6173` 浏览器图片加载完成，天然尺寸为 600×450。
- 当前常驻 API 验收：Source Batch 为 `completed`，19 个品牌、247/247 个型号完成、3,800 个快照、2,918 个附件、当前问题 0；方太 `1228243` 为完成态、0 张图片。
- 当前 `6173` 真实页面验收：顶部显示 247/247、唯一问题 0；搜索 `1228243` 显示“方太W25800K-01AG · 2 条资源 · 来源无图片”。
- 键盘验收与回归测试均通过：Esc 关闭由记录组进入的 Run 审计后，焦点返回原始记录组按钮。
- 2026-09-01 ZOL 微波炉原始数据验收：19 个计划品牌与 19 个实际品牌完全一致；247 个型号都有参数页和图集页，246 个型号有图片，1 个型号由 ZOL 明确标识为无图片；2,918 个 Asset 全部归属型号。
- 2026-09-02 Windows 多来源 Planning 回归：全仓 48 个测试文件、219 个测试通过，2 个文件与 7 个测试按既有条件跳过；六个 workspace 类型检查通过。真实 Run `crawl-planning-run-3cfa5c02-34bb-435c-84dd-67a449955049` 在一次定向补查后生成 `crawl-plan-073d11a3-fd9b-469a-bd92-e4346acd9c21` v6，20 个公开来源、5 个专业技术来源、5 个独立专业 origin、0 个 blocker。
- 2026-09-02 真实 Source Batch `source-batch-0d9674f0-f8b0-42d8-b851-f6474859c2e5` 已由 Confirmed Plan v6 启动。公开来源中 18/20 已完成并保存原始响应，5 个 PDF Asset 落盘；NDRC 与北交大两个 origin 的真实访问限制分别留痕且未重试。ZOL Resume Run `source-run-83c1227a-4a36-4657-84a8-4c363d6e1440` 已跨过前序瞬时 404 并保持运行；观测点为 28 个 Snapshot、12 个 Asset、6 个型号、1 个型号完成、2 个型号独立 attention。
- 2026-09-02 ZOL 品牌目录 404 失败作用域回归：`zolCatalogGalleryProvider.test.ts` 13/13 通过，验证单品牌目录 404 保存 `not_found` 观察并继续后续品牌；全量 Vitest 中 219 项通过、7 项按既有条件跳过，唯一已有 Windows 频控计时断言测得 89ms 后单独复跑 5/5 通过；六个 workspace 类型检查全部通过，`git diff --check` 通过。
- 当前 Batch `source-batch-0d9674f0-f8b0-42d8-b851-f6474859c2e5` 已在第二次 Resume 后以 `partial` 终态收口：38 个 Run、3310 个 Snapshot、2418 个 Asset；247 个型号中 197 个完成、50 个需关注。66 条问题由 62 条型号资源问题、2 条历史品牌目录 404 和 2 条公开来源访问限制组成，不能把问题条数当作未完成型号数。
- 2026-09-02 P0 本机实现验证：ZOL HTML 首次 404 显式复核一次，持续 404 仍交还 Provider 保存 `not_found`；公开来源按 origin 熔断且 Resume 不清除无关 gate；品牌目录持续 404 只结束当前品牌。聚焦 PostgreSQL/Worker 23/23、全量 49 个测试文件与 226 项测试通过，2 个文件与 7 项按既有条件跳过；六 workspace 类型检查和生产构建通过。
- 2026-09-03 真实 P0 验收：Batch `source-batch-b2a25771-63c3-4b8a-8b77-4687989b6c28` 在一次 Start 后全部终态；没有运行期代码修改或人工 Resume。ZOL 的 86 个 exact URL 以 `404 -> 200` 恢复，11 个以 `404 -> 404` 保持 `not_found`；13 个需关注型号和 6 个受限公开来源保留为当前质量缺口。P0 的执行可靠性通过，阶段 1 原始资料质量门未通过，P1 进入 issue 05/07。
- 2026-09-03 终态报告交付验证：`git diff --check`、六 workspace `npm run typecheck`、`npm test`（49 个文件、226 项通过；2 个文件与 7 项按既有环境门跳过）和 `npm run build` 均通过。报告与 issue/路线/进度已同步，待推送后核对远端 SHA。
- 内容寻址存储全量校验：2,685 份不同内容逐一读取，0 缺失、0 大小不一致、0 SHA-256 不一致、0 元数据冲突；API 读取样本的字节数、MIME 与 SHA-256 和数据库一致。
- 请求审计：原抓取的 106 次历史失败尝试中，98 次对应工作后来成功，8 次可还原为 TLS 断开或请求超时；它们保留在运行审计，不进入当前问题统计。
- 本轮聚焦回归：ZOL 明确无图与商品地图标识共 2 个文件、23 个测试通过；常驻 API 返回 247/247 完成、当前问题 0。
- 真实多来源 Planning POC：约 110.6 秒内完成 3–5 轮 web search，返回 10 个专业主题和 11 个公开直达候选；App Server 报告累计 268,647 tokens。该结果只验证来源发现，不作为研究报告或已抓取证据。
- 多来源聚焦回归：6 个测试文件、48 个测试全部通过，覆盖计划组装、ZOL 目录规划、计划确认协议、单来源失败继续、公开来源全部受阻仍保留 ZOL 计划、公共网页/PDF Provider 和 launchd PATH 修复。
- `npm run typecheck`：shared、db、workbench、worker、api、web 六个 workspace 全部通过。
- `npm test`：47 个测试文件通过、2 个跳过；214 个测试通过、7 个按环境门跳过。
- `npm run build`：六个 workspace 与 Web 生产构建通过；Vite 只有既有大分块提示。
- Category Interview 真实重试生成 Capture Task Draft `capture-task-draft-2e93dcc7-f085-489a-8f94-d69c799e420d` version 3；本轮已按负责人指令确认该草稿。
- Capture Task Draft version 3 已确认，正式任务升级为 revision 3。Planning Run `crawl-planning-run-7a63fa4e-584d-4b75-9e87-6927294a25d0` 生成并确认 Crawl Plan `crawl-plan-8673cd17-9108-415d-af15-07e0c199916e` version 3；计划引用已完成 ZOL Batch，只包含 17 个 `public.web-resource` 来源。
- 真实公开资料执行：Batch `source-batch-abe119fd-f6be-4b40-b6f9-b36d4473aac7` 在约 4 分钟内进入 `partial` 终态；15 个来源完成，USDA 因 robots.txt 403 停止，专业期刊候选在请求前被持久访问门阻止，后续来源均已继续执行。Source Dataset 保存 16 个 Snapshot 和 4 个 PDF Asset，0 个运行中来源。
- 本轮聚焦数据库回归：多来源 Planning Runtime 4 个测试、Crawl Plan 集成 3 个测试，合计 7 个测试通过；覆盖已完成 ZOL 引用不再调用目录 Runtime、计划只含公开来源，以及跨任务或未完成 Batch 不能被引用。
- 常驻 API 已重启并加载当前主工作区代码，PID `85325`，`/health` 返回 HTTP 200；未跟踪的 `.env.local` 只保存本机受信任 HTTPS 代理地址，不进入 Git。
- 独立审计确认首次结果只达到执行链闭环：标准监管 9 条、品牌官方 6 条均满足基本规模，专业技术 0 条；因此撤回“阶段 1 资料已通过”的旧结论。
- 覆盖模块真实投影只报告 `professional_technical` 一个缺口：0/3 条、0/2 个网站；商品目录、其他来源族和五个必需主题均已达标。系统要求该缺口至少产生 5 个新候选、来自至少 3 个新网站。
- 增量 Planning Run `crawl-planning-run-d73f70a5-de0a-41dc-9e6b-c0634a5a2d96` 生成 Crawl Plan `crawl-plan-da4d5e07-d39f-4b47-966b-6c2aa2cce165` version 4；计划只含 5 个专业技术来源，0 个 blocker，没有 ZOL 或历史成功 URL。
- 增量 Source Batch `source-batch-c370c3dd-9e51-428f-bacb-a4a2fd25349f` 以 `5/5 个来源完成` 收口；5 个 Run 均为 completed、accessibleCount 1、snapshotCount 1、failedCount 0，WSU Run 另保存 1 个 PDF Asset。
- 最终 Source Coverage 为 `satisfied`：ZOL 商品目录 19 个品牌、247/247 个型号有完成关联、3,792 个 accessible 快照；accepted 公开资料累计 20 条；标准监管 9 条/6 个网站，专业技术 5 条/5 个网站，品牌官方 6 条/3 个网站；五个计划主题入口分别为 7、7、7、10、6 条，剩余 gap 0。Batch、Run、Target、Work Item、Request Attempt 未结束记录均为 0。
- 覆盖模块、自动 ZOL 引用与缺口规划的 PostgreSQL 集成回归 74/74 通过；Source Dataset 覆盖展示聚焦回归 12/12 通过。
- 独立 Agent 最终复核通过，无剩余 must-fix。商品目录门已改为逐型号核对同 Run 的 completed Work Item 与真实 Snapshot；Snapshot 必须有 lineage、`accessible`、`accepted`、非空且非 legacy。Run 汇总计数不再能单独放行商品目录，真实数据仍为 247/247 个型号、3,792 个 accepted Snapshot。
- Windows 正确性聚焦回归：4 个测试文件、20 个测试通过，覆盖唯一 `PATH`、只有真实 Source Run 才形成已尝试 URL、终态 Batch 与恢复中 Batch 分流，以及 Source Dataset 的商品目录/执行终态展示。
- Windows 无外部服务全量 Vitest：40 个测试文件通过、10 个按 PostgreSQL 环境门跳过；187 个测试通过、36 个跳过。当前主机的 Code Integrity 阻止 PostgreSQL `libpq.dll` 加载，因此本轮新增 PostgreSQL 集成断言仍需在可运行官方 PostgreSQL 的环境补跑。
- Windows `npm run typecheck`：shared、db、workbench、worker、api、web 六个 workspace 全部通过；`npm run build` 通过，Web 完成 2,487 个模块构建，仅有既有 Vite 大分块提示；`git diff --check` 通过，仅有行尾转换提示。

## 当前正式运行

- Confirmed Capture Task：`capture-task-f3db0719-1fdf-45e7-814a-e74c8b946f51`，revision 3，status `ready`
- 已确认范围：家用微波炉；包含单功能、微烤一体机、微蒸烤一体机及其他具备微波功能的家用组合型产品；不抓商用、不抓无微波功能蒸烤箱
- 已确认策略：综合评分严格大于 0、按榜单顺序最多 20 个品牌、每批 3 个、每品牌每轮 10 个、每品牌最多 20 个
- ZOL Planning Run：`crawl-planning-run-4b649fc5-bd5e-4d6e-a40a-b84f9cb42b73`；ZOL 榜单 41 行，执行品牌 19 个
- ZOL Confirmed Crawl Plan：`crawl-plan-5aa3b862-d09a-4773-b947-fcf23d91871a`，version 2；无 planning blocker，最大执行容量 380 个型号
- ZOL Source Batch：`source-batch-476fab42-4a67-4a7b-bf8e-00a594378cb4`，状态 `completed`，恢复状态 `completed`，终态原因为 `1/1 个来源完成`
- 恢复链：原始 Run `source-run-133bf9a6-046a-4dc0-a63c-f84ffd57c5ca` 按进程丢失收口；两段中间恢复 Run 保存历史终态；Run `source-run-8e76eae2-de80-47e0-9022-88fbab337376` 以 `plan_scope_completed` 完成。人工补标前的两次环境/一致性检查作为历史 Run 保留，不进入当前问题。
- 19 个品牌对账：美的、格兰仕、松下、东芝、海尔、惠而浦、三洋、LG 各完成 20 个型号；西门子 8、创维 2、大宇 19、易厨 4、帝而 18、ouio 1、家易仕 1、米家 1、日立 12、威力 5 个型号按来源穷尽结束；方太完成 16 个型号，其中 `1228243` 由来源明确标识为无图片。
- 2026-09-01 当前观测：247 个型号完成、当前问题 0；3,800 个不可变快照、2,918 个资源文件；请求为 3,823 个完成、107 个失败、2 个历史取消，0 个执行中。
- 多来源 Planning Run：`crawl-planning-run-7a63fa4e-584d-4b75-9e87-6927294a25d0`；ZOL 审计引用上述完成 Batch，公开来源共 17 个，计划阻塞 0 个。
- 多来源 Confirmed Crawl Plan：`crawl-plan-8673cd17-9108-415d-af15-07e0c199916e`，version 3；6 个品牌公开来源、6 个监管来源、4 个标准平台来源、1 个专业期刊来源，执行 Provider 仅为 `public.web-resource@2.0.0`。
- 公开资料 Source Batch：`source-batch-abe119fd-f6be-4b40-b6f9-b36d4473aac7`，状态 `partial`，终态原因为 `15/17 个来源完成，2 个来源失败`；15 条 accepted 原始记录、1 条 failed 原始记录、4 个 PDF Asset，0 个运行中或缺失 Source Run。
- 增量多来源 Planning Run：`crawl-planning-run-d73f70a5-de0a-41dc-9e6b-c0634a5a2d96`；自动引用已完成 ZOL Batch，只调查 `professional_technical` 缺口。
- 增量 Confirmed Crawl Plan：`crawl-plan-da4d5e07-d39f-4b47-966b-6c2aa2cce165`，version 4；5 个新专业技术 exact 来源，5 个独立 origin，0 个 blocker。
- 增量专业技术 Source Batch：`source-batch-c370c3dd-9e51-428f-bacb-a4a2fd25349f`，状态 `completed`，终态原因为 `5/5 个来源完成`；5 条 accepted 原始记录、1 个 PDF Asset、0 个失败、0 个运行中。
- 当前 Source Coverage：`satisfied`；ZOL 19 个品牌、247/247 个型号有完成关联；20 条 accepted 公开资料，全部 3 个来源族和 5 个计划主题入口达标，剩余 gap 0。

## 架构影响

本轮架构影响：`改变`。

- Capture Task 公共 contract 新增品牌选择与执行节奏策略，成为负责人确认边界的唯一事实源。
- Crawl Plan 公共 contract 以排行榜审计与计划 blocker 作为来源调查和执行品牌集合的唯一事实源。
- ZOL Provider 配置升级为通用品类 `category_slug`，不再承担选品牌职责。
- 旧的冰箱专用计划旁路已删除，不保留兼容入口。
- ZOL 排行榜事实改由来源 adapter 沿官方链路确定性核验；Planning Run 与 Crawl Plan 事实源未变，没有新增第二运行时或 fallback。
- Source Execution 失败分类补充可信 DNS SERVFAIL 与临时网关错误；请求、品牌/型号工作项与 Source Run 的失败作用域已经分开，`target_count` 明确为最大覆盖边界。事实源和依赖方向不变。
- 本轮新增 Source Execution 自动恢复查询、Source Dataset 未完成批次扫描、Graphile cron/延迟 Resume 投递和 Resume command 幂等；事实源仍为 Source Dataset/Source Execution，模块职责与依赖方向按基线扩展为 `改变`。
- 自动恢复查询新增当前计划可执行性门，避免旧规划协议在启动扫描或 cron 中反复创建失败任务；未改变事实源与依赖方向。
- 本次启动独立服务、恢复既有 Source Batch 和配置 Codex 观察任务不改变模块职责、事实源、依赖方向或公共 contract。
- 型号图集和大图分区的局部解析错误改为复用现有 Work Item 隔离语义；没有新增协议、恢复入口或第二事实源，本次架构影响为 `澄清`。
- Target 完成核对从“全部完成”澄清为“全部终态”，与既有 Work Item 失败隔离语义一致；没有改变 Source Dataset 的事实源、模块职责或公共 contract。
- 微波炉 Batch 进入终态不改变架构基线。
- Source Dataset 公共 contract 新增 Capture Subject、商品投影、轻量 Run 审计投影和按 Subject/Resource 分页的记录摘要；Source Dataset 仍是原始内容与来源身份事实源，Web 只投影。
- Workbench 新增 Capture Subject 写入/回填边界与 Run View 组装边界；这是现有 Source Dataset seam 的职责分离，没有新增第二事实源或通用插件层。
- API 新增可选本地资产根目录配置，解决多个 checkout 共享数据库时的附件读取位置；公共 HTTP、Asset ID、哈希和 Source Dataset 事实源不变。
- Web 的商品地图与运行审计采用两个明确投影，活动行与详情选择保持分离；详情焦点恢复只属于交互状态，不改变领域 contract。
- 本轮架构影响记录为 `改变`，接受决定见 `docs/adr/001-source-capture-subject.md`；`docs/development/RESEARCH.md` 的 R-010 保持本次候选与验证依据。
- 2026-09-01 路线登记与 ZOL 数据验收的架构影响为 `无变化`：没有修改模块职责、事实源、依赖方向或公共 contract；验收发现只记录现有数据和请求审计缺口。
- 2026-09-01 ZOL 明确无图口径修正的架构影响为 `澄清`：ZOL Provider 识别来源无图，Source Dataset 仍保存不可变原始事实，Web 只读取 typed 投影；公共 contract、事实源和依赖方向不变。
- 2026-09-01 多来源 Planning 的架构影响为 `改变`：Crawl Plan 公共 audit 从 ZOL 单来源升级为多来源 v6，Planning Runtime 新增公开来源调查与计划组装，生产 Provider 注册表新增现有 `public.web-resource`。Planning Run、Crawl Plan、Source Execution 和 Source Dataset 的事实源归属不变。
- 2026-09-01 已完成 ZOL 引用与真实执行的架构影响为 `改变`：Planning request/audit 新增结构化 ZOL 完成引用；Workbench 只接受同任务、完成 Batch 与完成 ZOL Provider Run，计划和执行不再重复抓 ZOL。历史 Source Dataset 仍是已完成原始事实源，新 Source Dataset Batch 保存本轮公开来源事实；没有新增 Provider、抓取器或 fallback。
- 2026-09-01 全资料最低覆盖与增量规划的架构影响为 `改变`：新增 typed `SourceCoverageModule`，只从 Source Dataset accepted 快照投影来源族、主题、独立 origin、已尝试 URL 和执行终态；Planning 与 Source Dataset 页面共用该 interface。Crawl Plan 当前协议升级为 v7，手工 `completedSourceReferences` 请求入口删除，ZOL 完成引用改由覆盖模块自动推导。原始事实源、Provider 和执行依赖方向不变。
- 旧的一次性专业研究任务文档已删除；没有保留第二条研究流程、旧 v5 确认入口或 fallback。
- 2026-09-01 Windows 正确性修复的架构影响为 `澄清`：只有已经创建 Source Run 的公开来源才进入已尝试 URL；`failed`、`stopped`、`partial` Batch 保持终态，只有活动或恢复中的 Batch 阻止缺口 Planning；Web 完整展示商品目录与执行终态门。Source Dataset、Source Coverage、Planning 和 Web 的事实源及依赖方向不变，公共 contract 未改变。
- 2026-09-02 多来源覆盖补查、研究时间边界和公开来源 origin 熔断的架构影响为 `澄清`：沿用现有 Codex App Server、覆盖校验、Source Request Admission 与人工 Resume seam；Source Dataset 仍是请求、限制、Snapshot 和 Asset 的唯一事实源，公共 contract、模块职责与依赖方向不变。
- 2026-09-02 ZOL 单品牌目录 404 的架构影响为 `澄清`：Provider 把该品牌当前页保存为 `not_found` 并保留已发现型号，继续同一计划中的后续品牌；全局结构绑定、来源访问限制和预算停止门保持不变，没有修改公共 contract、事实源、Provider 注册或恢复协议。
- 2026-09-02 ZOL HTML 一次 404 复核的架构影响为 `澄清`：复用现有 `p-retry`、Source Access Gate、Request Attempt 与两次尝试上限，只增加 ZOL HTML adapter 的显式选择；图片、robots、通用来源和公共 contract 不变。

Baseline Impact:

- touched modules: Shared Source Coverage/Crawl Planning contract、Workbench Coverage/Planning/Source Dataset、Web 覆盖投影、权威文档
- owning fact source: Run、Snapshot、Asset、URL 与 lineage 仍归 Source Dataset；最低规则归 shared contract；当前覆盖是只读 typed 投影
- public interface changed: yes，Source Dataset task view 新增 coverage，Planning audit 升级 v7，删除手工完成引用字段
- new protocol/adapter/fallback: yes，新增 coverage v1 typed projection；没有新增 Provider、adapter、抓取器或 fallback
- compatibility or legacy path changed: yes，v6 及更早计划只读保留，不能确认或执行
- research update required: yes，见 `RESEARCH.md` R-012
- architecture or ADR update required: yes，已更新 `ARCHITECTURE.md`；事实源与依赖方向未改变，不新增 ADR
- tests and real-surface validation to run: 已完成覆盖模块数据库测试、真实缺口 Planning/Confirm/Prepare/Start、增量 Source Dataset 终态对账、全量测试、六 workspace 类型检查和生产构建

## 后续入口

1. 按 `.scratch/source-capture-reliability/PRD.md` 的 P1 顺序完成型号资源终态和 Source Dataset 指标/coverage 语义。
2. 仅在 P1 的类型化规则与真实 Batch 对账通过后，再处理 Planning 韧性与进度交付等后续项。
3. 当前版本的真实可靠性门通过后，再重新采访、调研并设计阶段 2；不直接沿用旧 Evidence、Knowledge Factory 或知识包实现。

## 交付状态

历史多来源阶段 1 基线、本轮真实采集可靠性修复和 Batch 终态报告均纳入 Git `master`；本文件所在提交推送并完成本地、upstream 与 origin SHA 核对后，形成新的跨电脑代码接续点。Windows 新 Batch 的真实运行结论以 `MICROWAVE-REAL-CAPTURE-REPORT.md` 与 issue 04 为准。数据库、原始页面、图片和本机秘密只保留在本地，不进入 Git。
