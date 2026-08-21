# 京东完整来源数据闭环迭代说明

状态：工程范围已由负责人授权实施；完成度与验证证据只见 `PROGRESS.md`，本文件不授权真实京东访问、登录或扩批

更新日期：2026-08-21

唯一职责：把 `ROADMAP.md` 1D 和 `JD-COLLECTION-DESIGN.md` 已确认的京东产物，收敛成一次最小但完整的工程迭代。阶段顺序仍只由 `ROADMAP.md` 拥有，当前完成度仍只由 `PROGRESS.md` 拥有，技术候选状态仍只由 `RESEARCH.md` 拥有；本文件不建立平行 roadmap、progress 或 architecture。

## 1. 简单说明

这轮要交付的不是一个“能打开京东页面”的演示，也不是再换一个限速库。系统最终必须能按已确认 Crawl Plan 抓取并保存：

- 京东分类、筛选和分页目录；
- 京东自营与经核实的品牌官方旗舰店商品；
- 每个 SKU 的完整详情 HTML/源站 JSON、全部原始参数和详情文字；
- 主图、详情图、参数图的源站 URL，以及这些引用与 SKU、区块、顺序的关系；本阶段不下载图片字节；
- 评价汇总和按计划取得的 50/100 条评价样本；
- 每一次真实网络请求、停止原因、已完成对象和未完成对象；
- 可以在中断或进程退出后由负责人显式继续的本地任务。

这一轮的第一优先级是尽量不触发京东限制。工程顺序必须是先消除不必要请求，再精确计量剩余请求，再持久熔断和恢复，最后才讨论等待间隔；不能用计时器掩盖多余请求。图片 URL 必须从已经取得的详情 HTML/源站 JSON 中提取，图片服务器收到的请求必须为 0。

最小改动不等于继续维持当前的两个请求、一个商品或丢失图片引用。最小改动的含义是：保留 Crawl Plan、Source Execution、Source Dataset、Source Asset 和本地 CAS 这些已经正确的 seam，只补它们无法表达完整京东数据、URL 引用与安全恢复的缺口；不新建代理池 manager、浏览器 registry、站点通用 plugin、第二套队列或第二套原始数据模型。Source Asset/CAS 继续服务计划明确要求下载的 PDF、XLSX 等来源，本轮京东图片不使用它们。

## 2. 本轮完成定义

只有以下结果全部成立，才可以说本轮“京东完整来源数据闭环”完成：

1. 新版本 JD Provider 能执行同一份计划中的目录、店铺/商品枚举、完整详情、评价汇总和评价样本 target；图片引用随详情响应保存，不形成独立请求 target；
2. HTML 和 JSON 以源站真实格式追加为不可变 Snapshot，不先清洗或压成统一参数表；
3. 详情中发现的图片保存源站 URL、资源类型、用途、区块、顺序、所属商品关系和来源 Snapshot 关系；不请求图片字节，不生成图片 Source Asset，不记录未经取得的媒体大小、内容哈希或尺寸；
4. 每次真实 HTTP hop 在出网前取得持久准入，在返回后记录状态、时间、字节数和限制结果；重定向每一跳单独计数；
5. 第一次出现 401、403、429、登录页、验证页、`risk_handler`、频控页或未知跨源跳转时，全京东来源停止，未派发工作保持未完成，自动重试为零；
6. 进程被强杀或前台连接断开后，已提交 Snapshot/资源引用不丢失、不重复；负责人显式恢复时只处理未完成工作；
7. Workbench 能查看来源、target、请求计数、快照、图片 URL 引用、失败原因和恢复来源，并能导出 JSONL/CSV；
8. 本地 fixture、强杀恢复、真实有界探针和首批 20 SKU 均通过各自完成门；任何一次受限都使真实扩批停止；
9. 分类、详情、图片 URL 引用或评价任一块没有真实产物，都不能把“Provider 能运行”报告为本轮完成。

## 3. 当前事实与根因

### 3.1 已经证明的事实

