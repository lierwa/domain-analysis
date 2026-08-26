# Crawl Planning 开发设计

状态：已获用户授权实施
更新日期：2026-08-26
服务阶段：`ROADMAP.md` 1B–1E

## 1. 简单说明

Capture Task 只确认“要取得哪些原始数据”。它确认后不会自动访问网站，而是在任务页进入一个独立的“抓取计划”环节：

```text
Capture Task 当前 revision
  -> 用户点击“制定抓取计划”
  -> Codex 在可见时间线中搜索并核实具体来源
  -> 形成 Crawl Plan Draft
  -> 用户补充、重做或确认
  -> Confirmed Crawl Plan
  -> 后续由已验证 Provider 执行
```

Crawl Plan 必须直接决定三件事：

1. **来源**：访问哪个发布者、域名和具体入口；
2. **内容**：在该来源捕获哪些原始对象与格式；
3. **数量**：全部、目标数量或样本数量，分母和停止口径是什么。

缺少其中任意一项，不生成可确认计划。确认计划不等于开始抓取。

## 2. 当前实施范围

当前系统实现一条从规划到原始数据验收的生产纵切片：

- 已确认 Capture Task 页面新增“抓取计划”；
- 用户显式启动一次 Codex Planning Run；
- Workbench 展示真实 commentary、网页搜索和整理状态；
- Codex 只做来源调查，不执行批量抓取；
- Workbench 校验并保存版本化 Crawl Plan Draft；
- Workbench 确定性组装 `public.web-resource@2.0.0` 的 `exact/site` typed route、内容信号、数量和停止门；
- 用户可以输入补充要求重新规划；
- 用户显式确认后得到不可变 Confirmed Crawl Plan；
- Prepare 不访问来源；Start 后由持久后台 Batch 执行；
- Provider 通过持久准入读取 robots/sitemap/页面，原始响应全部保存并单独记录内容 assessment；
- Capture Task revision 改变后，旧计划保留但不能冒充当前计划。

系统不自动确认计划，不从 HTTP 自动切换浏览器，不绕过访问限制，也不进入阶段 2 清洗。

## 3. 用户流程

### 3.1 任务确认后的入口

Capture Task 页面固定包含：

```text
抓取范围 | 抓取计划 | 原始数据
```

任务尚无当前计划时，“抓取计划”展示主动作“制定抓取计划”。点击前不启动 Codex，也不访问任何候选来源。

### 3.2 规划运行

点击后启动后台可恢复、前台可见的 Planning Run：

- 读取当前 Capture Task revision；
- 读取任务内已经调查过的 Source Candidate；
- 用网页搜索核实或补充具体发布者、入口和预期原始格式；
- 把每个任务内容方向映射到一个或多个来源抓取目标；
- 为每个抓取目标给出数量口径与停止条件；
- 明确 Provider、许可、登录、验证码、风控或频控等执行缺口。

DBOS 用 Planning Run ID 和稳定阶段 key 保存内部执行检查点；品牌发现、每次饱和查询、市场目录、每个品牌官网批次和知识来源分别执行。已完成阶段在 API 重启后不重做，正在进行的单个模型阶段按至少一次语义可能重做；每个 App Server 阶段仍有独立十分钟上限。页面连接只显示进度，关闭或刷新不会取消后台规划；Workbench PostgreSQL 保存用户可见的阶段状态、时间线和最终结果，Web 不读取 DBOS 内部表。

运行完成只生成一个新 Plan Draft。它不会自动确认计划、Prepare 或 Start；同一任务已有 `running` Planning Run 时拒绝再开第二轮。

### 3.3 计划审查与修订

计划草稿按来源展示：

- 来源名称、发布者、类型、角色和入口；
- 本轮搜索发现时间与初步访问状态；
- 每个抓取目标覆盖的 Capture Task 内容方向；
- 捕获单元、原始格式、唯一键、遍历方式；
- 数量模式、数量、单位、覆盖分母和理由；
- 停止条件；
- 执行阻塞项。

用户可以输入补充要求重新运行规划。新草稿追加版本，不覆盖旧计划；重新规划不会访问正式抓取入口。

### 3.4 计划确认

只有当前 Capture Task revision 的 draft 可以确认。确认时：

- 当前计划变为 `confirmed`；
- 旧 confirmed 计划变为 `superseded`；
- 计划内容与 content hash 保持不可变；
- 不创建 Source Run，不访问外部来源。

确认后必须再显式 Prepare 和 Start。Prepare 只检查当前 Provider/计划契约；Start 才创建持久 Batch 并提交后台执行。刷新或离开页面不取消批次，执行状态只从 Source Dataset 读取。

## 4. 领域契约

### 4.1 Planning Run

一次 Planning Run 只绑定：

- `taskId`；
- `taskRevision`；
- 可选的用户补充要求；
- 有序 Agent 时间线；
- `running / completed / interrupted / failed` 状态；
- 可选输出计划版本。

它是生成过程记录，不拥有抓取范围，也不是 Source Run。阶段检查点只投影 Planning Run 的可见进度；DBOS 内部工作流历史不成为第二个产品状态接口。

### 4.2 Crawl Plan Version

计划版本包含：

- `taskId + taskRevision`；
- `version`；
- `draft / confirmed / superseded`；
- 计划摘要；
- 一个或多个具体来源；
- 明确排除项；
- content hash、创建和确认时间。

每个来源包含一个或多个 Capture Target。Capture Target 是“内容＋数量”的最小计划单元。

### 4.3 Capture Target

每个 Capture Target 必须包含：

