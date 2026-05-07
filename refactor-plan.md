# Social Intelligence 产品重构详细方案

## 1. 产品立意与重构原则

当前系统的问题不是单个页面不好用，而是信息架构错了：它把用户要完成的“社媒洞察分析”拆成了 Topic、Query、Source、Task、Content 等工程对象。用户真正想做的是：输入一个分析目标，系统采集公开数据，自动清洗分析，输出洞察和报告。

重构后的产品不再是“爬虫配置后台”，而是一个轻量级 Social Intelligence 工作台。核心对象从技术实体改成业务实体：

- `Analysis Project`：用户关注的一个长期分析主题，例如“AI 搜索产品用户痛点”。
- `Analysis Run`：某次分析执行，例如“抓取 Reddit 最近 100 条公开讨论并分析”。
- `Content Sample`：某次 run 采集到的原始内容。
- `Insight`：AI 从内容样本中提取的结构化洞察。
- `Report`：面向人阅读和导出的分析结果。

重构原则：

- 删除面向工程配置的主导航，不让用户在 `Topics / Queries / Sources / Tasks / Content` 间来回跳。
- 所有内容必须可追溯到具体 `Analysis Run`，不能再出现全局混杂内容库。
- 所有筛选器必须对应真实数据字段和 API 查询能力，禁止静态占位 filter。
- Reddit 是 MVP 的唯一默认采集源；其他平台不作为一屏流程的一部分。
- 保留成熟库和当前技术栈：Fastify、Drizzle、SQLite、Zod、TanStack Query、Crawlee；不自研基础能力。

## 2. 删除与保留边界

### 删除前端主流程页面

彻底从主导航移除并删除这些页面文件：

- `TopicsPage.tsx`
- `QueriesPage.tsx`
- `SourcesPage.tsx`
- `TasksPage.tsx`
- `ContentPage.tsx` 当前实现
- `PlainModulePage.tsx` 中用于 settings scaffold 的占位逻辑

原因：

- `Topics/Queries/Sources` 是内部配置概念，不应该让用户按工程顺序操作。
- `Tasks` 只是 run log，不应该是一级页面。
- 当前 `Content` 是全局原始数据堆，不符合分析产品的上下文。
- `Sources` 在 MVP 只有 Reddit，独立页面没有价值。

### 删除或降级 API

删除对外暴露的用户流程 API：

- `POST /api/topics`
- `GET /api/topics`
- `POST /api/topics/:id/queries`
- `GET /api/topics/:id/queries`
- `POST /api/queries/:id/crawl`
- `GET /api/sources`
- `GET /api/crawl-tasks` 作为主业务接口
- `GET /api/raw-contents` 作为无上下文全局接口

保留内部 repository 能力，但不再作为前端主流程直接调用。`sources` 表可保留用于平台元数据；`topics/queries` 可在迁移后废弃，不再新增 UI 依赖。

### 保留并重命名导航

新的一级导航只保留：

- `Workspace`：核心分析工作台，默认首页。
- `Library`：跨项目内容样本库，必须带项目/run 筛选和来源标识。
- `Reports`：所有生成过的报告。
- `Settings`：运行配置、AI provider、Reddit 采集配置。

移除 `Overview / Topics / Queries / Sources / Tasks / Content / Analytics` 这种按技术阶段拆分的导航。

## 3. 新数据模型

### 新增 `analysis_projects`

业务含义：用户关注的长期分析主题。

字段：

```ts
id: string
name: string
goal: string
language: string
market: string
defaultPlatform: "reddit"
defaultLimit: number
status: "active" | "paused" | "archived"
createdAt: string
updatedAt: string
```

说明：

- 替代当前 `topics`。
- `goal` 是必填，因为 AI 分析和报告必须知道分析目标。
- MVP `defaultPlatform` 固定为 `reddit`，不再给用户展示多个平台按钮。

### 新增 `analysis_runs`

业务含义：一次完整分析执行。

字段：

```ts
id: string
projectId: string
name: string
status:
  | "draft"
  | "collecting"
  | "collection_failed"
  | "content_ready"
  | "analyzing"
  | "analysis_failed"
  | "insight_ready"
  | "reporting"
  | "report_ready"
includeKeywords: string[]
excludeKeywords: string[]
platform: "reddit"
limit: number
collectedCount: number
validCount: number
duplicateCount: number
analyzedCount: number
reportId?: string
errorMessage?: string
startedAt?: string
finishedAt?: string
createdAt: string
updatedAt: string
```

