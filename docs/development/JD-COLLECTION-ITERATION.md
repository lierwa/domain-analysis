# 京东目录发现与品牌官网补齐迭代说明

状态：历史方案；已由 ADR 0018 和 `ROADMAP.md` 1D 的 AI 深度来源规划取代，不得据此继续实现或执行 JD 抓取
更新日期：2026-08-24

唯一职责：保留 2026-08-24 早期 JD 目录候选方案的历史审计。当前实现不得注册 JD Provider、生成 JD source、建立京东覆盖投影或执行本文后续步骤；当前权威方案见 ADR 0018、R-044、`ROADMAP.md` 与 `PROGRESS.md`。

## 1. 简单说明

要解决的不是“怎样继续打开京东详情页”，而是“怎样知道电视这个门类里京东公开目录展示了哪些品牌和商品，再到对应品牌官网取得型号、参数和说明书”。

系统对用户仍只显示一个抓取任务，内部按三个可审计回合推进：

1. 京东市场目录发现：只读取匿名公开分类/搜索目录及其分页、筛选和商品卡，不登录、不进入商品详情、不抓评论；
2. 品牌官网补齐：根据第一回合真实发现的品牌和型号候选，回到新的 Crawl Planning Run，确认官网来源后抓取官方产品页、规格页和说明书原件；
3. 缺口修复：把“未找到官网”“型号只能匹配到系列”“参数页缺失”“来源受限”等问题逐项列出，负责人确认新计划后再补抓。

最终得到的不是一份假装“全量”的表，而是：京东目录原始快照、品牌官网原始快照/附件、每个品牌和型号的覆盖对账，以及所有未完成缺口。阶段 1 不把不同网站参数提前清洗成统一 schema。

## 2. 本轮范围与非目标

### 2.1 必须完成

- 用新的 `jd.catalog-market@1.0.0` 语义替代历史 `jd.catalog-product@2.0.0` 执行语义；
- 京东只捕获公开目录、品牌筛选、分页信息、商品卡原始字段和卡片/变体图片 URL；详情 URL 只保存为引用，不派发详情工作项；
- 以可重建的 Coverage Projection 对账品牌分母、分页分母、商品卡数量、SKU/SPU 去重数和型号候选；
- 把新发现的品牌官网来源交回新的 Planning Run；未经确认不得在 Source Run 中边搜边抓；
- 官网阶段保存原始 HTML、源站 JSON、PDF/表格说明书及其来源关系；
- UI 以一个任务的整体覆盖和缺口为主视图，Batch/Source Run 作为审计和重试入口；
- 删除被真实证据否决的京东登录会话、详情 canary、详情/店铺/评价动态工作链及其文档承诺。

### 2.2 明确不做

- 不自动登录京东，不刷新、切换账号、复制 Cookie/Profile、绕过验证码或风控；
- 不使用代理池、浏览器指纹伪装、验证码破解、第三方解锁服务或账号轮换；
- 不请求京东商品详情、店铺页、评论接口或图片字节；
- 不承诺外部网站一定公开所有品牌、型号或参数；缺失只能形成显式缺口；
- 不恢复旧 `MarketUniverse`、Evidence、Knowledge Factory、知识包或 Runtime；
- 不建立万能 crawler/plugin/registry，也不为未知官网预建逐站 DOM projector；
- 不在阶段 1 做跨来源实体合并、参数标准化、优劣判断或导购回答。

## 3. 完成定义

一个电视任务只有同时满足以下条件，阶段 1 的本轮目标才可以标记 `completed`；任一项未知、受限或不一致都必须是 `partial`：

1. 范围已冻结：类目入口、市场/地区、观察时间、商品生命周期口径和匿名访问方式明确；
2. 京东目录覆盖可对账：可见品牌筛选数、每品牌页面声明结果数、应遍历页数、实际遍历页数、商品卡数和唯一 SKU/SPU 数都有原始来源；
3. 每个京东可见品牌都有且只有一个官网映射结论：`mapped`、`ambiguous`、`not_found` 或 `not_published`；
4. 每个原始型号候选都有匹配结论：`exact`、`family_only`、`ambiguous`、`not_found` 或 `not_published`；
5. 对 `exact` 型号，官方产品页、结构化数据、规格页、说明书/规格附件分别记录 `captured` 或带原因的 `missing`；
6. 所有网络请求都属于已确认 Crawl Plan，进入既有 Source Request Attempt / Source Access Gate；
7. 登录、验证码、风控、拒绝、未知跳转、robots 禁止或覆盖分母漂移时失败关闭，不自动换路径；
8. 原始快照不可变，Coverage Projection 可从快照重建，删除投影不会丢失事实；
9. Workbench 默认展示任务整体覆盖、缺口和“继续补齐”，而不是要求用户在一长串 Batch 里猜哪次属于哪批数据。