- 监督式普通浏览器会话曾读取京东自营目录 5 页、300 个唯一 SKU；同轮详情读取到第 17 个请求时触发真实 `risk_handler`。
- 暂停前有 15 个详情完整可读；人工扫码后仍进入 `pc-frequent-pro...reason=403`，登录不是已验证恢复方案。
- Patchright 的旧、新、无 Profile 会话都进入 `risk_handler`；Playwright＋系统 Chrome 得到空骨架；Puppeteer＋系统 Chrome 进入频控页；同一时点普通浏览器仍能读取公开规格。
- 当前 `jd.catalog-product@1.0.0` 已失败关闭，不启动浏览器、不访问京东，并且只接受一个目录和一个首商品详情、只保留 HTML，不能显式保存详情中的图片资源引用。
- Source Dataset 已具备不可变 Snapshot、单附件 Asset、SHA-256、cacache 内容寻址、下载和导出；这些附件能力继续用于计划明确要求取得原文件的来源，但本轮不应用于京东图片。

### 3.2 旧实现为什么无效

1. Prepare、Preflight 和 Collect 分别执行页面导航，实际访问次数多于计划工作项；
2. 一次 `page.goto` 会加载 document、script、stylesheet、image、XHR/fetch 等多条网络请求，旧 gate 只记为一次；
3. 生产运行曾把批次冷却覆写为 1ms，fixture 没覆盖这条组合路径；
4. 403/429 被转成页面 Snapshot 状态，没有抛给 circuit，限制后仍可能继续派发；
5. 频率和 circuit 只存在内存，进程重启后会遗忘；
6. 旧 v1 计划和 Provider 根本不能表达全部商品、图片 URL 引用和评价，继续修补 v1 只会得到“安全但不满足需求”的代码。

### 3.3 本轮针对的三个不同问题

| 问题 | 本轮处理方式 | 不能冒充的结果 |
| --- | --- | --- |
| 页面自动加载造成请求不可计量 | 改为显式 HTML/JSON 请求，每个 redirect hop 先准入；图片只解析 URL，零下载 | 不保证京东接受该访问表面 |
| 进程内冷却和熔断会遗忘 | 把 request attempt、下一可访问时间和 circuit 写入 PostgreSQL | 不把固定窗口限速说成反爬破解 |
| 数百 SKU 页面和评价不能靠前台内存列表恢复 | 复用 Crawlee 持久 RequestQueue 和稳定 uniqueKey，显式恢复未完成工作；图片引用随详情事务提交 | 不增加自动重试、SessionPool 或换身份 |

## 4. Baseline Impact

```text
Baseline Impact:
- touched modules: shared Crawl Plan/Source Dataset contract、DB schema/migration、Source Access、JD Provider、Source Execution、API/Web 来源运行视图、RESEARCH/ADR/PROGRESS
- owning fact source: Crawl Plan 拥有来源/内容/数量/停止政策；Source Dataset 拥有 Source Run/Target/Capture Work Item/Request Attempt/Snapshot/Source Resource Reference；Crawlee RequestQueue 只拥有本机派发 mechanics
- public interface changed: yes；新增 JD v2 计划与动态覆盖语义、Capture Work Item/逐请求 observation、来源资源引用和显式恢复关联
- new protocol/adapter/fallback: yes；现有 PacedSessionHttpAccess 深化为显式 HTTP adapter，并增加 PostgreSQL admission port；没有浏览器或代理 fallback
- compatibility or legacy path changed: yes；v1 保持只读历史和失败关闭，新计划只生成 v2，不让同一版本同时解释两种行为
- research update required: yes；撤销 JOS/rate-limiter-flexible/DBOS 作为当前解法，登记 Crawlee 持久队列、代理和 Firefox 的准确边界
- architecture or ADR update required: implementation 时 yes；需要修订 ADR-0013/0016 的 JD v1 与恢复语义；本轮只出设计，不提前改写已实现架构
- tests and real-surface validation to run: 多资源本地 fixture、实际服务端时间戳、图片服务器零请求、403/429 零继续、强杀恢复、URL 引用/导出、Workbench 主路径、多捕获单元真实探针、首批有界 SKU
```

## 5. Patch Disposition

