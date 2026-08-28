# 数据抓取平台架构基线

状态：ZOL 单来源纵向验证基线
更新日期：2026-08-28

## 简单说明

系统先从 ZOL 门类页取得品牌，再用 ZOL 门类品牌榜决定抓取顺序。第一轮从一个 P1 品牌开始，取得品牌当前型号目录和每个型号的参数页。单品牌链路通过后，再让多个品牌任务交错运行；所有 ZOL 请求仍经过同一个访问门，避免并发任务分别向源站放量。

## 目标数据流

```text
Confirmed Capture Task
  -> Crawl Plan Draft
  -> ZOL Category Adapter
       -> category roster
       -> brand ranking
       -> brand catalog pages
       -> model parameter pages
  -> Persistent Request Queue
  -> Shared Origin Access Gate
  -> Raw Snapshot + Request Ledger + Lineage
  -> Source Dataset
```

## 模块职责

| 模块 | 职责 | 不负责 |
| --- | --- | --- |
| Capture Task | 拥有用户确认的门类与内容范围 | ZOL URL、分页和频率 |
| Crawl Plan | 拥有品牌分母、P1 清单、页面目标、预算和停止条件 | 发请求、解析响应 |
| ZOL Category Adapter | 识别 ZOL 门类、品牌、分页、型号和参数页关系 | 决定通用品类范围、清洗参数 |
| Persistent Request Queue | 去重并持久派发品牌页与型号页工作项 | 用户可见完成状态 |
| Source Access Gate | 对同一 ZOL origin 统一准入、控频和熔断 | 选择抓取目标 |
| Source Dataset | 保存请求事实、原始响应、采集血缘和运行结果 | 标准化或覆盖原始内容 |

## 单一事实源

| 事实 | 拥有者 |
| --- | --- |
| 抓取门类与内容范围 | Capture Task |
| 本轮全部品牌、P1 清单和型号完成分母 | Crawl Plan version |
| 待处理 URL 与去重状态 | 持久 Request Queue |
| 请求准入、频率、冷却和熔断 | Source Access Gate |
| 实际请求和响应 | Source Request Attempt / Raw Snapshot |
| 页面之间的发现关系 | Source Dataset lineage |

## 并行与控频边界

- 品牌任务可以并行进入队列，但同一 `detail.zol.com.cn` origin 必须共享一个 gate key。
- 初始验证按每分钟最多 2 次、请求启动间隔至少 30 秒执行。
- 多品牌先采用交错调度，不让一个大品牌占满队列。
- 提高到每分钟 4 次、最大网络并发 2 属于独立验证门，不能由运行时自动放量。
- HTTP 403、429、登录、验证码、风险正文或结构异常立即熔断，不自动重试、换代理或绕过。
- HTML 解析和持久化可以并行；网络并发必须受共享 origin gate 约束。

## 来源特有边界

ZOL 路径、分页和 DOM 识别只能存在于 ZOL adapter。共享 Capture Task、Crawl Plan、Provider 和 Source Dataset contract 不出现冰箱、海尔或 ZOL 固定字段。

当前设计复用仓库已有的 Crawlee 持久队列、`p-queue`、Cockatiel、robots 解析、请求准入和不可变 Source Dataset。没有新增公共 interface；如果 V0 证明现有 Provider 无法表达品牌和型号工作项，下一上下文必须先给出最小 interface 变更及影响范围，再修改代码。

## 架构通过门

1. V0 证明一个 P1 品牌能从列表页到参数页形成可对账原始数据。
2. V1 证明两个品牌能交错执行并共享同一访问门。
3. 请求、快照、血缘、品牌分母和型号分母都能从持久事实恢复。
4. 只有通过上述门后，才允许执行 P1 品牌批次。