“全量”在本项目中只表示“对已冻结入口在该观察窗口内，按源站声明分母完成对账”，不表示证明互联网不存在未公开或未展示的商品。

## 4. 当前事实与根因

### 4.1 已验证事实

- 京东匿名电视目录曾保存 1 个真实 Snapshot、30 个商品卡工作对象和 60 条商品卡/变体图片 URL，图片字节请求为 0；
- 匿名详情只返回客户端骨架；Playwright 专用登录后首条详情仍是骨架，并触发账号“当前页面异常”；
- 延迟、单并发和会话共享没有解决访问限制，继续真实详情实验会伤害账号且违反当前停止门；
- 当前 `public.web-resource` 只适合精确 URL 或一次同源唯一链接，不能证明品牌官网目录、分页、sitemap 和型号覆盖；
- Source Dataset、Graphile 后台任务、Crawlee RequestQueue、逐请求账本、持久访问门、不可变快照和资源引用已经是可复用资产。

### 4.2 根因

旧设计把“京东必须覆盖”错误等同于“京东必须提供详情、参数、图片和评价”。这迫使 Provider 进入受限详情面，并让 UI 用一串技术批次代替用户真正关心的品牌/型号覆盖。

新边界把来源职责拆清：

- 京东负责市场目录发现和公开商品卡观察；
- 品牌官网负责型号身份、官方参数、规格页和说明书原件；
- Source Dataset 保存原始事实；
- Coverage Projection 只从原始事实计算覆盖与缺口；
- 阶段 2 才做标准化和知识加工。

## 5. Baseline Impact

```text
Baseline Impact:
- touched modules: Capture Task、Crawl Planning、JD Provider、Source Dataset、Source Execution、Workbench 原始数据视图
- owning fact source: Crawl Plan 拥有冻结来源/分母；Source Dataset 拥有原始快照；Coverage Projection 是可重建控制视图
- public interface changed: yes；JD v2 五 target 被新的目录观察语义替代，并增加严格覆盖投影 contract
- new protocol/adapter/fallback: yes；官网目录候选仅在 POC 通过后加入，不提供自动 fallback
- compatibility or legacy path changed: yes；历史 JD v2 计划只读、不可再执行，旧数据保留
- research update required: yes；sitemap、robots、结构化商品数据和官方站点遍历候选需登记并做 POC
- architecture or ADR update required: yes；来源职责和用户可见完成语义改变
- tests and real-surface validation to run: contract、parser fixture、Source Dataset 重建、执行硬门、API/Web、强杀恢复、本地官网 POC、经批准的最小真实目录 canary
```

## 6. Patch Disposition

```text
Patch Disposition:
- delete: 京东 Playwright 登录会话、typed 登录 API、页面登录按钮、JD_DETAIL_CANARY_LIMIT、登录集成测试、详情/店铺/评价动态工作项和相关文案
- keep: Crawl Plan 确认门、Graphile 后台执行、Source Collection Batch、Capture Work Item、Crawlee RequestQueue、Source Request Attempt、Source Access Gate、不可变 Snapshot/Asset/Resource Reference、页面内 Dialog
- rewrite: JD Capture Task 默认范围、Crawl Plan JD contract、目录 parser/provider、Coverage Projection、任务级数据管理 UI、相关测试和权威文档
- reason: 真实账号异常已否决登录/详情路径；匿名目录已有有价值且低请求面的真实证据，官网才是参数与说明书的正确来源
```

### 6.1 删除清单

实现 I0 时必须删除或回写下列当前 WIP，不得保留“以后也许能用”的死路径：

- `.env.example` 的 `JD_DETAIL_CANARY_LIMIT`；
- `apps/api/src/config.ts` 及测试中的 canary 配置；
- `packages/shared/src/source-access.ts` 和 `packages/shared/src/index.ts` 导出；
- `packages/worker/src/jdAuthenticatedSession.ts`、对应 integration test 和 worker 导出；
- `apps/api/src/routes/sourceAccessSessionRoutes.ts`、对应 API test、server/index 组合根接线；
- `apps/web/src/lib/api.ts` 的登录会话 API 和 `CrawlPlanningPanel.tsx` 的登录动作/状态；
- `packages/worker/src/jdCatalogProvider.ts` 的 `accessSession`、authenticated fetch、detail canary、详情/店铺/评论 enqueue/handler；
- `packages/shared/src/crawl-planning.ts` 的 JD v2 五 target 强约束；
- `packages/shared/src/capture-task.ts` 中 `product_details`、`product_parameters`、详情媒体和评论的京东默认承诺；
- ADR、`CONTEXT.md`、架构、进度中的“Source Access Session 是当前候选”表述。

