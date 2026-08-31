# 数据抓取平台开发进度

更新日期：2026-08-31
当前阶段：ZOL 微波炉真实抓取终态对账

## 简单说明

系统当前按“采访门类 → 确认 Capture Task 草稿 → 调查 ZOL 门类品牌排行榜 → 确认 Crawl Plan → Prepare / Start → Source Dataset”工作。负责人在采访阶段确认业务范围和覆盖策略；系统在规划阶段调查具体品牌、排行榜与型号入口。没有可验证的 ZOL 品牌排行榜时，计划必须停止在人工确认门，不能把品牌目录当成排行榜继续执行。

当前默认策略是：选择 ZOL 门类品牌排行榜中综合评分大于 0 的品牌，按榜单顺序最多 20 个；每批 3 个品牌；每品牌每轮 10 个型号；每品牌最多 20 个型号，品牌目录不足时以来源穷尽结束该品牌。

本轮已补齐瞬时 DNS/传输失败后的持久自动 Resume：Worker 完成命令后、API 启动时和 Graphile cron 扫描都会从 Source Dataset 查找可安全恢复的 Batch；自动恢复先验证当前 Confirmed Crawl Plan 仍可执行，历史旧计划回到人工规划门。型号图集或大图分区的局部结构异常按当前型号隔离，不阻断后续品牌；Target 在全部工作项进入完成或失败终态后正常收口。微波炉任务已完成终态对账。

## Git 与运行环境

- 主工作区：`/Users/guojunxi/Desktop/work/domain-analysis`，branch `master`
- 当前服务执行工作区：`/Users/guojunxi/.codex/worktrees/fcb1/domain-analysis`，与本地 `master` 使用同一份实现
- 当前实现、测试与权威文档合入本地 `master`；本轮未推送远端
- PostgreSQL 保留运行数据；API、Web 与 Graphile Worker 由独立 `launchctl` 服务运行，分别监听 `4000` 与 `6173`
- 数据库、浏览器状态、原始页面与图片资产只保留在本机，不进入 Git

## 产品链状态

| 环节 | 当前状态 | 权威事实源 |
| --- | --- | --- |
| 采集请求与品类采访 | 已接通 | Category Interview |
| 采访草稿版本与人工确认 | 已接通 | Versioned Markdown Capture Task Draft |
| Capture Task | 已接通 | Capture Task |
| 品类调查与抓取规划 | 已接通 | Planning Run |
| 排行榜审计、计划草稿与人工确认 | 已接通 | Crawl Plan |
| Prepare / Start / Resume | 已接通 | Source Execution |
| 原始页面、图片、血缘与导出 | 已接通 | Source Dataset |
| 新正式冰箱门类纵向验收 | 已形成终态报告 | Capture Task / Crawl Plan / Source Dataset |
| 瞬时传输失败无人值守恢复 | 已接通并通过回归测试 | Source Execution / Graphile Worker |
| 微波炉门类纵向验收 | Capture Task v2、Crawl Plan v2 已确认，Source Batch 已完成并完成终态对账 | Source Dataset |

## 当前领域规则

- Capture Task 是负责人确认的覆盖策略事实源：榜单评分门槛、品牌上限、品牌批次、每轮型号数和每品牌型号上限都必须显式保存。
- Planning Run 主动调查 ZOL 品类入口、门类品牌排行榜和入选品牌目录，并按任务策略确定性生成执行品牌。
- 执行品牌只能由已验证榜单按“综合评分大于 0、榜单顺序、最多 20 个”确定；不得按品牌目录数量、字母顺序或临时样例替代。
- 没有可验证榜单、没有满足阈值的品牌或入选品牌无法映射到目录时，Crawl Plan 保存明确 blocker、保持空执行来源并停在计划确认门。
- 同一 Confirmed Crawl Plan 按每批 3 个品牌推进全部入选品牌；每品牌每轮 10 个型号，达到 20 个或目录穷尽即结束该品牌。
- Provider 只执行已确认的品牌目录与型号捕获，不决定入选品牌，不跨品牌补数；参数页分片由产品 ID 计算，不含品类固定 ID。

## 当前实现收口

- 两个项目 Skill 已改为通用品类语义，采访不向负责人索要可调查的品牌清单；规划不使用全品牌回退。
- Capture Task contract 已保存 `brandSelectionPolicy`、`executionCadencePolicy` 与 `modelCoveragePolicy`。
- Crawl Plan contract 已保存 `brandRankingPlanningAudit` 与 `planningBlockers`，并校验榜单排序、评分阈值、目录映射、执行品牌和容量一致性。
- 规划运行时已收口为 `createZolCategoryPlanningRuntime`：从 Capture Task 的官方排行榜候选反查门类 slug，逐级核验门类页、排行聚合页和品牌榜，再由本地 ZOL adapter 解码并解析榜单。
- ZOL Provider 已按 `category_slug` 执行通用品类目录，并区分来源穷尽与访问失败。
- ZOL Provider 已按工作项隔离暂时性失败：请求有界重试耗尽后记录品牌/型号失败并继续；图片 404、非成功响应或格式不合格只结束当前型号。
- 型号图集无法枚举大图分区或大图详情无法识别来源图片字段时，Provider 保存拒绝快照并把当前型号标记为 `content_not_accepted`；参数页无法绑定型号身份、来源级目录结构变化和安全限制仍保留为 Run 级停止门。
- Source Dataset 完成 Target 时只等待 `pending` 或 `running` 工作项；已完成和已隔离失败的工作项都属于可对账终态。
- Source Execution 的访问限制熔断只响应登录、验证和拒绝访问；普通 `not_found/source_error` 快照保留后继续，`target_count` 作为计划最大覆盖边界允许实际结果因来源穷尽或隔离失败而更小。
- Source Execution 只将 `transient_transport` 和满足安全条件的进程丢失标记为自动 Resume 候选；请求使用同一 Confirmed Crawl Plan、同一 Source Run 恢复链和原 request budget，结构性失败保留为终态供人工处理。
- API 启动扫描未完成 Batch，Graphile cron 每分钟触发恢复扫描；自动 Resume 使用确定性 job key 和固定延迟，重放同一 Resume command 不会创建第二个 Source Run。
- 自动 Resume 候选生成前必须通过当前 Confirmed Crawl Plan 的可执行性校验；旧规划协议不会反复自动入队。
- Workbench 已展示排行榜证据、执行品牌、批次与型号边界；存在 blocker、无有效排行榜审计或旧检查清单的计划不能确认。
- 冰箱专用固定品牌验收 API 已删除；正式链路只有 Planning Run 生成 Crawl Plan 一个计划入口。

