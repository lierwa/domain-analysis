# 技术调研登记
状态：当前采用结论与阶段 2 候选调研
更新日期：2026-09-03

本文件只记录当前实现和下一阶段直接依赖的技术结论、验证证据与退出条件。
## R-001 ZOL 品牌目录、型号参数与图集
### 当前结论
- ZOL 标准商品门类、品牌目录、型号参数页和型号图集具有稳定的公开入口关系；
- 品牌目录可以按页面顺序枚举不同 ZOL 产品 ID；
- 参数页可以识别来源参数区块和图集入口；
- 图集详情 `picList` 可以用产品 ID、图片 ID、hash、扩展名和 `sizeInfo.source` 绑定来源原图；
- 产品绑定的实际图片集合是型号图片完成事实。
- 型号参数页首段是 `ceil(productId / 1000)` 得到的产品分片，不是品类 ID；同一门类不同年代的型号可能使用不同分片。

ZOL 特有 DOM 和 URL 协议只保留在 ZOL Provider，不进入共享领域模型。
### 验证证据
正式系统完成海尔 10、美的 10，共 20 个型号和 502 张完成图片。每个型号的参数页、图集页、图片引用、本地资产、来源 ordinal、MIME 和哈希均已对账。跨门类原型已用电视 `digital_tv` slug 和不同产品分片验证通用目录解析与参数页路由。
### 退出条件
页面结构无法绑定门类、品牌或产品 ID，或者图片详情无法提供可信原图字段时，Provider 失败关闭并保留原始响应。
## R-002 PostgreSQL 后台命令队列
### 候选
| 候选 | 许可证/运行条件 | 处置 |
| --- | --- | --- |
| Graphile Worker 0.17.x | MIT；PostgreSQL 12+；Node 22.18+ | 采用 |
| pg-boss 12.x | MIT；PostgreSQL 13+ | 保留为可替换候选 |
| BullMQ | 成熟默认路径依赖 Redis | 不采用，增加 local-first 部署依赖 |
| API 进程内 Promise | 不提供持久命令恢复 | 不采用 |
### 采用边界
- 固定 `source_collection` queue；
- `concurrency=1`；
- `maxAttempts=1`，来源请求的重试由 Source Execution 管理；
- command ID 同时承担普通命令的 job key 和领域幂等关联；自动 Resume 使用 `source-auto-resume-{runId}` 确定性 job key 与 `preserve_run_at`；
- 使用 Graphile Worker 的 cron 扫描在 API 启动和每分钟周期发现未完成 Batch；候选类型和恢复预算由 Source Execution/Source Dataset 决定，队列不推导领域状态；
- 自动恢复投递前重新验证 Batch 绑定的 Confirmed Crawl Plan 仍是当前可执行协议；历史旧计划只保留人工重新规划入口；
- Start/Resume 返回 `202` 后由 Worker 完整消费 Source Execution 事件；
- 只释放已被终态 Batch 或终态 Run 证明退出的 Worker lock。