- 稳定 key 和可读名称；
- 所覆盖的 Capture Task topic；
- 原始捕获单元和格式；
- 来源对象唯一键；
- 遍历方式和停止条件；
- 数量：`all_available / target_count / sample` 三选一；
- 单位、覆盖分母和数量理由。

`target_count` 与 `sample` 必须给出正整数数量。`all_available` 也必须给出可审核分母，不能用“尽量多”等模糊表达。

### 4.4 当前 version 4 路由与内容验收

- `exact`：只请求计划冻结的 URL，适合明确正文、标准、规格页和附件；成功要求响应状态与计划原始格式一致。
- `site`：只用于品牌官网 HTML 种子；计划冻结同源边界、内容信号、最大深度、最大页数、最少 accepted 页面、时长、频率和请求预算。
- sitemap 原文保存为 `supporting`，相关性不足的页面保存为 `rejected`，满足计划信号与商品结构的页面保存为 `accepted`；三者都是不可变原始 Snapshot，但只有 `accepted` 增加有效完成数。
- Source Run 不搜索新来源、不跨源扩张、不修改计划；新增入口必须通过新的 Planning Run 和 Plan version。

### 4.5 确定性校验

Workbench 而不是 Codex 保护以下不变量：

- plan 的 task ID/revision 由服务端写入，模型不能自行改写；
- source 的观察等级、初步访问状态和发现时间由服务端写为 `search_discovered / unknown / 本轮完成时间`，模型不能自行提升；
- source key 在计划内唯一；
- target key 在来源内唯一；
- target 只能引用当前 Capture Task 中真实存在的 topic；
- Capture Task 的每个通用/品类 topic 至少被一个 target 覆盖；
- source、target、入口和数量都非空；
- 当前 revision 改变后旧 draft 不能确认；
- 计划确认不创建 Source Run。

## 5. 模块与 interface

新增一个深模块，不增加 manager、registry 或 engine：

```ts
interface CrawlPlanningModule {
  get(taskId: string): Promise<CrawlPlanningView | null>;
  run(input: CrawlPlanningRunRequest & { signal?: AbortSignal }): AsyncIterable<CrawlPlanningEvent>;
  confirm(input: ConfirmCrawlPlan): Promise<CrawlPlanningView>;
}
```

模块内部负责读取当前 Capture Task、创建/关闭 Planning Run、校验 Agent 输出、版本化 plan 和事务确认。API 与 Web 不重复推导状态。

Codex runtime 是注入的外部协议 seam。生产 adapter 复用现有 App Server `stdio`；测试 adapter 交付确定性事件和候选计划。

## 6. HTTP 与 Web

最小 HTTP interface：

```text
GET  /api/capture-tasks/:taskId/crawl-planning
POST /api/capture-tasks/:taskId/crawl-planning/runs          (SSE)
POST /api/capture-tasks/:taskId/crawl-plans/:planId/confirm
```

Web 只调用上述 interface：

- GET 恢复已完成/中断运行和计划版本；
- SSE 展示本轮有序 commentary/activity；
- confirm 使用 `expectedTaskRevision` 防止确认过期计划；
- 页面不从按钮文案、搜索结果或计时器猜测领域状态。

## 7. 复用与新增边界

### 复用成熟组件

- Codex App Server `stdio`、explicit Skill input、ephemeral thread、web search item 和 delta；
- Zod 严格结构校验；
- PostgreSQL＋Drizzle migration/transaction；
- Fastify SSE；
- React Query 与现有 Workbench task page；
- `canonicalize`＋SHA-256 内容指纹。

### 项目已有资产

- Capture Task revision；
- Source Candidate；
- Agent ordered timeline；
- 当前 Source Dataset 读取面；
- SourceAccessPolicy 类型，但 Planning Agent 不得凭空发明频控参数。

### 只编写的产品特有代码

- 标准商品任务 topic 到具体来源 Capture Target 的规划规则；
- 来源、内容、数量的不变量校验；
- 计划版本和确认门；
- Crawl Plan 在 Workbench 的可读投影。

这些职责是当前产品领域规则与现有组件编排，不是通用工作流、队列或 Agent 框架。

## 8. 停止与安全门

- Planning Run 只允许 App Server 网页搜索；即使搜索工具返回页面内容，当前计划也只记录为 `search_discovered`，不能冒充 Provider 已验证观察；
- 不读取 Cookie、Profile、密码、认证 Header 或验证码材料；
- 不做批量分页、商品枚举或文件下载来冒充规划；
- URL 字符串或 search item 不自动证明页面已打开；
- 许可、登录、验证码、风控、频控或 Provider 缺失必须作为执行阻塞展示；
- 运行时禁止自动 retry、代理轮换、账号切换、TLS 忽略和 HTTP→浏览器 fallback；
- 京东当前仍受许可与真实 reader/频控门约束，本轮不得发真实批量请求；
- 确认计划不越过任何访问门。

## 9. 验收门

自动化必须证明：

1. 当前 Capture Task 可以创建第一版计划草稿；
2. 计划明确来源、内容和数量；
3. topic 漏覆盖、未知 topic、重复 key 和模糊数量失败关闭；
4. 计划草稿可追加版本，历史不覆盖；
5. 过期 task revision 的计划不能确认；
6. 计划确认不创建 Source Run；
7. 中断/失败运行可恢复查看并可重试；
8. HTTP 与 Web 只经 CrawlPlanningModule interface；
9. 真实 PC 页面能看到规划搜索过程、计划详情、补充输入和确认结果；
10. 全程没有真实批量来源访问。