## 当前验证

2026-08-31 当前工作区：

- `npm run typecheck`：shared、db、workbench、worker、api、web 六个 workspace 全部通过。
- `npm test`：43 个测试文件通过、2 个跳过；200 个测试通过、7 个跳过。
- 本轮自动恢复回归：2 个文件、16 个测试通过，覆盖瞬时失败候选、旧计划保护、启动扫描、完成回调、确定性 job key 与重复 Resume 幂等。
- `npm run build`：通过；Web 完成 2483 个模块构建。只有 Vite 大分块提示，不是 Node 异常退出或 OOM。
- 两个项目 Skill 的 `quick_validate.py` 校验通过。
- `git diff --check`：通过，仅有 Git 行尾转换提示。
- 最新 ZOL 排行榜 adapter、规划组装、自动恢复和确认门回归均通过；随后六个 workspace 全量类型检查、全量测试和生产构建再次通过。
- API 健康检查通过，Web 可访问；独立 `launchctl` API/Web 服务保持 `running`，Graphile Worker 已连接并消费 `execute_source_collection` 与 `schedule_source_recovery`。
- Workbench 真实页面已确认微波炉任务显示“后台执行中”。
- 型号图集局部结构异常回归：`zolCatalogGalleryProvider.test.ts` 11 个测试通过，覆盖图集入口与大图详情两类局部失败后继续后续型号。
- Worker 全量测试：8 个文件通过、2 个跳过；56 个测试通过、7 个跳过；Worker 类型检查通过。
- Source Dataset 终态收口集成回归：9 个测试通过，验证未结束工作项仍阻止完成、已失败工作项允许 Target 完成；Workbench 全量测试 15 个文件、66 个测试通过，类型检查通过。
- 微波炉真实 Batch 终态对账：无 `started` 请求或 `running` 工作项；19 个计划品牌均为完成、来源穷尽或隔离失败终态。

## 当前正式运行

- Confirmed Capture Task：`capture-task-f3db0719-1fdf-45e7-814a-e74c8b946f51`，revision 2，status `ready`
- 已确认范围：家用微波炉；包含单功能、微烤一体机、微蒸烤一体机及其他具备微波功能的家用组合型产品；不抓商用、不抓无微波功能蒸烤箱
- 已确认策略：综合评分严格大于 0、按榜单顺序最多 20 个品牌、每批 3 个、每品牌每轮 10 个、每品牌最多 20 个
- Planning Run：`crawl-planning-run-4b649fc5-bd5e-4d6e-a40a-b84f9cb42b73`；ZOL 榜单 41 行，执行品牌 19 个
- Confirmed Crawl Plan：`crawl-plan-5aa3b862-d09a-4773-b947-fcf23d91871a`，version 2；无 planning blocker，最大执行容量 380 个型号
- Source Batch：`source-batch-476fab42-4a67-4a7b-bf8e-00a594378cb4`，状态 `completed`，恢复状态 `completed`，终态原因为 `1/1 个来源完成`
- 恢复链：原始 Run `source-run-133bf9a6-046a-4dc0-a63c-f84ffd57c5ca` 按进程丢失收口；两段中间恢复 Run 保存历史终态；最终 Run `source-run-8e76eae2-de80-47e0-9022-88fbab337376` 以 `plan_scope_completed` 完成，目标实际覆盖 247 个来源型号。
- 19 个品牌对账：美的、格兰仕、松下、东芝、海尔、惠而浦、三洋、LG 各完成 20 个型号；西门子 8、创维 2、大宇 19、易厨 4、帝而 18、ouio 1、家易仕 1、米家 1、日立 12、威力 5 个型号按来源穷尽结束；方太完成 15 个型号，型号 `1228243` 因无法识别图集大图分区而隔离失败。
- 2026-08-31 14:00 最终观测：246 个型号完成、1 个局部失败；3,799 个不可变快照、2,918 个资源文件；3,879 个最新工作项完成、1 个失败、0 个运行中；请求为 3,822 个完成、106 个失败、2 个历史取消，0 个执行中。

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

## 后续入口

1. 基于已完成的微波炉 Source Dataset 审核原始页面、图片资产和血缘；数据处理阶段仍须按路线图重新访谈、调研和设计。

## 交付状态

本轮代码合入本地 `master`；未推送远端，提交不包含数据库、原始页面、图片或本机秘密。
