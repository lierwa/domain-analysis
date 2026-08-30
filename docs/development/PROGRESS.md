# 数据抓取平台开发进度

更新日期：2026-08-31
当前阶段：ZOL 冰箱正式抓取终态与执行容错收口

## 简单说明

系统当前按“采访门类 → 确认 Capture Task 草稿 → 调查 ZOL 门类品牌排行榜 → 确认 Crawl Plan → Prepare / Start → Source Dataset”工作。负责人在采访阶段确认业务范围和覆盖策略；系统在规划阶段调查具体品牌、排行榜与型号入口。没有可验证的 ZOL 品牌排行榜时，计划必须停止在人工确认门，不能把品牌目录当成排行榜继续执行。

当前默认策略是：选择 ZOL 门类品牌排行榜中综合评分大于 0 的品牌，按榜单顺序最多 20 个；每批 3 个品牌；每品牌每轮 10 个型号；每品牌最多 20 个型号，品牌目录不足时以来源穷尽结束该品牌。

本次正式运行完成首批海尔、美的、容声各 10 个型号并形成终态 Source Dataset；完整结果见 `ZOL-REFRIGERATOR-CAPTURE-REPORT.md`。

## Git 与运行环境

- worktree：`D:\work\domain-analysis-zol-v0`
- branch：`codex/zol-v0-vertical-publish-20260828`
- 远程接续分支：`origin/codex/zol-v0-vertical-publish-20260828`
- 当前实现、迁移、测试、Skills、权威文档和结论报告作为同一 Git 交付形成跨电脑接续点
- PostgreSQL、API、Web 与 Graphile Worker 当前在本机运行；API `4000`，Web `6173`
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
- Source Execution 的访问限制熔断只响应登录、验证和拒绝访问；普通 `not_found/source_error` 快照保留后继续，`target_count` 作为计划最大覆盖边界允许实际结果因来源穷尽或隔离失败而更小。
- Workbench 已展示排行榜证据、执行品牌、批次与型号边界；存在 blocker、无有效排行榜审计或旧检查清单的计划不能确认。
- 冰箱专用固定品牌验收 API 已删除；正式链路只有 Planning Run 生成 Crawl Plan 一个计划入口。

## 当前验证

2026-08-31 当前工作区：

- `npm run typecheck`：shared、db、workbench、worker、api、web 六个 workspace 全部通过。
- `npm test`：43 个测试文件通过、2 个跳过；195 个测试通过、7 个跳过。
- `npm run build`：通过；Web 完成 2483 个模块构建。只有 Vite 大分块提示，不是 Node 异常退出或 OOM。
- 两个项目 Skill 的 `quick_validate.py` 校验通过。
- `git diff --check`：通过，仅有 Git 行尾转换提示。
- API 与 Web 健康检查：HTTP 200。
- 最新 ZOL 排行榜 adapter、规划组装与确认门聚焦回归：3 个文件、13 个测试全部通过；随后六个 workspace 全量类型检查、全量测试和生产构建再次通过。
- 执行容错聚焦回归：4 个文件、22 个测试通过，覆盖型号 DNS 重试耗尽、品牌目录临时失败、资源不存在、低于最大目标收口和结构错误停止；随后六个 workspace 类型检查、195 项全量测试和生产构建通过。

本轮没有出现 Node 异常退出或 OOM；正式 Source Run 观测到的 Node 私有内存最高约 388 MB。

## 当前正式运行

- Confirmed Capture Task：`capture-task-acf59990-8c0d-422f-8a67-4ceb020adf87`，revision 1，status `ready`
- 已确认策略：综合评分严格大于 0、按榜单顺序最多 20 个品牌、每批 3 个、每品牌每轮 10 个、每品牌最多 20 个
- 当前规划协议：`executionChecklistVersion=5`；品牌排行榜审计必须通过 typed contract，旧协议草稿不能确认或执行
- Planning Run：`crawl-planning-run-56a1c76c-ca08-4555-93c4-4f31711f6408`；官方冰箱榜 50 行，综合评分大于 0 的执行品牌 20 个
- Confirmed Crawl Plan：`crawl-plan-41c7bca7-4fc5-46ba-a364-de0be0114332`，version 5；无 planning blocker，20 个品牌入口，参数 3 / 10 / 20
- Source Batch：`source-batch-5219dbea-2d69-42a8-b85f-0206d308308a`；Source Run：`source-run-48f29f4d-187a-4313-a9f7-07f0efdd0e5b`，终态 `failed`
- 最终结果：835 个不可变快照、834 个验收内容响应、703 张图片、30 个完整型号；海尔 / 美的 / 容声各完成第一轮 10 个型号
- 终止原因：`可信 DoH 查询失败：DNS status 2`；两个终止图片请求均完成一次有界重试，没有登录、验证码、401、403、429、来源风控或 OOM
- 终态对账与完整结论：`ZOL-REFRIGERATOR-CAPTURE-REPORT.md`

## 架构影响

本轮架构影响：`改变`。

- Capture Task 公共 contract 新增品牌选择与执行节奏策略，成为负责人确认边界的唯一事实源。
- Crawl Plan 公共 contract 以排行榜审计与计划 blocker 作为来源调查和执行品牌集合的唯一事实源。
- ZOL Provider 配置升级为通用品类 `category_slug`，不再承担选品牌职责。
- 旧的冰箱专用计划旁路已删除，不保留兼容入口。
- ZOL 排行榜事实改由来源 adapter 沿官方链路确定性核验；Planning Run 与 Crawl Plan 事实源未变，没有新增第二运行时或 fallback。
- Source Execution 失败分类补充可信 DNS SERVFAIL 与临时网关错误；请求、品牌/型号工作项与 Source Run 的失败作用域已经分开，`target_count` 明确为最大覆盖边界。事实源和依赖方向不变。

## 后续入口

1. 本次正式 Source Run 已完成终态对账，代码、测试、迁移、Skills、权威文档和结论报告作为同一 Git 交付推送。
2. 后续若继续完成剩余品牌范围，从当前 Confirmed Crawl Plan 和 Source Run 恢复事实发起新的明确执行动作。

## 交付状态

本次终态交付已获用户明确授权；远程 Git 提交不包含数据库、原始页面、图片或本机秘密。
