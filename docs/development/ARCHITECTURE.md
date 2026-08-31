# 数据抓取平台架构基线

状态：完整采集链目标基线
更新日期：2026-08-31

## 简单说明

用户先在 Workbench 说明要调查哪个标准商品门类。系统通过采访确认业务范围和覆盖策略，再调查 ZOL 门类品牌排行榜与入选品牌目录，按已确认规则生成执行品牌集合和可审核计划。负责人确认计划并明确 Start 后，后台 Worker 执行抓取，Source Dataset 保存原始页面、图片和完整血缘。

## 目标数据流

```text
Workbench Chat Timeline
  -> Category Interview
  -> confirmed Markdown Capture Task Draft
  -> Capture Task materialization
  -> Planning Run
       -> official category chain and brand ranking verification
       -> Crawl Plan Draft
  -> human plan confirmation
  -> Confirmed Crawl Plan
  -> Prepare
  -> Start / Resume command (HTTP 202)
  -> PostgreSQL Graphile Worker
  -> Source Execution
  -> Source Provider
  -> Request Ledger + Snapshot + Asset + Lineage
  -> Source Dataset
```

## 模块职责

| 模块 | 职责 | 不负责 |
| --- | --- | --- |
| Category Interview | 保存消息、负责人取舍、采访范围草案和继续上下文 | 决定来源 URL 或执行节奏 |
| Capture Task | 拥有负责人确认的门类、内容范围、品牌筛选规则、品牌批次、每轮型号量和每品牌型号上限 | 具体品牌、榜单快照、来源分页、频率和 Provider 配置 |
| Crawl Planning | 调查来源门类、品牌排行榜、入选品牌目录、Provider 能力和预算，按任务规则生成执行品牌集合 | 执行来源请求或改写任务策略 |
| Crawl Plan | 拥有版本化计划草案、榜单审计、榜单快照、执行品牌清单和预算 | 运行生命周期和响应解释 |
| PostgreSQL Background Command Queue | 持久派发 Start/Resume、自动恢复扫描与命令去重 | 拥有 Source Run 终态 |
| Source Execution | 拥有 Batch、Run、target、work item 与恢复生命周期 | 决定计划范围 |
| Source Access Gate | 持久准入 HTML 与图片请求，执行节奏、预算和访问限制熔断 | 选择品牌或型号 |
| ZOL Catalog + Gallery Provider | 按计划识别品牌目录、型号、参数页、图集和图片关系 | 扩大计划范围或清洗商品参数 |
| Public Resource Transport | 固定公网地址、限制重定向、执行字节上限并返回原始响应 | 控频、业务重试或范围选择 |
| Source Dataset | 保存请求、原始响应、图片资产、引用、血缘、型号完成数和终态 | 标准化或覆盖原始内容 |
| Web | 投影采访、计划、运行进度和 Source Dataset | 推导新的领域状态或直连来源资产 |

## 单一事实源

| 事实 | 拥有者 |
| --- | --- |
| 采访消息、负责人取舍与范围草案 | Category Interview |
| 抓取门类、内容范围、品牌筛选规则、品牌批次、每轮型号量与每品牌型号上限 | Capture Task |
| 规划活动与计划草案版本 | Planning Run / Crawl Plan Draft |
| 品牌排行榜快照、执行品牌目录、访问预算和停止条件 | Confirmed Crawl Plan |
| Start/Resume 命令交付与去重 | PostgreSQL Background Command Queue |
| 实际工作项与执行终态 | Source Execution |
| 请求准入、节奏、冷却和熔断 | Source Access Gate |
| 实际请求和响应 | Source Request Attempt / Raw Snapshot |
| 页面与资源发现关系 | Source Dataset lineage |
| 图片 bytes、MIME、哈希和来源关系 | Source Asset / Resource Reference |

## 规划与确认门

- Planning Run 只接受已确认的 Capture Task revision。
- 品牌、型号、来源入口和 Provider 能力属于系统调查事实；负责人只决定会改变业务范围的真实取舍。
- Planning Run 必须保存可验证品牌排行榜，并从 Capture Task 策略确定性生成执行品牌集合；门类品牌目录不能替代排行榜。
- ZOL Planning Runtime 从 Capture Task 的官方排行榜候选出发，沿“品牌榜 → 品牌目录门类 slug → 门类页 → 排行聚合页 → 品牌榜”反向核对同门类官方链路；GBK 解码、榜单行解析和目录映射由 ZOL adapter 确定性完成，不依赖通用 Agent 的网页工具输出。
- 默认执行品牌由 Capture Task 的规则确定：综合评分大于 `0`，按榜单顺序最多 `20` 个。没有可验证榜单时生成受阻草稿，停在计划确认门，不回退为全品牌或固定品牌。
- Crawl Plan Draft 必须展示来源依据、榜单行与评分、执行品牌、品牌批次、每轮型号量、每品牌上限、捕获单元、预算、恢复策略、停止条件和阻塞。
- 品牌批次只控制同一 Confirmed Crawl Plan 中已经选出的执行品牌分组；默认每批 `3` 个，当前组完成后自动推进下一组。
- 负责人确认生成新的 Confirmed Crawl Plan version；确认计划与 Start 保持为两个独立动作。
- Provider 只执行 Confirmed Crawl Plan，不在运行时增加品牌、型号或来源。