```text
Patch Disposition:
- delete: 京东图片下载、图片 CDN 请求、图片 Capture Work Item、JD 图片 Asset/context、图片字节 hash/尺寸/CAS/下载验收；JOS 旧入口与“官方 API 可替代本轮网页数据”的错误候选；rate-limiter-flexible/DBOS 能解决京东频控的表述；v1 page.goto/readiness/自动登录路径；1ms 冷却；受限后重试；browser route POC
- keep: JD Provider 失败关闭；Crawl Plan/Source Dataset 单一事实源；target attempt 对账；SourceAccessError；p-queue/Cockatiel 进程内 gate；PacedSessionHttpAccess 手工 redirect；通用 cacache Asset 存储继续服务确需下载的非京东来源；多 Provider 失败隔离
- rewrite: jd.catalog-product 升级为 v2 的完整来源 adapter；图片处理改为从已取得详情载荷提取并提交 Source Resource Reference；请求 observation/准入改为持久事实；长任务改为 Crawlee RequestQueue 驱动的前台可暂停/显式恢复执行
- reason: 旧补丁既把导航工作项误当真实请求，又给京东增加了不必要的图片请求；先把图片请求降为零，再对剩余 HTML/JSON 请求逐跳准入，才符合本轮“尽量不触发限制”的首要目标
```

## 6. 最小一致设计

### 6.1 保持不变的 seam

- `CrawlPlanningModule` 仍独占“从哪里抓、抓什么、抓多少、何时停止”。
- `SourceProvider.collect` 仍是 Source Execution 使用的唯一 Provider interface；不增加 JD 专用执行入口。
- `SourceDatasetModule` 仍是运行、对象、快照、资源引用和附件的唯一事务入口；Provider 不直接写数据库或文件。
- `SourceAssetStore` 继续使用 cacache，但本轮不接收京东图片；不增加 JD 图片目录、对象存储或下载服务。
- Web/API 只投影 Workbench 事实，不从错误文案或轮询状态推导运行结果。

### 6.2 JD Provider 使用新版本，不扩写 v1

新增 `jd.catalog-product@2.0.0`。v1 历史计划和历史 Source Run 保持可读，但不能再次启动；新计划只生成 v2。

v2 至少接受以下 Provider-owned target operation：

| operation | 捕获单元 | 原始格式 | 数量语义 |
| --- | --- | --- | --- |
| `catalog_pages` | 分类/筛选目录页或源站 JSON | `html` / `source_json` | `all_available` 或经负责人确认的 sample |
| `store_catalogs` | 自营/候选官方旗舰店的店铺观察与商品目录 | `html` / `source_json` | 对计划入口中全部可核实店铺执行；无法核实保持原始状态 |
| `product_details` | 每个唯一 SKU 的详情正文及其中声明的图片资源引用 | `html` / `source_json` | 与已接纳 SKU 分母一致；保存全部图片引用但不请求图片 URL |
| `review_summaries` | 每个 SKU 的公开评分与标签汇总 | `source_json` | 与详情成功 SKU 分母一致 |
| `review_samples` | 每个 SKU 的去个人化评价页/批次 | `source_json` | v2 target 配置冻结 `samples_per_product=50|100`；完成时逐 SKU 对账，不能只对账全局总数 |

店铺核实、SKU 去重、详情→图片关系和评价分页规则属于 v2 adapter implementation，不进入共享 contract。共享 contract 只保存 target、来源对象、原始载荷和关系上下文，不出现京东、冰箱、SKU、价格或评价固定字段。

### 6.3 显式请求，而不是完整页面导航

深化现有 `PacedSessionHttpAccess`：

1. 只有计划要求取得的 HTML 和 JSON 通过同一个显式 GET interface；图片 URL 不进入 GET interface；
2. 自动 redirect 固定为 0，每一跳在发送前重新准入；
3. 只允许 v2 adapter 已校验的 HTTPS origin，未知 origin 在出网前失败；
4. 每个响应校验状态、媒体类型、声明字节和实际字节；
5. 401、403、429、登录/验证/频控正文或异常跳转抛出 typed `SourceAccessError`；
6. 不自动加载脚本、字体、广告、推荐流和追踪资源；
7. 主图、详情图和参数图的 URL 是目标数据，但图片字节不是本阶段目标；解析这些引用必须新增 0 次网络请求；
8. 不逆向签名、不伪造指纹/UA/Header、不复制 Cookie/Profile，不自动处理验证码。