### 6.2 历史数据和计划

- 已保存 Batch、Run、Request、Snapshot 和 Resource Reference 不删除、不回填、不改写；
- 历史 `jd.catalog-product@2.0.0` 计划保留可读，但组合根不再注册该版本；尝试执行必须返回明确的“历史 Provider 不可执行”，不能静默迁移；
- 新计划使用新 key/version，避免旧计划被新语义误执行；
- 已证明错误的测试必须删除或重写，不能把测试改成继续保护登录/详情行为。

## 7. 最小架构

```text
一个 Capture Task revision
  -> Planning Run A：确认京东公开目录入口、分母与停止条件
  -> Crawl Plan A
  -> Batch/Source Run A：jd.catalog-market@1.0.0
  -> 不可变目录 Snapshot + 商品卡 Resource Reference
  -> Catalog Coverage Projection（可删除重建）
  -> 品牌/型号 Coverage Gap
  -> Planning Run B：调查并确认品牌官网、产品目录、说明书来源
  -> Crawl Plan B
  -> Batch/Source Run B：精确公共资源 + 经 POC 验证的官网目录 Provider
  -> 不可变官网 Snapshot/Asset
  -> 更新 Coverage Projection
  -> [仍有缺口] Planning Run C / 新 plan version
```

Plan A 运行时不能自行创建 Plan B。来源运行只返回观察结果；调查、来源选择和数量仍属于 Crawl Planning。

## 8. 最小数据 contract

### 8.1 京东目录观察

从目录原始 Snapshot 解析，严格字段只包含当前真实需要：

- `snapshotId`、`sourceRunId`、`observedAt`；
- 原始品牌筛选标签/键及源站声明数量；
- 当前分页、源站声明总页数或总结果数；
- `sku`、可见 `spu`（若源站公开）、原始标题、详情 URL 引用；
- 展示价格文本、评价数量文本、卡片顺序；
- 商品卡与变体图片原始 URL、变体标签和顺序。

不得把从标题猜出的品牌、型号或参数写回原始观察。原始标题只能生成“待核实型号候选”，匹配状态由独立投影表达。

### 8.2 官网目录观察

- `snapshotId`、`sourceRunId`、品牌标签、观察时间；
- 源站明确给出的型号/系列文本和标识；
- 产品页、规格页、说明书/规格附件 URL 引用；
- 可见分页或 sitemap 分母。

通用结构化商品数据只作为原始页面中的一种可观察表示，不等于来源完整，也不创建跨品类参数 schema。

### 8.3 Coverage Projection

投影最少包含：

- 范围：类目、市场、观察窗口、生命周期口径；
- 京东目录：品牌声明数/已遍历数、页面声明数/已遍历数、卡片数、唯一 SKU/SPU 数、分母来源；
- 官网：每品牌映射状态和证据 Snapshot；
- 型号：每个原始候选的匹配状态、官方页面/附件捕获状态；
- 缺口：类型、原因、最后一次计划/运行、下一动作是否需要负责人确认；
- 总状态：只有全部分母对账且没有 open/unknown/blocked 缺口时为 `completed`，否则为 `partial`。

它不拥有原始事实；任何计数都必须可追溯到计划版本和 Snapshot。删除后必须能从 Source Dataset 重建。

## 9. 实施切片

### I0：清算错误补丁

- 按 6.1 删除登录、canary、详情/评论路径；
- 历史计划失败关闭，旧数据只读；
- 运行现有安全失败、批次归属和 Source Dataset 回归。

停止门：diff 仍存在登录 API、Cookie/Profile 使用、详情/评论 work kind 或自动兼容时，不进入 I1。

### I1：先写 contract 与红灯测试

- 修改 Capture Task 和 Crawl Plan 的 JD 语义；
- 为目录观察和 Coverage Projection 建严格 typed contract；
- 写历史计划不可执行、投影可重建、分母不一致为 `partial` 的测试。

停止门：不得先写生产 parser 再补测试，也不得用 `metadata: unknown` 绕开 contract。

### I2：京东目录 Provider