说明：

- 替代用户视角里的 `queries + crawl_tasks`。
- 用户点击一次 `Start analysis` 只创建一个 run。
- run 是所有内容、洞察、报告的上下文根。

### 调整 `crawl_tasks`

保留为内部运行日志，不再是用户主对象。

新增字段：

```ts
analysisRunId: string
```

保留字段：

```ts
sourceId
status
targetCount
collectedCount
validCount
duplicateCount
errorMessage
startedAt
finishedAt
```

删除或废弃字段：

```ts
topicId
queryId
```

迁移策略：

- 阶段性保留 nullable `topicId/queryId`，避免旧数据直接崩。
- 新代码不再写入 `topicId/queryId`。
- 后续稳定后移除旧字段。

### 调整 `raw_contents`

新增字段：

```ts
analysisProjectId: string
analysisRunId: string
crawlTaskId: string
matchedKeywords: string[]
```

保留字段：

```ts
platform
sourceId
externalId
url
authorName
authorHandle
text
metricsJson
publishedAt
capturedAt
rawJson
```

删除或废弃字段：

```ts
topicId
queryId
```

说明：

- 每条内容必须归属某个 `analysisRunId`。
- `crawlTaskId` 用于追踪哪次抓取产生该内容。
- `matchedKeywords` 用于解释为什么这条内容进入结果集。

### 调整 `cleaned_contents`

保留，但改成 run 上下文可查询。

新增字段：

```ts
analysisRunId: string
```

补齐用途：

- 去重结果
- 广告/无关判断
- 质量分
- engagement 分

### 调整 `analyzed_contents`

保留，但作为 MVP 下一阶段的核心输出表。

新增字段：

```ts
analysisRunId: string
```

字段必须结构化：

```ts
summary
contentType
topics
entities
intent
sentiment
insightScore
opportunityScore
contentOpportunity
reason
modelName
```

### 调整 `reports`

从 topic 绑定改为 run 绑定。

字段：

```ts
id: string
projectId: string
analysisRunId: string
title: string
type: "run_summary" | "content_opportunities" | "keyword_analysis"
status: "draft" | "ready" | "failed"
contentMarkdown: string
contentJson: Record<string, unknown>
createdAt: string
updatedAt: string
```

废弃：

```ts
topicId
dateRangeStart
dateRangeEnd
```

MVP 的报告范围默认来自 run，不需要用户单独选 date range。

## 4. 新用户流程

### 4.1 首次进入系统

默认进入 `Workspace`。

空状态不是显示一堆模块，而是一个明确入口：

- 标题：`Start a social intelligence analysis`
- 表单字段：
  - Analysis name
  - Goal
  - Include keywords
  - Exclude keywords
  - Language
  - Market
  - Reddit result limit
- 主按钮：`Start analysis`

用户填完后系统自动：

1. 创建 `analysis_project`，或在已有 project 下创建 run。
2. 创建 `analysis_run`。
3. 创建内部 `crawl_task`。
4. 启动 Reddit 公开数据采集。
5. 跳转到 run detail。

### 4.2 Run Detail 页面

一个页面承载完整闭环，不再跳页面。

页面结构：

- Header：
  - run 名称
  - status badge
  - started / finished time
  - collected / valid / duplicate / analyzed counts
  - retry / delete / generate report 操作

- Stage navigation：
  - `Setup`
  - `Collection`
  - `Content`
  - `Insights`
  - `Report`

每个 stage 是同一个 run 的不同视图，不是不同模块。

### 4.3 Setup

展示本次分析配置：

- goal
- include keywords
- exclude keywords
- platform: Reddit
- limit
- language
- market

允许在 draft 状态编辑。开始采集后只读。

### 4.4 Collection

展示内部 crawl task 状态：

- 当前采集状态
- 目标数量
- 已抓取数量
- 有效数量
- 重复数量
- 错误原因
- 开始时间
- 结束时间
- retry

这里替代原 `TasksPage`。

### 4.5 Content

只展示当前 run 的内容。

列表字段：

- 摘要文本
- Reddit 作者
- subreddit 或来源信息，如果 rawJson 可取
- 原文链接
- matched keywords
- published time
- captured time
- crawl task id
- metrics