浏览器只保留为以后可能需要的人工登录/人工确认载体。Prepare 不导航京东；Start 的第一条真实请求同时承担可达性检查和原始捕获，避免准备阶段重复访问。

请求最小化是先于任何时间策略的硬门：

- Prepare 固定 0 个京东请求，不发 HEAD、预热或登录探测；
- 同一 Source Run 内相同规范化 GET URL 最多实际发送一次；队列重复项直接对账已有 Snapshot，不再次访问；
- 从前序响应发现的详情、评价 URL 必须先以稳定 work key 去重，再进入准入；
- 单个详情响应中的参数、文字和全部图片 URL 一次解析、一次事务提交，不为不同区块重复请求同一详情；
- 图片 URL 永远不进入请求队列；
- Crawl Plan 必须冻结目录页数、每 SKU 详情请求上限、评价页数/样本上限和总 hop 上限。实际请求数超过计划上限时，在出网前停止，不能靠事后限速补救。

### 6.4 持久请求账本与全局 JD circuit

在 Source Dataset 事实层增加通用、非 JD 专用的三类记录：

- `SourceCaptureWorkItem`：`runId`、`targetKey`、稳定 work key、parent object key、capture unit、expected/observed unit count、状态和停止原因；它表达目录页、SKU 详情或每 SKU 评价批次的用户可见覆盖事实；图片引用不是网络工作项；
- `SourceRequestAttempt`：`runId`、`targetKey`、稳定 work key、requested/final URL、origin、redirect parent、started/finished time、HTTP status、bytes、result state、restriction reason；
- `SourceAccessGateState`：Provider/version＋访问范围、last attempt、next eligible time、window count、circuit state、blocked reason/time、manual resume requirement 和 policy version。

`SourceCollectionTargetRun` 汇总 Capture Work Item，而不是只统计 Provider 发出的 Snapshot。`all_available` target 只有在发现过程明确结束、全部已发现 work item 都有终态、expected/observed 数量相等时才能 completed；每 SKU 评价的 50/100 也按 parent object 独立对账，不能用全局总数掩盖某些 SKU 缺失。

请求顺序必须是：

```text
reserve in PostgreSQL
  -> 持久校验 circuit / request budget / next eligible time
  -> 写 started attempt
  -> 发出一个实际 HTTP hop
  -> 写 finished attempt
  -> 保存 Snapshot/Source Resource Reference
  -> 标记对应 Crawlee request handled
```

若数据库不可用、attempt 无法落盘或 gate 状态不明确，失败关闭，不退回纯内存发送。`p-queue`/Cockatiel 继续负责单进程严格串行、取消和首错熔断；PostgreSQL 只负责跨进程不遗忘的准入与审计，不再引入 `rate-limiter-flexible` 作为“反爬方案”。

### 6.5 持久工作项与显式恢复

复用当前已安装的 `@crawlee/core@3.18.1`、`@crawlee/memory-storage@3.18.1`：

- 每个来源运行使用命名 RequestQueue，`persistStorage=true`，目录位于 Git 忽略的本机 `data/`；
- work item uniqueKey 由 plan version、target、来源对象 identity 和捕获单元稳定组成；入队前先提交对应 `SourceCaptureWorkItem`，队列项不能成为唯一记录；
- Source Execution 每次只从 RequestQueue 锁定一个 work item；这只是并发上限，频控仍由显式请求 gate 管理；
- 不接入 SessionPool、代理轮换或 BasicCrawler 的 `retryOnBlocked`/自动 retry；失败工作项写入 Source Dataset 后不自动 reclaim；
- 页面/JSON 解析发现的新 SKU 和评价页只通过同一个 RequestQueue 加入，不能形成旁路 Promise；图片 URL 只随所属详情 Snapshot 提交，禁止入队；
- 前台连接断开或进程退出时停止派发。已完成 uniqueKey 不再加入；未完成项在负责人显式“继续”后进入新的 Source Run，并通过 `resumedFromRunId` 对账前序运行；
- RequestQueue 只负责派发与去重，Source Dataset 的 Capture Work Item 仍是用户可见状态事实源。二者不互相推导完成；启动/恢复时必须按稳定 work key 显式对账。

