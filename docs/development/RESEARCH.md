# 技术调研登记

状态：当前采用结论
更新日期：2026-08-31

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