筛选器只显示已实现字段：

- keyword search
- author
- published date range
- min score / comments，如果 metricsJson 里有
- duplicate / valid status，等 cleaning 实现后显示

不显示 sentiment、score、content type，直到 AI 分析落地。

### 4.6 Insights

如果还没实现 AI，显示真实状态：

- `Analysis is not configured yet`
- 按钮：`Run analysis` 仅在 AnalysisService 实现后启用

实现 AI 后展示：

- Top themes
- User intents
- Pain points
- Sentiment distribution
- High value samples
- Content opportunities

### 4.7 Report

如果无 report：

- 显示 `Generate report from this run`

生成后展示：

- markdown preview
- copy markdown
- export markdown
- 后续再做 PDF

## 5. API 设计

### Analysis Project API

```http
GET /api/analysis-projects?page=1&pageSize=20
POST /api/analysis-projects
GET /api/analysis-projects/:id
POST /api/analysis-projects/:id/update
POST /api/analysis-projects/:id/archive
```

`POST /api/analysis-projects` body：

```ts
{
  name: string
  goal: string
  language: string
  market: string
  defaultLimit: number
}
```

### Analysis Run API

```http
GET /api/analysis-runs?page=1&pageSize=20&projectId=&status=
POST /api/analysis-runs
GET /api/analysis-runs/:id
POST /api/analysis-runs/:id/start
POST /api/analysis-runs/:id/retry
POST /api/analysis-runs/:id/delete
```

`POST /api/analysis-runs` body：

```ts
{
  projectId?: string
  projectName?: string
  goal: string
  includeKeywords: string[]
  excludeKeywords: string[]
  language: string
  market: string
  limit: number
}
```

行为：

- 如果 `projectId` 存在，在该 project 下创建 run。
- 如果没有 `projectId`，创建 project 后创建 run。
- `start` 只允许 draft / collection_failed 状态。
- 重复 start 返回已有 running run，不创建并发任务。

### Run Content API

```http
GET /api/analysis-runs/:id/contents?page=1&pageSize=20&search=&author=&publishedFrom=&publishedTo=&minScore=
GET /api/analysis-runs/:id/contents/:contentId
```

返回内容必须包含来源上下文：

```ts
{
  id: string
  analysisRunId: string
  crawlTaskId: string
  platform: "reddit"
  authorName?: string
  authorHandle?: string
  url: string
  text: string
  matchedKeywords: string[]
  metricsJson: Record<string, unknown> | null
  publishedAt?: string
  capturedAt: string
}
```

### Run Log API

```http
GET /api/analysis-runs/:id/crawl-tasks
```

仅用于 run detail 的 Collection tab，不再作为全局 task center。

### Report API

```http
POST /api/analysis-runs/:id/report
GET /api/reports?page=1&pageSize=20&projectId=
GET /api/reports/:id
```

## 6. 后端实现拆分

### 新增 service 层

当前 routes 直接拼 repository 和 worker，重构后必须增加 service 层：

- `AnalysisProjectService`
- `AnalysisRunService`
- `ContentService`
- `CollectionService`
- `ReportService`

职责：

- route 只做 HTTP 参数解析。
- service 编排业务流程。
- repository 只负责数据库读写。
- worker 只负责执行采集/分析/报告 job。

### 新增 repository

新增：

- `createAnalysisProjectRepository`
- `createAnalysisRunRepository`
- `createRunContentRepository`
- `createRunReportRepository`

保留但内部化：

- `createSourceRepository`
- `createCrawlTaskRepository`
- `createRawContentRepository`

删除对 UI 暴露的 topic/query repositories 调用路径。

### CollectionService 逻辑

`startRun(runId)`：

1. 读取 run。
2. 校验状态。
3. seed Reddit source。
4. 更新 run status 为 `collecting`。
5. 创建 crawl task，带 `analysisRunId`。
6. 调用 worker queue。
7. worker 返回 items 后写入 raw contents，带 `analysisProjectId/analysisRunId/crawlTaskId`。
8. 更新 crawl task count。
9. 更新 run status 为 `content_ready`。
10. 如果失败，更新 run status 为 `collection_failed`，保留 errorMessage。

### ContentService 逻辑