先用当前 Crawlee 版本完成强杀原型。若命名 RequestQueue＋MemoryStorage 不能稳定恢复被锁工作项，该候选保持失败，不允许自行补写队列；重新进入 `RESEARCH.md` 选择成熟替代方案。

### 6.6 图片只保存来源资源引用

详情 HTML/源站 JSON 已经声明的每一个图片引用，与所属详情 Snapshot 在同一提交边界内保存为通用 `SourceResourceReference`。它表达“这个来源在该时点引用了一个资源”，不表达资源字节已经取得、URL 仍可访问或内容已经校验。

最小字段为：

```text
sourceUrl: 源站载荷中观察到的原始 URL
resourceKind: image
role: primary | detail | parameter | review
section: 源站区块标识或原始区块名
ordinal: 在该商品和区块内的原始顺序
sourceObjectId: 所属商品对象
sourceSnapshotId: 发现该引用的不可变详情快照
```

这些值是 Provider observation，不是清洗后的跨品类图片类型。`src/srcset/data-*` 等源站明确候选分别保留原始值和其页面位置；不得改写 CDN 路径或尺寸参数猜测“更高清”URL。相同 URL 出现在不同 SKU、区块或顺序时，关系都必须保留，不能因 URL 去重而合并。

本轮不向这些 URL 发请求，不生成 `SourceProviderAsset`/`SourceAsset`，不计算图片内容哈希、尺寸或本地内容地址，也不在 Workbench 提供图片下载。通用 Source Asset/CAS 不删除，继续服务 Crawl Plan 明确要求下载的 PDF、XLSX 等来源。

### 6.7 评价边界

- 评价汇总与样本分别作为原始 JSON Snapshot 保存，不在阶段 1 做主题分类、情感分析或真实性判断；
- 每个 SKU 的目标量由 Crawl Plan 冻结，默认候选为 100，访问边界不足时只能按计划修订为 50，不能静默少抓；
- 不保存头像、个人主页、完整账号标识或无关个人信息；公开昵称没有业务必要时不保存；
- 若公开评价请求必须逆向签名、复制认证材料或绕过验证才能取得，立即停止该 target；不能用“详情和图片 URL 成功”冒充评价闭环成功。

### 6.8 代理与 Firefox 的处置

- 本轮不建设轮换代理池。代理轮换会改变访问身份，不能减少请求数，也不能成为 403 后继续访问的 fallback。
- 若部署环境已有明确授权的固定代理，可在未来作为 `PacedSessionHttpAccess` 的单一网络配置验证；它不改变预算、circuit 和零重试规则。
- Firefox 只保留为一次单变量差分实验，不进入 v2 基础实现。Playwright Firefox 是补丁构建，不等于普通 Firefox；Puppeteer/Selenium Firefox 仍是自动化会话。
- 只有显式 HTTP 的本地全部门已通过、多捕获单元真实探针在首个请求表面失败、且同一时点人工普通 Firefox 可读时，才登记一个 Firefox 对照原型。原型只改变浏览器/连接方式，不同时换网络、账号、Profile 或频率；失败后删除，不建设浏览器 registry 或自动 fallback。

## 7. 预计代码改动

| 位置 | 最小必要改动 | 明确不做 |
| --- | --- | --- |
| `packages/shared/src/crawl-planning.ts` | 增加 JD v2 candidate schema 和五类 target operation；v1 只读 | 不把 JD 字段写进通用 target |
| `packages/shared/src/source-dataset.ts` | 增加 Capture Work Item、request observation、恢复关联和 Source Resource Reference | 不把资源引用冒充已下载 Asset |
| `packages/db/src/workbenchSchema.ts`＋migration | work item、请求 attempt、gate state、恢复关联、资源引用 | 不把图片 Blob 放 PostgreSQL |
| `packages/worker/src/pacedSessionHttpAccess.ts` | 注入持久 admission port，保留手工 redirect、字节上限、typed restriction | 不增加代理/浏览器 fallback |
| `packages/worker/src/jdCatalogProvider.ts` | v2 编排、显式请求、RequestQueue work item | 不恢复 `page.goto` 批量采集 |
| `packages/worker/src/jdCatalogParser.ts` | 纯解析目录、商品、图片 URL manifest、评价引用 | 不请求图片或把 DOM 规则升级为共享模型 |
| `packages/workbench/src/sourceDatasetModule.ts` | 原子 reserve/finish request、资源引用提交、恢复读取 | 不直接调 JD 网络 |
| `packages/workbench/src/sourceExecutionModule.ts` | 建立/恢复队列、传递 admission port、来源级 circuit | 不自建后台 workflow engine |
| API/Web | 显示 request/资源引用/target 对账和显式“继续” | 不下载图片，不展示 Cookie/Profile/Header |