## 执行、恢复与安全边界

- HTML 与图片使用独立节奏槽，并共享 Provider 访问限制熔断。
- 401/403/429、登录、验证码、风险正文和计划外 origin 立即停止当前计划范围。
- 暂时性传输错误、HTTP 502/503/504 和可信 DNS SERVFAIL 最多执行一次有界重试；执行阶段每次尝试都重新经过 Source Access Gate 并写请求账本，规划阶段的只读榜单核验同样只重试一次。
- 单个请求在重试耗尽后结束对应请求 Work Item；品牌目录或型号范围可以隔离时，记录终止原因并继续后续品牌或型号，不把局部失败升级为 Source Run 失败。
- 只有访问限制、计划与来源结构无法绑定、Provider/typed contract/存储不变量破坏、预算与最长运行时间耗尽、人工停止等运行级条件才结束整个 Source Run。
- 每个型号使用独立 work item；参数页、图集页和全部排队图片完成后才增加型号完成数。
- `target_count` 表达计划允许的最大覆盖边界；来源穷尽或隔离失败可以低于该值，实际完成数和失败原因由 target 与 work item 分别保存，任何执行都不得超过计划上限。
- Resume 只跳过恢复链中已经完整完成的型号，未完成型号重新执行，已有快照保持不可变。
- Worker 完整消费 Start/Resume 后，Source Execution 只为 `transient_transport` 和满足安全条件的 `execution_process_lost` 生成自动 Resume 请求；请求先把 Batch 标记为 `pending`，再以 `source-auto-resume-{runId}` 作为确定性 job key 延迟投递。
- 自动 Resume 候选生成前必须重新通过当前 Confirmed Crawl Plan 的可执行性校验；旧规划协议、过期版本或已失效计划回到人工规划门，不进入自动恢复队列。
- API 启动时扫描未完成 Batch，Graphile cron 每分钟再次扫描；恢复仍进入同一 Resume 入口和 Source Run 恢复链，累计请求数受原 Confirmed Crawl Plan 的 request budget 约束。访问限制、计划/契约错误、预算耗尽和人工停止不会自动重试。
- 队列关闭等待真实在途任务退出；Run 终态要求请求和 work item 全部终态，局部失败不会留下 running 项。

## 公共传输与内存边界

公共资源读取复用一个 Node 24 `https.Agent`。transport adapter 保留公网地址校验、可信 DNS/Fake-IP 失败关闭、同 origin 单次重定向、逐跳请求审计、流式最大字节限制和本机受信任 HTTPS 代理支持。

当前真实长批次在新增 134 个快照、114 张图片后约占 275 MB，并完成 20 个型号的剩余范围。该证据覆盖当前验收规模；后续品牌批次继续观测进程内存、请求节奏和存储预算。

## ZOL 来源边界

ZOL 路径、分页、DOM、`picList` 和图片 URL 协议只存在于 ZOL Provider。共享 Capture Task、Crawl Plan、Source Execution 和 Source Dataset contract 不包含具体品类、品牌、平台或型号假设。

ZOL Provider 接受 Confirmed Crawl Plan 中的门类 slug 与品牌目录数组，按榜单顺序和计划批次选择每品牌前 N 个不同产品 ID，并保存参数页、图集页和与当前产品绑定的来源原图。参数页的产品分片由每个产品 ID 确定性计算，不是门类 ID。

## 架构通过门

1. 用户可以从 Workbench Chat Timeline 发起采集请求并确认采访范围草案。
2. 已确认 Capture Task 可以启动 Planning Run，并在同一产品表面查看规划活动与 Crawl Plan Draft。
3. 负责人可以独立确认计划，再执行 Prepare 和 Start。
4. 后台执行、瞬时传输自动恢复、访问限制和 Source Dataset 对账保持现有验证结果。
5. 正式门类计划按榜单规则选择最多 20 个品牌，每批 3 个、每品牌每轮 10 个，达到每品牌 20 个型号上限或来源穷尽；没有可验证排行榜时保持在计划确认门。