- 所有 content 查询必须带 runId 或显式 global library 参数。
- 默认按 `capturedAt desc`。
- 支持分页。
- 支持 search / author / published range / min score。
- 查询返回时补齐 `crawlTaskId`、时间格式、matched keywords。

## 7. 前端重构

### 删除 AppShell 当前导航

新导航：

```ts
[
  { key: "workspace", label: "Workspace" },
  { key: "library", label: "Library" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" }
]
```

移动端仍使用 select 或 compact tabs。

### 新增页面

#### `WorkspacePage`

职责：

- 左侧：analysis runs 列表。
- 右侧：选中 run detail。
- 空状态：创建第一个分析任务。

组件：

- `RunList`
- `RunStatusBadge`
- `StartAnalysisForm`
- `RunDetail`
- `RunStageTabs`

#### `RunDetail`

tabs：

- Setup
- Collection
- Content
- Insights
- Report

状态映射：

- draft：Setup 可编辑，其他 tab disabled。
- collecting：Collection active。
- collection_failed：Collection 显示错误和 retry。
- content_ready：Content active。
- insight_ready：Insights active。
- report_ready：Report active。

#### `RunContentPanel`

替代当前 `ContentPage`。

必须：

- 只查 `/api/analysis-runs/:id/contents`。
- 显示 `crawlTaskId` 或短 ID。
- 显示 matched keywords。
- 显示 `Published` 和 `Captured`。
- filter 与 API 参数双向绑定。
- 分页沿用 `PaginationControls`。

#### `LibraryPage`

跨 run 内容库，但必须默认要求用户选择 project 或 run。

显示字段：

- run name
- project name
- content text
- source
- captured time

没有上下文时不展示混杂全量内容，只显示选择器。

#### `ReportsPage`

从占位页改成真实 reports 列表：

- report title
- project
- run
- status
- created time
- open

#### `SettingsPage`

只保留真实配置：

- Reddit collection mode
- API/worker runtime status
- AI provider placeholder disabled state

### 删除前端 API 方法

删除或停止使用：

- `fetchTopics`
- `createTopic`
- `updateTopic`
- `deleteTopic`
- `fetchQueries`
- `createQuery`
- `updateQuery`
- `deleteQuery`
- `fetchSources`
- `createSource`
- `updateSource`
- `runCrawl(queryId, platform)`

新增：

- `fetchAnalysisProjects`
- `createAnalysisProject`
- `fetchAnalysisRuns`
- `createAnalysisRun`
- `startAnalysisRun`
- `retryAnalysisRun`
- `deleteAnalysisRun`
- `fetchRunContents`
- `fetchRunCrawlTasks`
- `generateRunReport`
- `fetchReports`

## 8. 数据迁移策略

当前项目没有正式 migrations，使用 `initializeDatabase` 建表。重构时采用兼容式迁移：

1. 在 `packages/db/src/client.ts` 增加 idempotent schema upgrade helper：
   - `create table if not exists analysis_projects`
   - `create table if not exists analysis_runs`
   - `addColumnIfMissing(table, column, ddl)`
2. 给 `crawl_tasks` 添加 nullable `analysis_run_id`。
3. 给 `raw_contents` 添加 nullable：
   - `analysis_project_id`
   - `analysis_run_id`
   - `crawl_task_id`
   - `matched_keywords`
4. 旧数据迁移：
   - 如果存在旧 `topics/queries/raw_contents`，不强行推断 run。
   - 旧 content 在 Library 显示为 `Legacy content`。
   - 新流程创建的数据必须完整写入 run 关联字段。
5. 旧表暂时不删物理表，先删 UI/API 入口；下一轮确认无旧数据依赖后再删表。

这样既满足“该删的删”的产品和代码路径清理，也避免直接破坏本地 SQLite 数据。

## 9. 清理旧代码清单

### 删除文件

- `apps/web/src/pages/TopicsPage.tsx`
- `apps/web/src/pages/QueriesPage.tsx`
- `apps/web/src/pages/SourcesPage.tsx`
- `apps/web/src/pages/TasksPage.tsx`
- `apps/web/src/pages/ContentPage.tsx`
- `apps/web/src/pages/AnalyticsPage.tsx`
- `apps/web/src/pages/PlainModulePage.tsx`

### 新增文件