新增源码文件只允许承担两个真实职责：JD 外部协议的纯解析，以及 PostgreSQL request admission adapter。不得机械拆出 manager、coordinator、factory、registry 或转发 helper。

## 8. 实施顺序与停止门

### I0：旧补丁清算和红灯 fixture

- 删除或重写第 5 节列出的错误结论和死路径；
- 建立本地 HTTP fixture：两页目录、3 个商品、每个详情载荷至少声明 25 个图片 URL、重复 URL、lazy URL、独立计数的图片服务器、JSON、重定向、登录跳转、403 和 429；
- 红灯必须能证明当前 v1 不能显式保存图片引用、页面工作项不能覆盖实际请求、图片服务器必须收到 0 次请求、强杀后 gate/队列状态丢失。

停止门：没有能捕获上述三个真实缺口的红灯命令，不进入实现。

### I1：contract、migration 和持久 admission

- 先写 shared/db/workbench tests，再实现 work item、request reserve/finish、circuit 和 resource reference；
- 同一 gate key 并发 reserve 只能一个成功；首个 restriction 提交与 circuit open 必须同一事务；
- API 进程重启后仍读取 blocked/manual-resume 状态。

停止门：数据库断开时若仍能发请求，立即失败，不进入 Provider。

### I2：显式 HTTP、队列和强杀恢复

- 把 `PacedSessionHttpAccess` 接到持久 admission；
- 使用命名 RequestQueue 生成目录、详情和评价 work item；图片 URL 不生成 work item；
- 子进程运行到指定 work key 后强杀，重启后验证已完成项不重复、未完成项不自动发送，负责人显式继续后才恢复。

停止门：任何自动 retry、队列 purge、重复 successful URL 或限制后新增服务端时间戳都使本阶段失败。

### I3：JD v2 纯解析与完整 fixture 纵切片

- 目录产生唯一 SKU；详情产生原始正文和图片 URL manifest；每个需要网络访问的发现对象先形成稳定 Capture Work Item；图片引用随详情进入 Source Dataset；评价汇总/样本进入原始 JSON；
- target 数量与 Source Dataset 真实 Snapshot/Resource Reference 数严格对账；
- Workbench 可查看并导出第 21～25 条图片引用，证明没有隐式 20 条上限；独立图片服务器请求计数必须为 0；
- 同一图片 URL 跨 SKU 或区块出现时，每个来源关系都存在，不把关系合并。

停止门：任一图片丢失区块/顺序/SKU 关系，或评价不足而 target 仍 completed，均失败。

### I4：Workbench 主路径与全量自动化门

- 从 confirmed v2 Crawl Plan 显式 Start；
- 展示目录、详情、图片 URL 引用、评价 target 进度、请求计数、circuit 和停止原因；
- 中断后只提供显式“继续”，不自动恢复；
- 运行 package tests、全量 test、六 workspace typecheck、production build 和 `git diff --check`。

停止门：fixture/测试不能替代下一阶段真实结果。

### I5：真实有界验收，最后才讨论登录

只有 I0～I4 全部通过后，才允许执行不进入正式数据集的真实验收。真实探针只请求目录、详情和评价 JSON；图片 URL 从详情响应提取，任何图片 CDN 请求都使验收失败：

