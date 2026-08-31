# 数据抓取平台开发进度

更新日期：2026-08-31
当前阶段：ZOL 微波炉真实抓取恢复链收口

## 简单说明

系统当前按“采访门类 → 确认 Capture Task 草稿 → 调查 ZOL 门类品牌排行榜 → 确认 Crawl Plan → Prepare / Start → Source Dataset”工作。负责人在采访阶段确认业务范围和覆盖策略；系统在规划阶段调查具体品牌、排行榜与型号入口。没有可验证的 ZOL 品牌排行榜时，计划必须停止在人工确认门，不能把品牌目录当成排行榜继续执行。

当前默认策略是：选择 ZOL 门类品牌排行榜中综合评分大于 0 的品牌，按榜单顺序最多 20 个；每批 3 个品牌；每品牌每轮 10 个型号；每品牌最多 20 个型号，品牌目录不足时以来源穷尽结束该品牌。

本轮已补齐瞬时 DNS/传输失败后的持久自动 Resume：Worker 完成命令后、API 启动时和 Graphile cron 扫描都会从 Source Dataset 查找可安全恢复的 Batch；自动恢复先验证当前 Confirmed Crawl Plan 仍可执行，历史旧计划回到人工规划门。型号图集或大图分区的局部结构异常已经按当前型号隔离，不阻断后续品牌。微波炉任务继续沿同一 Confirmed Crawl Plan 和 Source Batch 的恢复链执行，Codex 每 5 分钟核对一次 Source Dataset 与独立服务状态。

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
| 微波炉门类纵向验收 | Capture Task v2、Crawl Plan v2 已确认，Source Batch 已恢复并继续执行 | Source Dataset |

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

## 当前正式运行

- Confirmed Capture Task：`capture-task-f3db0719-1fdf-45e7-814a-e74c8b946f51`，revision 2，status `ready`
- 已确认范围：家用微波炉；包含单功能、微烤一体机、微蒸烤一体机及其他具备微波功能的家用组合型产品；不抓商用、不抓无微波功能蒸烤箱
- 已确认策略：综合评分严格大于 0、按榜单顺序最多 20 个品牌、每批 3 个、每品牌每轮 10 个、每品牌最多 20 个
- Planning Run：`crawl-planning-run-4b649fc5-bd5e-4d6e-a40a-b84f9cb42b73`；ZOL 榜单 41 行，执行品牌 19 个
- Confirmed Crawl Plan：`crawl-plan-5aa3b862-d09a-4773-b947-fcf23d91871a`，version 2；无 planning blocker，最大执行容量 380 个型号
- Source Batch：`source-batch-476fab42-4a67-4a7b-bf8e-00a594378cb4`，当前 `running`，恢复状态 `running`
- 原始 Source Run：`source-run-133bf9a6-046a-4dc0-a63c-f84ffd57c5ca`，已按 `execution_process_lost` 收口为 `stopped`；第一段恢复 Run：`source-run-ce8291f0-1550-48da-8d47-7d7372a7bb3a`，在第 10 至 12 个品牌组按图集结构错误收口；当前恢复 Run：`source-run-c5fc9e3c-8249-494a-bf22-9f8febd1c96e`，状态 `running`
- 第一段恢复结束时，恢复链已经保存 2558 个不可变快照、2048 个资源文件；美的、格兰仕、松下各完成 20 个型号，东芝 19 个、海尔 20 个、西门子 8 个、创维 2 个、大宇 18 个、易厨 4 个，目录不足的品牌按来源穷尽结束。当前恢复 Run 从已完成型号之后继续重试第 10 至 12 个品牌组，并推进其余 7 个品牌。
- 2026-08-31 13:13 观测：当前恢复 Run 已新增 6 个快照，整个恢复链累计 2564 个快照、2048 个资源文件，Batch 与 Run 均为 `running`。

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

## 后续入口

1. Codex 观察任务每 5 分钟核对独立服务和 Source Dataset 的实际增量；暂时性请求按 30 秒超时、最多重试一次，仍失败则记录并继续后续图片、型号或品牌。
2. Source Batch 进入终态后，核对 Batch/Run/target/work item、请求账本、快照、图片、血缘和全部 19 个品牌的最终状态。

## 交付状态

本轮代码合入本地 `master`；未推送远端，提交不包含数据库、原始页面、图片或本机秘密。