- 把现有真实目录 parser 改为商品卡/品牌筛选/分页观察；
- `jd.catalog-market@1.0.0` 只派发目录页/品牌分页工作；
- 商品详情、店铺、评论和图片 URL 都不得变成网络工作项；
- 每个目录请求继续复用 PostgreSQL admission、Crawlee RequestQueue 和首错停止。

停止门：本地 fixture 必须证明详情域名和图片 CDN 请求数为 0。

### I3：品牌官网目录 POC

- 先用三个结构不同的电视品牌官网，在本地公开 fixture 与真实只读调研中验证 sitemap、产品列表、结构化商品数据和说明书链接；
- 标准 sitemap 优先复用 Crawlee `SitemapRequestList`；robots 解析继续复用现有 `robots-parser`；HTML 解析继续复用 Cheerio；
- 只有 POC 能稳定表达分页/分母/停止条件后，才冻结 `brand.official-catalog@1.0.0`；不满足时回到 `RESEARCH.md`，提交缺口和最小站点 adapter 范围等待确认。

停止门：README 示例跑通不算验证；没有三站 POC 证据不进入生产 contract。

### I4：官网补齐与缺口修复计划

- 从 Coverage Projection 生成“需要调查”的输入，但由新的 Planning Run 搜索、核实并生成 plan version；
- 精确官网产品页/说明书继续复用 `public.web-resource`；
- 目录遍历只使用 I3 已通过的 Provider；
- 运行结果只更新原始数据和可重建投影，不自动修改 Capture Task。

停止门：Source Run 内发现新 URL 后不得越过 confirmed plan 自由递归。

### I5：任务级数据管理 UI

- 原始数据首页按任务显示整体状态：品牌覆盖、型号覆盖、官网资料覆盖、open gap；
- 默认选中最近一次相关运行，但左右区域独立滚动；
- 每个失败项支持显式重试；任务级“继续补齐”只为失败/缺口生成待确认动作，不自动重跑全部来源；
- Batch/Source Run 保留在二级审计视图，可按 plan version、来源、目标和时间过滤。

停止门：不能通过 UI 文案重新推导完成状态，所有状态只投影 Coverage/Batch/Run 事实。

## 10. 验证矩阵

| 层级 | 必须证明 |
| --- | --- |
| Contract | 历史 JD v2 拒绝执行；新计划只有目录目标；缺口枚举无 `unknown` 泄漏 |
| Parser fixture | 品牌筛选、分页、SKU/SPU、标题、价格、评论数文本、卡片/变体图片 URL 可追溯 |
| 网络 fixture | 目录请求逐 hop 记账；详情域名、评论接口、图片 CDN 请求数均为 0 |
| Dataset | Snapshot 不可变；Coverage Projection 删除后可重建；分母漂移失败关闭 |
| 恢复 | 强杀后只继续 pending 目录页；已完成页不重复；人工继续不重置预算 |
| Planning | 新官网来源必须形成新的 Draft/confirmed plan；Run 不能边搜边扩范围 |
| API/Web | 一个任务展示跨批次整体覆盖；失败可定向重试；历史批次可审计但不混入当前结果 |
| 真实表面 | 用户可从 Workbench 自己启动、离开页面、回来查看覆盖/缺口，不依赖 Codex 看守 |

## 11. 真实来源验证门

文档和本地测试通过后，真实执行仍分开授权：

1. 京东匿名目录 canary：一个已确认类目入口，最多一页，不登录、不跳详情、不下载图片、零自动重试；
2. 若成功，再由负责人确认是否按源站分页分母扩展；首次受限信号立即停止；
3. 官网 POC 分品牌单独确认访问范围；robots 禁止、许可不明、登录或挑战立即记为 gap；
4. 只有真实 Workbench 自助流程和原始快照/覆盖投影都通过，才能进入下一品牌或扩大数量。

本迭代不授权任何真实请求。

## 12. 开源与项目代码边界

复用的成熟组件：Crawlee RequestQueue/SitemapRequestList、Graphile Worker、Cheerio、`robots-parser`、Cockatiel、PostgreSQL/Drizzle、Zod。

复用的项目资产：Capture Task、Crawl Plan、Batch/Run/Work/Request/Gate、Source Dataset、Snapshot/Asset/Resource Reference、后台命令和页面内 Dialog。

必须编写的产品特有代码只有：

- 京东公开目录商品卡/品牌/分页 adapter；
- 品牌官网目录的已验证薄 adapter；
- 标准商品覆盖投影与缺口规则；
- 任务级覆盖 UI。

这些代码分别承载来源协议差异和本产品“目录发现—官网补齐—缺口对账”的领域规则，不重复实现队列、重试、限速、robots、sitemap、存储或工作流引擎。