- `apps/web/src/pages/WorkspacePage.tsx`
- `apps/web/src/pages/LibraryPage.tsx`
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/pages/RunDetail.tsx`
- `apps/web/src/pages/RunContentPanel.tsx`
- `apps/web/src/components/RunStatusBadge.tsx`
- `apps/web/src/components/RunStageTabs.tsx`
- `apps/api/src/routes/analysisRoutes.ts`
- `apps/api/src/services/analysisRunService.ts`
- `apps/api/src/services/contentService.ts`

### 修改文件

- `apps/web/src/App.tsx`
- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/lib/api.ts`
- `apps/api/src/server.ts`
- `apps/api/src/routes/modules.ts`
- `packages/db/src/schema.ts`
- `packages/db/src/client.ts`
- `packages/db/src/repositories.ts`
- `packages/worker/src/jobs.ts`
- `packages/worker/src/adapters/types.ts`
- `packages/shared/src/schemas.ts`
- `packages/shared/src/domain.ts`

## 10. AI 分析与报告的 MVP 边界

这次重构必须为 AI 和报告留出正确位置，但不假装已经实现完整 AI。

MVP 这轮做到：

- run 生命周期包含 `analyzing / insight_ready / report_ready` 状态。
- `Insights` tab 有真实空状态。
- report API 可以先生成 deterministic markdown 报告：
  - run 配置
  - 样本数量
  - top authors
  - top keywords
  - high engagement samples
  - source links
- AI provider 未配置时，不显示假的 sentiment/score/filter。

下一轮 AI 才实现：

- clean content
- analyze content
- aggregate insights
- LLM report generation

## 11. 测试计划

### DB tests

- 创建 analysis project。
- 创建 analysis run。
- start run 创建 crawl task。
- raw content 写入时必须包含 analysisRunId 和 crawlTaskId。
- run content pagination 只返回该 run 内容。
- legacy content 缺少 runId 时不会破坏 Library 查询。
- schema upgrade helper 重复执行不报错。

### API tests

- `POST /api/analysis-runs` 可创建 project + run。
- `POST /api/analysis-runs/:id/start` 会启动 Reddit collection。
- collecting 成功后 run 变为 `content_ready`。
- collection 失败后 run 变为 `collection_failed` 且保留 errorMessage。
- `GET /api/analysis-runs/:id/contents` 不泄漏其他 run 内容。
- filters 生效：search、author、published range。
- 删除旧公开 topic/query/source/crawl/raw-content 接口后，前端不再引用。

### Web tests

- API client 拼接新接口。
- Workspace 空状态显示创建表单。
- 创建 run 后进入 detail。
- Collection tab 显示状态和错误。
- Content tab 只展示当前 run 内容。
- Library 没有上下文时不展示全局混杂数据。
- Reports 页面展示真实 reports response。
- 时间统一格式化仍通过。

### Verification

- `npm test`
- `npm run typecheck`
- `npm run build`
- 手动启动 `npm run dev`
- 创建一个 Reddit analysis run，确认：
  - 一个按钮启动
  - 内容归属 run
  - content 能看到 crawlTask/run 来源
  - 不需要进入 Topics/Queries/Sources/Tasks

## 12. 实施顺序

1. 先改 DB schema 和 repositories，建立 `analysis_projects / analysis_runs / run content` 基础。
2. 增加 service 层，完成 create/start/retry/run content 查询。
3. 增加 analysis routes，并从 server 注册。
4. 改 worker payload，让采集结果写入 run/task 关联字段。
5. 改 shared schemas 和 web API client。
6. 重写 AppShell 导航和 Workspace 页面。
7. 实现 RunDetail 五个 tab。
8. 实现 Library 和 Reports。
9. 删除旧页面和旧前端 API 引用。
10. 删除旧 routes 的对外注册，保留 repository 兼容旧数据。
11. 补测试。
12. 跑完整验证。

## 13. 明确默认决策

- 默认只支持 Reddit，平台选择不在主流程出现。
- 默认创建 run 时自动创建 project；高级 project 管理以后再做。
- 默认每个 run 是一次快照，不做后台定时监控。
- 默认 content 不做全局混杂展示，必须有 project/run context。
- 默认不显示未实现的 sentiment、score、content type filter。
- 旧 topic/query/source/task 概念从用户界面删除，作为内部兼容层过渡。
- 报告先做 deterministic markdown，AI 报告作为后续增强。