1. 三个相互冷却的首级窗口：每窗最多 1 个目录、1 个详情和 1 个评价汇总；详情必须产出主图/详情图/参数图 URL 引用，但不请求图片；
2. 每次实际请求、redirect 和状态都有出网前持久记录；图片 URL 引用没有 request attempt；连续三个窗口均无 403/验证/频控，才形成候选运行区间；
3. 再执行最多 3 个 SKU 的完整详情和计划评价样本，验证动态工作项总量、图片引用完整性和中断恢复；这一批仍是验收数据，不扩大市场覆盖；
4. 任一窗口出现登录要求，停止并由负责人决定是否人工登录；登录前不继续探针；
5. 任一窗口出现限制，停止并回到原因分析，不换代理、账号、Cookie、指纹或浏览器自动 fallback；
6. 上述多捕获单元探针通过后，正式首批上限为 20 SKU，实际数量必须受探针测得的安全请求预算约束；必须同时验收详情、全部图片 URL 引用和评价，不只看参数页；
7. 首批通过后才能依据真实请求量和成功率修订 Crawl Plan、分批扩大；不能预先承诺整站永不受限。

## 9. 自动化验收矩阵

| 门 | 必须证明的失败/成功 | 证据 |
| --- | --- | --- |
| 请求最小化与计量 | HTML、JSON、每个 redirect 各占一次预算；图片服务器请求数严格为 0 | fixture 服务端时间戳＋SourceRequestAttempt＋图片服务器计数 |
| 重复访问 | Prepare 为 0 请求；同一运行的相同规范化 GET URL 最多出网一次 | request ledger＋fixture URL 命中次数 |
| 熔断 | 首个 403/429/验证后零继续派发，重启仍 blocked | 观察窗内服务端零新增请求 |
| 图片引用完整性 | 每商品至少 25 条引用，URL/用途/区块/顺序/SKU/Snapshot 关系完整，可查看和导出 | resource reference 行数＋Workbench JSONL/CSV |
| 引用关系 | 相同 URL 不发请求；跨 SKU/区块/顺序的关系不合并 | 图片服务器零请求＋resource reference rows |
| 数量 | all_available/50/100 按动态 work item 和 parent object 严格对账 | target/work item/snapshot counts |
| 强杀恢复 | 已完成不重复，未完成不丢失、不自动发送 | kill/restart 脚本＋queue/DB 对账 |
| 隐私 | Cookie/Profile/Header/账号信息不入库、日志、导出 | schema、日志和导出断言 |
| 真实表面 | 三个多捕获单元窗口、3 SKU 完整样本、20 SKU 分批均如实报告 | 原始运行时间戳与人工验收记录 |

## 10. 明确不做

- 不建设轮换代理池、账号池、Cookie 池或住宅代理切换；
- 不伪造浏览器指纹、UA/Header，不逆向 `h5st` 或其他签名；
- 不把 Firefox 写成默认“反检测浏览器”；
- 不恢复 v1 页面导航或 Prepare 页面探测；
- 不用 `rate-limiter-flexible`、DBOS 或其他库的名字代替真实请求计量和恢复证据；
- 不自动重试 401/403/429/验证/登录；
- 不在阶段 1 解析成规范化商品参数、情感标签或知识；
- 不因为目录、详情或图片 URL 其中一块成功，就缩小完成口径；
- 不在本迭代开始真实登录或京东访问；真实探针必须等 I0～I4 通过并另行显式开始。

## 11. 本轮文档验收结论

这份迭代以现有 seam 为基础，公共扩展收敛为三组：JD v2 计划与动态覆盖语义、Capture Work Item/逐请求持久 observation/准入、恢复关联与 Source Resource Reference。图片 URL 从已有详情响应提取，增加 0 次网络请求；图片字节、内容哈希、尺寸、CAS 和下载全部退出本轮。请求队列复用已安装 Crawlee，不恢复 DBOS，不增加代理池或浏览器插件系统。

这已经是能同时满足“完整京东数据＋图片 URL＋评价＋请求最小化＋受限即停＋中断可恢复”的最小一致范围。它不能承诺京东永不触发限制，但明确把可控的触发面降到最低：不加载页面子资源、不请求图片、没有 Prepare 重复访问、每个剩余 HTTP hop 先准入、首次受限即停止。