Graphile Worker 只负责命令交付；Batch、Run、work item 和 Source Dataset 由 Workbench/PostgreSQL 领域表拥有。
### 验证与退出
Windows PostgreSQL 14 已验证 HTTP 返回后独立消费、幂等提交、Resume command 关联和进程恢复；本轮补充了本机自动 Resume 的回归测试。Graphile 官方 `addJob` 支持 `runAt`、`jobKey` 与 `maxAttempts`，官方 cron 使用普通队列周期投递且避免重复调度：[addJob](https://worker.graphile.org/docs/library/add-job)、[job key](https://worker.graphile.org/docs/job-key)、[cron](https://worker.graphile.org/docs/cron)。替换队列时保持 Source Execution 和 Source Dataset contract 不变。
## R-003 HTML 与图片独立调度
### 采用依据
- `p-queue` 9.3.3 为 MIT、原生 ESM；Node 24 满足运行要求；
- Cockatiel 承担访问限制熔断；
- PostgreSQL Source Access Gate 拥有跨进程准入事实。
### 采用配置
| 通道 | 最大频率 | 最小启动间隔 | 并发/容量 |
| --- | --- | --- | --- |
| HTML | 12/min | 5 秒 | 持久 gate 串行准入 |
| 图片 | 30/min | 2 秒 | `p-queue` 2 / 100 |

两条通道独立调度，共享 Provider 访问限制熔断。图片 ordinal 在入队时冻结；关闭时取消排队项并等待真实在途 Promise。
### 验证与退出
正式长批次完成 20 个型号，终态没有访问限制、未结束请求或 running work item。出现访问限制、节奏失效、队列无法收口或进程内存持续增长时停止放量并收紧计划。
## R-004 暂时性网络重试
`p-retry` 8.0.0 为 MIT、纯 Node ESM。当前最多执行一次有界重试，适用于：

- 暂时性传输错误；
- HTTP 502/503/504；
- 可信 DoH 明确返回的 DNS SERVFAIL。

每次尝试都重新经过 Source Access Gate 并写请求账本。访问限制、身份挑战、计划与来源结构无法绑定、计划外跳转和安全策略失败直接进入停止流程。
### 失败作用域
- 重试耗尽只终止对应请求 Work Item；ZOL 品牌目录或型号可以隔离时继续后续工作项；
- 单张图片不存在、非成功响应或格式不合格记入当前型号，不结束整个 Source Run；
- 访问限制、计划/来源结构无法绑定、Provider/typed contract/存储不变量、预算与运行时限属于 Run 级停止条件；
- `stopOnAccessRestriction` 只接受登录、验证和拒绝访问状态，普通 `not_found/source_error` 不能触发全局熔断；
- 继续复用 `p-retry`、Source Access Gate、请求账本和现有 Work Item 生命周期，不新增第二套重试器或内存状态机。
## R-005 公共资源传输与内存验证
Node 24 官方 `https.request` 和复用的 `https.Agent` 承担公开 HTML 与图片传输。薄 transport adapter 保留：

- 公网地址与 DNS 校验；
- 同 origin 单次重定向；
- 逐跳请求审计；
- 流式最大字节限制；
- 本机受信任 HTTPS 代理支持。

正式长批次在新增 134 个快照、114 张图片后约占 275 MB，并完成 20 个型号剩余范围。该结论覆盖当前验收规模；每次扩大品牌批次继续观测内存曲线和存储预算。
### 退出条件
新规模出现持续内存增长时停止批次并重新评估 transport 生命周期；Node heap 上限不作为容量修复手段。
## R-006 Source Dataset 热路径
`commitSnapshot` 只返回更新后的 Run 计数。需要快照、资源引用和资产详情的 API/UI 显式调用 `getRun`；target 失败或停止时，未完成 work item 与 target 在同一事务收口。

Source Dataset 保持为唯一事实源，该接口不增加缓存状态或改变 HTTP contract。
## R-007 Crawl Planning 产品链
### 产品约束
- Planning Run 只消费已确认 Capture Task revision；
- Capture Task 显式保存品牌榜筛选、品牌批次、每轮型号量和每品牌型号上限；
- 来源入口、排行榜、入选品牌目录和 Provider 能力由系统主动调查；
- Crawl Plan Draft 与 Confirmed Crawl Plan 分开建模；
- 计划确认与 Start 分开授权；
- Provider 只执行计划冻结的范围。
### 复用结论
Category Interview 继续使用锁定版本的 Codex App Server `stdio`、ephemeral thread、官方事件流和本地 Zod 校验。ZOL Crawl Planning 的品牌范围事实改由现有 Public Resource Transport、`encoding-sniffer`、Cheerio、`p-retry`、PostgreSQL Planning Run 与 Crawl Plan schema 组装：来源 adapter 沿 ZOL 官方链接核验门类和品牌榜，瞬态传输失败只重试一次；不再让通用 Agent 的网页解码、工具选择或十分钟运行时决定执行品牌。
### 当前验证
Planning Runtime、PostgreSQL Planning Run、Crawl Plan Draft、独立确认 API 和 Workbench 投影已经接线。typed contract 已覆盖可验证榜单与榜单不可用两种结果；旧规划协议和带计划级阻塞的草稿不能确认。正式冰箱任务已经生成并确认 v5 计划，Prepare 通过且 Source Execution 已启动；剩余验证门是全部执行品牌的型号、页面、图片与 Source Dataset 终态对账。
## R-008 Source Dataset UI
`@xyflow/react`、Dagre、ELK、Radix UI 和 `usehooks-ts` 只承担 Source Dataset 展示和通用交互，不拥有业务状态。后续性能工作以真实页面测量为入口。
## R-009 ZOL 门类品牌排行榜
### 官方页面证据
- ZOL 品牌榜总入口：`https://top.zol.com.cn/manu/`，公开列出手机、电视、空调、洗衣机、冰箱等多个分类品牌榜及综合评分；
- 电视品牌榜：`https://top.zol.com.cn/compositor/314/manu_param_1.html`，页面展示名次、品牌综合评分，并包含综合评分为 `0` 的尾部品牌；
- 洗衣机品牌榜：`https://top.zol.com.cn/compositor/372/manu_attention.html`，页面展示同构的名次和品牌综合评分列；
- 电视详情门类：`https://detail.zol.com.cn/category/314.shtml`；洗衣机详情门类：`https://detail.zol.com.cn/washer/`。
- 冰箱门类页：`https://detail.zol.com.cn/icebox/`；排行聚合页：`https://top.zol.com.cn/compositor/icebox.html`；品牌榜：`https://top.zol.com.cn/compositor/359/manu_attention.html`。2026-08-30 实际核验为 50 行，其中前 20 行综合评分大于 `0`，第 21 至 50 行为 `0`。
### 采用结论
- 执行品牌只从当前门类可验证的 ZOL 品牌排行榜产生；门类品牌目录不能替代排行榜；
- 执行品牌按已确认规则从当前门类榜单确定：综合评分严格大于 `0`，保持榜单顺序，最多 `20` 个；
- 默认每批 `3` 个品牌、每品牌每轮 `10` 个型号、每品牌最多 `20` 个型号；
- 每个门类必须独立验证排行榜 URL、门类归属和综合评分列；“其他门类存在榜单”不能证明当前门类也有可用榜单；
- 没有可验证排行榜时生成空来源受阻草稿，并停在计划确认门；不使用全品牌、热门品牌或固定品牌 fallback。
### 验证与退出
ZOL adapter 先校验 Capture Task 排行榜候选、榜单品牌目录中的唯一门类 slug、门类页排行入口、排行聚合页品牌榜入口、GBK 页面标题、名次、综合评分和目录 URL；typed contract 再校验评分阈值、品牌上限和执行品牌集合。ZOL 改版后若任一链路、综合评分或唯一品牌映射不可验证，Planning Run 进入 `rankingStatus=unavailable`，不进入执行。
## R-010 Source Capture Subject 与数据地图投影
### 问题与候选
当前 Source Dataset 只保存 URL 资源、Run、work item 和发现深度；ZOL Provider 已经识别品牌与型号，但这两个来源事实没有通过 typed contract 持久化。Web 因而只能按 Run/深度展示，或解析 `workKey`、URL 和文案猜测业务归属。后者会把来源协议泄漏到通用 UI，不能采用。

| 候选 | 本地与离线 | 类型/安全边界 | 处置 |
| --- | --- | --- | --- |
| Web 解析 `workKey`、URL 或错误文案 | 可用 | 来源协议泄漏，形成第二事实源 | 不采用 |
| 每个 Snapshot 重复保存品牌/型号 JSON | 可用 | typed，但在数千资源上重复身份 | 不采用 |
| Provider 通过现有 `ensureCaptureWorkItem` 写入规范化 Capture Subject | 可用 | 来源 adapter 写事实，Source Dataset 校验和幂等，Web 只读 | 采用 |
| 引入新的图数据库或状态管理库 | 增加部署与升级成本 | 与当前 PostgreSQL/React Query 能力重复 | 不采用 |
### 采用结论
- Source Dataset 新增批次内唯一的 `brand` / `product_model` Capture Subject；它只表达源站身份和显示名称，不是阶段 2 的跨来源商品标准化实体。
- `ensureCaptureWorkItem` 保持为 Provider 唯一写入 seam；Source Dataset 在接口内部完成 subject 幂等、父品牌关联、工作项关联和冲突校验。
- Snapshot 保存真实 Capture Work Item 外键；原有 typed lineage 继续保存来源发现路径。历史数据只增加可审计关联，不改写原始内容、哈希或已确认计划。
- Workbench 统一投影 Batch 汇总、品牌型号完成度和逻辑问题；Web 不重复计算领域状态。
- 继续复用 Drizzle 0.45.2 的 PostgreSQL 外键、索引和 `onConflict`，React Flow 12 的可见子树，TanStack Query 5 的游标分页，以及 Radix Alert Dialog 的键盘和焦点管理；不增加依赖。官方依据：[Drizzle insert/upsert](https://orm.drizzle.team/docs/insert)、[React Flow expand/collapse](https://reactflow.dev/examples/layout/expand-collapse)、[TanStack Query pagination](https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries)、[Radix Alert Dialog](https://www.radix-ui.com/primitives/docs/components/alert-dialog)。
### 最小原型与退出条件
最小原型必须用当前微波炉 Batch 证明：19 个品牌、247 个型号、246 个完成、1 个需关注；3,799 个快照和 2,918 个图片附件按全部 4 个 Run 汇总；同一内容拒绝在 3 个 Run 出现时只投影为 1 个问题；单张图片详情不得加载整个 Run。

如果 Provider 无法从已保存的来源目录事实确定品牌或型号，记录保持在“未归类原始记录”，不得由通用模块猜测。若真实数据无法满足上述关联门，停止 UI 切换并保留现有运行审计入口。
## R-011 多来源 Planning 与公开原始资料抓取
### 要解决的问题
ZOL、标准监管、专业技术和品牌公开资料需要在同一 Planning 阶段进入一份 Crawl Plan。Planning 负责发现可执行入口，Provider 负责保存原始响应；两者不能合成一份离线研究报告，也不能建立第二套抓取系统。
### 复用与处置
| 能力 | 当前资产 | 处置 |
| --- | --- | --- |
| 品类商品目录核验 | `createZolCategoryPlanningRuntime` 与 ZOL adapter | 继续确定性执行，模型不拥有榜单事实 |
| 多轮搜索与结构化来源发现 | 锁定的 Codex App Server `stdio`、ephemeral thread、官方 web search 事件、本地 Zod 校验 | 复用，只承担 Planning 调查 |
| 公开网页/PDF 原始抓取 | `public.web-resource@2.0.0`、Public Resource Transport、Source Access Gate | 复用，按计划 exact URL 保存原文和附件 |
| 执行与失败隔离 | 现有 Source Execution、Request Ledger、Source Dataset | 复用，每个来源独立 Source Run |
| 旧的大型 Codex planning agent 或新的通用研究框架 | 会重复计划事实源、搜索编排、抓取和引用存储 | 不恢复、不引入；先验证现有正式 seam |

本轮不增加依赖。产品特有代码只负责三件事：把已确认品类范围写成研究提示、把结构化来源结果映射为现有 Crawl Plan source、将 ZOL 与公开来源合并成一个计划。搜索、进程协议、结构化输出校验、HTTP 传输、重试、预算和持久化均复用官方或项目既有能力。
### 真实最小原型
2026-09-01 使用真实 Codex App Server 和 web search 执行微波炉 Planning 研究：约 110.6 秒内完成 3–5 轮搜索，返回 10 个专业主题和 11 个公开直达候选，覆盖中国标准/认证、技术与安全机构、食品安全资料以及品牌官方说明书。App Server 报告本次累计 268,647 tokens，其中输入 264,146、输出 4,501；该数值说明多轮搜索上下文成本较高，不能把无界 Deep Research 放进每次规划。

原型只证明“通用品类主题拆解 → 多轮搜索 → 结构化直达入口”能够工作，不证明 11 个来源充分，也没有把搜索结果当作已抓取原文。公开来源仍必须经过负责人确认、Provider 实际请求和 Source Dataset 终态验收。

2026-09-01 完成正式微波炉纵向验证：Capture Task revision 3 明确引用同任务已完成的 ZOL Batch，Planning Run `crawl-planning-run-7a63fa4e-584d-4b75-9e87-6927294a25d0` 没有再次调用 ZOL 目录 Runtime，生成 17 个 `public.web-resource` exact 来源：6 个品牌公开来源、6 个监管来源、4 个标准平台来源和 1 个专业期刊来源。Crawl Plan `crawl-plan-8673cd17-9108-415d-af15-07e0c199916e` version 3 无 blocker，并通过 Confirm、Prepare 与 Start。

Source Batch `source-batch-abe119fd-f6be-4b40-b6f9-b36d4473aac7` 的 17 个 Source Run 全部进入终态：15 个完成，USDA 页面和专业期刊摘要页分别因 `access_denied` 进入 `source_restricted`，后续来源仍继续。Source Dataset 保存 16 个 Snapshot（15 个 accepted、1 个 failed）和 4 个 PDF Asset。该结果验证的是多来源原始采集和失败留痕，不是资料充分性判断。
### 采用边界
- 该轮 Crawl Plan 检查清单升级为 v6，并保存一份 `multi_source_planning` audit；R-012 已将当前确认与执行协议升级为 v7，v6 及更早计划只读保留。
- 主题使用通用 facet，具体原理词、部件词、标准号、品牌和 URL 都是当前任务调查结果，不能写进跨品类规则。
- 只接受公开、可审计、无需绕过登录、验证码、付费或许可限制的 HTTPS 直达入口。
- 搜索过程中单个查询或候选失败进入 `blocked`；执行过程中单个来源失败保存在对应 Source Run，后续来源继续。
- Codex 只接收已确认 Capture Task 的品类范围和来源候选，不接收 Cookie、Profile、认证 Header、未脱敏原始内容或 Source Dataset 私有资产。
- 最终 JSON 由本地 schema 校验；模型 commentary 不作为计划事实，Provider 不从模型说明文字推导执行参数。
- 已完成来源复用由 `SourceCoverageModule` 从同任务 Source Dataset 自动推导；只有完成 Batch 与对应完成 Provider Run 可以进入计划审计。调用方不再手工提交完成引用，该引用不会复制原始数据。
### 验证门与退出条件
当前代码、typed contract、UI 投影和 Provider 注册已经接线，并完成负责人确认后的真实多来源 Crawl Plan、Source Execution 和 Source Dataset 对账。该轮证明执行链闭环；阶段 1 的资料最低覆盖采用门由 R-012 单独定义和验收。

若真实规划持续超过预算、来源入口不可执行、模型无法稳定返回合法 schema，或 Source Dataset 无法逐来源保存原文与失败事实，则停止正式确认并重新评估研究运行时；不得在当前链路上叠加第二套搜索器、抓取器或引用库。
## R-012 阶段 1 原始资料最低覆盖门
### 要解决的问题
多来源全部进入终态，只能证明抓取链能够收口，不能证明各类原始资料已经达到最基本的输入规模。覆盖门必须同时检查商品目录、来源族、主题、独立站点、已接受原始内容和全部计划运行终态；不能用“计划里出现过 URL”或 HTTP 成功替代资料验收。
### 候选与采用结论
| 候选 | Node/TypeScript 与本地边界 | 处置 |
| --- | --- | --- |
| [Great Expectations](https://docs.greatexpectations.io/docs/home/) | Apache-2.0、持续维护，但需要 Python 运行时，主要验证表格字段与数据质量，不能表达本项目的来源族、主题和独立站点语义 | 不引入 |
| [PostgreSQL 聚合](https://www.postgresql.org/docs/current/functions-aggregate.html) + [JSON 函数](https://www.postgresql.org/docs/current/functions-json.html) + 现有 Drizzle | 已部署、本地可运行，可以读取不可变 Source Dataset；产品规则仍由 typed contract 明确表达 | 采用 |
| [Zod refinements](https://zod.dev/api?id=refinements) | 项目已锁定使用，负责覆盖投影和 Planning 输入的边界校验；不承担数据库事实推导 | 采用 |

本轮不增加依赖。Source Dataset 继续拥有 Run、Snapshot、Asset、URL 和血缘事实；Workbench 新增一个小的 `SourceCoverageModule`，集中完成去重、独立站点计数、来源族与主题缺口计算。Planning 和 Source Dataset 页面通过同一个 interface 读取结果，避免各自维护第二套判断。
### 最低覆盖规则
- 商品目录：同一 Capture Task 必须存在已完成的 ZOL Batch 和完成的 ZOL Provider Run，并至少有品牌、型号、全部型号完成关联及 accepted 原始快照；后续补资料不得重跑它。
- 必需来源族：`standards_and_regulation`、`professional_technical`、`brand_official`。每族至少 `3` 条已接受原始资料，且至少来自 `2` 个 URL origin。
- 必需主题入口：运行原理、核心部件、安全与法规、性能与测试、使用与维护。每个经确认计划标注的主题至少有 `2` 条已接受原始资料入口，且至少来自 `2` 个 URL origin；该门不冒充正文语义审核。
- 已接受资料：`public.web-resource` Run 完成，并存在 `accessible`、`accepted`、非空、带 URL 与 lineage 的 Snapshot；Snapshot requested URL 必须与计划 exact URL 一致，再按规范化 URL 去重。
- 计划终态：同一任务的 Batch、Run、Target、Work Item 和 Request Attempt 都必须进入终态；失败保留在审计中，但不计入已接受资料。
- exact URL 只声明自身实际返回的一种格式；HTML 页面链接的 PDF 必须作为独立 PDF 直达候选，不能用一个 URL 同时宣称抓到 HTML 与 PDF。
- 增量规划：只规划当前缺口，排除已经接受和已经尝试的 exact URL；每个缺口至少调查“缺少数量 + 2”个候选，并覆盖足够的不同 origin。

这是阶段 1 的最低输入门，只表示已经形成可供下一阶段重新采访、调研和设计的基本原始资料，不表示资料已经足以支撑专业导购，也不对内容做清洗、事实合并或正确性裁决。
### 当前真实差距与退出条件
2026-09-01 独立审计确认：商品目录完成；标准平台 4/4、监管 5/6、品牌官方 6/6，但专业技术 0/1。当前 15 条成功资料均为 HTTP 200、非空、带 URL 与 lineage，4 个 PDF 的内容签名、哈希和数据库一致。USDA 记录为 robots.txt 403；专业期刊候选在真正发出请求前被持久访问门阻止，不能描述为源站明确拒绝。

因此此前“执行链闭环”保留为已验证事实，“资料最低覆盖通过”撤回。系统应继续增量规划和抓取，直至全部来源族、必需主题和终态门满足；若公开、可审计且无需绕过访问限制的候选已经穷尽，则以具体缺口、已尝试入口和来源限制停止，不用重复重试同一 URL 伪造进展。

2026-09-01 完成缺口闭环验证：覆盖模块从 Source Dataset 自动确认唯一缺口为 `professional_technical` 0/3；其余来源族与五个必需主题已经达标。Planning Run `crawl-planning-run-d73f70a5-de0a-41dc-9e6b-c0634a5a2d96` 没有重跑 ZOL，也没有重用 17 个历史 exact URL，只为该缺口生成 5 个新候选、覆盖 5 个 URL origin。Crawl Plan `crawl-plan-da4d5e07-d39f-4b47-966b-6c2aa2cce165` version 4 通过 v7 确认门。

Source Batch `source-batch-c370c3dd-9e51-428f-bacb-a4a2fd25349f` 的 5 个 Source Run 全部完成并各保存 1 条 accessible、accepted、非空且与计划 exact URL 一致、带 lineage 的 Snapshot；WSU 来源另保存 1 个 PDF Asset。最终商品目录为 19 个品牌、247/247 个型号有完成记录；累计 20 条已接受公开资料：标准监管 9 条/6 个 origin，专业技术 5 条/5 个 origin，品牌官方 6 条/3 个 origin；五个必需计划主题入口分别为 7、7、7、10、6 条，均超过 2 条/2 个 origin 的最低门。全部 Batch、Run、Target、Work Item 和 Request Attempt 终态，覆盖状态为 `satisfied`，剩余缺口 0。
## R-013 ZOL HTML 404 有界复核
### 真实问题与证据
2026-09-02 Windows 真实 Batch `source-batch-0d9674f0-f8b0-42d8-b851-f6474859c2e5` 中，ZOL 参数页、图集页和大图页出现大量 HTTP 404，最终只有 197/247 个型号完成。随后在同一主机使用 `DomainAnalysisBot/0.1`，分别经直连与正式 `.env.local` HTTPS 代理路径复核以下失败 exact URL，均返回 HTTP 200：

- `https://detail.zol.com.cn/101/100191/param.shtml`
- `https://detail.zol.com.cn/1229/1228247/param.shtml`
- `https://detail.zol.com.cn/1266/1265066/pic.shtml`

该证据否定了“首次 404 必然表示永久不存在”，但不能推出所有网站或所有 ZOL 图片 404 都应重试。一般 HTTP 404 仍是资源终态；本结论只约束已经通过真实执行验证的 ZOL HTML adapter。
### 候选与采用结论
| 候选 | 处置 |
| --- | --- |
| 全局把 404 视为暂时错误 | 不采用；会重复请求真实不存在资源并改变所有 Provider 语义 |
| 新建 ZOL 专用重试循环 | 不采用；重复现有 `p-retry`、访问 gate、预算和取消机制 |
| 调用方显式启用一次 ZOL HTML 404 复核 | 采用；复用现有 `p-retry`，每次尝试仍写持久请求账本 |
| 放宽型号完成门或从分母删除失败型号 | 不采用；会掩盖数据缺口 |

`p-retry` 的官方接口把 attempt number 传给输入函数，并允许 `shouldRetry` 决定是否消费剩余重试；当前项目继续使用锁定依赖和现有一次重试预算，不新增依赖。实现只在第一次 ZOL HTML 404 时抛出既有暂时失败信号；第二次 404 原样返回 Provider，确保最终 `not_found` 响应仍进入不可变 Source Dataset。
### 验证门与退出条件
- `404 -> 200` 必须产生两条 Request Attempt，最终保存 accepted Snapshot。
- `404 -> 404` 最多两次，并保存最终 `not_found` Snapshot。
- 401/403/429、robots、图片 Asset、通用公开来源、预算、取消和最长运行时间保持原行为。
- 若一次复核仍不能显著降低真实假 404，停止扩大重试次数，转而调查代理出口、DNS/CDN 路径或从产品综述页跟随来源链接；不得用无界重试伪造完成率。

2026-09-02 的独立真实验收进一步验证了该退出条件：Batch `source-batch-b2a25771-63c3-4b8a-8b77-4687989b6c28` 的 ZOL Run 对 86 个 exact URL 记录了 `404 -> 200`，对 11 个 exact URL 记录了 `404 -> 404`。前者说明一次有界复核显著降低了假 404；后者按两次上限保留 `not_found` 与型号问题，没有扩大次数。两类结果均来自同一持久 Request Attempt 账本。
## R-014 Agent 知识包产线市场调研
调研日期：2026-09-03。状态：公开资料调研完成，技术候选待原型验证。
### 简单说明与需求边界
阶段 2 的产品是可重复运行的资料加工产线：接收已经收集的资料，按适合资料和使用目的的加工规则，生产供外部 Agent 挂载使用的知识包。知识包应让使用方知道有什么内容、如何查找、依据在哪里，以及适用范围。具体消费场景由下游 Agent 决定。

本次调查 9 个主要产品/项目、1 个早期格式探索，以及加工、评测、数据封装和 Agent 接入的官方资料。市场比较来自文档、正式发布信息、公开源码和论文，尚未执行这些候选的完整产线。后续本地薄适配已完成固定文字样包与六题消费对照，证据见 KNOWLEDGE-PACK-SAMPLE-REPORT.md；平台宣传与论文效果仍只代表其自身条件。

本节服务 `ROADMAP.md` 的数据处理阶段采访与调研入口，承接 `ARCHITECTURE.md` 的 Source Dataset 只读消费边界。阶段 1 采集范围与原始事实源继续按现有基线执行；阶段 2 的模块、公共契约和成品格式仍待确认。首轮消费验证使用 Codex Agent Skills；图片沿用采集时的型号、来源分类和血缘，进行有限 OCR，视觉模型不参与本轮加工与消费验证。HTML 复用已有解析能力；OCR 的硬件、速度和质量证据见 R-015。
### 市场已有的加工方式
| 产品/项目 | 已核实的加工能力 | 对本产线的候选价值与边界 |
| --- | --- | --- |
| [RAGFlow 知识编译](https://github.com/infiniflow/ragflow/blob/v0.27.1/docs/guides/knowledge_compilation/overview.md) | Parser、Chunker、Compiler、Indexer；编译模板产生图谱、树、页面索引、时间线、Wiki 等产物 | 优先作为完整产线对照；模板定义加工方法，资料执行后才产生实际产物。文档还提供 [To Skills 与更新检查](https://github.com/infiniflow/ragflow/blob/v0.27.1/docs/guides/knowledge_compilation/apply_knowledge_compilation_template.md)，独立包交付仍须验证 |
| [Corpus2Skill](https://github.com/dukesun99/Corpus2Skill) | 离线嵌入与层次聚类、摘要和命名，输出 SKILL.md/INDEX.md 目录；Agent 沿目录导航，再按文档 ID 读原文 | 与外挂形态直接相关；属于早期实现，原始文档读取工具也是交付依赖，不能只交摘要目录 |
| [Dify Knowledge Pipeline](https://docs.dify.ai/en/cloud/use-dify/knowledge/knowledge-pipeline/knowledge-pipeline-orchestration) | 可视化接入、解析、普通/父子/问答分块、索引与检索配置；支持图文片段 | 可参考可配置加工体验。其 [DSL 导出](https://docs.dify.ai/en/cloud/use-dify/knowledge/knowledge-pipeline/create-knowledge-pipeline)携带流程和配置，不能据此认定知识内容、附件与索引已完整导出 |
| [Docling](https://github.com/docling-project/docling) | 多格式解析、OCR、阅读顺序与表格结构；输出 Markdown、HTML 和 JSON | 结构保真解析候选。[DoclingDocument](https://docling-project.github.io/docling/concepts/docling_document/)表达层级、正文/页眉页脚、图片、表格、位置与来源信息；它本身不承担事实裁决或整条发布流程 |
| [Unstructured](https://docs.unstructured.io/open-source/ingestion/overview) | 按元素拆解文档，再清洗、分块、嵌入、输出；商业平台提供更多增强与编排能力 | 解析/元素加工候选。官方明确开源 Ingest CLI/库没有持续同步全部 API 新功能，采购和复用须区分产品版本 |
| [DataFlow](https://github.com/OpenDCAI/DataFlow) | 可组合的生成、清洗、过滤、评估算子；有 PDF/文档知识清洗与 QA 流程 | 可参考加工算子与中间结果；[PDF2QA](https://opendcai.github.io/DataFlow-Doc/en/guide/r51ooua8/)的清洗、QA 生成是特定加工路线，生成问答和训练数据不自动等于外挂知识包 |
| [LlamaParse/LlamaCloud](https://developers.llamaindex.ai/llamaparse/) | Parse、Extract、Classify、Split、托管 Index；提供 TypeScript SDK | 商业能力与成本对照。按 schema 抽取和通用文档解析分开，产线可按目标选择；标准云 API 涉及资料上传，不符合本项目默认本地处理边界 |
| [Microsoft GraphRAG](https://microsoft.github.io/graphrag/index/default_dataflow/) | 文本单元、实体关系抽取、社区聚类与摘要，输出有关联的知识表；可选 claim 抽取 | 适合验证跨文档关系和主题综合。默认实体合并依据名称与类型，不能把它直接当成可靠的跨来源实体消歧或冲突裁决 |
| [Cognee](https://github.com/topoteretes/cognee) | 文档接入、图/向量存储、Agent 记忆读取和反馈更新，支持本地部署 | 可对照 Agent 获取资料与关系的方式；其持续变化的记忆生命周期，与固定版本知识包的交付生命周期需要单独评估 |

补充观察：[Agent Wiki / OKF](https://github.com/xinhuagu/agent-wiki)探索 raw、wiki、schema、index、evidence 与 manifest 的便携目录形式。项目将其描述为 v0.1 格式路径；本次没有取得广泛跨产品互通的证据，保留为格式观察项。
### 与外挂形态最相关的证据
RAGFlow v0.27.1 的知识编译已经进入正式发布。其 [版本记录](https://github.com/infiniflow/ragflow/releases/tag/v0.27.1)包含 Wiki 编译、模型配置和导航修复。[Skill 生成器](https://github.com/infiniflow/ragflow/blob/v0.27.1/rag/svr/task_executor_refactor/dataset_skill_generator.py)按文档生成摘要，聚类为层次树，再将节点 Markdown 和树 JSON 写入文档引擎；[Dataset API](https://github.com/infiniflow/ragflow/blob/v0.27.1/api/apps/restful_apis/dataset_api.py)提供整树与单页读取。本次核实到平台内生成与读取，未验证包含原件、资源和兼容说明的完整独立包导出。

[Corpus2Skill 论文 v4](https://arxiv.org/abs/2604.14572v4)更直接讨论离线编译和在线导航的分工：有明确主题结构的有限语料适合层次导航，开放事实集合和同质表格语料可能更适合检索。论文的 11 数据集结果为 5 胜、3 平、3 负，因此“全部数据统一转 Skill 树”仍缺乏采用依据。其源码声明 Alpha；本轮只把它列为方法与形态候选。
### 运行、许可证与维护快照
以下版本/日期通过 2026-09-03 GitHub 官方 API 的仓库及 latest release 信息核对；表示调研时的发布状态，不是本项目已安装版本。9 个主要项目中，下表的 8 个代码仓库均未归档；LlamaParse/LlamaCloud 按商业服务核对。

| 候选 | 许可证与维护快照 | Node/TypeScript、本地与部署成本 |
| --- | --- | --- |
| RAGFlow | Apache-2.0；[v0.27.1，2026-08-28](https://github.com/infiniflow/ragflow/releases/tag/v0.27.1) | TS 应用可走 HTTP；包含 Python 加工运行时与多个存储服务。README 给出 4 核/16GB/50GB 基础要求，预构建镜像为 x86，ARM64 需另建；不适合直接视为轻量嵌入库 |
| Docling | MIT；[v2.124.0，2026-08-31](https://github.com/docling-project/docling/releases/tag/v2.124.0)；模型另有许可 | Python 核心，[官方 docling-serve](https://docling-project.github.io/docling/usage/api_server/)可隔离为 REST 服务；官方声明支持 macOS/Linux/Windows、x86_64/arm64。本地模型与 OCR 依赖须预置，资源要求按材料验证 |
| Unstructured | Apache-2.0 库；[0.27.5，2026-08-28](https://github.com/Unstructured-IO/unstructured/releases/tag/0.27.5)；商业平台另计 | Python 库可本地处理，TS 使用 API 侧接口；[官方仓库](https://github.com/Unstructured-IO/unstructured)提供多架构容器说明。不同格式引入不同系统依赖，开源与商业增强能力分别验证 |
| Dify | [附加条件许可证](https://github.com/langgenius/dify/blob/main/LICENSE)，多租户服务等有额外条件；[1.17.0，2026-08-25](https://github.com/langgenius/dify/releases/tag/1.17.0) | 自部署平台及 HTTP API；是否离线取决于使用的模型/插件。会增加独立平台和存储运维，实际商业分发先核对许可条件 |
| DataFlow | Apache-2.0；[v1.0.10，2026-03-26](https://github.com/OpenDCAI/DataFlow/releases/tag/v1.0.10)，主分支 2026-08-18 仍有更新 | Python >=3.10，[官方安装](https://opendcai.github.io/DataFlow-Doc/en/guide/install/)区分 API/CPU 与本地 GPU。TS 直接嵌入证据不足；引入 Python 或独立处理服务须有单独收益验证 |
| Corpus2Skill | MIT；[包声明](https://github.com/dukesun99/Corpus2Skill/blob/main/pyproject.toml)为 0.1.0 / Alpha；2026-08-21 有更新 | Python >=3.10，编译依赖 sentence-transformers 和 LLM；默认 SDK 依赖 Anthropic。目录可携带，完整离线加工与跨 Agent 兼容尚未验证 |
| GraphRAG | MIT；[v3.1.2，2026-08-21](https://github.com/microsoft/graphrag/releases/tag/v3.1.2) | Python 加工管道；模型、嵌入、图抽取与摘要分别消耗资源。TS 接入需读取产物或服务适配，不能把开源代码等同零模型成本 |
| Cognee | Apache-2.0；[v1.5.3，2026-08-23](https://github.com/topoteretes/cognee/releases/tag/v1.5.3) | Python 核心，支持 HTTP/MCP；本地开发使用 SQLite/LanceDB/图存储等，生产后端组合与隔离能力须逐项验证 |
| LlamaParse/LlamaCloud | 商业服务；官方 TypeScript SDK 可用 | 云 API 对照；[定价](https://developers.llamaindex.ai/llamaparse/general/pricing/)区分解析、抽取、索引与存储，例如 v2 解析为 1/3/10/45 credits 每页，抽取另按选定档位叠加。未取得符合本项目本地离线边界的部署报价与验证 |

以上均未在本项目安装、执行或上传真实资料。升级与退出成本需通过原型检查：能否导出结构化内容与引用、能否重建索引、是否绑定内部 ID/模型维度/服务 API、升级是否要求全量重算。固定版本和清晰中间产物应作为比较条件。
### 加工路线的调查结论
以下是跨产品归纳出的候选工序与适用条件，不是冻结的架构；并非每份资料都执行所有分支。

| 工序 | 产出与目的 | 可复用依据及待验证点 |
| --- | --- | --- |
| 输入登记与分类 | 固定输入范围，保留来源、格式、时间、哈希和引用 | 复用本项目 Source Dataset 原件与血缘。PDF、网页、图片、表格分别统计，失败和缺失仍可追踪 |
| 结构保真解析 | 文档元素、段落、标题、表格、图片和位置 | Docling/Unstructured；比较中文、复杂表格、OCR、否定句、单位与脚注保留情况 |
| 清洗与组织 | 正文、重复分组、层次、原文映射、质量标记 | 比较规则处理与 DataFlow 类算子；区分相同内容重复和不同版本，避免清洗抹去差异 |
| 文档检索路线 | 带所属文档/章节背景的片段及检索索引 | Dify/RAGFlow；[Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)提供补充片段上下文及关键词/向量组合的原型依据 |
| 知识编译路线 | 按需要生成结构化字段、实体关系、主题页或导航树 | LlamaExtract、GraphRAG、RAGFlow、Corpus2Skill；选择应由资料结构和使用任务决定，生成内容保留来源与不确定性 |
| 质量检查 | 缺失、冲突、证据断链、抽取错误与使用效果报告 | 文档/字段检查加人工标注样本；[RAGChecker](https://github.com/amazon-science/RAGChecker)的检索与生成分项评测可作方法参考，模型评判仍需人工校准 |
| 成品封装与挂载验收 | 有版本、目录、内容、引用和读取说明的产物 | 下述封装标准与接口分别验证；实际测试拷贝、加载、引用回查、更新和回滚 |

由此建议首先验证“保留原文结构、按资料选择加工方法、产物带证据和版本”这一方向。摘要、QA、图谱、向量和导航树分别承担特定作用；是否进入某类知识包，需要用本项目任务证明收益。
### 知识包封装与 Agent 读取
| 已有规范/形态 | 已覆盖能力 | 对本产品仍需验证的部分 |
| --- | --- | --- |
| [Frictionless Data Package 2.0](https://datapackage.org/standard/data-package/) | 用描述文件管理资源、版本、来源与许可，可包含本地文件或远程资源；资源类型不限表格 | 可作为通用数据封装候选；Agent 读取行为、衍生事实粒度与索引兼容需要产品约定 |
| [RO-Crate 1.3](https://www.researchobject.org/ro-crate/specification/1.3/introduction.html) | 用 JSON-LD 描述文件、来源、参与者、生成过程与复用信息 | 可作为来源与加工血缘封装候选；验证表达收益是否值得额外复杂度，以及离线元数据处理 |
| [Agent Skills](https://agentskills.io/specification) | SKILL.md 与按需读取的 references/assets，描述使用方式和支持材料 | 可提供面向 Agent 的入口；仍需逐一验证宿主、规模、附件和资料更新支持 |
| [MCP Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources) | 统一列举与读取资源，资源可以是文本或二进制 | 属于访问接口；宿主如何把资源带入上下文由应用决定，文件包与检索服务仍需要实际实现和验证 |

本次样本显示“流水线配置”“处理后的知识产物”“Agent 接入接口”各有成熟实践，但尚未核实上述候选存在一份覆盖全部内容、证据、索引、版本并跨任意 Agent 即插即用的共同成品标准。应先验证成熟封装与读取能力的组合，不能据此直接批准自建包格式或运行时。

2026-09-03 按负责人要求核查本机 `opencode-dev`：分支 `codex/runtime-surface-spec`，HEAD `d81ab569`，包含未提交工作区。源码 `vertical-runtime/authoring-registry.ts:305,448` 从本轮已启用 UI package 解析有效协议并生成上下文，`host-runtime/main-authoring-turn.ts:83` 将其自动装配为当前任务；ADR-0063 明确视觉优先使用属于生成规则，ADR-0065 的后备展示以实际工具结果为前提。`runtime-adapters/adapters/pi-agent-session-factory.ts:87` 将 Agent 声明的工具传入 Pi，`pi-agent-session-tools.ts:19` 调用同一 executor 并发出执行事实；`pi-agent-session-runtime.ts:318` 的 ResourceLoader 返回空 Skills。`verticals/perfume/agent.ts:74` 已声明本地资料工具，`tools/perfume-material-tools.ts:118` 实现按需查询与读取，索引属于派生状态。负责人明确正式知识包启用后应自动成为相关问题的优先知识来源；候选方向是版本化内容包加宿主的启用记录、受信任使用规则和查询/读取工具，避免将整包正文常驻上下文。本期范围限定为 domain-analysis 内的版本化知识包生产、管理界面与成品交付；此核查只作为消费需求参考。宿主启用、版本切换和优先查询约束归入后续跨工程接入，届时需自然提问实测；本轮未改宿主或运行模型测试。
### 原型通过门与候选处置
推荐优先比较 RAGFlow 的完整知识编译、Docling/Unstructured 的结构保真解析，以及 Corpus2Skill 的目录导航形态；Dify 提供流程配置对照，DataFlow 提供加工算子对照，商业服务提供能力/成本对照。GraphRAG/Cognee 在跨文档关系或动态记忆有明确需求时加入针对性比较。

首轮固定输入为本机 Source Dataset 的 4 个型号、11 份 HTML 和 12 张去重图片，覆盖来源分类、颜色标签、原文缺单位、不同功率和来源明确无图片。固定 ID 与校验规格见 [KNOWLEDGE-PACK-SAMPLE-INPUT.md](KNOWLEDGE-PACK-SAMPLE-INPUT.md)。样本用于文字提取与来源保真，尚不覆盖 PDF、跨来源冲突或跨品类泛化；实作评审与工序合格条件见 [KNOWLEDGE-PACK-PROCESSING.md](KNOWLEDGE-PACK-PROCESSING.md)。当前缺口集中在内容入包筛选、样本之外的解析与验收、可重复建包和失败记账，下一步据此比较组件与分工。

后续按真实输入需要扩展文本 PDF、扫描/图表 PDF、表格、跨来源版本与冲突材料。资料始终采用已授权本地材料或公开许可样本；扩展后的消费任务再覆盖定位原文、精确查值、跨文档综合与证据不足四类。
### 首轮成本与停止门
- 复用：Source Dataset 不可变快照、Subject/分类/血缘、现有 Cheerio 与 Node 哈希校验；新增代码只允许承担样本选择、来源规则和成熟组件之间的薄适配。本机 OCR 候选实验见 R-015，生产加工模块与成品技术选型继续保持待确认。
- OCR 专项调研先核对候选的官方实现、维护与许可证、模型下载体积、中文能力、macOS ARM64 与 Linux 支持、Node/TypeScript 接入以及离线依赖，再进入安装和微基准。本机为 M1 Pro、8 核、16GB；本机实测及平台限制见 R-015。
- 建议实验预算：最多比较 2 个成熟 OCR 候选；每个先处理 3 张图，记录模型下载、冷启动、处理耗时和峰值内存；单图 30 秒超时、连续 2 次相同环境错误即停该候选。小样可运行后扩到固定 12 张，避免先处理整批 2,685 个不同图片内容。这是建议的实验上限，不是性能实测结论。
- OCR 输出可读文字与位置；文字转写、字段配对与可用性分别核验。拟采用的关键数值与单位须有复核依据，错误、无法辨认和未检出文字分别记账；完整准确率评估需另备人工金标。已明确的 HTML/OCR 歧义字段及相互冲突的值都进入独立待核材料，合格内容才进入回答包；当前样包只添加标签，尚未实现该入包筛选。
- HTML 的数值、原字段标签、单位与来源缺失标记按输入报告逐项检查，全部通过才封装。图片分类仅辅助筛选，OCR 成功返回或置信度高均不自动等于内容可信。
- 本小样先以规则提取组织文字，模型 token 集中计在 Codex 消费试验；原始文字基线采用 HTML 转写与同一版 OCR。已完成 6 个 HTML 问题两组共 12 次运行；原计划的 2 个 OCR 消费问题未运行。文字消费按固定转写核对，人工图片金标另用于识别准确率；当前转入工序评审与组件方案，不追加模型运行，复杂评测在工序稳定后展开。
- 消费目录只提供文字、来源索引与 Skill 入口；原图保留在 Source Dataset 供人工回查。实际工具轨迹仅读取文字才计入本次通过数，答案基准位于消费目录外。下一版包按歧义隔离规则调整消费验收，原实验规格与结果保留；现有图片副本尚未接入 ZIP，不能计作完整附件交付。
### 扩展验证维度
| 验证维度 | 必须取得的证据 |
| --- | --- |
| 信息保真 | 人工标注样本中的数值、单位、否定、条件、表格关联及图文对应；记录错误与遗漏 |
| 来源追踪 | 加工内容可返回原 Snapshot/Asset 与段落、页或区域；摘要与推断有明确身份 |
| 质量与使用 | 固定任务的证据召回、答案依据、歧义隔离和资料不足处理；同时报告人工复核与模型评测 |
| 可重复生产 | 固定输入、工具/模型/规则版本；重跑、中断、失败隔离和输入增量有清晰结果；LLM 重跑不假定逐字一致 |
| 包可携带 | 隔离目录或另一环境加载；附件与证据链接完整，显式报告外部服务/模型依赖，索引能重建或兼容读取 |
| 宿主适配 | 首轮在 Codex 中显式调用 Skill，核对按需读取、引用回查和 token；跨宿主交付另用第二种预期宿主验证同一份内容 |
| 成本与平台 | 记录按页/文档/token 的耗时、模型费用、内存与存储；开发机及 Linux，声明 Windows 支持时补 Windows |

首轮范围与宿主按上文执行；加工组件的离线能力需在依赖和模型预置后断网验证，Codex 推理的网络条件单独记录。扩大包覆盖、目标平台和跨宿主交付时补充对应实测门。通用解析、工作流、索引与包管理继续优先验证成熟方案，候选通过与当前产品约束一致的原型后才进入选型结论。
### 本轮 Baseline Impact
- touched modules: 调研与进度、输入证据、独立样包组装/消费实验脚本；生产模块未修改
- owning fact source: 原始数据仍归 Source Dataset；阶段 2 衍生产物的拥有者待设计确认
- public interface changed: no
- new protocol/adapter/fallback: 仅实验 adapter，复用 Cheerio、Node crypto、execa/ndjson、官方 Agent Skills 与仓库锁定 Codex CLI 0.147.0；不增加生产协议或 fallback
- compatibility or legacy path changed: no
- research update required: yes；[官方 Skill](https://developers.openai.com/codex/skills)支持目录与按需 references，[官方非交互运行](https://developers.openai.com/codex/noninteractive)提供 ephemeral、JSONL 轨迹和 usage。既有生产 App Server adapter 关闭文件工具且不返回 usage，本轮隔离实验直接使用官方 CLI；独立目录、只读、关闭搜索/图片/插件/记忆，核对实际读取轨迹。
- 消费实验固定当前配置的模型 gpt-5.6-sol，两组均 low 推理；每题独立 ephemeral 运行，单题 120 秒，执行错误不重试、连续两次错误停止。金标与输出位于消费目录外；OCR 文字消费与原图识别准确率分别记账。实验代码仅承担本样本来源规则、成熟组件组装与证据记账；本轮工序评审仅更新文档，不增加实现或模型调用。
- architecture or ADR update required: no，当前只有产品目标澄清和候选研究，未冻结模块、依赖方向或契约
- tests and real-surface validation: 样包 77 字段/92 行 OCR 保真、11 HTML 与 12 图哈希、Skill 格式通过；6 HTML 问题两组共 12 次真实消费与引用/轨迹均通过，六题加工组累计输入 token 减少 37.9%（非缓存减少 19.1%）、耗时相近。2 OCR 消费题未运行。选样、标定与复核人时未完整计量，整体加工成本待测；小样证据见 KNOWLEDGE-PACK-SAMPLE-REPORT.md，工序审查不扩大既有通过范围。
## R-015 本机图片文字提取原型
调研日期：2026-09-03。状态：本机 CPU 与离线运行通过固定小样实验；文字质量待人工复核，技术候选保持原型阶段。
### 简单说明
在独立 Python 环境中，以 CPU 执行轻量 OCR，将图片转换为带位置、置信度与来源标识的文字候选；记录安装、模型体积、启动、处理时间和内存。先取 3 张，再按运行结果扩到固定 12 张。图片内容正确性以人工对照原图为验收依据。
### 候选、依据与边界

| 对象 | 官方证据与本轮用途 |
| --- | --- |
| RapidOCR 3.9.2 | [官方用法](https://rapidai.github.io/RapidOCRDocs/main/install_usage/rapidocr/how_to_use_ppocrv5/)支持显式使用 PP-OCRv5 mobile；[3.9.2 许可证](https://github.com/RapidAI/RapidOCR/blob/v3.9.2/LICENSE)为 Apache-2.0，PyPI 该版本发布于 2026-07-21。本轮只复用 OCR 调用与结果输出 |
| ONNX Runtime 1.29.0 CPU | [官方 Python 入口](https://onnxruntime.ai/docs/get-started/with-python.html)，MIT；PyPI 提供 Python 3.12 的 macOS ARM64、Linux x86_64/aarch64 安装包，安装包存在性不代表本项目已通过平台实测 |
| PaddleOCR 的 PP-OCRv5 mobile | 沿用 PaddleOCR 模型，以 RapidOCR + ONNX Runtime 为调用库和推理后端；[官方锁定模型清单](https://github.com/RapidAI/RapidOCR/blob/v3.9.2/python/rapidocr/default_models.yaml)提供下载地址和 SHA-256。检测 4,819,576 bytes、识别 16,631,306 bytes，加 PP-OCRv4 文字方向模型 585,532 bytes，合计 22,036,414 bytes；下载字节另核对哈希 |
| PaddleOCR 官方 Python 管线 | 成熟对照候选，提供完整 OCR 管线；本轮按已讨论的 RapidOCR CPU 组合先验证，尚无两者速度或准确率的项目实测对比 |

- PP-OCRv5 mobile 的[官方检测模型](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det)与[官方识别模型](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec)均声明 Apache-2.0；本轮使用 RapidOCR 官方清单提供的 ONNX 转换文件及固定哈希。
- 运行条件：当前 Mac 为 M1 Pro、8 核、16GB；隔离 Python 3.12，固定模型路径和 CPU 后端，单图串行，限制推理线程。现有 Node/TypeScript 项目通过离线实验文件读写衔接 Python，尚不增加生产接口。
- 本地边界：依赖及模型下载完成后，用系统网络隔离执行 OCR；输入只从本机 Source Dataset 读取，来源与内容哈希随结果保留。原图、模型、环境和未经人工复核的 OCR 文字存放于 Git 忽略的 data/ 区域。
- 质量边界：OCR 空结果记为“未检出文字”，不能直接判定原图无文字；置信度只作排序线索。人工金标未完成时，只报告可运行性、耗时和内存，保持正确率门待验收。
- 升级与退出：版本、模型哈希、参数及依赖清单固定；输出保留文字和位置，可替换 OCR 引擎重跑同一批输入。模型文件大小与峰值内存分别计量。
- 测试边界：本轮执行真实 3/12 图实验与网络隔离复跑；目标 Linux/Windows 的安装及运行另行验证，不用 macOS 结果替代。
### 本机实测结论

- 独立 Python 环境安装 21 个依赖约 40.28 秒，落盘约 281.35 MiB；三个模型约 21.02 MiB，下载文件均通过 SHA-256 校验。
- 12 张图单次 OCR 共 3.671 秒，平均 0.306 秒/图，进程峰值 RSS 1.178 GiB；独立进程复跑为 3.700 秒、1.172 GiB。两次得到相同的 92 行文字、位置和置信度，实际图片处理均受系统 deny network* 约束。
- 首次完整运行触及 30 秒总预算，定位栈停在 cv2 原生模块加载；后续依赖检查、3 图与两次 12 图运行成功。首次加载缓慢的具体原因尚未确认，保留启动风险，不能把后续约 0.4 秒初始化当成首次安装保证。
- OCR 的“46道自动菜单”与同型号 HTML 的“58道菜单”形成待核差异；输出均保持 pending_human_review。置信度和重复一致性不替代人工金标，完整文字准确率尚未验收；内容入包规则按 R-014 执行。
- 详细输入、逐图指标、启动证据、原图对照页与复跑入口见 [OCR-SAMPLE-REPORT.md](OCR-SAMPLE-REPORT.md)。本轮结论仅覆盖 Mac 上的固定小样，支持继续做文字质量复核。
### Baseline Impact

- touched modules: 独立本机 OCR 实验、调研与进度、输入核验报告；生产模块未修改
- owning fact source: Source Dataset 的 Snapshot、Asset、Subject 与来源关系
- public interface changed: no
- new protocol/adapter/fallback: yes，仅官方 Python OCR 结果到本机实验文件的薄适配；生产协议无变化
- compatibility or legacy path changed: no
- research update required: yes，本节先登记候选证据与原型边界
- architecture or ADR update required: no，本轮为阶段 2 小样实验，未改变模块职责或依赖方向
- tests and real-surface validation to run: 本轮已完成模型/输入哈希、实际 CPU 执行、启动/逐图时间、峰值内存、网络隔离、两次 92 行一致性与结果结构；人工文字复核独立记账

## R-016 导出图片去水印小样

调研日期：2026-09-03。状态：字形与边界保护的 2 图小样效果已获负责人确认；批量自动处理仍待验证。

简单说明：原图分别用于文字提取和生成去水印副本；人工对照通过后，副本才能作为导出图片。加工结果保留原图身份、处理区域和方法。

- 复用组件：[OpenCV inpaint](https://docs.opencv.org/4.13.0/df/d3d/tutorial_py_inpainting.html) 的 Telea / Navier-Stokes 两种局部修补，以及现有 RapidOCR。固定环境已包含 opencv-python 5.0.0.93，不新增依赖或模型。OpenCV [官方发布页](https://github.com/opencv/opencv/releases)持续维护，4.5 及以后采用 [Apache-2.0](https://opencv.org/license/)。
- Node/TypeScript 边界：[官方 OpenCV.js 支持 Node](https://docs.opencv.org/4.13.0/dc/de6/tutorial_js_nodejs.html)；本次直接复用已获授权的 Python OCR 环境，正式 TS 接口和 OpenCV.js 算子覆盖尚未验证。
- 候选比较：以同水印、平滑背景样本构建字形 mask，复用 OpenCV [形态学](https://docs.opencv.org/4.13.0/d9/d61/tutorial_py_morphological_ops.html)与[模板匹配](https://docs.opencv.org/4.13.0/d4/dc6/tutorial_py_template_matching.html)；字形内填补仍可能扭曲边缘，另比较基于 [W3C source-over 合成关系](https://www.w3.org/TR/compositing-1/#simplealphacompositing)和 OpenCV 数组运算的透明度模板校正。模板仅限同版本、同尺度 ZOL 标记，透明度由平滑背景样本估计，不作为通用恢复能力。
- 定位候选：复用原图 OCR 的 ZOL 文本与位置；必要时仅对右下角放大 OCR。定位不足的图片保持待标注，不根据“通常在右下角”直接抹除整块内容。来源文字匹配是此次 ZOL 小样规则，不是通用水印识别契约。
- 本地与安全：图片处理进程禁止网络，原图只读并核对哈希；输出 PNG 副本、mask 和本机对照页放入忽略的 data/。视觉模型不参与，产品参数仍来自原图 OCR。
- 验证门：先用负责人指出的 1406483-I3 建立边缘偏移回归，参考水印上、下未遮挡的直边，验证旧副本失败；新副本检查字形外像素、边缘偏移、水印残留和局部视觉效果，通过后复用到另一张已定位图。原图 OCR 结果继续复用。
- 结构保护候选：对本图可由未遮挡部分确认的直边，分别在两侧调用 OpenCV 局部修补，限制颜色跨边界填入；边界位置作为显式样本标注，不能声称已实现批量自动边界识别。模板、原图和边界检查坐标均留有来源记录。
- 部署与退出：本轮只验证 Mac；Linux/Windows 尚未实跑。版本与输入哈希固定，输出采用 PNG/JSON，替换修补方法时复用相同输入和 mask；本轮不改变生产包格式。

Baseline Impact:
- touched modules: 独立素材实验脚本、OCR 报告、调研与进度
- owning fact source: Source Dataset；输出是有来源的本机实验副本
- public interface changed: no
- new protocol/adapter/fallback: yes，仅成熟 OCR/OpenCV 与实验文件之间的薄适配
- compatibility or legacy path changed: no
- research update required: yes，本节登记候选与通过门
- architecture or ADR update required: no，架构影响为澄清
- tests and real-surface validation to run: 离线真实图执行、原图哈希、mask 外像素、文字区域交集、对照页资源与人工效果复核

已验事实：12 张原图 OCR 4.081 秒、92 行，与前次一致；角落 OCR 2.404 秒，仅定位 2 张。首轮 4 个 PNG 的矩形外像素不变，但截图证实矩形内机身边缘变形，视觉门失败；10 张位置待确认。详细证据见 OCR-SAMPLE-REPORT.md。
Patch Disposition：保留原图、OCR、来源与首轮失败对照；重写脚本中的整块矩形 mask 及当前效果页说明；首轮产物作为失败证据，不用于导出。来源模板参数与具体边缘验收坐标仅保存为小样数据，成熟组件承担图像运算，不新增生产能力。
本轮采用：平滑背景样本估计字形（2,741 像素），模板匹配后按显式边界分区调用 OpenCV；形态学字形填补仍发生边缘漂移，透明度校正留有淡字，均只保留实验对照。边缘最大偏移由旧 13/20 像素降至当前 0/0，4 个副本字形外像素不变；2 图定位与修补约 0.020 秒，进程外部墙钟 0.588 秒。负责人已确认当前展示小样的视觉效果合格；该结果依赖样本标定，批量自动处理仍待验证。

## R-017 建设产线组件与接入原型

日期：2026-09-03。状态：组件原型证据保留；队列、缓存、ZIP、PDF 与界面结论继续适用，发布格式以 R-018 和 ADR-002 为准。承接 Source Dataset 只读边界。

简单说明：本节验证队列、缓存、解析、ZIP 和审核隔离所需的成熟组件；标准 Skill 成品及领域消费形态见 R-018。

| 能力/候选 | 官方依据、维护与许可证 | Node/本地、部署与退出 | 本轮处置 |
| --- | --- | --- | --- |
| Data Package 2.0 | [描述文件](https://datapackage.org/standard/data-package/)、[官方 schema](https://datapackage.org/profiles/2.0/datapackage.json)；规范页更新 2026-08-25 | JSON 描述任意文件；没有运行服务依赖，内容用 Markdown/JSON/PNG 可独立读 | 已完成通用清单原型；不能表达 Agent 触发与查询入口，新版本由 R-018 的标准 Skill 承载 |
| RO-Crate 1.3 | R-014 已核对 JSON-LD 来源与生成过程表达 | 需要额外词汇映射；当前需求能先用 Data Package 资源与产品来源记录验证 | 保留复杂科研血缘场景对照，当前原型不引入 |
| fflate 0.8.3 | [官方仓库](https://github.com/101arrowz/fflate)，MIT；npm 当前版本已核对 | 纯 JS/TS、Node/浏览器、离线；支持 ZIP 与流式输出；固定 mtime 可做可重复封装 | 小包先验证有界内存；生产放量前验证流式内存和取消 |
| Ajv 8.20.0 / ajv-formats 3.0.1 | [官方 JSON Schema](https://ajv.js.org/json-schema.html)，MIT | Node、离线 schema 校验；只预置可信官方 schema，不解析来自包的远程 schema | 用于隔离 Data Package 原型；标准 Skill 改用自身结构校验后不作为生产直接依赖 |
| PDF.js 6.3.289 | [官方 Node 示例](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs)，Apache-2.0；npm 当前版本已核对 | Node >=22.13 或 >=24；optional canvas 有原生依赖，当前只做本地文字与位置解析 | 与 R-014 Docling/Unstructured 对照；文字层不等于表格关系正确，复杂版面保持待核 |
| cacache 20.0.4 + canonicalize 3.0.0 | 现有锁定依赖；[cacache](https://github.com/npm/cacache) MIT，完整性校验及并发写入 | 缓存键包含输入哈希、工具/配置；缓存可丢弃，版本成品单独保留 | 用真实重复提取验证命中与配置变化失效 |
| Graphile Worker + Drizzle/PostgreSQL | R-002 已接受；[job key](https://worker.graphile.org/docs/job-key)、[事务](https://orm.drizzle.team/docs/transactions) | 复用部署；现有队列绑定采集命令，不能直接承载加工语义 | 拟新增加工命令与持久记录；不新增通用调度框架，契约需确认 |
| React/Radix/TanStack Query | 当前 Web 已采用；[Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)、[Query](https://tanstack.com/query/latest/docs/framework/react/overview) | 本地 UI；焦点、请求缓存与轮询复用现有能力 | 隔离界面表达原料、加工、审核、版本；领域结果由后端投影 |

原型边界：源码与独立依赖锁位于 `.scratch/knowledge-processing/prototype/`；输入与结果位于忽略的 `data/knowledge-processing-prototype/`。不注册生产路由、不迁移正式数据库。复用原始 Source Dataset 与既有样包证据；原型数据和情景演示均明确标识。

输入和预算：固定 4 型号 HTML、12 图的已有 OCR 与修补证据；另选现有任务中的最多 2 份 PDF 与 1 个新型号参数页。只读本机 API；单资源 20 MiB、PDF 前 5 页、单文件 30 秒、连续两次相同环境错误停止该候选。加工/消费 LLM 调用为 0；不新增模型下载。图片不重新生成，复核既有副本的哈希和准入边界。

通过条件：官方描述文件 schema 通过；文字与附件相对路径可离线读取；已知歧义的各副本及承载它的图片都不入消费包；2 次同输入生成一致文件/ZIP，缩小输入无残留；旧版本在新构建失败后哈希不变；缓存只在输入和配置一致时命中。PDF 逐页保留文字与位置，对照渲染检查阅读顺序、表格、单位和否定；不足时保持人工审核候选。

平台门：当前 Mac 实跑；Linux/Windows 安装与运行尚无证据，不宣称支持。隔离依赖不进入生产 workspace；正式引入任何原生 optional 依赖前补对应平台验证。安全门：原始 HTML 不直接渲染，原件与待核值不进入 ZIP；只生成固定相对路径；导出采用文件清单白名单，来源 URL 只供回查。

Baseline Impact: touched modules 为隔离原型与 PRD/RESEARCH/PROGRESS；owning fact source 仍为 Source Dataset，加工拥有者是待确认设计；public interface changed=no；new protocol/adapter/fallback=仅实验适配；compatibility changed=no；research update=yes；architecture/ADR update=no（正式职责待确认）；验证为真实本机文件、UI 与隔离 ZIP。已有脚本和样包全部保留。

原型结果（2026-09-03）：Mac arm64 / Node 24.12.0，12 HTML 使用同一来源 adapter，其中 1 份是新增型号 1406343；重复调用全部命中缓存，规则版本变化产生新键。两版 ZIP 分别 713,798 / 710,592 bytes，内容 81 / 45 条，各含 1 PNG；第 2 版缩减三个旧型号并增加新型号。同输入重复构建 ZIP 哈希一致，失败后旧版哈希保持。机器热缓存运行 1.61 秒，模型调用/token 均 0，人工历史成本未计量。

准入结果：92 行 OCR 与一个冲突 HTML 字段留在审核区；2 个既有效果合格副本中，I2 来源宣传图经过本轮型号/来源对照进入实验包，I3 性能图继续待内容复核，其余 10 图待标定。已知菜单冲突映射是显式样本资料；原型测试证明事实组和依赖传播到正文、目录、来源与图片，不等于自动发现任意冲突。官方 schema、ZIP 文件白名单、CRC、bytes/hash、相对引用和来源 ID 完整性均通过，其中 ZIP/引用另以 Python zipfile 独立核验。

PDF.js 实跑：技术论文 9 页/本次 5 页/1,305 文字项，0.17 秒、峰值 RSS 154.8 MB；说明书 63 页/本次 5 页/9,184 项，0.27 秒、175.3 MB。进程退出 0，位置与文字保留；与实际渲染对照发现说明书控制字符和图表读序问题，论文包含页眉/正文混排。采用为底层文字位置候选，自动正文准入门尚未通过；继续评估 R-014 的成熟版面方案，当前不增加自研 PDF 阅读顺序推断。

部署证据：隔离 npm 11 lockfile v3 安装、6 项准入/版本/封装测试、UI TypeScript 检查和 Vite 构建通过；PC 浏览器已走查选料、预算、停止继续、审核、版本切换、必需项门和确认下载。初次 shell 误选 Node 21/npm 6 已改为明确的 Node 24/npm 11 安装；PDF v6 清理改用官方 loadingTask.destroy，后续两次运行均正常退出。Linux/Windows 与生产 Worker 中断恢复仍待验证；详细复跑入口和界面边界见原型 README。

开发界面复用 [Vite 5 官方 HMR dispose](https://v5.vite.dev/guide/api-hmr#hot-dispose-cb) 释放入口的 React 根节点；连续两次文件更新后页面可操作，浏览器未新增错误。正式生产构建移除该开发态清理分支；此次修正只涉及隔离原型的根节点生命周期。

建设 B 事务边界：复用 Graphile 官方 [SQL add_job](https://worker.graphile.org/docs/sql-add-job)，将固定输入/运行记录与入队置于同一 Drizzle 事务；固定 knowledge_processing queue、单并发，业务逐件失败由加工记录拥有。PostgreSQL advisory lock 检查真实在途执行，只有持锁进程已退出才记为中断并释放相应 Graphile 锁，复用当前来源队列的验证模式。Python 子进程取消与预算复用 [Execa termination](https://github.com/sindresorhus/execa/blob/main/docs/termination.md)，原图/模型哈希固定；正文默认待核，图片按显式 mask/边界标注调用既有 OpenCV。先验证事务回滚、重复命令、逐件保存、停止和图片像素边界，再接入发布。

建设 B 接入核验：Graphile 的 [jobs 公开视图](https://worker.graphile.org/docs/jobs-view) 通过 `key` 关联产品执行身份；payload 由执行入口接收并经 Zod 收窄。cacache 按 [官方 put algorithms](https://github.com/npm/cacache#optsalgorithms) 显式写入 SHA-256 并核对返回摘要，版本和图片副本保存于 `artifacts/`，可丢弃的机器提取缓存保存于 `cache/`。首次集成测试已发现并修正这两处协议使用差异；当前 4 项持久化测试及全仓构建通过，真实 Worker/图片/Web 验证继续推进。生产直接依赖使用纯 JS 的 fflate/Cheerio；Zod 校验产品边界，本地 Python 环境复用既有已验证版本。

## R-018 标准 Agent Skill 成品与领域消费形态

日期：2026-09-04。状态：已接受并通过本机产物原型；宿主接入保持后续跨工程范围。决策见 [ADR-002](../adr/002-agent-skill-package.md)。

简单说明：发布物采用标准 Skill 目录。简短入口告诉 Agent 何时使用和怎样查询，结构化资料、来源、图片与查询脚本随包交付；Perfume 与 Tutor 的差异留在各自数据和查询逻辑中。

### 官方标准核对

| 项目 | 证据与结论 |
| --- | --- |
| 格式 | [Agent Skills specification](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx) 要求目录至少包含带 YAML frontmatter 的 `SKILL.md`，并约定可选 `scripts/`、`references/`、`assets/`；`name` 与父目录一致，描述同时说明能力和触发时机。采用。 |
| 渐进读取 | 规范将 metadata、`SKILL.md` 正文和按需资源分层加载，并建议入口保持简短。采用“入口说明 + 结构化数据 + 查询脚本”，避免让 Agent 每次加载整批材料。 |
| 校验 | 规范提供 `skills-ref validate`；本机同时使用 OpenAI `skill-creator` 的 `quick_validate.py` 和包内 `validate.mjs`，分别检查标准 frontmatter 与产品引用。 |
| 维护状态 | 2026-09-04 通过 GitHub API 核对 `agentskills/agentskills` 最新提交 `69ef37e9424c`（2026-08-09）及 `openai/skills` 最新提交 `49f948faa925`（2026-06-24），均有近期维护。 |
| 许可证 | `agentskills/agentskills` 根 LICENSE 为 Apache-2.0。产线只实现公开目录规范；包内查询脚本为本项目产品代码。 |
| Node/本地与部署 | 格式本身不要求服务端。当前 `query.mjs`/`validate.mjs` 只使用 Node 标准库，可在解压目录离线运行；宿主只需支持 Agent Skills 或提供等价目录安装入口。 |
| 安全 | ZIP 固定相对路径白名单；不包含 Cookie、Profile、认证 Header、原图、遮罩、未确认 OCR 或内部审核记录。来源 URL 只用于公开回查，不执行远程代码。 |
| 升级与退出 | 版本记录固定全部文件 bytes/hash；查询与 catalog schema 随版本演进。若未来宿主不支持 Skill，JSON、Markdown、PNG 和 ESM 脚本仍可独立迁移。 |

### `opencode-dev` 实例核对

核对基线：`/Users/guojunxi/Desktop/work/opencode-dev`，HEAD `c869b506751f`；该仓库既有未提交 UI 测试改动保持不变。

- Perfume 的权威资源位于 `verticals/perfume/domain/resources/notes.json` 和 `sensory-facet-taxonomy.json`；`verticals/perfume/tools/perfume-material-tools.ts` 使用 Orama 与中文 tokenizer，向 Agent 暴露 search/list/summarize 三种受 Zod 约束的工具。它需要可筛选、可分页、可聚合的结构化目录，而不是逐原件 Markdown。
- Tutor 的 `packages/platform-runtime/src/english-kb/` 从版本化关系数据建立查询库；`evidence-candidates.ts` 按题型、年级和关键词聚合模板、评价标准与知识点，返回精简摘要和完整候选池。它需要保留关系的结构化数据与确定性聚合入口。
- 因此通用交付层采用标准 Skill，领域层保持两种可替换查询：目录型知识映射 search/list/summarize，关系型知识映射 evidence-candidates/graph query。当前微波炉样包采用按对象聚合的 `catalog.json` 和全文查询脚本；不会把 Perfume 或 Tutor 的 schema 固化进通用 contract。

### 本机原型证据

正式 Knowledge Processing 已生成并发布 v3 Agent Skill：8 个文件、714,411 bytes、SHA-256 `7758290f57e50a76d3308cabd4ee22da57b91ee7b82a224b85be5f2be2028a32`。解压后包内 `validate.mjs` 返回 `valid: true`、3 个记录、64 个来源；查询“东芝”返回对应型号、24 条事实、1 张合格图片和精确来源 ID。OpenAI `skill-creator` 的 `quick_validate.py` 返回 `Skill is valid!`。

当前 v3 使用历史冻结的 7 份输入与既有审核决定验证格式迁移和历史保留。新批次选料 contract 已改为完整批次；真实全批次换批加工仍属于建设 D 的扩大样本验收。

Baseline Impact：touched modules 为 Shared、Knowledge Processing、Web、标准 Skill 产物、测试与权威文档；owning fact source 仍为 Source Dataset 原件及 Knowledge Processing 加工事实；public interface changed=yes（批次选料与 Agent Skill 产物）；new protocol/adapter=yes（标准 Skill 导出 adapter）；compatibility changed=yes（历史包只读保留）；architecture/ADR update=yes；验证覆盖本机 ZIP、标准校验、包内脚本和真实页面。Patch Disposition 见 KNOWLEDGE-PACK-PROCESSING。

## R-019 内容与图片自动判断、人工冲突审核

日期：2026-09-04。状态：协议与本机自动处理已通过原型/集成验证；新的完整采集批次扩量属于建设 D。决策见 [ADR-003](../adr/003-knowledge-review-routing.md)。

简单说明：系统自动判断内容归属、OCR 和图片。可靠结果直接采用，其余自动隔离；人只处理必须在多个有效来源之间作事实取舍的冲突。

### 官方能力与复用边界

| 项目 | 官方依据与本轮结论 |
| --- | --- |
| 运行时 | 复用仓库锁定的 [Codex App Server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) `stdio`、ephemeral thread、每 turn `outputSchema`、只读 sandbox 和现有生命周期；不引入第二个 Agent SDK、Provider 或 fallback。问题按最多 32 个、16 份原件分组，累计写入同一审核记录。 |
| 图片输入 | 官方 v2 [JSON Schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.v2.schemas.json) 支持 `image` data URL 与 `localImage`；产线只发送当前问题所需的 Source Asset 原图，不把远程 URL 当模型图片输入。 |
| OCR 证据 | [RapidOCR 官方输出](https://rapidai.github.io/RapidOCRDocs/main/en/install_usage/rapidocr/usage/)将检测框、文字和置信度按行对齐。置信度用于排序和风险判断，模型还必须对照原图、内容归属和当前对象；高置信水印文字仍须隔离。 |
| 图片处理 | [OpenCV 官方 inpaint](https://docs.opencv.org/4.13.0/df/d3d/tutorial_py_inpainting.html)提供 Telea 局部修补。产品只把模型明确选择的 OCR 四边形转为 mask，限制面积不超过原图 10%，并校验 mask 外像素不变；无水印图直接转标准 PNG，处理失败整图隔离。生成副本后，视觉模型再对照原图检查内容完整性、修补痕迹和水印残留。 |
| 结构化输出 | 每个问题返回 `issueId`、`accept/exclude/human_action`、置信度、范围内 `candidateIds` 和理由；图片另返回 `keep/remove_watermark/exclude` 与 mask 候选。Zod 校验覆盖、候选和动作一致性；App Server 将不适用可选字段表示为 `null` 时只在外部 seam 归一化，失败按现有错误最多完整纠正一次。 |
| 安全和退出 | web search 关闭，隔离临时目录不提供文件/MCP/动态工具；输入不含 Cookie、Profile 或认证材料。模型不可用时记录自动阶段失败，合格历史版本保持可用。没有新增依赖；退出时可保留同一准入 contract 替换模型或图片实现。 |

### 自动与人工边界

| 问题 | 处理方式 | 准入结果 |
| --- | --- | --- |
| 稳定 HTML 字段 | 确定性规则 | 结构、值、单位、条件和来源定位通过后直接采用 |
| 加工失败、空内容 | 返回加工 | 没有候选进入包，不生成人工选择题 |
| 非结构化内容、OCR | 自动判断 | 只采用高置信且有当前原件支撑的范围内候选，其余自动隔离 |
| 图片 | 自动处理与视觉验收 | 生成标准 PNG、按 OCR 坐标局部修补或整图隔离；副本保留原图/输出/mask/方法哈希，原图/副本对照不通过时自动隔离 |
| 同字段来源冲突 | 人工整组审核 | 负责人按来源和适用条件保留一个成立值或全部排除 |

### 验证与历史处置

历史正式运行 `knowledge-run-a142f7dd-1c6c-4ec3-a472-e7cb1e735a0a` 的 7 个问题曾由 `gpt-5.6-terra` / medium 完成一次调用，耗时约 91.2 秒；该记录保留审计。它暴露出高置信站点水印仍可能被误判为正文，因此新协议把 OCR 坐标、图片动作和候选范围纳入校验，并以 `automatic-review-2` 指纹隔离旧结果。

当前真实记录 `knowledge-ai-review-be5ce138-4262-4edd-8232-f025784e92b7` 使用 `gpt-5.6-terra` / medium 在 56.376 秒内完成 7 组自动判断，15 个候选采用、38 个排除、0 个未决；视觉对照识别出一张去水印副本的明显修补痕迹并自动隔离，另一张标准 PNG 通过。v4 Skill 为 9 文件、1,730,266 bytes、79 个来源、2 张图片，SHA-256 `426968df4f569a0456a1bc9c0842711dfefa812cc4eaa8dcbbe26000d4ab43a7`；独立 CRC、包内校验/查询、水印文字泄漏和真实 HTTP 下载一致性通过。持久化集成测试覆盖生成副本后的第二次视觉验收；Web 验证逐行控件、修图入口和内部纵向滚动均为 0。新的完整采集批次扩量、token 与支持环境成本仍在建设 D 计量。

Baseline Impact：touched modules 为 Shared、Knowledge Processing、Codex App Server adapter、PostgreSQL、API/Worker、Web、测试和权威文档；owning fact source 为 Source Dataset 原件及 Knowledge Processing 自动/人工处置；public interface changed=yes（自动图片动作、视觉验收与版本化自动判断）；new protocol/adapter=yes（App Server 图片输入、RapidOCR 坐标到 OpenCV mask）；compatibility changed=yes（旧建议只读保留且不参与新准入）；research/architecture/ADR update=yes；版本输入摘要绑定自动建议/人工决定/副本哈希；验证为规则、持久化、实际图片处理、Chrome 页面与 v4 Skill。
