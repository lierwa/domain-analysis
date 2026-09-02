# 技术调研登记

状态：当前采用结论
更新日期：2026-09-02

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
