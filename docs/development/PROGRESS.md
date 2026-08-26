# 数据抓取与清洗平台开发进度

更新日期：2026-08-26
当前阶段：`ROADMAP.md` 1E。`public.web-resource@2.0.0` 的 exact/site 多路由、内容验收、低频 ZOL 电视门类真实系统重跑和原字节编码门已通过；DBOS 可恢复规划已生成电视 v11 draft，尚未确认或启动。
总体状态：采访 → Markdown 确认 → Capture Task → DBOS 可恢复 Crawl Planning → Crawl Plan Draft → 人工确认 → Prepare → Graphile 后台 Start/Resume → Source Dataset 已形成生产主链。ZOL 已证明能低频保存品牌/型号/参数密集原文；品牌占位质量门已修复。DBOS 4.25.14 已按稳定品牌发现/饱和/市场目录/官网批次/知识来源阶段接入生产组合根，并通过真实页面断连和两次 API `SIGKILL` 恢复。最新电视 v11 为 50 品牌、43 来源、72 target 的未确认草稿；质量审计发现 ZOL target 被错误标注为覆盖全部 10 个任务 topic，因而当前不得确认或开始抓取。阶段 2 未获授权。
当前积分：85.5（以 `AGENT-SCORECARD.md` 为准）

## 1. 本轮目标

用户已确认项目只有两个阶段：数据抓取、数据清洗，并进一步确认从首句到执行必须分成四段。当前先把 1A 纠正为“采访文字记录与搜索事实 → Markdown 范围确认 → 确认后正式结构化”，同时保留 1B 对来源、内容、数量和停止口径的独占结构化职责；任何确认都不得自动创建 Source Run。

## 2. 已完成的代码清理

删除或退出正式组合根：

- 旧 Social 分析、旧 SQLite 分析库与相关 API；
- 品类参数编辑器、Category Definition、Confirmed Scope、Collection Board 和 Market Universe；
- Evidence、Knowledge Factory、Review、知识包和 Runtime；
- 旧通用 Pipeline/DBOS 组合、Planner 规则、京东/官网/监管 Provider 和站点 DOM 解析；
- 全部 `docs/development/pocs/**`、独立实验依赖和隔离数据库脚本；
- 与上述错误契约同构的测试和 fixture。

保留并收窄：

- Workbench Chat Timeline 和本地 Codex App Server ephemeral 单轮执行；
- Interview Message、Decision、Unresolved Item；
- Capture Task、Source Run、Source Object、Source Snapshot、Source Asset；
- 原始数据查看和 JSONL/CSV 导出；
- Crawlee 临时存储，以及 `p-queue` + `cockatiel` 的频控、取消和熔断基础。

## 3. 当前对话产物

完成对话后得到一个版本化 Markdown `采访范围草案`，用自然语言包含：

- 用户原始需求；
- 商品门类；
- 中国大陆普通消费者实际可购买的市场口径，不按品牌国籍排除；
- 通用抓取内容和该品类补充内容；
- 平台来源范围（京东由标准商品平台来源策略确定，不作为负责人取舍题；淘宝是后续同级候选，当前只有精确公开入口 Provider，没有淘宝专用 crawler、分页或登录能力）；
- 系统通过已完成搜索得到的来源事实及当前已知格式和访问状态，不把搜索结果冒充已接入或已抓取；
- 排除项、未决项和已确认决定。

采访回合不生成正式任务字段。用户整体确认 Markdown 后，Workbench 才发起一次禁止搜索和新增事实的独立转换，校验并生成正式 Capture Task；不会自动启动 Crawl Planning 或真实抓取。草稿或正式任务范围不足时都能继续原对话：新草稿追加版本，后续确认保持 Capture Task ID 不变并推进 revision，历史确认草案不覆盖。

## 4. Baseline Impact

```text
Baseline Impact:
- touched modules: shared Crawl Plan contract, db migration, Workbench Planning Module/App Server adapter, API SSE, task-page Web, repository Skill and authority docs
- owning fact source: Capture Task owns confirmed scope; Planning Run owns generation history; versioned Crawl Plan owns source/content/quantity decisions; Source Dataset continues to own future raw captures
- public interface changed: yes, added Crawl Planning view/run/confirm contracts and HTTP routes
- new protocol/adapter/fallback: reuses the existing App Server stdio seam; no new transport, queue or fallback
- compatibility or legacy path changed: yes, existing legacy source_collection_plans rows remain readable and are excluded from the new task/version uniqueness rule
- research update required: yes, R-035 records why the visible foreground App Server run is used and durable background workflow is deferred
- architecture or ADR update required: architecture and roadmap clarified for 1B; ADR-0012 records the explicit bounded exception to the former 1A sequencing gate; no new technology ADR
- tests and real-surface validation to run: migration, full typecheck/test/build, current task Planning Run, refresh recovery and zero-Source-Run check
```

## 5. Patch Disposition

```text
Patch Disposition:
- delete: stage-2 modules, old project schemas, parameter editor, legacy Social chain, POCs, unused Providers and同构 tests
- keep: interview timeline, PostgreSQL source rows, raw source identity/history, rate limiting and circuit breaker
- rewrite: shared contracts, DB schema, Workbench composition, API routes, Web workspace, interview Skill and authority docs
- reason: old patch encoded cleaning/knowledge assumptions before raw acquisition was proven and could not produce the requested stage-1 MVP
```

### 2026-08-18 真实文字流修复

```text
Baseline Impact:
- touched modules: Workbench Codex transport adapter, interview runtime prompt/projection, R-029 and architecture/progress baselines
- owning fact source: unchanged; Workbench/PostgreSQL owns messages and interview state, Codex owns no product thread
- public interface changed: no; existing assistant.delta SSE contract is now fed by real item/agentMessage/delta
- new protocol/adapter/fallback: yes, replace codex exec JSONL adapter with official App Server stdio adapter; no fallback
- compatibility or legacy path changed: no persisted task/message schema change
- research update required: yes, earlier App Server ephemeral and outputSchema conclusions were incorrect
- architecture or ADR update required: architecture clarification/change at external runtime seam; no domain ownership change and no ADR
- tests and real-surface validation to run: adapter fake protocol tests, six-workspace typecheck/test/build, real Codex delta/search/final schema, live Workbench browser
```

```text
Patch Disposition:
- delete: codexExecClient, --output-schema, --output-last-message, ignored agent_message path, tests protecting one-shot text
- keep: execa lifecycle, ndjson JSONL decoding, Zod final validation, typed SSE, assistant-ui ExternalStoreRuntime, Workbench fact ownership
- rewrite: Codex transport as ephemeral App Server stdio state machine and split commentary delta from final machine JSON
- reason: outputSchema constrained commentary into JSON, while the old adapter discarded agent message content and could never produce true text streaming
```

### 2026-08-18 Agent 反馈与任务修订回归

```text
Baseline Impact:
- touched modules: shared interview contract, Workbench Codex adapter/interview module, API interview routes, Web timeline/task workspace, authority docs
- owning fact source: Workbench Interview owns messages/decisions/drafts; Capture Task owns current confirmed revision
- public interface changed: yes, turn.activity changed from fixed string to typed activity object; decision confirm carries the actual clicked selection; task-to-interview read route added
- new protocol/adapter/fallback: no fallback; existing Codex JSONL adapter now exposes sanitized item progress
- compatibility or legacy path changed: question-only model output is normalized to proposed Decision; existing confirmed tasks remain readable
- research update required: yes, official Codex JSONL/final-output boundary and assistant-ui empty-part behavior recorded in R-028/R-029
- architecture or ADR update required: architecture clarification only; fact ownership and dependency direction unchanged, no ADR
- tests and real-surface validation to run: full typecheck/test/build, 720px browser layout, real web_search/tool activity, actual option selection, draft continuation, confirmed-task revision entry
```

```text
Patch Disposition:
- delete: fixed activity-string overwrite, fake assistant text delta, redundant second confirmation action, empty running assistant bubble
- keep（该轮历史处置；Codex transport 已由下方真流式修复替换）: assistant-ui ExternalStoreRuntime, final structured Zod validation, immutable confirmed draft versions
- rewrite: JSONL item projection, append-only activity reducer, clicked-option confirmation, confirmed-task revision path, obsolete string-status test
- reason: the old patch hid real runtime work, allowed status regression, stored only one of two valid question shapes, and ended the conversation too early
```

### 2026-08-19 Timeline 与负责人回答交互纠错

```text
Baseline Impact:
- touched modules: shared interview confirmation, Workbench interview/Codex adapter, Web Timeline/Composer, product and architecture baselines
- owning fact source: unchanged; Workbench/PostgreSQL owns messages and Interview Decision, Web only projects ordered parts
- public interface changed: yes; decision confirmation now accepts a Composer answer up to 2000 characters and persists its user message
- new protocol/adapter/fallback: no new runtime or fallback; existing App Server item projection now retains only a safe command exit summary
- compatibility or legacy path changed: yes; independent Decision Card and out-of-band Activity Panel leave the production path
- research update required: yes; assistant-ui ordered data parts/live-edge scrolling and App Server command item fields recorded in R-028/R-029
- architecture or ADR update required: architecture interaction contract clarified; module ownership/dependency direction unchanged, no new ADR
- tests and real-surface validation to run: ordered-part reducer, custom-answer PostgreSQL integration, fake App Server, six-workspace typecheck/test/build, real Workbench browser
```

```text
Patch Disposition:
- delete: independent activity panel, independent decision card, raw command detail, fixed bottom offset and obsolete activity reducer/test
- keep: assistant-ui ExternalStoreRuntime, App Server ephemeral turn, typed SSE/item IDs, Workbench fact ownership, Capture Task Draft card
- rewrite: one assistant turn as ordered text/activity parts, Composer decision answer, safe failed-command summary, scroll-to-live-edge placement and regression tests
- reason: the previous patch split one chronological turn into unrelated UI regions and turned suggestions into a closed form that rejected valid user answers
```

### 2026-08-19 工具详情与生命周期真实页面纠错

```text
Baseline Impact:
- touched modules: Web Timeline part presentation, Workbench App Server event projection, focused tests, R-028/R-029 and progress baseline
- owning fact source: unchanged; Workbench/PostgreSQL owns messages and decisions, Web projects ordered parts
- public interface changed: no shared/API contract change; internal App Server event type now declares its existing phase field
- new protocol/adapter/fallback: no new protocol or fallback; existing webSearch/commandExecution/agentMessage fields are projected more accurately
- compatibility or legacy path changed: no
- research update required: yes; official item lifecycle and the real-surface regression are recorded
- architecture or ADR update required: interaction contract clarification only; no ownership or dependency change, no ADR
- tests and real-surface validation to run: boundary whitespace, lifecycle in-place update, visible safe tool detail, final-answer activity, full typecheck/test/build
```

```text
Patch Disposition:
- delete: collapsed tool detail, redundant completed connection/start rows, tool-boundary blank lines
- keep: ordered assistant parts, same-item in-place updates, ephemeral App Server, raw command/output redaction
- rewrite: lifecycle IDs, tool/status visual projection, safe command purpose, final-answer activity and regression fixtures
- reason: the prior patch preserved event order but still hid useful tool context and exposed infrastructure transitions as separate product history
```

### 2026-08-19 Web Search 折叠、网址保留与对齐纠错

```text
Baseline Impact:
- touched modules: App Server webSearch adapter, shared interview activity, Web ordered-part projection/presentation, focused tests and authority docs
- owning fact source: unchanged; App Server owns ephemeral tool events, Workbench owns product messages/decisions, Web only projects the current turn
- public interface changed: yes; existing InterviewTurnActivity adds optional bounded urls
- new protocol/adapter/fallback: no new runtime or fallback; the existing adapter now consumes official results and raw web_search_call action fields
- compatibility or legacy path changed: optional field only; old activities without urls still render
- research update required: yes; R-029 records the generated official schema and opaque-results boundary
- architecture or ADR update required: architecture interaction contract clarified; ownership and dependency direction unchanged, no ADR
- tests and real-surface validation to run: fake App Server result/raw-action cases, same-item retention, same-turn aggregation, full typecheck/test/build, real Workbench collapse/expand/alignment
```

```text
Patch Disposition:
- delete: independent bordered web-search cards and manual icon top offsets
- keep: assistant-ui ordered parts, command/MCP tool summary, App Server ephemeral turn and redaction boundary
- rewrite: URL extraction/retention, same-turn web-search aggregation and the disclosure row
- reason: the old patch exposed implementation calls as separate cards and discarded actual page URLs behind query precedence
```

### 2026-08-19 工具时间线刷新持久化与工程命令隔离纠错

```text
Baseline Impact:
- touched modules: shared assistant message/timeline contract, PostgreSQL interview message schema/migration, Workbench turn persistence, App Server interview runtime, Web refresh reconciliation, focused tests and authority docs
- owning fact source: Category Interview Module / PostgreSQL; App Server events are ephemeral inputs and Web remains a projection
- public interface changed: yes; NormalizedInterviewMessage adds optional ordered timelineParts
- new protocol/adapter/fallback: no new runtime or fallback; the authoritative Skill is copied into an isolated standard skill root, official skill input is explicit, and stable shell_tool/unified_exec features are disabled
- compatibility or legacy path changed: old messages without timelineParts continue to display final text only; unrecoverable historical tool events are not fabricated
- research update required: yes; R-029 corrects command projection, skill injection and refresh persistence conclusions
- architecture or ADR update required: architecture contract changed for persisted message timeline and runtime instruction isolation; ownership/dependency direction unchanged, no ADR
- tests and real-surface validation to run: red/green DB persistence, fake App Server command isolation, true full-refresh reducer, full typecheck/test/build, real Workbench run/reload/expand/delete
```

```text
Patch Disposition:
- delete: commandExecution product projection, local-command purpose mapper, fake refresh test that reused live browser parts
- keep: ordered assistant presentation, same-item activity updates, web-search URL extraction/folding, icon/text center alignment, ephemeral App Server and Workbench fact ownership
- rewrite: assistant timeline assembly/persistence/recovery and product runtime cwd/Skill synchronization/injection/tool-capability boundary
- reason: the old patch fixed the live screen but did not persist tool history and still leaked engineering-agent bootstrap into the product conversation
```

### 2026-08-19 产品文档统一与标准商品采访边界

用户确认：

- 采访 Skill 面向有稳定品牌、型号、规格、分类或标准的标准商品，例如冰箱和电视机；手工制品等非标准商品不在当前范围；
- Agent 是专业抓取任务顾问，参考 `grill-with-docs` 用调查、解释、推荐和一次一问推动负责人理解并确认真实取舍；
- 推荐项应当是当前证据下的专业默认答案，不能为了凑出相悖选项制造问题；
- 对冰箱等家电，京东是必须覆盖的核心平台数据源，淘宝是后续同级多平台来源且当前没有 crawler/Provider；不把“是否纳入京东/淘宝”或网站选择作为负责人问题。

文档处置：

- 重写产品导航、PRD、总体技术方案和 MVP 实施计划，使其与当前两阶段架构、`CONTEXT.md`、`ROADMAP.md` 和代码主线一致；
- 旧 Provider/知识包产品规范明确降为历史资料；旧需求问题树改为当前有效决定；
- ADR-0012 改为标准商品专业采访与 Capture Task，新增 ADR-0015 记录原始数据优先的两阶段产品决定；旧知识生产 ADR 标记为由 ADR-0015 取代；
- 更新 `AGENTS.md`、`CONTEXT.md`、`ARCHITECTURE.md`、`ROADMAP.md` 和 `RESEARCH.md` 的当前适用边界。

```text
Baseline Impact:
- touched modules: authority/product/domain/architecture/progress docs only
- owning fact source: Capture Task Interview / Capture Task; Source Dataset owns raw source data
- public interface changed: no; current jd schema mismatch is recorded, not hidden
- new protocol/adapter/fallback: no
- compatibility or legacy path changed: old knowledge-platform docs and ADRs become historical
- research update required: no new technology; current-applicability index corrected
- architecture or ADR update required: yes, product scope and interview responsibility changed
- tests and real-surface validation to run: documentation consistency search and diff check; Skill behavior requires later real Workbench acceptance
```

本轮架构影响：改变产品适用范围和采访职责基线，但没有修改生产代码或公共 contract。Skill 如何承载平台策略、来源观察层级以及确定性草稿门仍在设计讨论中；未确认前不得直接实现。

### 2026-08-19 Capture Task 到 Crawl Plan 纵切片

```text
Baseline Impact:
- touched modules: shared Crawl Planning contract, Workbench DB/schema/module/Codex runtime, API SSE, Web task page, repository Skill, migration and authority docs
- owning fact source: Capture Task owns requested scope; Crawl Plan owns source/content/quantity; Planning Run owns generation history; Source Run remains future execution fact
- public interface changed: yes, add typed CrawlPlanningView/Event and three HTTP routes
- new protocol/adapter/fallback: reuse existing App Server stdio and SSE; no fallback, Provider, background queue or persistent Codex thread
- compatibility or legacy path changed: existing source_collection_plans rows remain distinguishable because only rows with planning_run_id enter the new planning view
- research update required: yes, R-035 records App Server reuse and DBOS/background queue deferral
- architecture or ADR update required: architecture fact ownership and module boundary updated; no new difficult-to-reverse technology ADR
- tests and real-surface validation to run: contract, fake App Server, PostgreSQL integration, API/Web projection, full typecheck/test/build, real PC Workbench planning run
```

```text
Patch Disposition:
- delete: none; no prior production Crawl Planning implementation existed
- keep: Capture Task revision, ordered Agent timeline, App Server ephemeral runtime, Source Dataset and immutable raw-data boundary
- rewrite: unconnected legacy SourceCollectionPlan shape is retained for old rows while new rows receive planning_run_id/version/status and the new Crawl Plan content contract
- reason: the new contract must directly decide source/content/quantity without pretending that Provider, frequency, permission or persistence gates have passed
```

实现边界：Planning Run 只使用 App Server 网页搜索，所有来源当前标为 `search_discovered`；未验证的 Provider、许可、登录、验证码、风控、频控和持久化能力必须进入 `executionBlockers`。运行连接关闭即中止，完成版本持久化；不引入 DBOS、手写队列、Agent registry 或自动开始抓取。

本轮架构影响：改变。新增 Crawl Planning Module 与公共 typed contract，明确它独占“来源、内容、数量”的计划事实；Capture Task、Planning Run、Crawl Plan 与 Source Run 的 ownership 分离，API/Web 只适配和投影。依赖方向仍为 Web → API → Workbench → DB/注入式 Codex runtime。

## 6. 验证记录

本节按时间保留历史验证证据；其中“返回京东范围问题”“Workbench 直接规范化数字答案”“首轮或任意重试看到搜索即通过”等结果已经被后续根因修复取代，只证明当时的 transport/UI 局部能力，不代表当前采访契约。当前有效契约及待验证门以本节末尾“采访工作资料与状态边界补全”为准。

- `npm install` 与依赖清单收口：成功；移除旧表单、旧 POC 和旧组合根的无调用方依赖，lockfile 中 `node_modules` package entries 由 910 降至 768（净减少 142）。当前审计仍报告 19 个依赖漏洞（1 low / 6 moderate / 9 high / 3 critical），未擅自执行 breaking `audit fix`。
- `npm run typecheck`：shared、db、workbench、worker、api、web 全部通过。
- `npm test`：宿主权限下 6 个文件通过、1 个真实时间 acceptance 跳过；14 tests passed / 1 skipped。首次沙箱失败仅因禁止 4 个 fixture 监听 127.0.0.1，宿主重跑未改代码即通过。
- `npm run build`：全部 workspace 通过；Web 2295 modules，主 JS 546.04 kB / gzip 161.63 kB，仍有大于 500 kB warning。
- Drizzle 已生成并审计 `0010_oval_bushwacker.sql`；已修正 CASCADE 后重复删外键、已有附件表直接新增 NOT NULL filename 两个迁移问题。
- `drizzle-kit check`：在项目规定的 arm64 Node 24 下通过；从 package 子目录直接启动 shell 会误命中旧 x64 Node 21，因此开发命令必须继续走根脚本的 runtime gate。
- Skill 官方校验脚本未运行成功，因为脚本运行环境缺少 `PyYAML`；未为了校验新增项目依赖。仍需在依赖齐备环境补跑。
- 本机迁移：`0010_oval_bushwacker.sql` 已应用为 migration id 12。迁移前后均保留 12 个任务、2 个任务草稿、5 个采访会话、36 条消息、12 条决定、2 个未决项；Source Dataset 的 plan/run/object/snapshot/asset 均为 0。
- 真实启动：API `http://127.0.0.1:4000/health` 返回 200，任务列表可读取 12 条历史任务；Web 因 6173 已被其他进程占用运行在 `http://127.0.0.1:6174/`。
- 浏览器真实页面：任务列表和任务详情正常渲染，无 console error；修复了“新建任务恢复旧采访”和“草稿只显示来源数量无法审查”两个 Web 投影问题。新建入口现在是空白对话，草稿与确认后任务共用完整内容展示。
- 本机数据清空：经用户明确授权，已在单个 PostgreSQL 事务中清空 `workbench` 全部业务数据，以及两个旧 DBOS schema 的运行数据；复查三类运行/业务行数均为 0。`workbench.__drizzle_migrations` 保留 12 条，两个 DBOS schema 各保留 1 条 migration，表结构未删除。由本轮启动的 API/Web 服务已停止，4000 和 6174 端口已释放。
- 2026-08-18 用户真实使用暴露三项生产回归：提交后无 Agent 反馈、composer/按钮不符合 Chat、失败时直接展示 Codex stderr/ANSI。根因是 adapter 只累计 JSONL event 名并等待进程退出、Web 使用固定高度且并列渲染 Send/Cancel、错误边界直接拼接 stderr；同时真实 Codex 揭示模型输出 schema 仍含不支持的 `format: uri`。
- 当前修复复用既有 `assistant-ui`、`ndjson`、`eventsource-parser` 和 `execa`：新增受控 `turn.activity` 事件，`thread.started`、`turn.started`、`web_search` 等只在 Workbench adapter 内映射为启动/分析/调查/工具活动；`--ignore-user-config` 隔离无关用户 MCP；公开错误不再包含 stderr、ANSI 或原始 CLI 事件。模型 schema 去除不支持的 `format`，最终值仍由原始 Zod `.url()` 等规则校验。
- 真实浏览器复验：发送后 250ms 内显示“正在启动抓取规划 Agent…”，随后依真实事件切换为“正在分析你的需求…”和“正在调查相关品牌、参数和候选来源…”；运行时只显示 Stop，空闲时只显示 Send。长消息下 document scrollHeight 等于 720px 视口，消息区独立滚动，composer bottom=646px、聊天区 bottom=688px；不再被内容顶出视口。
- 真实 Codex/Workbench 复验：`gpt-5.6-terra + medium` 完成冰箱首轮调查，观察到启动、分析和多次 `web_search` 活动，最终返回海尔官网、国家标准/能效备案、京东访问状态，以及“完整京东范围/仅商品资料/不纳入京东”三个选项和推荐项。该结果只证明运行链恢复，问题内容仍待用户验收。
- 追加式 Agent 活动回归：fake Codex 覆盖 `web_search` started/completed、reasoning 交错、command/MCP 摘要、停止和 ANSI/502 错误；Web reducer 覆盖同一 item 状态更新、历史步骤保留和本轮完成关闭 loading。旧 `searching_sources` 字符串契约测试先在全量测试中失败，已重写为 typed activity 不变量。
- 该轮历史任务修订数据库回归：只返回 `question` 的 runtime output 能形成 proposed Decision，旧 UI 点击非推荐项后保存实际选择；首次确认创建任务，确认后继续对话形成新草稿，再次确认保持 task ID 不变、revision 前进，并保留两个不可变 confirmed draft 版本。当前回答入口已由 2026-08-19 Composer contract 替代。
- 当前自动验证：六 workspace `npm run typecheck` 通过；生产 `npm run build` 通过（Web 2297 modules，主 JS 553.19 kB / gzip 163.62 kB，仍有既存 500 kB warning）；连接本机 PostgreSQL 的全量 Vitest 为 8 files passed、1 skipped，17 tests passed、1 skipped。
- 当前真实浏览器验证：720px 视口下 document scrollHeight=720、聊天区高 487px、composer bottom=646px；空闲只有 Send、运行只有 Stop。发送后 700ms 出现“连接本机 Codex”，运行中逐条展示真实 web search query 和只读命令摘要，无空白 Agent 气泡；点击“仅商品信息”后无需第二次确认，数据库 confirmed selection 精确为“仅商品信息”。确认后产生 v1 草稿，显示 3 个本轮实际候选来源、“继续补充或修改”和版本不覆盖说明；既有已确认任务可进入“继续对话修改范围”。
- 本轮真实页面验收创建的临时会话 `interview-session-6f9d8f50-602d-4651-a78d-59cba05b4e69`（5 消息、2 决定、1 草稿、0 正式任务）已按精确 ID 在单事务中清理，复查 remaining=0；未删除或修改用户既有正式任务。API/Web 已停止，4000/6173 监听均为空。
- 历史 macOS 开发端口复验：当时宿主权限执行 `npm run dev:stop` 可释放 4000/6173，Node watch 重启与 Ctrl-C 后 `lsof` 无监听；该结果不能证明 Windows 的嵌套 npm batch/watcher 生命周期，Windows 纠错结果以下方 2026-08-18 记录为准。
- 默认测试门修正：此前直接 `vitest run` 未加载 `POSTGRES_DATABASE_URL`，会把抓取任务确认/修订集成测试静默标成 skipped。根 `npm test` 现在先确保本地库，再由 Node 24 官方 `--env-file` 直接启动 lockfile 声明的 Vitest CLI；第一次采用 `node --run` 中转的补丁仍会跳过，已删除并重写，不新增依赖。
- 真流式协议验收：本机 `@openai/codex@0.147.0` 稳定生成类型确认 `thread/start.ephemeral`、`item/agentMessage/delta` 和 commentary/final_answer phase；临时生成目录已删除。真实 CLI 探针证明带 `outputSchema` 时 commentary 也是 JSON，移除后正常中文按 token 到达，final_answer 仍能被 JSON/Zod 校验。
- 真实 Codex 直连验收：`gpt-5.6-terra + medium` 的冰箱首轮连续产出中文 `text_delta`、多个 `web_search` activity，并最终返回通过业务 schema 的京东范围问题；进程正常退出。
- 真实 Workbench 浏览器验收：新建“电饭煲”任务后，8 秒内已有连接/启动/分析及 elapsed 状态，随后出现逐 token 中文气泡与真实搜索活动；本轮完成后显示结构化三选一京东问题，console error/warn 为 0。验收产生的精确临时 session `interview-session-5a47a5b8-b9f4-4c70-bd16-8734bc723604` 已在单事务中删除其 1 session、2 messages、1 decision、2 unresolved items，复查 remaining=0；未改用户既有正式任务。
- 2026-08-18 Windows 拉取后启动恢复：在 `master`/`819c4e8` 干净基线上复现 `npm run dev` 于 `db:ensure-local` 报 `ECONNREFUSED 127.0.0.1:5432`；核对确认仓库既有 `data/postgresql` 是 PostgreSQL 14 完整数据目录，只是服务器进程停止。使用官方 `pg_ctl` 原样恢复该目录，未初始化、删除或覆盖数据库；`domain_analysis` 随后可连接。
- Windows 本机依赖同步：Node `v24.14.1`、npm `11.11.0` 通过 runtime gate；拉取后的安装树缺少新 lockfile 中的 `kill-port-process`，执行 `npm install` 后 `dev:stop` 可用。npm 对 lockfile 的平台性机械改写已撤销，仓库锁文件保持 `819c4e8` 原样。
- Windows 当前自动验证：六 workspace `npm run typecheck` 通过；连接本机 PostgreSQL 的 `npm test` 为 8 files passed、1 skipped，17 tests passed、1 skipped；`npm run build` 通过，Web 2297 modules，主 JS 553.19 kB / gzip 163.62 kB，保留既存大于 500 kB warning。
- Windows 启停根因与修复：用户复现的 4000 冲突来自旧根启动链遗留的嵌套 npm batch 和 `node --watch` 父进程；旧 `dev:stop` 只终止监听子进程，并会把已空闲的 6173 打印成失败。默认 `npm run dev` 现经 `concurrently` 程序化 API 在各 workspace 的真实 `cwd` 直接启动 API/Vite，不再嵌套 npm 或 API watcher；`dev:api` 独立热重载命令保留。`dev:stop` 用 `wait-on` 预检，只停止实际活动端口，空闲状态重复执行也成功。
- Windows 两轮生命周期回归：每轮 `npm run dev` 后 API `/health`、Web HTML、`/src/styles.css` 和 `/src/main.tsx` 均返回 200，CSS 已实际经过 Vite/Tailwind 转换；每轮 `npm run dev:stop` 后 4000/6173 监听数为 0、仓库相关开发进程数为 0，第二轮未出现 `EADDRINUSE`。该证据保护本地启停和资源转换，不替代真实浏览器/Codex 采访验收；PostgreSQL 5432 保持运行，供用户自行启动 Workbench。
- 安全核查：诊断未处理的 `concurrently` rejection 时曾打印其完整 Command 对象和继承环境；启动脚本现只保留子进程日志及非零退出码，不再打印环境对象。输出涉及的 `.env.example` 是 HEAD 已有、被 Git 跟踪且本轮未修改的配置；其本地数据库连接信息不是本补丁引入，但应另行确认是否需要轮换和改为非敏感示例，本轮未擅自改凭据或数据库。
- 2026-08-19 红色工具项复核：截图中的 App Server `commandExecution` 确实返回 failed，但旧 adapter 只保留 status 和完整 command，未保留 `exitCode/aggregatedOutput`，所以历史精确 stderr 已无法恢复。同一命令当前复跑 exit 0、输出约 25k 字符、四个目标文件与 PowerShell 路径均存在；不能把它归因为当前可复现的缺文件或语法错误。当前 adapter 不再把完整命令送到 Web，失败时只显示安全退出码。
- 2026-08-19 最终自动验证：六 workspace `npm run typecheck` 通过；连接本机 PostgreSQL 的全量 `npm test` 为 8 files passed、1 skipped，18 tests passed、1 skipped；`npm run build` 通过（Web 2298 modules，主 JS 558.58 kB / gzip 165.76 kB，保留既存大于 500 kB warning）。其中定向 3 files / 8 tests 覆盖事件顺序、同 item 原位更新、刷新保留、建议外回答入库和命令脱敏；自动证据不替代真实页面验收。
- 2026-08-19 第二轮真实截图证明：`webSearch` 详情实际已到达但被默认折叠；工具后的 text part 因前导换行形成大块空白；每轮 ephemeral App Server 的连接/thread/turn 状态被保留成三行；`final_answer` 生成等待没有准确状态。当前修复后再次运行六 workspace `npm run typecheck` 通过；全量 `npm test` 为 8 files passed、1 skipped，18 tests passed、1 skipped；`npm run build` 通过（Web 2298 modules，主 JS 560.07 kB / gzip 166.08 kB，保留既存大于 500 kB warning）。定向 2 files / 6 tests 保护生命周期同 ID、工具边界去空行、搜索/命令安全详情及 final-answer 状态；修复后的真实浏览器绿色表面尚未复验。
- 2026-08-19 Web Search 纠错最终验证：六 workspace `npm run typecheck` 通过；宿主 PostgreSQL 全量 `npm test` 为 8 files passed、1 skipped，19 tests passed、1 skipped；`npm run build` 通过（Web 2298 modules，主 JS 562.26 kB / gzip 166.62 kB，保留既存大于 500 kB warning）。定向 2 files / 7 tests 保护 App Server 高层 opaque `results`、raw `open_page`、URL 协议/凭据边界、同 item 保留及同 turn 去重聚合。真实“抓烤箱”运行闭合显示“搜索了 41 个网页”，`details.open=false` 且链接不可见；展开后 41/41 个 URL 可见且唯一，搜索与 finalizing 两类 icon/text 中心线差均为 0px，console error/warn 为 0。验收创建的 4 个精确临时 session 及子记录已在单事务中删除，复查 remaining=0；正式“家用冰箱抓取任务”未修改。API/Web 保持运行在 4000/6173，且已加载本轮新 adapter。
- 2026-08-19 刷新恢复与任务记录删除纠错：数据库确认用户“电视机”未完成采访仍为 `active/idle` 且 2 条消息完整；根因是顶层刷新固定进入正式任务模式，使子级恢复 effect 不可达。当前刷新会直接恢复活动会话，任务记录同时列出未关联正式任务的未完成采访和正式任务；选择正式任务会清除当前导航指针，但未完成采访仍可从记录继续。未完成采访经确认后事务删除，运行中/已关联任务时失败关闭；正式任务删除只归档并保留采访、版本和原始数据。六 workspace typecheck 通过；全量测试 11 files passed、1 skipped，25 tests passed、1 skipped；生产构建通过（Web 2298 modules，主 JS 565.53 kB / gzip 167.51 kB，保留既存大于 500 kB warning）。真实页面刷新恢复电视机两条消息及负责人问题，显示 4 个未完成采访＋1 个正式任务，任务行四个中心线差均为 0px，console error/warn 为 0。真实临时 Interview DELETE 204 且复读 404；临时 Capture Task DELETE 204、数据库状态 `archived`、活动 GET 404，两个测试记录均已精确清理，用户现有数据未修改。
- 2026-08-19 工具时间线持久化阶段验证：新增 DB 红灯先证明 assistant 复读缺少 `timelineParts`，fake App Server 红灯先证明本地命令仍被投影；修复后六 workspace `npm run typecheck` 通过，全量 `npm test` 为 11 files passed、1 skipped，26 tests passed、1 skipped，`npm run build` 通过（Web 2298 modules，主 JS 565.39 kB / gzip 167.54 kB，保留既存大于 500 kB warning）。真实空气炸锅轮次显示折叠“搜索了 22 个网页”且无“执行本地只读命令”；完整刷新后搜索计数、前后说明文字和最终消息仍在，展开后 22 个去重 URL 仍可见，京东与飞利浦链接均保留；API 复读确认数据库按“分析活动 → commentary → web search → commentary → finalizing → final text”保存。验收临时 session 精确 DELETE 204、复读 404；现有电视机采访和冰箱正式任务仍保留。最终运行能力边界以后续 shell/Skill 隔离补验为准。
- 2026-08-19 shell 能力关闭与 Skill 隔离最终补验：官方配置确认 `shell_tool` 与 `unified_exec` 均为可关闭的稳定 feature，fake App Server 断言两项启动参数及隔离 cwd 内的 Skill 路径都存在。一次旧 API 进程上的电热水壶运行曾先返回无效 final JSON、人工重试后搜索成功；因该进程未加载最终 `--disable` 参数，已明确作废且不作为验收。重启并加载最终代码后，真实空气净化器样本首轮直接完成 21 个网页搜索、3 个真实候选来源、负责人问题和草稿，页面全程无本地命令或 Skill 缺失文案；完整刷新后“搜索了 21 个网页”、最终说明和草稿仍保留，展开后京东与飞利浦网址仍在。服务端现在要求新品类首轮/重试必须观察到 `web_search`，否则失败关闭。最终临时 session 精确 DELETE 204、复读 404；电视机采访和冰箱正式任务未修改。

### 2026-08-19 执行中搜索消失与未确认草稿纠错

```text
Baseline Impact:
- touched modules: shared Interview activity/output contract, Workbench draft state gate, Web draft projection, interview Skill/prompt and focused tests
- owning fact source: unchanged; Workbench/PostgreSQL owns messages, Decisions, unresolved items and drafts
- public interface changed: existing activity URL bound widened to cover a whole-turn aggregate; invalid runtime output combinations are now rejected
- new protocol/adapter/fallback: no
- compatibility or legacy path changed: historical invalid drafts are read as active conversations and are not exposed as confirmable drafts
- research update required: no; no technology or reusable capability decision changed
- architecture or ADR update required: no; ownership and dependency direction are unchanged
- tests and real-surface validation to run: 52-URL aggregation, invalid mixed output transaction, fake App Server prompt, full typecheck/test/build and current television page
```

```text
Patch Disposition:
- delete: silent hiding after aggregate validation, unconditional taskCandidate-to-task_ready transition, confirmable projection of drafts blocked by proposed/open owner decisions
- keep: persisted ordered timeline, collapsed Web Search disclosure, URL retention, icon/text alignment and isolated App Server runtime
- rewrite: runtime output invariant, Workbench state gate, legacy read normalization and fixed JD-scope interview instruction
- reason: the previous patch preserved raw events but allowed the UI aggregate to exceed its own schema and accepted a draft before the owner decision was confirmed
```

- 两条 1 秒级红灯先稳定复现：3 个搜索 activity 聚合为 52 个唯一网址后无法通过展示 schema；同一 output 含 proposed Decision、owner=user 未决项和 taskCandidate 时仍完成并进入 `task_ready`。
- 修复后定向 3 files / 12 tests 通过；六 workspace `npm run typecheck` 通过；全量 `npm test` 为 11 files passed、1 skipped，28 tests passed、1 skipped；`npm run build` 通过（Web 2298 modules，主 JS 565.90 kB / gzip 167.72 kB，保留既存大于 500 kB warning）；`git diff --check` 通过。
- 真实页面复验使用现有电视机坏记录且未改写数据库内容：侧栏状态由错误的“草稿待确认”降为“对话未完成”，搜索投影为一条默认折叠的“搜索了 52 个网页”，`details.open=false` 且内部保留 52 个链接；无效草稿卡和“确认此版本并生成抓取任务”按钮均为 0。旧错误问句仍作为历史消息保留，未擅自删除或改写用户数据。

这些结果不等于 1A 通过；系统运行链已真实通过，但采访问题与后续抓取任务草稿仍必须由用户验收。

### 2026-08-19 Crawl Planning 最小纵切片

- 数据库已应用 `0012_open_sentinel.sql`；新增 Planning Run，并在既有计划表上保存 task revision、版本、状态和确认时间，不建设第二套任务或来源事实源。
- 真实“家用冰箱抓取任务”运行两版计划。v1 完成后，v2 按“沿用来源、内容和数量口径，但不得把 Provider、许可、频控或可访问性写成已通过”重新核实；v2 成为当前 draft，v1 自动变为 superseded，未覆盖历史。
- v2 明确规划三个来源：京东冰箱频道、国家标准全文阅读、美的官方说明书；明确目录/详情全量、每 SKU 最多 30 条评价、标准题录全量和 20 份说明书样本，并为每项给出分母、唯一键、遍历与停止条件。
- Workbench 在运行中真实展示 commentary 和折叠网页搜索，刷新后 v2 仍可审查。来源观察等级、访问状态和发现时间统一由服务端写为 `search_discovered / unknown / Planning Run 完成时间`，模型不能冒充已访问或已获许可。
- 当前计划仍为 draft，未替用户确认。真实复查 Source Run 数量为 0；生成、修订和确认计划的路径都不负责开始抓取。
- 自动验证：全量 `npm test` 为 16 files passed、1 skipped，40 tests passed、1 skipped；六 workspace `npm run typecheck` 通过；`npm run build` 通过（Web 2301 modules，主 JS 579.50 kB / gzip 171.08 kB，保留既存大于 500 kB warning）；`git diff --check` 通过。

本轮架构影响：增加 1B 的公共 Crawl Plan contract 与 Workbench 深模块，但不改变采访、Capture Task 或 Source Dataset 的事实归属；Codex 仍是无状态单轮外部执行器。没有新增 Provider、后台队列、自动恢复、repair 或 fallback。

### 2026-08-19 京东默认策略、采访连续运行与失败表面修复（回答路径已被下一节纠正）

状态纠正：本节曾把“Workbench 直接规范化数字答案”当成完成态；真实复验已证明这仍把采访降成表单，并会丢失同一句中的补充、纠正和追问。该回答路径及其测试已由下一节删除或重写；本节只保留当时的历史处置记录，当前行为以下一节为准。

```text
Baseline Impact:
- touched modules: interview Skill, shared Capture Task/interview output contract, Category Interview Module, App Server transport/runtime, Web Timeline, PostgreSQL repair migration, focused tests and authority docs
- owning fact source: unchanged; Workbench/PostgreSQL owns product messages, Decisions, unresolved items and versioned task drafts; platform default policy is enforced at the shared/Workbench boundary
- public interface changed: yes; runtime output now rejects jd.scope owner questions, and numeric answers are normalized to the corresponding proposal label while preserving the raw user message
- new protocol/adapter/fallback: App Server stdio connection lifecycle is now explicit and reusable; every business turn still starts a new ephemeral thread; no fallback or persistent Codex thread
- compatibility or legacy path changed: yes; migration 0013 resolves open jd.scope items and supersedes obsolete decisions that are not referenced by an existing task draft
- research update required: yes; R-029 records initialize-once connection reuse and corrects the earlier per-turn process conclusion
- architecture or ADR update required: architecture clarification required; fact ownership and dependency direction are unchanged, so no new ADR
- tests and real-surface validation to run: shared policy/schema, ordinal confirmation, PostgreSQL repair/integration, two-turn same-connection protocol, structured error detail, duplicate-error projection, full typecheck/test/build, real new-task/revision/history surfaces
```

```text
Patch Disposition:
- delete: forced jd.scope question rules, per-turn App Server process creation, duplicated global error text, and tests that treated the wrong JD question as expected behavior
- keep: Workbench-owned timeline/state, official ephemeral thread, typed SSE, Zod final boundary, web-search requirement, Source Dataset separation and no-auto-crawl gate
- rewrite: default JD source policy, decision confirmation normalization, reusable stdio client lifecycle, structured validation error and historical jd.scope state repair
- reason: the previous patch encoded a platform default as a fake owner choice, paid a new connection cost on every reply, hid the failing field, duplicated the same failure in the UI and left the conversation blocked
```

- 根因链已闭合：采访 Skill 明写“必须且只能问一次京东范围”；平台 prompt 再次强调该问题；`confirmDecision` 把用户输入 `1` 原样保存且没有解决同 key 的未决项；下一轮因此仍携带冲突状态，最终 Zod 失败又被压成无字段路径的通用错误。Web 同时渲染持久化消息错误和页面级 `actionError`，形成截图中的中断与重复红框。
- 当前不再向负责人询问 `jd.scope`。`applyDefaultJdSourcePolicy` 对适用标准商品统一写入京东全范围；runtime schema 对任何 question/proposal/unresolved `jd.scope` 失败关闭，Workbench 在草稿落库前再次执行同一策略。用户输入数字序号时，用户消息保留原文，Decision 保存稳定 option label，并同时解决对应未决项。
- App Server 现在按 runtime 建立一条 `stdio` 连接并只初始化一次；同一连接可以运行多个 `thread/start(ephemeral:true)`，每个业务轮次仍是新的内存 thread，不使用 `resume`。Workbench 关闭时释放连接，取消使用官方 `turn/interrupt`。页面不再把每轮协议握手写成“连接本机 Codex”，而从“准备本轮分析”开始。
- 结构化输出失败现在返回最多 5 个 Zod 字段路径与原因，并明确“本轮未保存”；UI 检测到同一持久化错误已在 assistant 消息中展示时，不再重复渲染页面级错误文字。迁移 `0013_repair_jd_owner_question.sql` 已应用，历史失败会话的两条 `jd.scope` Decision 均为 `superseded`，未决项均为 `resolved`；历史消息原文保持不可变。
- 自动验证：官方 Skill validator 输出 `Skill is valid!`；聚焦无数据库回归 13/13、Category Interview PostgreSQL 集成 5/5；全量 `npm test` 为 16 files passed、1 skipped，44 tests passed、1 skipped；六 workspace `npm run typecheck` 通过；`npm run build` 通过（Web 主包 579.98 kB，保留既存大于 500 kB warning）。
- 终检按代码规范把已有的采访视图读取/历史规范化逻辑移入同层 `categoryInterviewViewStore.ts`；它隔离 PostgreSQL 读取 seam，主 `categoryInterviewModule.ts` 降为 494 行，没有新增公共接口或转发层。拆分后重新运行上述全量测试、类型检查和构建，结果不变。
- 真实 PC 路径：新会话 `interview-session-89c424c1-ef45-4d22-b9af-da7a65caffd0` 输入“抓冰箱”后直接形成 0 个负责人 Decision、5 个来源的 v1 草稿，京东默认包含完整类目/商品/参数/媒体/评价范围；确认后继续输入“补充淘宝公开入口，不改变其他范围”，同一会话形成并确认 v2，新增 2 个淘宝受限来源且未改京东范围。正式任务 `capture-task-f6aaf4e8-41d4-43f5-bbb5-6f0764b119c5` 当前 revision=2，Source Run=0。
- 历史失败会话 `interview-session-da08e840-b6d0-4fcb-b368-3f2589dcec35` 真实页面复验只有一个 error alert；旧错误问句作为历史消息保留，不再是可确认的生产 Decision。较早验证记录中“返回三项京东范围问题”“显示连接本机 Codex”的内容均是修复前历史证据，不再代表当前验收行为。

本轮架构影响：外部 App Server seam 的连接生命周期由“每轮进程”改为“runtime 复用连接、每轮 ephemeral thread”，并收紧 shared runtime output contract；产品会话、Decision、草稿和任务事实仍只属于 Workbench/PostgreSQL，没有第二套 Session、后台队列、Provider、repair fallback 或自动抓取。

### 2026-08-19 任意采访输入先理解、再提交工作资料

```text
Baseline Impact:
- touched modules: interview Skill, shared per-turn output contract, Category Interview Module, Codex interview runtime, API/Web Composer path, focused tests and authority docs
- owning fact source: unchanged; Workbench/PostgreSQL owns raw messages, Decisions, unresolved items, research observations and versioned task drafts; Codex only proposes one-turn semantic deltas
- public interface changed: yes; every turn is now user_message, decisionResolution replaces the direct confirmation endpoint, and proposedDecision is the only question representation
- new protocol/adapter/fallback: no; existing App Server stdio, ephemeral thread and local Zod boundary remain; no automatic model retry, repair, fallback or persistent Codex thread; user-triggered retry is restricted to the latest failed/interrupted raw input
- compatibility or legacy path changed: yes; historical failed messages and old Decisions remain immutable/readable, but no new input can enter the direct-confirm branch
- research update required: yes; R-029 records why arbitrary interview input requires an input-first semantic delta rather than a form confirmation path
- architecture or ADR update required: clarification only; the Workbench/Codex ownership boundary is unchanged and ADR-0012 is updated, so no new ADR
- tests and real-surface validation to run: mixed ordinal-plus-facts, custom answer, question/non-answer, same-turn next question/draft, duplicate question removal, full typecheck/test/build, Skill validation and real browser run
```

```text
Patch Disposition:
- delete: Web direct-confirm branch, confirmation HTTP/client method, `decision_confirmed` trigger, duplicate `question` output, Skill-level full-state JSON protocol and tests protecting those paths
- keep: raw user-message persistence, Workbench/PostgreSQL fact ownership, append-only draft/version history, ephemeral App Server turn, typed final boundary, default JD policy and explicit final task confirmation
- rewrite: runtime output as one-turn semantic delta; Workbench atomically resolves the current proposed Decision and records additional facts/unresolved changes/task draft from the same input
- reason: the previous patch only made bare ordinals pass; it could not understand `1，另外排除二手` or distinguish an answer from a correction, rejection, supplement or question
```

- 旧截图对应的可验证根因不是“严格 JSON 本身不该存在”，也不只是字符 `1`。旧 Web 在存在 proposed Decision 时绕过 Codex，直接把原始输入交给 `confirmDecision`；数据库因此留下 `selection: "1"`，下一轮才调用 Codex，并在最终结构校验处显示通用失败。历史运行没有保存完整原始 final JSON/Zod 字段路径，因此不能伪造当时究竟是哪一个字段违规；可以确认的是语义理解在模型之前被短路，而严格校验只是错误显现的位置。
- 当前 Composer 不再判断“这是选项回答还是普通消息”。任何输入都先按原文持久化并交给 Codex；模型可以在同一 typed delta 中解析当前决定、记录补充/纠正事实、更新未决项，并提出下一项真实取舍或生成完整草稿。Workbench 校验并提交增量，Skill 只约束采访行为和工作资料记录，不再拥有传输 JSON 协议。
- 红灯先证明 `1，另外不包含二手商品` 无法产生确认决定；修复后定向测试覆盖：序号加补充事实、自由回答、只追问不误确认、同轮继续下一题或生成草稿、原始消息/稳定选项/决定引用、唯一 proposedDecision 表达。官方 Skill validator 输出 `Skill is valid!`。
- 上一版自动验证（不覆盖下方最新契约修复）：全量 `npm test` 为 16 files passed、1 skipped，45 tests passed、1 skipped；六 workspace `npm run typecheck` 通过；`npm run build` 通过（Web 2301 modules，主 JS 578.57 kB / gzip 170.93 kB，保留既存大于 500 kB warning）；`git diff --check` 通过。
- 上一版真实 PC 复验（只作为历史基线）在历史失败会话 `interview-session-da08e840-b6d0-4fcb-b368-3f2589dcec35` 上继续进行，因此旧红色失败消息仍按不可变历史保留。输入“抓电视机，首期在售型号和近三年停售型号之间我还没决定”后，Agent 默认纳入京东且只询问真实的型号时间范围；再输入“1，另外明确排除二手商品；淘宝只是后续同级平台，现在不要写成已经有淘宝爬虫”，同一轮将 `1` 确认为“仅在售型号（推荐）”，记录二手排除和淘宝能力纠正，并生成未确认 v1 草稿。该轮当时为 `task_ready/idle` 且没有创建 Capture Task 或 Source Run，但它尚未覆盖下方新增的撤回、范围未变、换品类、时间和 retry 门。

本轮架构影响：澄清并收紧采访公共 contract，但不改变事实归属。Codex 只返回本轮理解增量；Workbench 仍是消息、决定、事实资料、未决项和版本化草稿的唯一权威来源。没有新增 Provider、第二套会话、后台运行、自动模型重试、repair、fallback 或自动抓取。

### 2026-08-19 采访工作资料与状态边界补全（最终验证待完成）

```text
Baseline Impact:
- touched modules: interview Skill, shared per-turn output contract, Category Interview Module/state policy, App Server search completion signal, Web confirmation projection, focused tests and authority docs
- owning fact source: Workbench/PostgreSQL continues to own raw messages, Decisions, unresolved items, source observations and versioned drafts; Capture Task owns only explicitly confirmed scope
- public interface changed: yes; 增加问题撤回，移除独立 Decision 确认路径，并收窄草稿确认、retry 和搜索完成证据
- new protocol/adapter/fallback: no new transport or fallback; retain App Server stdio, ephemeral thread, typed final boundary and user-triggered bounded retry
- compatibility or legacy path changed: historical messages/drafts remain readable; new input can no longer leave an older draft confirmable
- research update required: yes; R-029 records the corrected input, search-completion, observedAt and retry boundaries
- architecture or ADR update required: yes, clarify the confirmed interview contract in ARCHITECTURE and amend ADR-0012; fact ownership and dependency direction do not change
- tests and real-surface validation to run: mixed raw input, withdrawal, platform owner-question rejection, explicit/latest draft confirmation, revision history, exact retry, completed search evidence, full test/typecheck/build, clean browser smoke and screenshots
```

```text
Patch Disposition:
- delete: any remaining assumption that a current question limits user input, that a started search proves research, or that an older task-ready draft remains confirmable during a new turn
- keep: input-first raw-message persistence, Workbench-owned working record, strict runtime Zod boundary, append-only draft history, default JD policy and explicit task confirmation
- rewrite: question rejection as withdrawal, confirmability as latest idle+task_ready only, source timestamps as Workbench-owned, and retry as exact latest failed/interrupted message only
- reason: these are the remaining state and evidence gaps that could still interrupt a valid interview or confirm stale scope
```

已确认契约：

- Composer 的任意内容都先由 Agent 结合完整工作资料理解；成立的问题前提否定撤回当前问题，不能强行归入选项；
- 品牌、型号、标准、来源平台、网站和入口由系统调查。家电默认覆盖京东；淘宝是后续同级候选且当前没有 crawler/Provider；
- 工作资料持续保留用户事实、纠正、决定/撤回、未决项、来源调查和草稿版本。纯解释可明确当前范围不变，不制造新 revision；
- 任意新输入立即使旧草稿离开可确认态；只有最新回合结束且 session 为 `idle + task_ready` 时可确认，只有用户显式确认才创建或推进 Capture Task；
- 模型提供的来源时间不权威；Workbench 在草稿提交时写入当前时间；
- 首次调查和换品类必须完成 `web_search`，started/failed 不算；retry 只允许最近一条 failed/interrupted 原文，不能重放更早历史消息。

验证状态：2026-08-19 当前代码全量自动化 `65 passed / 1 skipped`，六个 workspace 类型检查通过，生产构建通过；Web 构建仅有既有 581.35 kB chunk 警告。真实页面以全新冰箱会话完成三轮：首轮主动搜索且只问型号生命周期，混合输入“1＋排除二手＋淘宝仅后续候选”被完整理解，后续按推荐确认品类边界后生成 v1 草稿；页面无错误，持久状态为 `task_ready + idle`、失败消息 0、草稿未关联 `taskId`，京东默认纳入，淘宝为 `unknown` 后续候选，正式 Capture Task 仍为 2 条。最终 Web 函数拆分后又以完整边界原文重跑一轮式烟测，当前代码直接生成相同约束的 v1 草稿，状态仍为 `task_ready + idle`、失败消息 0、正式任务仍为 2 条。发现模型正文可能导致选项显示“1、3”后，改由 Workbench 按结构化 options 确定性编号；重启 API 再跑首轮已显示连续 1/2/3 且无错误。全部临时烟测会话已精确删除；三张截图仅保存在本机验收目录，不属于跨电脑证据，跨电脑接续以包含本节的远端 Git 提交为准。产品负责人验收尚未关闭。

## 7. 数据迁移结果

迁移已删除已经退出当前阶段的旧表名和知识字段；它保留：

- 采访 session、message、decision、unresolved item；
- 抓取任务基础记录和历史任务草稿行；
- source collection plan/run、source object、source snapshot、source asset；
- 旧快照 `content_json`，读取时标记为 `legacy_structured_json`。

迁移前发现上一版 0010 已经删除阶段 2 表并新增部分列，但没有完成任务表/列改名。当前迁移按真实状态补齐改名、外键和索引，并使用 `IF EXISTS` 兼容“旧表仍存在/已不存在”两种本地状态。保留表行数前后相同。

用户授权清空后又进行了真实页面复验；较早记录中的精确行数只是当时快照。当前本机额外保留本轮真实验收产生的冰箱会话与 revision=2 正式 Capture Task，作为可见证据；其 Source Run 为 0，没有原始抓取数据写进这台 Mac 的正式数据库。历史失败会话没有删除，迁移只修复其可执行状态，不改写消息原文。

## 8. 下一步与停止门

2026-08-20 Windows 本地启动补全：根命令新增幂等 `db:start-local`。`npm run dev` 在建库和启动 API/Web 前先探测 `POSTGRES_DATABASE_URL`；端口已监听或数据目录对应的 PostgreSQL 已运行时不会重复启动，只有本机 PostgreSQL 未运行时才使用该数据目录记录的官方 `pg_ctl` 启动。冷启动实测恢复 PostgreSQL 14；紧接着第二次执行只报告“已运行”，没有再次启动；`db:ensure-local` 确认 `domain_analysis` 已存在。完整 `npm run dev` 随后复用运行中的 PostgreSQL，API `/health` 返回 200，Vite 在 6173 就绪；本轮 API/Web 验证进程已停止，PostgreSQL 保持运行。该改动只补全本地开发依赖生命周期，架构影响为无变化，不改变业务模块、事实源、公共 contract 或阶段 1B 停止门。

### 2026-08-20 采访阶段结构化时机纠错

```text
Baseline Impact:
- touched modules: shared Interview/Capture Task contract, Workbench interview runtime and confirmation path, PostgreSQL draft storage, Web draft card, interview Skill and authority docs
- owning fact source: Interview/PostgreSQL owns messages, answers, search activities and Markdown drafts; Capture Task owns confirmed structured scope; Crawl Plan continues to own source/content/quantity/stop decisions
- public interface changed: yes, CaptureTaskDraftVersion.content replaced by markdown; interview runtime taskCandidate replaced by draftMarkdown
- new protocol/adapter/fallback: no new transport or fallback; existing App Server client gains one confirmation-only materialization call
- compatibility or legacy path changed: yes, migration converts historical content_json drafts into readable Markdown and removes the old column; no runtime dual-read path
- research update required: yes, R-029 records why the failure is a stage-boundary defect rather than a nullable-field defect
- architecture or ADR update required: yes, D009 and ADR-0012 freeze the four-stage workflow and confirmation boundary
- tests and real-surface validation to run: full Vitest, six workspace typechecks, production build, real PostgreSQL migration, real App Server interview/search and confirmation
```

```text
Patch Disposition:
- delete: interview taskCandidate/sourceCandidates/observedAt generation, structured draft rendering, and tests that protected that premature schema
- keep: persisted messages, ordered search timeline, user Decision semantics, ephemeral App Server, explicit confirmation, Capture Task and Crawl Planning
- rewrite: draft persistence/UI to Markdown; confirmation to a separate strict Capture Task materialization
- reason: latest failure proved the formal task schema was being enforced before the user had confirmed the scope
```

实现与验证：

- `capture_task_draft_versions.content_json` 已通过 0014 migration 转为 `brief_markdown text`；历史 JSON 被完整包入带迁移说明的 Markdown fenced block，未删除历史内容，也没有保留双字段兼容分支。
- 采访 final answer 现在只允许最小增量和可选 `draftMarkdown`。用户确认按钮调用独立 materialization；该调用观察到 `web_search` 会失败关闭，Workbench 统一生成 `observedAt`、confirmed decision IDs 和当前未决项。
- Web 直接显示 Markdown 草案，确认期间禁用重复点击并显示“正在生成正式任务…”。
- 全量自动化：`65 passed / 1 skipped`；六个 workspace 类型检查通过；生产构建通过，只有既有约 581 kB Web chunk 警告；`git diff --check` 无错误。
- 真实本机链：Windows PostgreSQL 已运行且 `db:start-local` 二次调用没有重复启动。全新电饭煲会话完成真实 commentary、3 个 web_search activity 和 Markdown v1，状态为 `task_ready + idle`，无 Decision/负责人未决项；草案对象只有 `markdown`，确认前 Capture Task 为 0。显式确认后，独立纯转换生成 `ready` Capture Task revision 1，京东默认范围完整，session 进入 `confirmed + idle`，Source Run 为 0。验收任务随后通过产品删除动作归档，保留审计历史但不污染活动任务列表。
- 首两次沙箱内真实调用因 `https://api.openai.com/v1/responses` 连接被运行沙箱阻断而失败；在获批的沙箱外开发进程中同一持久化用户消息重试成功。该失败属于验证环境网络边界，不是产品 schema 回归，也没有加入自动重试或 fallback。

架构影响：改变。采访草案的公共 contract 和事实形态由正式任务结构改为 Markdown；Capture Task 的正式结构化职责移动到用户确认之后。Workbench/PostgreSQL 仍是会话事实源，Capture Task 与 Crawl Plan 的 ownership、依赖方向及 App Server transport 不变。

当前下一步：用户直接在正在运行的 Workbench 审查新建与修订效果；已确认任务再显式启动 Crawl Planning。最新 Crawl Plan 未确认、Provider/许可/频控/停止门未通过前，不创建 Source Run。当前请求未授权 commit/push，因此全部修改只在本机，尚未形成跨电脑接续点。

上一轮真流式修复的架构影响：改变外部运行 seam，但不改变领域事实源。Codex 入口由 `exec --ephemeral --json --output-schema` 改为版本锁定的 App Server `stdio`＋`thread/start(ephemeral:true)`；公共 SSE contract 不变，`assistant.delta` 现在来自真实 commentary delta。Workbench 仍是唯一产品会话/任务事实源，没有持久 Codex thread、第二 Provider 或 fallback。

本轮 Windows 启动恢复的架构影响：无变化。恢复已存在的本机 PostgreSQL 进程，并用已锁定的 `concurrently`、`wait-on`、`kill-port-process` 修正开发进程生命周期；只增加根开发命令的薄 adapter，没有修改业务模块职责、事实源、依赖方向、公共 contract、产品协议或 fallback。

本轮 Timeline/Composer 纠错的架构影响：澄清交互 contract，未改变模块职责或依赖方向。Workbench 仍保存 typed Message/Decision；变化是 proposed Decision 在 Web 投影为普通消息，Composer 原文回答成为 confirmed Decision 的来源消息，同一 assistant turn 通过 assistant-ui ordered parts 投影 commentary 与活动。

本轮工具详情与生命周期纠错的架构影响：澄清交互 contract，未改变模块职责、事实源、依赖方向或 shared/API contract。普通状态与工具活动仍使用同一 typed part，只在 Web 呈现层区分；App Server adapter 继续只投影安全摘要，不新增恢复、repair 或 fallback。

本轮 Web Search 纠错的架构影响：澄清并扩展既有交互 contract，`InterviewTurnActivity` 新增可选 bounded URL 列表；App Server adapter 仍是唯一外部协议收窄点，Workbench/PostgreSQL 与 Web 的事实归属、模块职责和依赖方向未变。没有新增 Provider、恢复路径、repair、fallback 或 ADR。

本轮刷新恢复与任务记录删除的架构影响：澄清产品恢复入口，并扩展既有 Workbench/HTTP 公共 interface。Category Interview 继续拥有未完成会话和删除约束，Capture Task 继续拥有正式任务并使用既有 `archived` 状态；Web 只投影两类记录，localStorage 仍是可丢弃导航指针。没有改变事实源或依赖方向，没有新增协议、Provider、fallback 或 ADR。

本轮工具时间线持久化与工程命令隔离的架构影响：改变公共消息 contract，`NormalizedInterviewMessage.timelineParts` 成为刷新恢复文字/活动顺序的可选持久化事实；Category Interview/PostgreSQL 的 ownership 与依赖方向不变。App Server 每轮先同步权威 Skill 到隔离产品 cwd，再显式注入并关闭 `shell_tool`/`unified_exec`；新品类首轮没有真实 web search 时失败关闭，adapter 对异常/旧 `commandExecution` 仍不投影。没有新增 Provider、repair、fallback 或第二会话事实源。

HARD STOP：最新 Crawl Plan 未经用户确认，且 Provider、许可、访问方式、频控与停止门未通过前，不创建 Source Run、不访问真实来源；1A 工程验收虽已通过，仍待产品负责人审查；不调用清洗/Evidence/知识加工链。

### 2026-08-20 可执行品类抓取任务 PRD

- 使用本地 Markdown Issue Tracker 发布 `.scratch/executable-category-crawl/PRD.md`，状态为 `ready-for-agent`。
- PRD 只定义“新建任务 → 采访工作资料 → 可读草稿 → Capture Task → 唯一可执行 Crawl Plan → 显式开始 → Source Run/原始快照”的最小闭环，并明确计划不能替代 Provider 代码。
- PRD 同时登记当前生产缺口：采访 proposal 重复 selection、历史 JSON 冒充 Markdown、两套计划结构、缺少 Provider/启动 API/Source Dataset 写入和真实纵向验收。
- 第一条真实通过门限定为冰箱＋京东的有界 Source Run；自动测试、fixture、搜索发现或计划确认都不能替代真实来源结果。
- 本轮只新增 PRD 与工程 Skill 本地 Issue Tracker 配置，没有修改生产代码、数据库或运行状态，也没有声称现有抓取链已经可执行。

本轮架构影响：澄清候选。PRD 提议把 Crawl Plan 收口为唯一可执行计划事实源，并增加 Provider 预检、显式 Source Run 启动和 Source Dataset 写入边界；这些尚未实施或验收，不能写成当前架构完成态。实施前必须按 PRD 清算旧补丁，并同步解决现有权威文档与已接受 ADR 的冲突。

### 2026-08-20 可执行 Crawl Plan 与真实京东 Source Run

```text
Baseline Impact:
- touched modules: shared plan/dataset contracts, PostgreSQL migration, Workbench planning/execution/dataset, API SSE, Worker JD Provider, Web plan/raw-data UI, authority docs
- owning fact source: Capture Task owns scope; versioned Crawl Plan owns executable source/limits; Source Dataset owns run/object/snapshot/asset
- public interface changed: yes; provider binding, explicit Start and Source Dataset write interface
- new protocol/adapter/fallback: JD CDP Provider and foreground Source Run SSE; no fallback or background queue
- compatibility or legacy path changed: old Source Collection Plan and structured draft rows remain legacy/read-only
- research update required: yes, R-036
- architecture or ADR update required: yes, ADR-0013 and 1C/1D baseline
- tests and real-surface validation: 69 automated passed/1 realtime skipped; six workspace typechecks, production build and diff check passed; two real JD runs classified below
```

```text
Patch Disposition:
- delete: proposal selection duplication; legacy JSON as current confirmable draft; dual-authority active plan behavior
- keep: Interview Working Record, Markdown drafts, Timeline, PostgreSQL raw tables, read/export, pacing/circuit breaker and idempotent startup
- rewrite: active plan execution fields, confirmation/preflight, explicit Start, transactional dataset writes and JD Provider
- reason: PRD requires one reviewable and machine-executable plan with truthful real-source results
```

- proposal 只保存问题、2–3 个选项、唯一推荐和 rationale；selection 只在后续 confirmed resolution。0015 migration 让历史 proposed row 可为空，并把旧结构化 draft 明确保持 superseded。
- active Crawl Plan 冻结 Provider key/version、key/value 配置、access/stop/raw-output policy；缺 Provider、blocker、配置或 CDP preflight 失败时不能确认或创建假 run。
- Source Execution 从 PostgreSQL 重读 confirmed task revision/plan version；一个 source 可由 Provider 展开目录与详情。Source Dataset 单一事务入口复用对象、追加 immutable snapshot、幂等检查并更新计数。
- 真实 Workbench：全新“抓冰箱”完成 19 个网页搜索、可读 Markdown v1 和 Capture Task v1。Planning v3 完成 20 个网页搜索，冻结 `mode=cdp / include_text=冰箱 / exclude_text=二手|冷柜|冰吧`，无 blocker 并通过 preflight。
- 两次独立真实 Source Run 均为：目录 `accessible`、详情 SKU `100377318432` → `passport.jd.com` → `login_required`，持久化 run=`failed` 且 UI 显示 `blocked · login_required`，snapshot=2、accessible=1、failed=1、asset=0。重启 API/Web 后两条 run 和快照仍可见；JSONL 各 2 条，CSV 均经引号感知解析为表头＋2 条。没有读取日常 Profile、复制 Cookie、绕过登录、自动重试或保存登录页内容。
- 当前分类：passed=采访/Markdown/Capture Task/plan/preflight/显式 Start/目录 HTML/不可变写入/重启恢复/页面查看与截断/JSONL 与 CSV 导出/幂等 PostgreSQL 启动/全量自动化；blocked=京东详情登录；failed=两次旧 observedAt schema run 与一次非法 camelCase provider key run，均已按根因修正且保留审计；untested=登录后详情成功、asset 下载、完整京东平台覆盖、Linux 安装与运行。

本轮架构影响：改变。新增 ADR-0013 的 Source Execution/Provider seam；事实源仍分别为 Capture Task、Crawl Plan 和 Source Dataset，没有第二套计划、会话、队列或 fallback。交付提交与远程 SHA 在推送完成后登记。

## 9. Git 状态

- 工作树：`C:\Users\30553\.codex\worktrees\ac3d\domain-analysis`
- 分支：`codex/executable-category-crawl`
- 本轮起始 HEAD：`0afa6c12fff7e06b2406154286179e6352dcd8c2`。
- 实现提交：`6e571f4597d7218f70e59933a0027a2696c7af32`；已推送至 `origin/codex/executable-category-crawl`，并通过 `git ls-remote` 验证本地与远程 SHA 一致。
- PostgreSQL 幂等启动、采访 Markdown/确认后结构化 contract、可执行 Crawl Plan、0014/0015 migration、JD Provider、Source Execution、Source Dataset、Workbench/Web/Skill/测试和权威文档已形成跨电脑接续点。本地数据库、JD CDP Profile、Cookie 和真实原始来源内容没有提交。

## 10. 2026-08-20 macOS 最终 Crawl Plan 生成门纠错

```text
Baseline Impact:
- touched modules: Crawl Planning App Server prompt、Web Crawl Plan 确认门、聚焦测试和本进度记录
- owning fact source: unchanged; Capture Task owns scope, versioned Crawl Plan owns source/quantity/stop decisions, Source Dataset owns future runs and snapshots
- public interface changed: no
- new protocol/adapter/fallback: no
- compatibility or legacy path changed: blocked v1 remains immutable history and v2 supersedes it normally
- research update required: no; R-035/R-036 technology decisions remain unchanged
- architecture or ADR update required: no; this fixes an implementation contradiction without changing ownership or dependency direction
- tests and real-surface validation: focused 5/5, full 70 passed/1 realtime skipped, six-workspace production build, real macOS Workbench planning/confirmation and console check
```

```text
Patch Disposition:
- delete: runtime prompt clauses that required every unverified Provider fact to become a blocker and discouraged the Skill-defined production Provider limits
- keep: injected planning Skill, server-side Provider validation/preflight, version history, explicit Start boundary and failed v1 evidence
- rewrite: prompt to follow the injected Provider contract and Web to hide confirmation for blocked plans
- reason: the old prompt contradicted the latest Skill, generated placeholder Providers and limits, while the page still presented a server-rejected plan as confirmable
```

- 当前 macOS 真实任务 `capture-task-f6aaf4e8-41d4-43f5-bbb5-6f0764b119c5` revision 2 的首次规划 v1 搜索 35 个网页，但错误生成 4 个 `workbench.unconfigured@unverified` 来源、非首个纵切片限额和 blockers；该版本保留为 `superseded`，没有删除或冒充成功。
- 修复后重新规划搜索 15 个网页，生成并确认 Crawl Plan v2 `crawl-plan-d1f45777-f3cb-45de-9a13-59f9f8053a09`，content hash `1ab156a6b105bc92fd218c54cf9ab61031135c1fb309ab68bfc97ef35eb2f595`。计划只有 `jd.catalog-product@1.0.0`，冻结 `mode=cdp / include_text=冰箱 / exclude_text=二手|冷柜|酒柜|冰吧|雪茄柜|商用`、每分钟 2 次、最小间隔 10 秒、最长 180 秒、请求预算 2、一个目录 HTML 和一个详情 HTML、零附件、零 blocker。
- 确认阶段连接隔离的 loopback Chrome CDP 并通过 Provider preflight；页面显示 `已确认` 与独立 `开始抓取`。本轮没有点击 Start，任务 Source Run 数量仍为 0；这是最终 Crawl Plan 验收，不是京东来源抓取结果。
- 当前页面控制台 0 error / 0 warning；服务运行在 `http://127.0.0.1:6173/`，最终计划页已留作用户检查。

本轮架构影响：无变化。修复只让 Planning prompt、Skill、服务端 preflight 和 Web 确认门表达同一既有事实，没有改变模块职责、事实源、公共 contract、Provider seam 或执行停止门。

当前变更仅在本机工作树，尚未提交或推送，不构成新的跨电脑接续点。下一步由产品负责人直接审查已确认 v2；未经另行明确要求，不点击“开始抓取”。

## 11. 2026-08-20 完整多来源 Crawl Plan 与目标级执行

```text
Baseline Impact:
- touched modules: shared Crawl Plan/Source Dataset contract、0016 migration、Crawl Planning/Source Execution/Source Dataset、JD/公共资源 Provider、API/Web、Planning Skill 与权威文档
- owning fact source: Capture Task owns confirmed scope/candidates/topics; Crawl Plan owns complete executable targets and limits; Source Dataset owns per-target attempts, immutable snapshots and assets
- public interface changed: yes; checklist v2 adds sourceCandidateIds/typed target configuration, Provider events carry targetKey, Source Dataset exposes target attempts and asset download
- new protocol/adapter/fallback: added public.web-resource@1.0.0 exact/one-linked-target adapter and cacache asset seam; no fallback, dynamic plugin, queue or model execution path
- compatibility or legacy path changed: historical plans remain readable but checklist v1 and blocked/placeholder plans cannot confirm or start; old snapshots remain legacy-readable
- research update required: yes; R-037 accepts Got, robots-parser, Cheerio and cacache after focused prototypes, while real multi-source access remains untested
- architecture or ADR update required: yes; ADR-0016 and ARCHITECTURE/ROADMAP/PRD record complete-list and target-level ownership
- tests and real-surface validation: six-workspace typecheck/build, full suite, real task v6 generation/confirmation, API reconciliation and visible Start button
```

```text
Patch Disposition:
- delete: no user data or plan history; archive only the synthetic task created by this investigation
- keep: existing Capture Task v2, immutable plan history, JD bounded Provider/preflight, explicit Start boundary, source raw-data tables and prior truthful blocked runs
- rewrite: topic-only/source-level completeness into candidate+topic+target reconciliation; placeholder-compatible candidate schema into two exact Provider protocols; source-only execution into per-target attempts; JSON commentary projection into readable text
- reason: the prior patch proved one JD technical slice but falsely allowed brand/standard/manual/technical candidates to disappear or stop at an entrance page
```

开源/已有资产/产品代码边界：

- 复用 Got stream、robots-parser、Cheerio、cacache，及已有 App Server `outputSchema`、Zod、PostgreSQL/Drizzle、SSE、JD CDP、p-queue/cockatiel；没有自研 transport、robots parser、HTML parser、CAS、队列或工作流引擎。
- 产品特有代码只承担三类职责：Capture Task 候选/topic 完整性与附件正文门；将冻结 target 交给 Provider 并逐项对账的 orchestration；把 Source Dataset/Plan 状态投影到 Workbench。公网/来源差异停留在薄 adapter。

交付事实：

- 真实任务 `capture-task-f6aaf4e8-41d4-43f5-bbb5-6f0764b119c5` revision 2 已生成并确认 Crawl Plan v6 `crawl-plan-e81605a8-6749-46ae-9a13-9eeac38bdcfd`，content hash `cf00a04ca1a8f55f0fb99ad11e49d41337598f6fc44067d824b960b412a7c282`。
- 清单包含 8 个来源、12 个 target：京东目录/首个合格详情、松下旗舰店精确入口、淘宝搜索精确入口、淘宝详情路由入口、海尔型号页＋“查看说明书”H5、GB 12021.2—2025 公开记录＋明确标为征求意见稿的官方编制说明 PDF、CNIS 公告＋家用电冰箱附件、NIST 制冷循环资料。
- 7 个采访候选各恰好使用 1 次；13 个 Capture Task 原文 topic 全覆盖；`executionBlockers` 为 0。海尔说明书、GB PDF 和 CNIS 附件均是独立正文 target，不再用入口页中的链接冒充抓取完成。
- 确认阶段通过当前两个 Provider 的严格配置与 preflight。重启 API/Web 后计划仍为 `confirmed`；页面显示 1 个“开始抓取”按钮、0 个“确认此计划”按钮，Planning Timeline 无 JSON 外壳。
- 该任务 Source Run 数量为 0；本轮没有点击 Start，没有访问、下载或持久化任何 v6 来源内容。计划可开始不等于来源访问成功。
- 调查产生的 synthetic `task-73e2fc0f-2fc3-4c10-ba49-2b11d0925be9` 已通过产品 UI 归档，未硬删数据库历史。

验证：当前补丁 `npm run typecheck` 通过；`npm test` 为 94 passed、1 个既有 realtime 限速验收 skipped；`npm run build` 六个 workspace 通过。Vite 报告单个 592.79 kB chunk 警告，不影响构建成功，未在本任务扩大为前端拆包。`npm audit --omit=dev` 报告 1 moderate/4 high，依赖链属于既有 Fastify/AJV/Crawlee；本轮没有擅自执行破坏性 `audit fix`，细节登记在 R-037/R-007。目标 Linux 安装行为仍未验证。

本轮架构影响：改变。ADR-0016 将 Crawl Plan 从“已绑定 Provider 的 source 列表”收口为“对账全部采访候选/topic 的 target 级完整执行清单”，并新增有界公共原始资源 Provider、target attempt 和 CAS asset 事实；Capture Task、Crawl Plan、Source Dataset 的三层 ownership 与依赖方向保持不变。

当前页面服务运行在 `http://127.0.0.1:6173/` 并停留在已确认 v6；未经另行明确授权不点击“开始抓取”。全部代码、migration、Skill 和权威文档仍只在本机工作树，尚未提交或推送，不构成新的跨电脑接续点。

## 12. 2026-08-20 电视专业导购 Crawl Plan 与侧栏顺序纠错

```text
Baseline Impact:
- touched modules: Web 任务导航、采访/规划 Skill、Capture Task 准备度、Crawl Planning runtime/module、公共资源 Provider、PRD/ROADMAP/ARCHITECTURE/进度与聚焦测试
- owning fact source: Capture Task 继续拥有已确认范围/候选/topic；Crawl Plan 拥有来源/target/数量/停止条件；Source Dataset 拥有未来 Source Run 和原始快照
- public interface changed: yes; CrawlPlanningModule 将纯结构 validate 与依赖运行态的 preflight 分开注入，但 shared JSON/SSE 领域 contract 未变
- new protocol/adapter/fallback: no; 复用既有两个 Provider、App Server、Zod 和显式 Start，没有新增 Provider、队列、repair 或 fallback
- compatibility or legacy path changed: 历史 v1 与失败 Planning Run 保持不可变可读；只有通过完整性与 Provider 结构校验的新 Draft 才能保存
- research update required: no; 沿用 R-037 已接受组件和 Provider 边界
- architecture or ADR update required: yes; ARCHITECTURE 澄清 Draft validate、确认 preflight、直接文档和 URL 规范化边界；事实源与依赖方向未变，无新 ADR
- tests and real-surface validation: full Vitest/typecheck/build、真实电视 v4 规划/确认/API 对账、侧栏选择顺序和 Source Run=0
```

```text
Patch Disposition:
- delete: 选中/加载既有会话时无条件 prepend；只检查现有 topic/候选自洽就声称完整；直接 PDF 必须再有子 target 的错误门；根 URL 原始字符串比较；被证据推翻的“跨候选 target”猜测性修复
- keep: Capture Task 显式确认、全部候选/topic 对账、Provider 严格配置、附件正文门、版本历史、显式 Start 和 Source Dataset 不可变边界
- rewrite: 新任务才置顶、已有任务原位更新；确认前要求零售/品牌/标准监管/技术原理四类来源；精确 PDF 按 document 留存；Provider validate 前移而 preflight 保留在确认/启动
- reason: 用户真实电视流程证明旧实现会把“两个品牌入口”和“可执行专业导购清单”混为一谈，并暴露两个会让正确计划无法确认的实现假阴性
```

产品目标与准备度门：

- 产品目标已明确为单门类、多品牌、多型号的专业导购 Agent；原始数据必须同时支撑市场在售/价格/公开评价、品牌官方配置/说明资料、国家标准/监管/能效、关键部件/技术路线/底层原理四类事实。
- 新 Capture Task 若缺少核心零售平台、品牌官方、标准/监管或权威技术原理来源，或京东标为 included 却没有真实 `jd.com` 候选，不能确认；缺少系统调查项也不能只因负责人问题已答完而生成正式任务。
- Crawl Planning 再次执行同一准备度门；把 topic 文本随意挂到已有品牌来源、遗漏采访候选或以入口 HTML 冒充 PDF/说明书正文均失败关闭。

真实电视验收：

- 旧电视任务 v1 只有 TCL/海信两个采访候选，旧 Crawl Plan v1 只有 3 个 `brand_official` 来源；它们保留为历史证据，不再冒充专业导购完整清单。
- 当前真实任务 `capture-task-16a108ad-fbde-4cfa-9206-5d2aeb8a123a` 已修订并确认到 revision 4，共 29 个候选：4 个 retailer、7 个 brand_official、14 个 standards_body、1 个 regulator、2 个 industry_organization、1 个 technical_publisher；历史 Redmi 70/小米电视 2 等非当前型号未纳入。
- 已生成并确认 Crawl Plan v2 `crawl-plan-a0933c21-bf79-4c0e-9e3f-3a49dd4f46fa`，content hash `43437b3aa151a40a0a05cfe3645d018fd869484de4656899b29af063bd4222f0`，基于任务 v4。清单为 29 个来源、32 个 target；29/29 候选各恰好一次，8/8 原文 topic 全覆盖，无额外 topic、无 execution blocker。
- 京东搜索入口使用 `public.web-resource@1.0.0`；三个 `www.jd.com/brand/...` 候选各自使用 `jd.catalog-product@1.0.0`，每个独立冻结 catalog 与 first_matching_product 两个 target。其余品牌官网、国标/监管/能效和技术原理入口使用公共精确资源 Provider。
- 发改委《平板电视能源效率标识实施规则》与 ITU BT.2020-2 原文均以 `document` target 且 `retainAssets=true` 保存；直接 PDF 的 exact target 被承认为正文，HTML 入口声称有附件时仍必须另列受控同源 target。
- 确认时三个京东来源连接隔离 loopback CDP，全部 Provider preflight 通过。页面当前显示 `已确认` 和一个独立“开始抓取”按钮；本轮没有点击 Start，电视任务 Source Run 数量为 0。
- 侧栏真实选择第二条“家用冰箱抓取任务 v2”后顺序仍为“电视 v4、冰箱 v2、冰箱 v1”，没有把选中项移动到顶部；随后已返回电视 v2 Crawl Plan 页面供产品负责人检查。

根因与验证：

- 侧栏根因是 `handleInterviewChanged` 对加载/选择产生的既有 session 也执行 prepend；现改为按 ID 原位替换，仅真正新建记录置顶。
- 完整性根因是任务确认只看负责人未决项、计划只看已有候选/topic 的内部自洽；现增加专业导购四来源组合与京东真实候选门。
- 计划确认期间发现并修复两个假阴性：附件门错误要求直接 PDF 仍有“子附件”；公共 Provider 把 `https://www.energylabel.com.cn` 与规范化后的尾斜杠 URL 当成不同入口。Provider 的纯结构 validate 现于 Draft 保存前执行，确认保留运行态 preflight。
- 当前 `npm test` 为 108 passed / 1 个既有 realtime 限速验收 skipped；六个 workspace `npm run typecheck` 通过；`npm run build` 通过。Vite 仅报告既有 592.90 kB chunk 警告；`git diff --check` 无错误。

本轮架构影响：澄清并收窄现有 Crawl Planning/Provider seam。新增的只是同一 Provider 在 Draft、确认、启动三阶段分别承担结构校验、运行态预检和执行的明确时机；Capture Task、Crawl Plan、Source Dataset 的 ownership、依赖方向、外部协议与显式 Start 停止门不变。

当前页面服务运行在 `http://127.0.0.1:6173/`，停留在已确认电视 Crawl Plan v2。全部修改仍只在本机工作树，未提交、未推送，不构成新的跨电脑接续点；未经另行明确授权不点击“开始抓取”。

## 13. 2026-08-20 Crawl Plan 折叠展示与重跑稳定性核查

```text
Baseline Impact:
- touched modules: Crawl Planning Web 来源/target 展示、前端回归测试、PROGRESS
- owning fact source: Crawl Plan，保持不变；Web 只投影既有 source/target
- public interface changed: no
- new protocol/adapter/fallback: no
- compatibility or legacy path changed: no；历史计划使用相同折叠投影
- research update required: no；未改变 Planning runtime、Provider 或依赖
- architecture or ADR update required: no；模块职责、事实源、依赖方向和 contract 均未改变
- tests and real-surface validation: 折叠红绿回归、规划完整性聚焦测试、Web production build、真实电视 v2 页面展开/折叠和 Start 可达性
```

```text
Patch Disposition:
- delete: 来源和内部 target 默认全部展开的长页面展示
- keep: 全部来源/target 字段、计划状态、确认/开始边界、历史版本和现有业务动作
- rewrite: 每个来源与其内部 target 使用原生 details/summary，默认关闭且可独立展开
- reason: 29 个来源与 32 个 target 同时展开会把 Start 动作推到几十屏之后；问题只属于 Web 投影，不应改写计划数据
```

交付与真实页面证据：

- `CrawlPlanCard` 当前把来源和内部抓取项分别投影成可访问的折叠结构；折叠标题保留来源名、发布者、来源类型、target 数和访问状态，展开后全部 Provider、频控、入口、数量与停止字段仍在。
- 红色回归首先证明旧 HTML 中 4 个样例来源的折叠节点数量为 0；修复后聚焦测试为 5/5 passed。规划准备度、runtime prompt 与完整性集成联合验证为 4 files / 25 tests passed。
- 真实电视 Crawl Plan v2 页面核对为 29 个来源、32 个 target、默认 `openSources=0 / openTargets=0`，独立展开来源和 target 后分别成为 1；页面仍只有 1 个“开始抓取”按钮，并已滚动到该按钮供负责人查看。
- Web production build 通过；Vite 仅报告既有 594.15 kB chunk 警告。`git diff --check` 通过。电视任务 Source Run 仍为 0，本轮没有点击 Start。

重跑稳定性结论：

- 对同一个已确认电视 Capture Task revision 4，29 个 `sourceCandidates` 已是 PostgreSQL 中的任务事实。每次重新规划都会把这 29 个 ID、原始入口、来源类型和 authoritative Provider 逐项注入；计划保存门要求每个候选恰好出现一次、8 个原文 topic 全覆盖，并把最近历史计划一并提供给 runtime。模型可以改变说明、target 命名或增加更精确来源，但不能保存退回两个来源的计划；不满足时 Planning Run 必须失败关闭。
- 对一个全新创建的电视任务，候选入口仍由采访 Agent 本轮 web search 调查并写入 Markdown，再由无搜索的 materialization 忠实转换。当前确定性代码要求零售/市场、至少两个独立品牌官网、标准或监管、权威技术原理四类入口，并在京东 included 时有真实京东候选；它没有跨任务复用电视 v4 的 29 条已确认来源，也没有冻结每个品类的完整品牌/型号/标准覆盖基线。因此不能承诺新任务必然得到相同 29 条或同等密度；这是当前真实剩余边界，不用一次成功样本冒充系统保证。

本轮架构影响：无变化。只改 Web 展示并澄清现有生成门；没有增加第二份来源事实、品类模板、共享 catalog 或新 contract。若产品要求所有全新同品类任务复用已验收来源覆盖，下一步必须先设计“品类来源基线/覆盖口径”的事实归属、版本与更新门，不能把电视 29 条硬编码进通用 Capture Task 或 Prompt。

当前改动仍只在本机工作树，未提交、未推送，不构成新的跨电脑接续点。

## 14. 2026-08-20 采访草案四类来源证据门与全新微波炉回归

```text
Baseline Impact:
- touched modules: shared Interview runtime contract、Category Interview 完成门/读取投影、Capture Task 准备度、0017 migration、采访 Skill/prompt、测试与架构/调研/ADR/进度文档
- owning fact source: Category Interview/PostgreSQL；搜索时间线与 Markdown 仍是来源事实，coverage_verified 只记录该版本是否通过关系校验
- public interface changed: yes；仅在生成 draftMarkdown 时增加四组 URL 的最小 draftCoverage 凭证，不恢复完整 Capture Task/sourceCandidates JSON
- new protocol/adapter/fallback: no；复用 App Server web_search、Zod、Drizzle/PostgreSQL，不增加 repair、第二模型、自动 retry 或新依赖
- compatibility or legacy path changed: 历史未验证 draft 文本保留但投影为 superseded，旧 task_ready 降回 active；已确认历史不回退
- research update required: yes；R-029 记录真实失败、最小凭证边界与无新依赖结论
- architecture or ADR update required: yes；ARCHITECTURE 与 ADR-0012 明确 Workbench 证据门和非第二事实源边界
- tests and real-surface validation: 聚焦红绿测试、PostgreSQL 集成、全量 115 passed/1 skipped、六 workspace typecheck/build、旧会话降级与全新微波炉真实回归
```

```text
Patch Disposition:
- delete: “模型没有声明系统未决项且出现过一次搜索就等于调查完成”的隐含放行；单品牌即可支持专业导购的错误完成口径
- keep: 一次一问、只问负责人真实取舍、Markdown 草案确认、确认后独立结构化、Capture Task/Crawl Plan/显式 Start 停止门
- rewrite: draftMarkdown 直接进入 task_ready 改为四类 URL 必须来自已完成搜索并写入 Markdown；历史未验证待确认草案改为不可确认投影
- reason: 真实微波炉 v1 只有京东、美的、松下三个入口，却遗漏标准监管与技术原理并错误开放确认
```

实现与验证事实：

- runtime final JSON 仍是本轮最小增量；只有生成 Markdown 时才附带 `draftCoverage` 四组 URL。零售/市场至少 1 个，品牌官网至少 2 个独立站点，标准/监管至少 1 个，技术原理至少 1 个；同一 URL 不能重复或跨角色复用。
- Workbench 将每个凭证 URL 与当前及历史 assistant 消息中 `status=completed` 的 `web_search` URL 交叉校验，并要求原字符串出现在最新 Markdown。凭证本身不落库；新草案仅写 `coverage_verified=true`。0017 对历史行默认 `false`。
- 正式 Capture Task 完成门同步要求至少两个独立品牌官网，防止确认后 materialization 丢掉第二品牌；Crawl Plan 双品牌测试夹具同步补全为两个候选、两个来源和两个 target，没有放松既有候选/topic/Provider/附件门。
- 先写红色回归证明旧实现会放行只有零售与品牌入口的草案；聚焦测试 18/18 通过，PostgreSQL 采访集成 10/10 通过。最终 `npm test` 为 115 passed、1 个既有 realtime 限速验收 skipped；`npm run typecheck` 六个 workspace 通过；`npm run build` 通过，Vite 只有既有约 594.65 kB chunk warning。
- 真实旧会话 `interview-session-d1d3e03c-9f06-4a55-997a-d2ba8f8b830a` 重启后，v1 从待确认投影为 `superseded`，session 从 `task_ready` 降回 `active`，历史消息/文本保留且确认按钮消失。继续调查后生成 v2：62 个去重已完成搜索 URL；京东、美的、松下、GB/T 4706.21-2024 与市场监管总局技术原理 5 个草案入口均同时存在于搜索记录和 Markdown，v2 才进入 `draft + task_ready`。
- 从零新建真实回归会话 `interview-session-42494f09-c475-48ff-ad7e-6935abfcba10`。首轮先完成 45 个去重搜索 URL，再只提出一个会改变产品边界的问题；回答“1”后同一轮生成 v1。草案中的京东、格兰仕、美的、GB 21456-2024、上海光机所技术原理 5 个入口逐一通过搜索记录与 Markdown 双重核对；Decision 为 confirmed，草案为 `draft + task_ready`。
- 页面 `http://127.0.0.1:6173/` 控制台 0 error / 0 warning，当前停留在“回归验证：我要抓取微波炉的数据”草案供负责人检查。本轮没有点击“确认范围并生成正式任务”，没有生成该回归任务的 Capture Task/Crawl Plan，更没有开始抓取。

本轮架构影响：改变。新增的是 Category Interview runtime 与 Workbench 之间的最小覆盖校验凭证及草案验证标记；消息、搜索时间线、Markdown、Capture Task、Crawl Plan 和 Source Dataset 的事实归属与依赖方向保持不变，没有第二套会话/任务/来源事实或 fallback。

全部改动与两个真实待确认草案仍只在本机工作树/本机数据库，未提交、未推送，不构成新的跨电脑接续点。

## 15. 2026-08-20 微波炉零问题直出草案缺陷与修复 Issue 登记（未实施）

用户在生产 Workbench 新建“我要抓取微波炉的数据”后，首轮搜索结束便直接得到草案，没有负责人问题。当前会话 `interview-session-ce6a3268-55ef-4c43-8b08-dff1a73d1da6` 的 API 事实为 `task_ready / idle`、0 个 Decision、0 个未决项、1 个 draft；草案自行写入家用市场、产品形态、复合机和商用边界。该现象已通过只读诊断确认，不是前端漏展示。

根因是生产 Skill/Prompt 允许 Agent 在调查后自行判定“提问或直接草案”，而 Workbench 只能验证模型已经声明的 Decision、未决项和四类来源覆盖，不能判断模型漏报的语义取舍。现有测试夹具又把模糊首句零 Decision 直接进入 `task_ready` 当作合法路径。四类来源证据门解决了来源不足，没有解决负责人取舍是否充分。

详细且可执行的修复方案、非目标、文件范围、验收矩阵和停止条件已经登记在 `.scratch/executable-category-crawl/issues/01-interview-scope-decision-gate.md`，状态为 `ready-for-agent`；当前 PRD 同步增加对应产品不变量与链接。方案不增加最低问题数、品类表、JSON audit、第二模型、repair 或 fallback，只收紧现有 Interview Skill/Prompt 对范围依据的判断。

```text
Baseline Impact:
- touched modules: 本轮只写 Issue/PRD/PROGRESS 留迹；后续实现限定为 Interview Skill、Codex Interview Prompt 和相关测试
- owning fact source: Category Interview / PostgreSQL，保持不变
- public interface changed: no
- new protocol/adapter/fallback: no
- compatibility or legacy path changed: no；当前真实会话和历史草案保持原样
- research update required: no；没有新能力、依赖或模型路径
- architecture or ADR update required: no；模块职责、事实源和依赖方向不变
- tests and real-surface validation to run: 以 Issue 01 的模糊/完整微波炉对照流程和现有全量门为准
```

```text
Patch Disposition:
- delete: 后续删除模糊首句零 Decision 直接草案属于正确行为的测试语义
- keep: 一次一问、只问真实取舍、四类来源覆盖、Markdown 确认和确认后结构化
- rewrite: 后续重写“没有必要取舍”的 Skill/Prompt 判断纪律与 fake runtime fixture
- reason: 当前缺陷是 Agent 把未确认范围选择误当系统默认，不是来源覆盖、状态机或 JSON schema 缺失
```

本轮架构影响：澄清，无代码、公共 contract、数据库或运行状态变化。下一步第一条动作是按 Issue 01 先建立 Prompt/fixture 红灯，再只改 Skill/Prompt；真实模糊微波炉流程仍零问题直出草案时必须判定失败并停止，不能改用硬编码或扩大架构。

以上留迹仍只在本机 dirty worktree，未提交、未推送，不构成跨电脑接续点。

## 16. 2026-08-20 采访范围依据纪律与模糊/完整微波炉对照验收

```text
Baseline Impact:
- touched modules: Interview Skill、Codex Category Interview Prompt、采访 runtime/turn-policy 测试夹具、Issue 01、PROGRESS
- owning fact source: Category Interview / PostgreSQL，保持不变
- public interface changed: no
- new protocol/adapter/fallback: no
- compatibility or legacy path changed: no；历史消息、Decision 和草案未改写或清理
- research update required: no；未引入新能力、依赖或模型路径
- architecture or ADR update required: no；模块职责、事实源、依赖方向和公共 contract 不变
- tests and real-surface validation: Prompt 红绿回归、采访聚焦/集成测试、全量 test/typecheck/build、真实模糊与完整微波炉 Workbench/API 对照
```

```text
Patch Disposition:
- delete: 模糊首句零 Decision 直接草案属于正确行为的 fixture 语义；Prompt 未检查范围依据即可直接草案的宽松表述
- keep: 一次一问、只问真实负责人取舍、四类来源覆盖、Markdown 确认、确认后独立结构化和显式 Start 停止门
- rewrite: “没有必要取舍”的 Skill/Prompt 判断纪律，以及需要直接草案的 fake runtime/来源门夹具
- reason: 根因是同一个采访 Agent 把未经确认的范围选择误当系统默认，不是状态机、来源覆盖、JSON schema 或页面投影缺失
```

实现保持 Issue 01 最小边界：

- `.agents/skills/interview-product-category/SKILL.md` 要求生成草案前逐项检查会改变商品集合、市场或观察时间的范围依据；只接受用户原文、已确认 Interview Decision、Skill 明确批准的系统默认，或不包含负责人选择的客观调查事实。推荐只是 proposal；仍有真实取舍时只输出影响最大的一个 `proposedDecision` 并省略草案。
- `packages/workbench/src/codexCategoryInterviewRuntime.ts` 的生产 Prompt 对齐同一纪律，明确该规则不是最低问题数；没有品类/关键词表、固定问题、JSON 字段、migration、第二模型、repair、fallback、重试或新依赖。
- runtime 直接草案 fixture 改成已经完整表达范围的冰箱请求；四类来源门 fixture 补入已确认生命周期 Decision。结构测试不再冒充自然语言语义判断，现有 typed delta 与 Workbench/PostgreSQL ownership 不变。

红绿与自动化证据：

- 先加入 Prompt contract 红灯，连续两次得到 1 failed / 6 passed；唯一缺失项是生产 Prompt 中的范围依据检查。最小修改后 runtime + turn policy 为 2 files / 13 passed，五个采访聚焦/集成文件为 27/27 passed。
- 全量 `npm test` 为 31 files passed、115 tests passed、1 个既有 realtime acceptance skipped；`npm run typecheck` 六个 workspace 通过；`npm run build` 通过。Vite 仅报告既有约 594.65 kB chunk warning；`git diff --check` 无错误。
- 首次在 sandbox 内运行采访集成测试只因无法连接宿主 `127.0.0.1:5432` 报 `EPERM`，获准连接同一台本地 PostgreSQL 后原命令 27/27 通过；该项分类为环境隔离，不是产品失败。

真实 Workbench/API 对照：

- 模糊输入会话 `interview-session-a2c4c424-345e-4684-b33a-114340d94ef1` 完成 23 个网页搜索活动后，提出 1 个真正改变商品集合的“组合型微波炉是否纳入”问题。API 为 `active / idle`、1 个 `proposed` Decision、1 个 open unresolved item、0 个草案；没有询问网站、京东、品牌/标准枚举或默认采集内容。
- 完整输入会话 `interview-session-5f845c1d-9c61-4fae-9e18-11e401c9c0df` 完成 43 个网页搜索活动后，API 为 `task_ready / idle`、0 Decision、0 未决项、1 个未确认 draft；证明本轮没有引入强制问题数量。
- 页面控制台为 0 error / 0 warning。两条新会话均保留供人工复核；旧错误会话和草案也未清理。本轮没有确认草案、生成回归 Capture Task/Crawl Plan、点击 Start 或执行真实来源抓取。Capture Task 列表在完整对照前后均为同 3 个 ID，因而没有新增 Capture Task 或其下游 Source Run。

本轮架构影响：澄清。改变的是同一个无状态采访 Agent 的 Skill/Prompt 语义纪律和误导性测试数据；Category Interview/PostgreSQL 事实源、App Server ephemeral turn、现有 typed contract、四类来源覆盖门、Capture Task/Crawl Plan/Source Dataset/Source Run 边界与依赖方向均未改变，因此不更新 ARCHITECTURE、RESEARCH 或 ADR。

实现、测试、迁移、Skill、Issue 与权威文档已提交为 `f359e4d2a293f2fce7760aef92609f9f73f686d6` 并合入 `master`，随本次远端交付形成代码层面的跨电脑接续点。本机 API/Web 服务已在交付前停止。两条真实回归会话、搜索时间线与未确认草案仍只存在于本机 PostgreSQL；Cookie、Profile、认证材料和来源内容均未进入 Git，其他电脑需要使用相同输入重新执行真实页面验收。

## 17. 2026-08-20 新建采访记录选中态修复

- 新会话创建后同步左侧 Session ID；点击当前记录不再重建 Timeline；恢复 ID 只在实例首次读取。
- 聚焦测试 4/4、Web 类型检查和真实首轮页面均通过；测试会话已删除。架构影响：无变化。
- 当前改动未提交、未推送；`package-lock.json` 是用户执行 `npm install` 产生的独立既有改动。

## 18. 2026-08-21 Crawl Planning 来源密度、京东契约与一次同线程修正

简单说明：采访不再把四类最低来源门当作搜索完成；京东候选只要按真实 URL 进入可执行 target，就不再被错误要求必须使用某一个 Provider。大计划 JSON 第一次没过原有校验时，系统会保留同一次搜索上下文，把原错误交回模型修正一次；没有新增更细的 JSON 检查。真实验收同时证明当前京东 Provider 每入口只抓一个商品，仍不足以兑现“主流品牌全系在售”，该能力缺口已单独登记，未混进本次补丁。

```text
Baseline Impact:
- touched modules: Interview Skill/Prompt、Crawl Planning Module/Codex runtime、Codex App Server client、AGENTS 最小开发规则、测试与 Issue/RESEARCH/ARCHITECTURE/PROGRESS
- owning fact source: Capture Task、Planning Run 与 Crawl Plan 的既有事实归属不变
- public interface changed: no；HTTP/SSE/shared schema/PostgreSQL schema 不变，只有 Workbench 内部 runtime/client seam 支持同 thread 后续 turn
- new protocol/adapter/fallback: yes；同一 ephemeral thread 最多一次 validation repair turn，不增加模型、Provider、持久 Session 或网络 fallback
- compatibility or legacy path changed: 删除 jd.disposition 与特定 Provider 绑定的错误全局假设；历史 task/run/plan 不改写
- research update required: yes；R-038 登记官方同 thread 多 turn 和逐 turn outputSchema 结论
- architecture or ADR update required: ARCHITECTURE 澄清一次修正回合；事实源和依赖方向不变，不新增 ADR
- tests and real-surface validation: repair/JD/来源 Prompt 红绿测试、全量 test/typecheck/build、真实电视采访与 Planning API 对账；未确认计划、未 Start
```

```text
Patch Disposition:
- delete: “京东 included 必须出现 jd.catalog-product”的错误全局检查
- keep: 现有 Zod、候选/topic、附件正文、Provider validate/preflight 及历史运行事实
- rewrite: 单次 Planning 输出直接成败改为同一 ephemeral thread 最多两轮；四类来源改为最低失败门而非完成标准
- reason: 业务来源覆盖与 Provider 选择被混淆；可修正的大 JSON 错误又被当成终局失败
```

实现与验证：

- `AGENTS.md` 已写入最小规则：LLM 大型结构化输出的错误回填只能复用现有解析/校验错误，不得新增、细化或复制校验。
- App Server client 首轮仍创建一个 ephemeral thread；只有现有输出解析或校验失败时，Planning runtime 才复用该 `threadId` 发起第二个 `turn/start`，两轮都携带相同 `outputSchema`。第二轮仍失败即结束，传输、认证、取消不进入该路径。
- 真实电视草案由上一版 6 个链接提高为 15 个：4 个京东、6 个品牌官方、4 个标准/监管、1 个技术入口。确认后的 Planning 重新搜索 3 轮并增加 LG Display OLED 官方技术来源。
- 真实 Planning Run `crawl-planning-run-288a0f9f-9c5b-4769-994c-488543a1c090` 首轮触发现有“海信电视产品目录缺少说明书正文 target”错误；第二轮在同 thread 只补该正文目标后成功，保存 draft plan `crawl-plan-0401714f-e534-40fe-88f6-31a43b4d1335`：16 sources、25 targets、16 unique entry URLs、总请求预算 37。计划未确认，也没有调用 Start。
- 该计划的 4 个 `jd.catalog-product` 来源仍各只有 1 个商品详情 target，不能满足已确认 Capture Task 的“主流品牌全系在售”。Issue 03 已把它归因为 Provider 固定 `catalog + first_matching_product` 的能力缺口；本轮不偷加分页、枚举或后端数量检查。
- 最终 `npm test`：31 files passed、1 skipped，118 tests passed、1 skipped；`npm run typecheck` 六 workspace 通过；`npm run build` 通过，Web 2301 modules、594.75 kB / gzip 175.87 kB，仅有既存大 chunk warning。
- 验收任务 `capture-task-3a404f9e-4ede-414d-9eaa-bc834303a5a5` 已归档，第一轮稀疏草案会话已删除；任务列表和独立采访列表均不再显示这些临时记录。API/Web 验收进程已停止，PostgreSQL 保持运行。

本轮架构影响：澄清。Planning Run 仍只拥有生成历史，Crawl Plan 仍独占来源/内容/数量；新增的是现有 App Server seam 内的一次同线程修正，不增加第二事实源。当前修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

## 19. 2026-08-21 抓取计划确认、运行准备与 Start 分离

简单说明：网页确认计划不再因为 9222 没启动而报错。确认成功后系统进入抓取准备：端口不存在就用项目独立 Profile 启动 Chrome，检查京东是否登录；未登录时打开登录页并提示扫码，重新检查通过后才显示“开始抓取”。准备本身不生成抓取记录，Start 仍会最终复检。

```text
Baseline Impact:
- touched modules: shared preparation contract、Crawl Planning、Source Execution、JD Provider、API/Web、ADR/ARCHITECTURE/ROADMAP/RESEARCH/PROGRESS
- owning fact source: Crawl Plan 继续独占来源/内容/数量；Source Execution 拥有临时运行准备；Source Dataset 只由 Start 创建运行事实
- public interface changed: yes；新增 typed Prepare HTTP 接口与 ready/action_required 响应
- new protocol/adapter/fallback: no 新 fallback；扩展既有 Source Provider seam 的 prepare/close 生命周期，复用 Playwright 官方 persistent context
- compatibility or legacy path changed: 计划确认删除运行态 preflight；Start 保留 confirmed plan 重读和最终 preflight；历史 plan/run/snapshot 不改写
- research update required: yes；R-036 补充 Playwright/Chrome 官方独立 Profile 与 remote debugging 约束
- architecture or ADR update required: yes；运行准备职责从 Crawl Planning 确认移动到 Source Execution，ADR-0013 已追加修订
- tests and real-surface validation: full test/typecheck/build；真实 9222-off Prepare；用户扫码后的 ready 和 Start 留给页面人工验收
```

```text
Patch Disposition:
- delete: 确认按钮中的 CDP/runtime preflight、底层 connectOverCDP 原始错误直出页面
- keep: Provider 纯结构 validate、confirmed plan 重读、Start 最终 preflight、登录/验证/风控失败即停、SSRF 公网地址拒绝、独立本机 Profile
- rewrite: JD 浏览器生命周期和 Web Start 门改为 Confirm → Prepare → ready → Start
- reason: 计划业务确认不应由易变本机运行态阻断；运行准备又必须在创建 Source Run 前完成
```

实现与验证：

- `POST /api/capture-tasks/:taskId/crawl-plans/:planId/prepare` 重读精确 task revision/plan version；每个 source 仍逐项 validate，Provider 会话准备只执行一次，不在正式抓取前无频控重复访问同一站点。
- `jd.catalog-product@1.0.0` 先连接 loopback CDP；9222 不存在时调用 Playwright `launchPersistentContext`，使用 Git 忽略的 `data/jd-cdp-profile` 和系统 Chrome，再通过 CDP 确认端口。未登录/验证只返回 typed 人工动作并把页面置前，不保存受限页面和认证材料。
- Web 确认成功后自动调用 Prepare；已有 confirmed plan 显示“准备抓取环境”。`action_required` 只显示“已完成，重新检查”，`ready` 才显示“开始抓取”。Start 内仍有服务端最终 preflight，不能只信页面状态。
- 真实本机验收先确认 9222 关闭，再调用正式 Prepare：系统启动 Chrome/151 并开放 `127.0.0.1:9222`，返回 `action_required/login_required` 和扫码提示；未创建新的 Source Run。本轮没有代替用户扫码，也没有调用 Start。
- `npm test`：32 files passed、1 skipped，121 tests passed、1 skipped；`npm run typecheck` 六个 workspace 通过；`npm run build` 通过，Web 2301 modules、596.39 kB / gzip 176.26 kB，仅有既存大 chunk warning；`git diff --check` 通过。

本轮架构影响：改变。Crawl Plan 的事实归属没有变化，但运行态 preflight 从计划确认职责移到 Source Execution 的显式 Prepare/Start 门；新增一个 typed HTTP contract，不新增数据库状态、队列或第二事实源。当前修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

## 20. 2026-08-21 京东请求级频控审计与登录硬停止

简单说明：昨晚的频控不是“等待不够久”，而是旧系统只给两次页面跳转计时，准备和复检会额外访问京东，页面自己加载的脚本、图片、接口和跳转又完全不计数；程序重启后冷却也会忘掉。当前已经把京东入口关闭：准备、开始和直接调用都不会启动 Chrome、不会检查登录、不会访问京东。本地只对随机端口假站做了请求级原型，证明每次跳转先占预算、首个 429 后不再发请求。正式恢复还需要把持久限速、待抓工作项和逐请求记录接入 PostgreSQL；这会改变当前工作流与公共数据 contract，需人工确认后实施。

```text
Baseline Impact:
- touched modules: Source Access、JD Provider、Source Execution、Source Dataset policy projection、公共资源 Provider、Web 多来源失败隔离、RESEARCH/ARCHITECTURE/JD 设计/Issue/PROGRESS
- owning fact source: Crawl Plan 继续拥有来源与计划级访问政策；Source Dataset 拥有 Source Run/target/snapshot；候选逐请求 observation 仍未获得持久事实归属
- public interface changed: no；已撤回 Provider accessPolicy 扩展，shared/HTTP/PostgreSQL schema 本轮不变
- new protocol/adapter/fallback: yes；新增未接入生产的显式会话 HTTP adapter；拒绝 browser route fallback，不增加重试、代理、账号轮换或反检测
- compatibility or legacy path changed: yes；JD Prepare/Preflight/Collect 从自动启动/页面访问改为统一失败关闭；其他 Provider 可独立继续
- research update required: yes；R-032/R-036 撤回旧结论并登记 Playwright 请求级审计、当前开放平台排除、Crawlee 持久队列候选与代理/Firefox 边界
- architecture or ADR update required: ARCHITECTURE 改变当前 JD Source Access 能力状态；持久准入/逐请求 contract 和恢复语义尚未实现，不新增 ADR
- tests and real-surface validation: 本地随机端口 Chrome fixture、JD 失败关闭、Source Execution 多 Provider 隔离、全量 test/typecheck/build、端口零监听；禁止京东真实页面与登录
```

```text
Patch Disposition:
- delete: Prepare/Preflight 未计量 page.goto、页面型 JD collect、1ms 批次冷却、未计量重定向的 browser route POC
- keep: p-queue/Cockatiel 显式任务 gate、typed SourceAccessError、Crawl Plan/Source Dataset 单一事实源、独立来源失败隔离 WIP
- rewrite: 本地候选改为 BrowserContext.request 显式 HTTP，每个 redirect hop 手动预算；生产 JD 三个入口全部失败关闭
- reason: 旧补丁保护的是导航次数而非真实网络请求，且进程重启后状态丢失，不能继续叠延迟或 UI 反推
```

调查与原型事实：

- 旧 JD 路径共有四个失效点：Prepare/Preflight 各自绕过 gate 导航；一个 `page.goto` 内的全部子请求不计量；生产把批次冷却硬改为 1ms；403/429 被转成 snapshot 文案而未触发 circuit。
- Playwright context 事件只能观测已发出的请求；route POC 又在 302 第二跳上出现服务端已收到、计量层未记账的红灯，和官方 redirect issue 一致，因此整个 POC 文件删除。
- `PacedSessionHttpAccess` 使用与 BrowserContext 共享 Cookie jar 的官方 `APIRequestContext`，关闭自动 redirect，白名单 origin，每一跳先进入现有 gate。随机端口 fixture 已证明共享本地测试 Cookie、最小间隔、批次冷却、预算前停止和首个 429 后零继续派发；没有访问外网。
- 当前官方入口是 `open.jd.com` 的京东零售开放平台/SP-API，不再引用 JOS。项目没有满足条件的商家/服务商主体、应用和接口权限，公开能力也不能证明覆盖分类筛选、全量详情图文和每 SKU 评价样本；官方 API 已从本轮候选中排除，不再与网页采集形成虚假的二选一。
- 用户要求下一轮保持最小改动但必须兑现完整范围。已形成 `JD-COLLECTION-ITERATION.md`：保留 Source Dataset/Asset/cacache、target attempt、p-queue/Cockatiel 和显式 HTTP；用 JD v2 计划/动态覆盖语义、PostgreSQL Capture Work Item＋逐请求账本/准入、现有 Crawlee RequestQueue 强杀恢复、图片资源引用与显式继续补齐缺口。负责人随后确认本阶段京东图片只保存 URL，不请求图片字节；通用 Asset/cacache 只保留给计划明确要求下载的其他来源。`rate-limiter-flexible`、DBOS、轮换代理池和 Firefox fallback 均不进入基础实现；Firefox只保留为满足严格前提时的单变量对照。

验证结果：显式开启浏览器 fixture 的 4 个聚焦文件为 12/12 通过，其中请求级 fixture 3/3；全量 `npm test` 为 32 files passed、2 skipped，122 tests passed、4 skipped；六个 workspace `npm run typecheck`、production `npm run build` 与 `git diff --check` 均通过。Vite 只有既存约 596.68 kB chunk warning。验证前后 4000/6173/9222 均无监听；没有启动项目 Chrome、没有登录、没有访问京东或其他外部来源。

当前阻塞：`JD-COLLECTION-ITERATION.md` 已把下一轮范围、旧补丁处置、公共 contract 变化、实现切片和验收门写清，等待负责人复核；本轮只获准出迭代文档，没有修改业务代码、登录京东或运行真实探针。当前修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

## 21. 2026-08-21 京东完整来源数据闭环迭代文档

简单说明：下一轮不会再把“一个目录＋一个详情”当作完整抓取，也不会用代理池、Firefox 或某个 limiter 的名字代替请求最小化。迭代文档要求同一 JD v2 纵切片覆盖分类/筛选、店铺/商品、完整详情、主图/详情图/参数图 URL、评价汇总和 50/100 条样本；图片 URL 从已有详情响应保存，图片服务器请求数必须为 0。其余真实 HTTP hop 先进入持久准入，受限即全京东停止，强杀后只在负责人显式继续时处理未完成项。

本轮文档产物：

- 新增并修订 `docs/development/JD-COLLECTION-ITERATION.md`，明确完成定义、Baseline Impact、Patch Disposition、JD v2 target、显式 HTTP、逐请求 PostgreSQL 账本、Crawlee RequestQueue 恢复、图片 URL-only/评价语义、代理/Firefox 处置、I0～I5 停止门和自动化验收矩阵；
- `README.md` 文档地图登记其唯一职责，明确它不是平行 roadmap/progress/architecture；
- `JD-COLLECTION-DESIGN.md` 指向下一轮迭代说明；
- `RESEARCH.md` 纠正 JOS 旧入口和 `rate-limiter-flexible + DBOS` 的错误解法，登记当前 `open.jd.com` 条件缺口、Crawlee 持久队列候选、轮换代理池拒绝和 Firefox 条件对照边界。
- `REQUIREMENTS-ALIGNMENT.md` 新增 D012，确认京东图片当前只保存 URL；`CONTEXT.md` 新增 `Source Resource Reference`，明确 URL 引用不是已下载附件。

本轮架构影响：澄清，无已实现架构变化。文档提出的 JD v2、逐请求公共 contract、数据库 migration 和显式恢复尚未实现；实施时必须先更新/修订 ADR-0013/0016，再按 I0 红灯开始，不能把本文件当作代码完成证据。

验证边界：只运行文档一致性、链接/状态和 diff 检查；没有运行代码测试，因为本轮没有业务代码改动且当前工作区已混有上一轮未提交代码 WIP。没有登录、访问京东或启动真实来源请求。

下一步第一条动作：负责人复核 `JD-COLLECTION-ITERATION.md` 除图片 URL-only 外的完整范围；确认后从 I0 开始，先写多资源、25+ 图片 URL、图片服务器零请求、redirect、403/429 和强杀恢复的本地红灯 fixture，再修改 contract 或生产 Provider。

## 22. 2026-08-21 京东 v2 本地数据闭环与请求级停止门

简单说明：京东抓取路径已经从“打开一个浏览器页面再猜发了多少请求”改成“每个真实 HTTP 跳转先在数据库领一次许可，再发出请求”。系统现在能从目录动态发现店铺和商品，保存详情、评价与图片 URL；图片文件完全不下载。首次遇到登录、验证、403/429、风险/频控正文、未知跳转或异常响应就停止。程序被强杀后，不会重复已完成项，也只有负责人点击“显式继续”才处理剩余工作。当前开关仍是关闭的，所以这些结论全部来自本机假站，没有访问京东。

```text
Baseline Impact:
- touched modules: shared Crawl Plan/Source Dataset contract、Drizzle schema/migrations、Source Dataset、Source Access、JD Provider、Source Execution、API/Web、RESEARCH/ADR/ARCHITECTURE/ROADMAP/PROGRESS
- owning fact source: Crawl Plan 拥有来源/内容/数量/停止政策；Source Dataset/PostgreSQL 拥有 run/target/work/request/gate/snapshot/resource reference；Crawlee 只拥有本机派发 mechanics
- public interface changed: yes；新增通用 Resource Reference、Capture Work Item、Request Attempt、Access Gate、resumedFromRunId、SourceProvider collection context 和显式 resume HTTP/SSE
- new protocol/adapter/fallback: yes；新增 PostgreSQL 请求准入、session advisory run lease、Crawlee 持久派发和 JD v2 显式 HTTP adapter；没有 fallback、自动 retry、代理池或浏览器 registry
- compatibility or legacy path changed: yes；JD v1/CDP 不再注入，新计划只生成 v2；历史计划、运行与快照保持可读
- research update required: yes；R-032/R-036 接受本地组合并记录 Crawlee 3.18.1 双锁周期、PostgreSQL advisory lease 和真实站点未验证边界
- architecture or ADR update required: yes；ARCHITECTURE 与 ADR-0013/0016 已更新公共事实源、恢复和访问职责
- tests and real-surface validation: 强杀子进程、PostgreSQL 集成、本地浏览器 HTTP fixture、JD 全纵向 fixture、API/Web、全量 test/typecheck/build；禁止京东真实请求
```

```text
Patch Disposition:
- delete: v1 page.goto/CDP/自动登录生产路径、图片下载/图片工作项、1ms 冷却、受限后重试和 DBOS/rate-limiter-flexible/代理池/Firefox fallback 结论
- keep: Crawl Plan/Source Dataset 单一事实源、target attempt、SourceAccessError、p-queue/Cockatiel 进程内调度、PacedSessionHttpAccess 手工 redirect、公共 Asset/cacache 与多 Provider 失败隔离
- rewrite: JD Provider 升级为 v2 五类动态工作；请求政策改为 PostgreSQL 逐 hop 准入；前台停止改为新 run 显式继续；图片改为 Snapshot Resource Reference
- reason: 旧实现计量的是导航而不是真实网络请求，进程重启会遗忘冷却，图片下载还增加不必要请求；继续叠延迟无法保护当前业务不变量
```

实现结果：

- 新增迁移 0018～0021：Resource Reference、Capture Work Item、Request Attempt、Access Gate 和 `resumedFromRunId`。Snapshot 与资源引用同事务提交；JSONL/CSV、API 和 Workbench 同屏读取同一事实。
- `PacedSessionHttpAccess` 对每个手工 redirect hop 先预留数据库 attempt；数据库失败、预算不足、冷却未到、circuit open、未知跨源跳转都产生零网络。401/403/429、登录/验证/风险/频控正文和其他异常响应完成账本后失败关闭。
- `jd.catalog-product@2.0.0` 只接受目录、店铺目录、商品详情、评价汇总、评价样本五类 target；Prepare 为零请求。详情解析 Resource Reference，不创建图片工作项。`JD_REAL_HTTP_ENABLED` 严格解析 true/false，默认 false；只有显式 true 才注入匿名、无 Cookie/Profile 的 APIRequestContext。
- 命名 Crawlee 3.18.1 RequestQueue 以稳定 work key 去重。强杀红灯最终定位为 v2 先锁队头、取请求时再延长一个周期；恢复上限改为 `2 × requestLockSecs + 1s`，真实 SIGKILL 测试通过。失败项不 reclaim、不自动 retry。
- Source Run 用 PostgreSQL session advisory lease 防止双执行；强杀断连自动释放。恢复前把 started request 结算为 outcome unknown、running work/target 结算为 stopped；新 run 记录 `resumedFromRunId`，预算和冷却沿链累计。
- Workbench 显示 request ledger、work、gate/circuit、图片 URL 引用和“显式继续”；API resume 复用原 SSE 契约。用户断开连接继续触发取消，不会转成后台自动任务。

本地验证证据：

- 全仓 `npm test`：38 files passed、2 skipped；137 tests passed、7 skipped。默认跳过的 6 条浏览器准入门另以 `RUN_BROWSER_RATE_GATE=1` 执行，6/6 通过。
- JD 完整本地纵向：2 个目录、1 个店铺目录、3 个商品详情、3 个评价汇总、3 个 50 条评价样本，共 12 个 Snapshot/Work/Request Attempt；每商品 25 个图片 URL，共 75 条 Resource Reference；图片服务器请求 0。
- 强杀门：Crawlee 子进程 SIGKILL 后已完成项不重复、锁未到期不派发、到期只取得未完成项；Source Run lease 子进程 SIGKILL 后活动继续先被拒绝，连接断开后可恢复。
- `npm run typecheck` 六个 workspace 通过；`npm run build` 通过，Web 2301 modules、602.06 kB / gzip 177.65 kB，仅有既存大 chunk warning；尚需最终 `git diff --check`。

真实 Workbench 对照：本机 API `127.0.0.1:4000`、Web `127.0.0.1:6173` 启动后，当前家用冰箱 v2 任务的已确认 Crawl Plan 仍绑定历史 `jd.catalog-product@1.0.0`。点击“准备抓取环境”后页面明确显示 `Provider 不可用：jd.catalog-product@1.0.0`，没有开放 Start、没有创建 Source Run，也没有访问京东；原始数据页保持空态。浏览器控制台 0 error / 0 warning。当前数据库没有 v2 Source Run，因此 request/work/gate/resource reference 的真实有数据页面只由组件测试与 API 纵向测试覆盖，本轮没有为截图污染正式数据。

本轮架构影响：改变。Crawl Plan 的来源/内容/数量事实归属不变；Source Dataset/PostgreSQL 新增动态工作、逐请求准入、恢复和 URL 引用事实，Source Access 只执行其准入结果，Crawlee 只负责派发。没有第二套状态机、万能 Provider、代理/浏览器 fallback 或自动绕过。

真实边界：只启动本地 API/Web 验证安全失败与空态，没有登录、访问京东或下载图片。当前修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。下一步必须由负责人另行授权真实匿名最小探针；首个受限信号即停止，不能直接进入登录或扩批。

## 23. 2026-08-21 公司 Fake-IP 网络修复与首轮真实多来源闭环

简单说明：截图中的“6 个来源全部 0 条”不是站点统一反爬，而是公司代理把域名解析成 Fake-IP 后，旧 transport 在发出 HTTP 前把它们全部拒绝；旧公共 Provider 的延迟又只存在于单次运行内，数据库里没有任何请求记录。修复后，同一个微波炉任务已真实抓回美的商品页、两条国家标准页和 FDA 页面，共 4 个不可变快照。美的页含 8 个商品、型号、价格、库存和图片 URL，并能从正式 JSONL/CSV 导出。京东和格兰仕没有伪装成功：前者 robots 被站点 302 到错误页，后者计划域名不存在，必须修计划或使用专用 Provider。

```text
Baseline Impact:
- touched modules: Source Access/public.web-resource、公共网络政策、Source Request Admission 接线、Crawl Planning 保存门/Prompt/Skill、worker 依赖、RESEARCH/ADR/ARCHITECTURE/ROADMAP/PROGRESS
- owning fact source: Crawl Plan 继续拥有来源/入口/请求政策；Source Dataset/PostgreSQL 拥有 work/request/gate/snapshot；部署环境只提供代理地址
- public interface changed: no；复用既有 SourceRequestAdmissionPort、Capture Work Item、Request Attempt 与 Access Gate contract
- new protocol/adapter/fallback: yes；新增 Node 24 官方代理 Agent＋可信 DoH＋固定公网 IP/SNI transport；没有自动 fallback、代理池、身份轮换、登录绕过或 retry
- compatibility or legacy path changed: yes；公共 Provider 不再直接使用 Got 或每次 run 独立的进程内 gate；历史 run/snapshot 保持可读
- research update required: yes；R-037 登记 Mihomo Fake-IP、官方代理/DoH 候选、原型和真实验收
- architecture or ADR update required: yes；ADR-0016/ARCHITECTURE 更新公共 Source Access 与持久准入职责
- tests and real-surface validation: Fake-IP/DoH/pinned IP、SSRF IPv4/IPv6、逐请求准入、同任务真实 Start、PostgreSQL 账本、JSONL/CSV、全量 test/typecheck/build
```

```text
Patch Disposition:
- delete: 公共 Provider 直连 Got 的 Fake-IP 不可用路径、每个 Source Run 独立创建的进程内 paced gate、规划 Skill 残留的 JD v1/CDP 两 target 规则、公共多来源/京东计划已可运行的错误结论
- keep: HTTPS 443/私网保留地址拒绝、robots 预算、零 redirect/零 retry、最大字节、JD v2 PostgreSQL 请求停止门
- rewrite: 公共网络改为先识别 Fake-IP，再经显式 HTTPS 代理查询可信 DoH并固定已校验公网 IP；robots/target 每次请求均进入现有 PostgreSQL admission
- reason: 直接放过 198.18.0.0/15 会破坏 SSRF 边界，继续叠延迟既不能出网也不能跨进程生效
```

实现结果：

- 新增 `publicResourceTransport`：普通 DNS 地址与 DoH 地址都必须逐个通过公网校验；Fake-IP 仅在存在显式 HTTPS 代理时经 Google Public DNS 解析；真正连接固定到校验过的 IP，原域名只用于 Host/SNI。响应流保持 30 秒超时和计划字节上限。
- 修正公共网络 BlockList：IPv4 与 IPv6 分开校验，避免 `::ffff:0:0/96` 错误命中全部 IPv4；`8.8.8.8` 正例与私网/保留地址反例均由测试保护。
- `public.web-resource` 的 robots 和 target 都先创建/启动 Work Item、预留 Request Attempt，并以 `public.web-resource@1.0.0:<origin>` 共享 PostgreSQL gate；401/403/429、5xx、DNS/DoH 与 transport 错误均记账后失败关闭。
- 移除 worker 对 Got 的直接依赖；Crawlee 的间接依赖不变。没有引入新的 limiter、队列、代理池、浏览器或图片下载。
- Crawl Planning 新增确定性京东完整性门：任务确认纳入京东时，public-only 搜索页计划直接失败，必须另有 `jd.catalog-product@2.0.0` 五类动态来源。Skill 与 runtime prompt 已统一为 JD v2；找不到可验证目录入口时停止规划，不再让用户确认一份注定抓不到京东商品的计划。

真实 Workbench 验收：任务 `capture-task-7489db28-65aa-48f5-8a25-815efc8a9858`、计划 `crawl-plan-1b00bad8-b5b7-42d1-8bc7-15f610120114` 从正式 Start 路径执行。最新 6 个 Source Run 为 4 completed/2 failed：

- 美的 `source-run-da8eed74-dfac-4d79-9e2d-def0347d2c68`：1 Snapshot、2 Work Item、2 Request Attempt、共享 origin gate；原始 HTML 119623 bytes，包含 8 个微波炉商品、`EM925F4T-SS`、`M3-L234E`、`EG720KG3-NR1`、价格/库存和图片 URL。
- 国家标准两条与 FDA：各 1 个 accessible Snapshot；所有请求按计划的 60000ms 最小间隔执行。
- 京东搜索来源：`https://search.jd.com/robots.txt` 真实返回 302，Location 为 `https://h5st.m.jd.com/file-no.2/public/error.html`，按零 redirect 门失败；它证明当前旧计划入口无效，不是 JD v2 商品闭环。
- 格兰仕来源：可信 DoH 返回 DNS status 3/NXDOMAIN，证明计划域名不存在。
- 美的正式 API 导出：JSONL 1 条/126312 bytes，CSV 122305 bytes；导出记录可命中上述 3 个型号并包含图片 URL。

当前验证：`npm run typecheck` 六个 workspace 通过；全仓 `npm test` 为 38 files passed、2 skipped，139 tests passed、7 skipped；`npm run build` 六个 workspace 通过，Web 2301 modules、602.06 kB / gzip 177.65 kB，仅有既存大 chunk warning。新增规划硬门先取得 1 个预期红灯，再由聚焦 PostgreSQL/Codex runtime 测试 19/19 通过。真实任务与导出均使用正式本地 PostgreSQL，不是注入 transport 或临时数据库。Workbench 浏览器原始数据页显示最新 6 条运行中 4 条 `1 条 · completed`、2 条明确 failed；点开美的运行可见 1 个不可变快照、请求账本 2/5，并能在页面原文命中三个商品型号。

本轮架构影响：改变。Crawl Plan、Source Dataset 与 Source Execution 的事实归属不变；公共 Source Access 的 transport 由 Got 直连改为 Node 官方代理/DoH/固定 IP，并强制复用既有 PostgreSQL admission；Crawl Planning 保存门新增“京东 included 必须有 JD v2 来源”的产品不变量。没有新增公共 contract、第二事实源、自动恢复/fallback、登录或反检测。本机修改尚未提交、推送，不构成跨电脑接续点。

## 24. 2026-08-21 抓取批次归属、旧计划执行硬门与真实页面修复

简单说明：绿色“准备完成”以前只是检查条件，却看起来像一瞬间抓完；原始数据又只有来源运行，没有“这次点击”这个批次，所以新旧结果混在一起。现在条件检查会明确写“没有创建批次、没有访问来源”；每次真正开始会先建立一个批次，本轮结果全部归到它下面。旧记录不删除，统一放进“历史记录（无批次）”。缺少京东商品 Provider 的旧 v1 计划已经不能再开始。

```text
Baseline Impact:
- touched modules: Crawl Planning、Source Execution、Source Dataset/PostgreSQL、API SSE、计划/原始数据 UI、typed contract、迁移 0022、测试与权威文档
- owning fact source: Crawl Plan 拥有执行范围；Source Collection Batch 拥有一次 Start；Source Run 只拥有一个来源执行
- public interface changed: yes；新增 Batch/Task View/Execution Event，Source Run 增加可空 executionBatchId
- new protocol/adapter/fallback: no 新外部协议、retry、代理、登录或 fallback
- compatibility or legacy path changed: yes；历史 Source Run 保留但明确为无批次，旧无 JD v2 confirmed plan 不得再次 Prepare/Start
- research update required: yes；R-039 接受显式 PostgreSQL 父事实，拒绝时间戳分组和通用 workflow 扩张
- architecture or ADR update required: yes；ARCHITECTURE、CONTEXT 与 ADR-0016 已更新批次事实归属和执行门
- tests and real-surface validation: migration、批次归属、旧计划硬门、SSE、UI 分组、JD fixture、全量 test/typecheck/build、真实 Workbench 页面
```

```text
Patch Disposition:
- delete: Prepare 成功等同抓取完成的绿色反馈、旧计划静默可执行路径、平铺 Source Run 冒充一次 Start
- keep: 历史 Source Run/Snapshot、不可变原始数据、request/work/gate、显式 Start/Resume、无自动重试
- rewrite: Start 先创建 Batch，再创建归属本批次的 Source Run；UI 按批次显示计划版本、时间、状态和来源结果
- reason: 旧实现缺少用户点击这一层事实，导致瞬时无执行和历史混杂都无法被产品准确表达
```

实现与真实证据：

- 新增 `Source Collection Batch` typed contract、PostgreSQL 表和 migration 0022；Batch 在 Provider preflight 前创建，按全部来源终态结算 completed/partial/failed/stopped。新 Start 的 Source Run 必须带同一 batch ID，历史行保持空关系。
- `CrawlPlanningModule.requireExecutablePlan` 成为执行前完整性事实门。真实旧计划 `crawl-plan-1b00bad8-b5b7-42d1-8bc7-15f610120114` 的 Prepare 已由本机 API 返回 422：`任务已纳入京东，但抓取计划缺少 jd.catalog-product@2.0.0 商品数据来源`；没有创建 Batch、Source Run 或网络请求。
- Workbench 真实计划页显示最新重新规划 `interrupted`，明确“没有生成可用的新计划”，并在旧 v1 下显示不能开始的 JD v2 缺口；原始数据页显示 `历史记录（无批次） · 18 个来源运行 · 4 条`。
- 再次重新规划已经生成待确认的 Crawl Plan v2：7 个来源、11 个 target；独立“京东自营微波炉目录”使用 `jd.catalog-product@2.0.0` 的 5 个动态 target。系统第一次输出因公共 URL 精确绑定校验失败，按原错误有界修正一次后成功；没有绕过校验。

当前停止门：新 v2 仍是“待确认”。抓取计划确认属于负责人决策，本轮没有代替负责人点击确认，所以也没有点击 Start、登录京东或发起真实京东请求。确认后页面将先显示“检查抓取条件”，ready 只说明零数据检查；第二个按钮才是“开始新批次抓取”。

验证状态：六个 workspace `npm run typecheck` 通过；全仓 `npm test` 为 38 files passed、2 skipped，142 tests passed、7 skipped；`npm run build` 六个 workspace 通过，Web 2301 modules、604.85 kB / gzip 178.47 kB，仅有既存大 chunk warning。定向历史恢复测试 2/2 通过，确认数据库 `NULL` 批次在 contract 边界保持“无批次”，不会伪造归属；`git diff --check` 通过。真实页面已核对 v2 的 `jd.catalog-product@2.0.0`、5 个动态 target、9 次预算和登录/验证码/拒绝/风控停止门。

本轮架构影响：改变。新增 Source Collection Batch 作为一次 Start 的唯一事实源；Crawl Plan、Source Run、Snapshot 和请求准入的原有事实归属不变。没有引入第二套工作流、自动恢复、代理池、登录绕过或图片下载。本机修改未提交、未推送，不构成跨电脑接续点。

## 25. 2026-08-21 页面无关的后台抓取、京东真实目录 URL 与页面确认组件

简单说明：现在用户点“开始新批次抓取”后，页面只负责把命令交给服务端，约 0.3 秒就能得到“后台已提交”；关闭、刷新或切到别的页面都不会停止抓取。原始数据页会从数据库持续看到批次、来源、请求和快照进度。真实电视任务已经在离开计划页后继续抓到京东目录 30 个商品和 60 条图片 URL；图片文件没有下载，首个详情若仍只有客户端骨架就按真实限制停止。所有浏览器系统弹窗也已换成页面内可访问确认组件，不再阻塞浏览器控制。

```text
Baseline Impact:
- touched modules: Source Execution API composition、Graphile job adapter、shared 202 acceptance contract、计划/原始数据 Web、JD catalog parser/provider、页面确认组件、RESEARCH/ARCHITECTURE/ROADMAP/ADR/PROGRESS
- owning fact source: Crawl Plan 拥有范围；Source Collection Batch 拥有一次 Start；Source Dataset/PostgreSQL 拥有 Run/Target/Work/Request/Gate/Snapshot/Resource Reference；Graphile 只拥有派发 mechanics
- public interface changed: yes；Start/Resume 从 SSE 执行流改为 JSON 202 acceptance，Web 后续只读 Source Dataset
- new protocol/adapter/fallback: yes；Graphile Worker 0.17.3 嵌入 API，单并发 PostgreSQL job；没有自动 retry、代理池、身份轮换、登录绕过或 fallback
- compatibility or legacy path changed: yes；页面断开不再转换为 operator_cancelled；历史 Batch/Run/Snapshot 保持原样可读
- research update required: yes；R-041 完成 Graphile/DBOS/pg-boss/Crawlee 候选处置、最小原型和安全边界
- architecture or ADR update required: yes；ARCHITECTURE 与 ADR-0013 已替代前台 SSE 当前契约；ROADMAP 记录页面断连门与进程强杀剩余边界
- tests and real-surface validation: task seam、202 route、真实 PostgreSQL/随机端口断连、同队列串行/runner 重启原型、Web 轮询、全量 test/typecheck/build、真实 Workbench 点击后离页
```

```text
Patch Disposition:
- delete: Start/Resume 的 SSE response、HTTP socket close → AbortSignal、抓取页面卸载 abort、UI 长时间“正在抓取”假占有；JD 假 `data-jd-*` 图片/店铺/评价完成规则；全部原生 alert/confirm/prompt
- keep: Source Collection Batch/Run/Target/Work/Request/Gate/Snapshot、PostgreSQL 请求频控/预算/熔断、Crawlee Provider 内工作队列、首错停止、显式继续关系、图片 URL-only
- rewrite: API Start/Resume 改为 typed 202 enqueue；服务端 task 消费完整 Source Execution 流；Web 改为短提交＋运行态轮询；JD 目录解析改用真实 `#J_goodsList li.gl-item[data-sku]` 与图片懒加载属性
- reason: 浏览器/Codex 连接不是业务任务句柄；旧假 DOM 属性和前台连接契约都已被真实页面推翻，不能继续叠 fallback
```

实现结果：

- 接受并锁定 `graphile-worker@0.17.3`。API 启动时使用官方 migrator和 library runner；`execute_source_collection` task 与 `source_collection` queue 单并发，payload 只含 task/plan/run/revision/command ID，`maxAttempts=1`。Graphile 表不进入 UI、导出或业务状态判断。
- Start 在入队前重读当前 confirmed plan/Provider readiness，成功返回 `{status:"accepted", commandId}`；后台 task 不带浏览器 `AbortSignal` 并消费完整 async iterable。Resume 使用同一后台契约。服务关闭先停止 runner，再关闭 Workbench/provider。
- Workbench 按 Batch/Run running 状态每 2 秒读取 Source Dataset；Start/Resume 按钮只在提交期间显示“正在提交”，随后明确提示可以关闭或离开页面。原始数据继续按 Batch 分组，历史无批次记录不混入新批次。
- 京东真实目录 parser 从 30 个 `data-sku` 商品卡保存 30 个商品工作项和 60 条主图 URL 引用；图片服务器请求为 0。虚构的 `data-jd-image-role`、店铺和评价属性已删除。匿名商品详情只返回骨架时形成 source failure 并停止后续 29 个详情请求，不伪造 target 完成。
- `ConfirmationDialog` 复用 Radix Alert Dialog，覆盖删除任务、删除采访和显式继续；取消默认获焦、Esc、焦点归还、取消零副作用、确认一次，以及生产源码零 native alert/confirm/prompt 均由测试保护。

真实 Workbench 证据：电视任务 `capture-task-2e069323-caf9-4862-abdf-08fb4448897b` 的 confirmed plan v1 在页面点击 Start 后 307ms 显示 `source-command-c897d3b7-3964-4200-93f0-60b2ac550882` 已交给后台；随即切到“抓取范围”，原 Start 页面已卸载。再进入原始数据时，新批次 `source-batch-6a8bb6b7-0d9f-4774-9daf-63ec1290c298` 仍为 running，已有 1 个 JD Source Run、1 个不可变目录 Snapshot、31 个 Work Item（目录完成＋30 商品待处理）、1 个 Request Attempt 和 60 条图片 URL，证明任务不依赖页面或 Codex 连接。本轮没有登录京东、没有下载图片、没有绕过验证或频控。

验证状态：

- 全仓 `npm test`：40 files passed、3 skipped；150 tests passed、8 skipped。默认跳过的请求级浏览器准入门另以 `RUN_BROWSER_RATE_GATE=1` 执行 6/6 通过。
- Graphile 最小原型：同 queue 在两个 worker/concurrency 2 下 `maxActive=1`；runner 停止期间入队的 job 在新 runner 启动后完成；HTTP 202 在 48ms 返回后 250ms 任务完成；领域失败只执行一次，非法 payload 零领域调用。生产 adapter 隔离命名空间的 PostgreSQL/随机端口断连集成 1/1 通过。
- 六个 workspace `npm run typecheck` 通过；`npm run build` 通过，Web 2302 modules、642.53 kB / gzip 190.58 kB，仅有既存大 chunk warning；`git diff --check` 通过。
- `npm audit --omit=dev` 仍为既有 1 moderate/4 high，报告链没有 Graphile Worker；Fastify 的完整修复要求破坏性大版本，未执行 `audit fix/force`。

本轮架构影响：改变。Source Collection Batch 仍是一次 Start 的唯一领域事实；新增 Graphile Worker 只把执行生命周期从 HTTP 页面移到服务端 PostgreSQL 持久 job，不拥有业务状态。旧 SSE/断连取消补丁已删除，没有保留第二套执行入口。未领取 job 的 runner 重启恢复已证明；正在执行一半的整批 API 强杀 exactly-once 尚未证明，继续作为后续恢复门，不能用本轮页面断连修复冒充完成。

当前修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。下一步第一条动作：保持当前真实后台批次自行运行，不用浏览器或 Codex 持续连接；负责人可随时关闭页面，之后仅通过原始数据页查看持久结果。若要宣称进程级完全恢复，再单独补执行中强杀门，不在本轮继续扩大实现。

## 26. 2026-08-24 京东专用登录会话与 1＋2 详情实验准备

简单说明：旧代码的问题不是“再等久一点”，而是浏览器登录和实际详情请求根本不共享会话。现在系统会从抓取计划页显式打开一个项目专用 Chrome；负责人自行登录并确认后，详情请求才会使用同一个会话。实验第一轮最多成功保存 1 条详情，达到上限自动停住并保留剩余队列；解析真实 HTML 后，再显式恢复 2 条。全程只保存图片 URL，不请求图片文件。

```text
Baseline Impact:
- touched modules: Source Access、JD Provider、API composition/routes、抓取计划 Web、共享会话状态 contract、运行配置、RESEARCH/ADR/ARCHITECTURE/ROADMAP/CONTEXT/PROGRESS
- owning fact source: Crawl Plan 继续拥有来源与全量分母；Source Dataset/PostgreSQL 继续拥有 Run/Work/Request/Gate/Snapshot；Source Access Session 只拥有本机瞬时会话 readiness
- public interface changed: yes；新增京东访问会话查询、打开、确认、关闭四个 typed API
- new protocol/adapter/fallback: yes；新增专用 persistent BrowserContext adapter；没有 CDP、Cookie 复制、自动 fallback、代理池、身份轮换、自动登录或验证码处理
- compatibility or legacy path changed: yes；生产 JD v2 不再使用匿名 request.newContext；历史匿名目录与骨架快照保持原样可读
- research update required: yes；R-036 记录官方 Cookie jar 语义、候选排除与本地原型
- architecture or ADR update required: yes；ARCHITECTURE、CONTEXT 与 ADR-0013 已同步会话 seam 和详情 canary
- tests and real-surface validation: loopback Chrome Cookie 对照、API/UI/Provider 红绿灯、全仓 test/typecheck/build、真实 Workbench Prepare/打开登录、后续 JD 1＋2
```

```text
Patch Disposition:
- delete: JD 生产组合根的匿名 request.newContext 入口、登录完成后仍无法进入同 Cookie jar 的错误假设
- keep: PostgreSQL 请求准入、每分钟最多 1 hop、冷却/熔断、零 retry、Crawlee 持久队列、强杀恢复、Graphile 后台派发、图片 URL-only
- rewrite: Prepare 未确认会话时返回 login_required；页面显式打开/确认专用 Chrome；Provider 使用 BrowserContext.request；每 Source Run 增加详情成功硬上限
- reason: 本地对照已证明独立 request context 只拿到骨架，而共享 BrowserContext Cookie jar 能取得完整夹具详情
```

本地证据：`jdAuthenticatedSession.integration.test.ts` 使用随机 loopback 登录页和系统 Chrome，独立 `request.newContext()` 得到骨架，对照的 `BrowserContext.request` 得到完整详情，图片路径请求 0。Provider 测试证明未确认会话时 Prepare 零请求并失败关闭；详情上限 1 时只完成 1 个 `product_details` 工作项，其余保持 pending。Fastify 四个 API 响应不包含 Cookie/Profile；计划页显示“打开京东专用登录窗口”和“我已完成登录”，不使用系统弹窗。

当前验证：全仓 `npm test` 为 41 files passed、4 skipped，154 tests passed、9 skipped；默认跳过的系统 Chrome 会话门另以 `RUN_BROWSER_RATE_GATE=1` 通过 1/1。六个 workspace `npm run typecheck` 通过；`npm run build` 通过，Web 2303 modules、644.37 kB / gzip 190.99 kB，仅有既存大 chunk warning。

真实页面状态：电视任务 confirmed Crawl Plan v1 的 Prepare 返回 `login_required`，页面显示两个 UI 登录动作和“开始其余来源”；没有创建新 Batch/Source Run。点击“打开京东专用登录窗口”后，API 在 3.8 秒内返回，页面显示“请在专用 Chrome 中完成京东登录，然后回到页面确认”。当前停在负责人手工登录门；尚未点击“我已完成登录”或 Start，京东商品请求、真实详情快照和图片 URL 仍为 0。

本轮架构影响：改变。新增最小 Source Access Session adapter 与 typed 页面动作，Crawl Plan、Source Dataset、Source Execution 和请求准入事实归属不变；详情 canary 只是临时安全门，不改变 `all_available` 计划。当前修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

## 27. 2026-08-24 京东登录详情候选被真实风控证据否决

简单说明：专用 Chrome 能共享 Cookie，并不等于京东允许该浏览器登录。负责人完成登录后，源站立即显示“当前页面异常，请刷新或切换账号”；浏览器同时显示 Playwright 默认加入的 `--no-sandbox` 启动警告。继续调延迟、刷新或切号都可能继续伤账号，所以 1＋2 实验已经停止，后两条详情没有开始。

```text
Baseline Impact:
- touched modules: 本轮只更新 R-036、ROADMAP 与 PROGRESS 的真实结论；运行中的 JD 会话已关闭
- owning fact source: Source Dataset 拥有请求/运行事实；源站可见风控页面是本次访问限制证据
- public interface changed: no（撤销登录 API/adapter 需要下一步明确确认后实施）
- new protocol/adapter/fallback: no
- compatibility or legacy path changed: no
- research update required: yes；专用登录会话候选由“待真实验收”改为“真实否决”
- architecture or ADR update required: no；当前先停止运行，尚未实施替代 adapter 或公共 contract 变更
- tests and real-surface validation: Source Run/API 账本核对、源站页面人工可见证据
```

```text
Patch Disposition:
- delete: 待确认后删除专用 Playwright Chrome 登录、确认 API/UI 和其“可用于真实详情”的本地夹具结论
- keep: PostgreSQL 频控/预算/熔断、Crawlee 持久队列、图片 URL-only、首错停止、骨架原始响应保存、续跑批次修复
- rewrite: JD 真实入口只能回到不带账号的受控候选；任何新真实 canary 仍需单独授权
- reason: 真实源站已经证明登录自动化本身会触发账号异常，本地 Cookie 夹具不能代表京东可用性
```

真实证据：首个已登录详情请求 `source-run-ad12ca38-84ee-4de5-bb29-b9563bfa2472` 只发送 1 个显式请求：`https://item.jd.com/100187642192.html` 返回 HTTP 200、35994 bytes，但仍是 `skeleton-screen`＋空 `#root`，随后立即停止且没有继续第二个 SKU。负责人随后看到专用 Chrome 的京东页面显示账号异常；系统立即关闭会话。已经受理但仍在队列锁恢复期的续跑形成 `source-run-a02a2ec1-68f3-4c76-8452-dfed7afca908`，最终 `requestAttempts=[]`、`snapshotCount=0`、`terminationReason=尚未确认完成京东登录`，证明关闭后没有新增京东请求。

本轮架构影响：澄清。专用登录会话实现仍在未提交工作区，但候选已被真实证据否决，不得发布或继续实测；下一步必须先取得“删除登录链并转入匿名受控候选”的人工确认，再同步清算代码、测试、ARCHITECTURE 与 ADR。当前仅本机，尚未形成跨电脑接续点。

## 28. 2026-08-24 市面反爬采集体系调研

简单说明：开放平台路线已按负责人要求从本轮候选中移除。公开资料证明，业内不是靠一个延迟器或换 Firefox，而是把代理/出口、会话一致性、浏览器执行、客户端信号、挑战处理、站点 adapter、失败恢复和数据质量做成持续运营系统；成功是阶段性概率和成本问题，不是永久绕过。

```text
Baseline Impact:
- touched modules: RESEARCH、PROGRESS 文档；没有修改代码、依赖、Provider 或数据库
- owning fact source: R-042 记录行业机制；ROADMAP 1D 与 Source Dataset 继续拥有完成门和真实运行事实
- public interface changed: no
- new protocol/adapter/fallback: no；市场产品和代理/指纹能力只调研，不接线
- compatibility or legacy path changed: no；被否决的 Playwright 登录 WIP 本轮未删除
- research update required: yes；记录多信号检测、会话池、托管浏览器/代理服务和当前项目边界
- architecture or ADR update required: no；模块职责、事实源和公共 contract 没有改变
- tests and real-surface validation to run: 官方资料只读核对、git diff --check；无代码测试
```

```text
Patch Disposition:
- delete: 本轮不删除文件；专用登录 API/UI/adapter 仍按第 27 节等待明确清算授权
- keep: PostgreSQL 请求预算、冷却、熔断、零 retry、首错停止、图片 URL-only 和历史运行事实
- rewrite: 本轮无实现；不把 limiter 改名或包装成反爬解决方案
- reason: 行业资料证明代理、会话和浏览器只是持续对抗体系的一部分，没有形成符合当前项目停止门的新 JD 访问方案
```

只读证据：Cloudflare 官方把 Header/Session/浏览器信号、JavaScript 检测、已知 fingerprint、机器学习、行为和 JA3/JA4 列为联合检测面；DataDome 同时使用 TLS/浏览器/Header 指纹、行为和 IP/代理信誉。采集侧 Apify/Crawlee 以 session 绑定 IP、Cookie 和健康状态，Zyte/ScrapingBee 则把浏览器渲染、Session、网络出口和更高成本访问托管成服务。它们证明代理池常见，但也证明“随机换 IP”不是完整方案。

本轮未打开或请求京东商品页、未登录、未读取 Cookie/Profile、未使用第三方解锁服务、未创建 POC。个人学习和自用不会改变技术检测；是否商业不影响本项目现有“不自动绕过访问限制”停止门。

本轮架构影响：澄清，无代码变化。当前下一步仍不是继续真实 JD canary；若要推进工程，第一条动作是明确授权删除已经被真实证据否决的 Playwright 登录链。若只继续学习，可另开本地自有靶场研究多信号 Bot Detection，不以京东账号或页面作为实验对象。当前研究记录仅在未提交、未推送的本机工作树，不构成跨电脑接续点。

## 29. 2026-08-24 京东目录发现与品牌官网补齐开发基线

简单说明：系统不再尝试从京东详情页取得完整参数，也不再把一长串批次当成用户的数据管理方式。一个任务先从京东公开目录对账品牌、分页和商品卡，再通过新的已确认计划去品牌官网补型号、参数和说明书；所有缺失、歧义和访问限制都会明确显示，不能用“抓到一些记录”冒充完整。本轮只完成开发文档，没有重构业务代码或发出真实请求。

```text
Baseline Impact:
- touched modules: Capture Task、Crawl Planning、JD Provider、Source Dataset、Source Execution、Workbench 原始数据视图及产品/开发权威文档
- owning fact source: Crawl Plan 拥有冻结来源与分母；Source Dataset 拥有原始 Snapshot；Catalog Coverage Projection 只从二者重建
- public interface changed: yes；JD 五 target 语义被目录-only 新版本替代，并规划严格 coverage/gap contract
- new protocol/adapter/fallback: yes；官网目录 Provider 仅为三站 POC 候选，无自动 fallback
- compatibility or legacy path changed: yes；历史 jd.catalog-product 计划只读且不可执行，历史数据保留
- research update required: yes；R-043 已登记 sitemap、robots、Schema.org 和官网 POC 门
- architecture or ADR update required: yes；ARCHITECTURE、CONTEXT、产品文档、ROADMAP 与 ADR 0017 已同步
- tests and real-surface validation to run: 后续 I0～I5 的 contract/parser/network/dataset/recovery/API/Web/真实 Workbench 门；本轮只做文档检查
```

```text
Patch Disposition:
- delete: 后续 I0 删除 Playwright 京东登录会话、typed API/UI、JD_DETAIL_CANARY_LIMIT、详情/店铺/评价 work chain 及其错误测试/文案
- keep: Crawl Plan 确认门、Graphile 后台执行、Batch/Run/Work/Request/Gate、Crawlee RequestQueue、不可变 Snapshot/Asset/Resource Reference、页面内 Dialog
- rewrite: JD Capture Task 默认范围、Crawl Plan contract、目录 parser/provider、Catalog Coverage Projection、任务级数据管理 UI 和相关测试
- reason: 真实账号异常已经否决登录/详情路径；匿名目录有价值，品牌官网才是型号参数与说明书的第一方来源
```

已完成文档：

- 重写 `JD-COLLECTION-ITERATION.md`，冻结完成定义、准确删除清单、最小架构、严格覆盖 contract、I0～I5 切片、测试矩阵和真实来源停止门；
- 新增 ADR 0017，接受“市场目录发现＋品牌官网补齐”、一个任务多计划版本、Coverage Projection 可重建和历史 JD v2 不执行；
- 更新 PRD、总体技术方案、MVP 计划、需求决定 D004/D010～D013、领域词汇、ARCHITECTURE、ROADMAP 和开发导航；
- 把 `JD-COLLECTION-DESIGN.md` 标为历史方案，不再驱动登录、详情和评论实现；
- R-043 记录现有 Crawlee/robots-parser/Cheerio 复用边界；官网目录 Provider 必须先通过三个代表性电视品牌 POC，当前仍是候选。

验证边界：本轮没有修改业务代码，所以不运行代码测试、构建、数据库 migration 或真实 Workbench 抓取。只运行文档矛盾检索、`git diff --check` 和变更范围检查。没有登录、访问京东或品牌官网，没有读取 Cookie/Profile，没有启动 POC。

当前架构影响：改变。京东职责由“详情/评价全链”改为“公开市场目录发现”，品牌官网负责官方型号参数与说明书；新增的 Catalog Coverage Projection 只是一份可从原始快照重建的阶段 1 控制视图，不改变 Source Dataset 的原始事实归属，也不恢复阶段 2。

下一步第一条可执行动作：实施 I0，先删除当前工作区已经被真实证据否决的登录会话、详情 canary 和详情/店铺/评论链，再用测试证明历史 JD v2 计划失败关闭。当前这些代码仍在未提交 WIP 中，尚未清理；本轮文档也未提交、未推送，只在本机，不构成跨电脑接续点。

## 30. 2026-08-24 京东公开目录与任务级覆盖视图实现

简单说明：系统已经停止登录京东和抓详情。新计划只抓 `www.jd.com` 的公开目录页，保存品牌筛选、商品卡、页面展示价格/评价数、详情 URL 和商品卡图片 URL；它不会请求详情页或图片文件。原始数据页最上方现在直接显示整个任务的目录页分母、品牌数、唯一 SKU 和缺口，下面的长批次列表只负责审计，并有独立滚动区。品牌官网型号与参数补齐仍需三站 POC，当前不会伪装成已完成。

```text
Baseline Impact:
- touched modules: Capture Task、Crawl Plan shared contract、Planning runtime/Skill、JD parser/provider、Source Dataset task view、Catalog Coverage Projection、Workbench 原始数据 UI、API/Worker/Workbench/Web tests、RESEARCH/PROGRESS
- owning fact source: Crawl Plan 拥有目录来源与停止分母；不可变 Source Snapshot 拥有原始事实；Catalog Coverage Projection 只从全部任务快照重建
- public interface changed: yes；新计划改为 jd.catalog-market@1.0.0 单 catalog_inventory target，SourceDatasetTaskView 增加严格 coverage
- new protocol/adapter/fallback: yes；新增 source-near jd_catalog_observation payload 与派生 coverage contract；没有新增依赖、自动 fallback、代理、登录或官网生产 Provider
- compatibility or legacy path changed: yes；历史 jd.catalog-product 计划可读但 Provider 不再注册，Prepare/Start 硬失败且不静默迁移
- research update required: yes；R-043 状态更新为 JD 目录实现完成、官网三站 POC 仍候选
- architecture or ADR update required: yes；沿用本轮已接受的 ARCHITECTURE/ADR-0017；未新增第二事实源或改变模块依赖方向
- tests and real-surface validation: parser/provider 网络 allowlist、历史版本拒绝、PostgreSQL 目录纵向、coverage 重建、UI 组件、全仓 test/typecheck/build、真实本地 Workbench 页面
```

```text
Patch Disposition:
- delete: 京东专用 Playwright 登录会话、会话 API/UI、JD_DETAIL_CANARY_LIMIT、详情 canary、店铺/详情/评价工作链及其旧生产提示
- keep: Graphile 后台派发、Batch/Run/Target/Work/Request/Gate、Crawlee 持久 RequestQueue、不可变 Snapshot/Asset/Resource Reference、批次恢复关联修复、页面内 ConfirmationDialog
- rewrite: Capture Task 默认京东范围、Crawl Plan schema/Skill/prompt、JD parser/provider、任务级 Source Dataset coverage 与批次列表文案/滚动
- reason: 真实账号异常已否决登录/详情路径；公开目录能提供市场发现字段，参数事实必须由后续已确认品牌官网计划补齐
```

实现结果：

- `jd.catalog-market@1.0.0` 只接受一个 `catalog_inventory` target、匿名 `www.jd.com` HTTPS 入口和 `html+source_json`。Prepare 固定零请求；网络 allowlist 只有 `https://www.jd.com`，目录中观察到的 `item.jd.com` 与图片 URL 只保存为字段/Resource Reference，不能成为请求。
- 每个目录响应先保存原始 HTML Snapshot，再保存严格 `jd_catalog_observation` JSON Snapshot；品牌筛选和下一页链接只有在同为 `www.jd.com` 时进入 Crawlee RequestQueue。登录、验证码、403/429、频控正文或跨源跳转继续首错停止、零重试。
- 默认 Capture Task 京东范围改为分类/筛选、目录商品卡、展示价格、展示评价数和目录图片 URL。旧 scope 枚举仅为历史任务读取保留，不进入新默认策略。
- Source Dataset 任务视图从当前 Provider 的所有不可变观察重建 Coverage：页分母、品牌、商品卡、唯一 SKU/SPU，以及目录分母、品牌官网来源和型号匹配三类 open gap。损坏观察、旧 Provider 和非观察 Snapshot 不计入覆盖。
- 原始数据页面优先展示任务级覆盖与缺口；批次列表显示来源 key 和 Provider version，并在桌面端使用 sticky＋独立纵向滚动。失败/停止的当前目录运行仍可通过原有显式继续入口定向恢复；历史 JD v2 不显示继续入口。
- Workbench 实际注入的 `plan-product-crawl` Skill 和 runtime prompt 已同步新契约，下一次重新规划不会再生成五类详情计划。

验证状态：

- `npm run typecheck` 六个 workspace 全部通过。
- 全仓 `npm test`：41 files passed、3 skipped；155 tests passed、8 skipped。PostgreSQL JD 纵向 fixture 证明两页目录只产生 2 个 HTTP Request Attempt、4 个 Snapshot、3 个唯一 SKU、8 条图片 URL，`item.jd.com` 和图片服务器请求均为 0。
- `npm run build` 全部 workspace 通过；Web 2303 modules、646.89 kB / gzip 191.67 kB，仅有既存大 chunk warning。`git diff --check` 通过。
- 真实本地 Workbench 原始数据页已显示“任务覆盖与缺口”和历史批次；当前正式库没有新 Provider Snapshot，因此如实显示“尚未开始 / 0 / 分母未知 / 1 个缺口”。批次侧栏计算样式为 `position: sticky`、`overflow-y: auto`、`max-height: 688px`，页面无系统 JS dialog、console error 或 warning。
- 真实旧 confirmed 计划仍显示 5 个历史 JD target，但页面明确阻止开始并提示必须重新规划为 `jd.catalog-market@1.0.0`；本轮没有点击重新规划、Prepare 或 Start，没有访问京东/品牌官网，也没有读取 Cookie/Profile。

本轮架构影响：改变。JD Provider 职责由详情/评价全链收窄为公开市场目录；新增 Coverage Projection 是 Source Dataset 的可重建读模型，不拥有原始事实。品牌官网目录 Provider 仍未通过 R-043 三站 POC，未实现、未注册。当前修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

## 31. 2026-08-24 真实 Workbench 全流程否决当前“正式品类抓取”结论

简单说明：本轮在真实浏览器中重新生成计划、确认计划并点击“开始新批次抓取”，等到后台批次结束后逐项查看了原始数据。结果不合格：京东只抓了一个电视目录页，得到 30 个商品卡，但一个品牌筛选都没识别出来，也不知道总共有多少页；系统却把这条来源写成“计划范围完成”。品牌官网也不是按京东发现的品牌动态补齐，而是仍只执行旧任务里固定的几个链接。因此当前项目只能证明“跑通了一次部分抓取”，不能证明“正式抓取一个品类尽可能全”。

```text
Baseline Impact:
- touched modules: 本轮只运行真实 Workbench/Provider 并更新 PROGRESS；没有修改业务代码或公共 contract
- owning fact source: Source Collection Batch/Source Dataset 拥有本次运行事实；PROGRESS 记录验收结论
- public interface changed: no
- new protocol/adapter/fallback: no
- compatibility or legacy path changed: no
- research update required: no；本轮得到的是当前实现的真实运行证据，不是新技术选型
- architecture or ADR update required: no；当前证据否决完成声明，但尚未批准新的模块职责或 contract
- tests and real-surface validation: 最新代码重启 API/Web 后，浏览器完成重新规划 v3、确认、Start、后台轮询、批次终态与 JD 原始 Snapshot/coverage 对账
```

```text
Patch Disposition:
- delete: 下一轮删除“单个种子页队列耗尽即 plan_scope_completed”的错误完成映射及保护该行为的测试
- keep: jd.catalog-market 匿名 www.jd.com allowlist、不可变 HTML/JSON Snapshot、图片 URL-only、Request Attempt、任务级 Coverage Projection 和 partial 缺口展示
- rewrite: 京东品牌/分页解析与可信分母规则；JD Source Run 完成门；市场发现结果生成后续品牌官网补齐计划的流程
- reason: 真实页面证明当前 DOM 选择器没有识别品牌和下一页，现有 10 个固定来源也不能表达“先发现全部品牌、再逐品牌补官网”的目标；不能继续在错误完成语义上叠补丁
```

真实批次证据：

- 任务：`capture-task-2e069323-caf9-4862-abdf-08fb4448897b`；最新计划 v3；批次：`source-batch-a420b965-fe7d-4777-9c35-9703ab76bb41`。
- 批次终态：`partial`，10 个来源中 7 个 completed、3 个 failed，共 8 个不可变 Snapshot。失败项为 TCL 中国电视目录超时、海信中国电视目录超时、TCL 官方店 robots.txt 返回 HTTP 302。
- 京东运行：`source-run-18c3663d-afd9-4fc5-9859-a1b74a002531`；Provider `jd.catalog-market@1.0.0`；只发送 1 个真实 HTTP 请求到 `https://www.jd.com/chanpin/450049.html`，HTTP 200，保存原始 HTML 与 `jd_catalog_observation` 两个 Snapshot，图片服务器请求为 0。
- 京东观察：页面声明结果数 32，但当前实现只保存 30 个唯一 SKU、60 条图片 URL、0 个品牌、0 个展示价格、30 个展示评价数、0 个下一目录 URL。页面声明 32 不能当作可信全品类分母；当前 Coverage 因而是 1 个目录页、分母未知、0 品牌、30 SKU、31 个 open gap。
- 错误完成语义：上述运行仍被记录为 `completed · plan_scope_completed`。真实证据只支持“当前单页请求完成”，不支持“计划范围完成”，更不支持“电视品类尽可能全”。
- 计划缺口：v3 仍只有 Capture Task 既有的 10 个固定来源。它没有先以京东发现品牌/型号，再生成覆盖全部已发现品牌的官网目录计划，因此即使 10 个来源全部成功也不能闭合用户要求的品类覆盖。
- 环境缺陷：首次浏览器重新规划时，前端已热更新但 API 仍运行旧代码，生成了旧 `jd.catalog-product@2.0.0` v2 计划。停止项目端口并用当前工作树完整重启后才生成正确的 `jd.catalog-market@1.0.0` v3；此前基于混合新前端/旧后端的页面验收作废。

本轮架构影响：澄清。没有修改模块职责、事实源、依赖方向或公共 contract；真实运行否决了第 30 节“目录切片通过即可继续”的隐含完成判断。当前代码和文档仍在未提交工作树，本地 `master` 相对 `origin/master` ahead 1，尚未推送，不构成跨电脑接续点。

下一步第一条可执行动作：先针对真实 JD HTML 建立品牌、分页和“分母未知不得完成”的失败用例，并清算错误 completion patch；若必须把市场发现结果自动转换成下一版品牌官网 Crawl Plan，则该动作会改变计划生成流程和跨模块 contract，实施前必须先确认新的事实归属与人工确认门，不能由 Source Run 自行扩抓。

## 32. 2026-08-24 AI 深度来源规划 version 3 与真实 Workbench 验收

简单说明：系统已经停止把 JD 当作电视品类分母。用户点击“重新规划”后，AI 会先深搜品牌版图，再逐品牌找官网，并同时调查参数/说明书、标准/监管和技术原理；搜索证据、品牌对账、未解决项和停止口径都显示在计划页。真实电视任务已生成 v4 草稿：111 个搜索 URL、8 个品牌、7 个官网映射，海尔因为没有找到可靠中国电视目录而保持未解决；没有 JD 来源，也没有开始抓取。

```text
Baseline Impact:
- touched modules: Crawl Plan shared contract、Planning Skill/runtime/module、Research Audit UI、生产 Provider composition、Source Dataset 批次 UI、产品/架构/调研/进度文档及相关测试
- owning fact source: Capture Task 继续拥有确认范围；versioned Crawl Plan Research Audit 拥有规划证据与品牌/topic 对账；Source Dataset 只拥有确认后真实执行得到的原始事实
- public interface changed: yes；当前可执行计划升级为 executionChecklistVersion 3，并增加严格 Research Audit contract
- new protocol/adapter/fallback: no；复用现有 Codex App Server web search、outputSchema、Zod、PostgreSQL 与 public.web-resource Provider，不增加搜索 API、多 Agent、自动 fallback 或队列
- compatibility or legacy path changed: yes；历史 version 2/JD 计划只读但不可启动，生产组合根和环境配置不再提供 JD 启用入口
- research update required: yes；R-044 接受 AI 深搜 Research Audit，R-043 标为历史候选
- architecture or ADR update required: yes；ADR 0018、ARCHITECTURE、ROADMAP、CONTEXT 和产品文档已同步事实归属与生产边界
- tests and real-surface validation: shared/workbench/runtime/Web contract 测试、全仓 typecheck/test/build、当前代码完整重启后的真实 Workbench 重新规划与 API 持久结果核对
```

```text
Patch Disposition:
- delete: 未提交的 JD Catalog Coverage Projection/schema/UI/tests、生产 `jd.catalog-market` 注册、JD HTTP 环境开关和 JD 生产纵切片测试
- keep: Crawl Plan 人工确认门、App Server 可见搜索时间线、公共资源 Provider、Graphile 后台执行、不可变 Snapshot/Asset/Resource Reference、批次独立滚动和来源名称展示；JD 历史快照与 dormant adapter fixture 只供历史审计
- rewrite: Planning Skill/prompt/schema/确定性完整性门和计划页，改为四类 Research Area、逐品牌官网或 unresolved 对账、逐 topic source/target 对账，并硬拒绝 JD URL/Provider
- reason: 真实 JD 批次只有 0 品牌和未知分母，VPN/无痕搜索又分别进入错误页和登录页；继续用 JD 会让形式完成掩盖无法验证的品类覆盖
```

实现结果：

- 采访阶段不再强制零售平台、两个品牌官网、标准和技术入口，也不再默认纳入 JD；它只确认品类/市场/内容边界并用 `scopeEvidenceUrls` 证明范围调查。完整品牌与来源深搜唯一归 Planning Agent。
- `executionChecklistVersion: 3` 必须带 `brand_landscape`、`official_source_mapping`、`parameters_and_manuals`、`standards_and_principles` 四类 Research Audit；品牌不少于 2 个，每个品牌只能是映射到实际 `brand_official` source 的 `planned`，或没有 source key 的 `unresolved`。
- Workbench 确定性门要求至少两个独立非 JD 品牌发现 origin、全部四类 topic 来源、全部 Capture Task topic 的实际 target 映射，并拒绝 `jd.catalog-market`、`*.jd.com`、占位 Provider 和旧 checklist。
- Planning Agent 可以补充采访中没有的新官网来源，但不能修改 task topic、确认计划或启动抓取。Source Run 不能在执行中调用搜索扩大来源。
- 生产组合根当前只注入 `public.web-resource@1.0.0`；删除 `JD_REAL_HTTP_ENABLED`。保留的 JD parser/provider 不可通过生产 API 到达，只用于历史 fixture 审计。
- 计划页新增“AI 深度来源调查”卡，显示市场口径、完整度、发现/已规划/未解决品牌数、四类搜索证据、逐品牌对账和停止口径。原始数据页删除了已被推翻的 JD 目录页/SKU 覆盖卡；批次 sticky 独立滚动和来源 key/provider 展示继续保留。

真实 Workbench 证据：

- 任务 `capture-task-2e069323-caf9-4862-abdf-08fb4448897b` 在完整重启 API/Web 后生成 Crawl Plan v4 draft，`executionChecklistVersion=3`，15 个 public 来源、15 个 target；Planning Run 状态 `completed`，时间线记录 111 个去重搜索 URL。
- Research Audit 四类 area 全部存在，10 个 task topic 已对账；品牌分母为海信、TCL、小米、创维、长虹、康佳、华为、海尔共 8 个。前 7 个已映射官网，海尔明确 `unresolved`，所以完整度如实为 `partial`。
- API 持久结果检查：JD source/provider/URL 数量为 0。页面明确排除“京东及任何 jd.com 来源”和误检的冰箱标准 GB 12021.2-2025。
- 本轮没有点击“确认此计划”，没有 Prepare/Start，没有创建新 Batch/Source Run，也没有抓取任何品牌官网页面；计划仍是 `draft`，等待负责人审查。

验证状态：`npm run typecheck` 六个 workspace 全部通过；全仓 `npm test` 为 39 files passed、3 skipped，143 tests passed、8 skipped；`npm run build` 全部 workspace 通过，Web 2303 modules，644.42 kB / gzip 191.17 kB，仅有既存大 chunk warning；`git diff --check` 通过。真实 Planning Run 在十分钟门内完成并持久化，不是 fixture 或静态页面假数据。完整重启 API/Web 后，v4 Research Audit 与 111 个搜索 URL 仍从 PostgreSQL 恢复。

本轮架构影响：改变。品牌覆盖的规划分母从不可用 JD 目录迁移到 versioned Research Audit；原始数据事实仍只属于 Source Dataset，没有恢复阶段 2，也没有让模型自动确认或执行。当前全部修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

当时的下一步判断（已由第 33 节真实 v8-v10 证据否决）：负责人审查并决定是否确认 v4。v4 现仅作历史证据，不得确认；当前动作以第 33 节的分阶段候选调研门为准。

## 33. 2026-08-24 真实 v8-v10 否决单轮巨型规划输出

简单说明：这次确实从系统页面运行了两轮，不是只跑测试。AI 分别搜索了 123 和 102 个网页，但都没有生成可用新计划；它在修复一个官网 source key 时又制造了另一个不存在的 key。系统已正确失败关闭，没有把错误计划保存成 v9/v10，也没有开始抓取。当前不能拿 v8 交付，下一步必须把深搜拆成小阶段，再由程序确定性组装。

```text
Baseline Impact:
- touched modules: Crawl Plan v3 shared schema、Planning runtime/Skill 硬门、Workbench Research Audit 确认/启动门、R-045/ADR/ROADMAP/PROGRESS
- owning fact source: Capture Task 仍拥有确认范围；最终 versioned Crawl Plan 拥有来源规划事实；失败 Planning Run 只保留搜索/校验时间线，不成为可执行来源事实
- public interface changed: no；最终 executionChecklistVersion 3 contract 未增加字段，本轮只收紧既有品牌与官网 source 的双向引用不变量
- new protocol/adapter/fallback: no；分阶段同线程仅登记为 R-045 候选，尚未实现
- compatibility or legacy path changed: yes；v8 虽为 draft，但按当前双向门不可确认或启动；v9/v10 failed 且没有 Plan
- research update required: yes；R-045 记录单轮否决证据与分阶段候选
- architecture or ADR update required: clarification；ADR 0018 的策略保留，明确单轮巨型输出实现被阻塞；尚未冻结新内部工作流
- tests and real-surface validation: shared/workbench/runtime 定向测试、全仓 typecheck/test/build、真实 Workbench v9/v10 按钮运行与 PostgreSQL/API 持久结果核对
```

```text
Patch Disposition:
- delete: 把 v4 或 v8 描述为已通过正式规划验收的完成结论；继续靠 Prompt 和重复运行碰运气
- keep: JD 正式排除、七类品牌发现、逐品牌/topic Audit、历史来源不可静默回退、一次有界回填、人工确认/Start 门、公共 Provider 与不可变 Source Dataset
- rewrite: shared candidate 和 Workbench 执行门同时检查双向引用；官网 source 必须归属 planned 品牌，planned 品牌引用的 key 必须存在且为 brand_official
- reason: v8 出现“索尼 unresolved 但仍执行索尼来源”；v9/v10 出现品牌引用不存在 source，证明旧单向门不保护真实执行清单
```

真实 Workbench 证据：

- v8 `crawl-plan-41bc59e5-6a16-4b26-baca-d6a184f15b93` 搜索 72 个 URL，18 个品牌、19 个来源；13 planned/5 unresolved，但索尼被标 unresolved 的同时仍保留 `sony-china-tv-catalog`，所以当前门判定不可执行。
- v9 run `crawl-planning-run-5af454e7-eab6-4c66-8b11-83176556ed76` 搜索 123 个 URL，运行 5 分 35 秒，最终 failed：`tcl-official-store-tv` 不存在或非官网；没有 v9 Plan。
- v10 run `crawl-planning-run-9063437e-c109-4bcd-a488-cabbf46ed948` 搜索 102 个 URL，运行 5 分 10 秒；首轮错误是缺 `tcl-official-store-tv`，有界修复又产生 `tcl-tv-manual-guide`，最终 failed；没有 v10 Plan。
- 页面恢复到“重新规划并生成新版本”，明确显示“本次重新规划失败”；本轮没有点击确认、Prepare 或 Start，没有新 Batch/Source Run，也没有访问任何品牌官网候选页。

实现和测试：新增双向 Research Audit/source 校验，并同步到 `plan-product-crawl` Skill 和提示；29 个定向 shared/workbench/runtime 测试通过。全仓 `npm run typecheck` 六个 workspace 通过；`npm test -- --reporter=basic` 为 40 files passed、3 skipped，147 tests passed、8 skipped；`npm run build` 全部通过，Web 2304 modules、648.69 kB / gzip 192.74 kB，仅有既存大 chunk warning；`git diff --check` 通过。当前开发服务仍在本机 `127.0.0.1:4000/6173` 运行。

本轮架构影响：澄清。AI 深搜、JD 排除和最终 v3 Plan 事实归属不变；真实运行否决“单轮巨型结构化输出已经可交付”。R-045 的分阶段同线程编排尚未实现、未形成新公共 contract。全部修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

下一步第一条可执行动作：按 R-045 先做分阶段同线程最小原型（品牌分母 → 小批官网/参数映射 → 确定性组装现有 v3 Plan），通过十分钟与真实电视页面门后，才允许负责人确认新计划并进入品牌官网抓取。

## 34. 2026-08-25 分阶段 AI 深搜完成真实电视计划验收

简单说明：系统现在不是一次让 AI 猜完整品牌和全部来源。它先从六个角度找品牌，再一次做一个补漏查询；连续两次没有新品牌才冻结清单。随后按可配置批次逐品牌找官网、参数和说明书，最后补标准和技术原理。真实页面流程用每批 10 个品牌完整跑完，生成了可审查的 v9：25 个品牌中 20 个找到官网，5 个明确保留为未解决；没有京东来源，也没有开始抓取。负责人现在只需要审查是否确认 v9；确认后仍需先做三个不同官网的目录遍历 POC，不能把“计划完成”说成“数据已经抓全”。

```text
Baseline Impact:
- touched modules: Crawl Planning App Server client/runtime、品牌发现与饱和投影、阶段 prompt/schema、配置、聚焦/集成测试、Planning Skill，以及 R-045/ADR/ARCHITECTURE/ROADMAP/CONTEXT/PROGRESS
- owning fact source: Capture Task 继续拥有用户确认范围；最终 versioned Crawl Plan v3 拥有来源规划与 Research Audit；Planning Run 只保存可见过程；Source Dataset 仍只拥有确认后真实执行数据
- public interface changed: no；最终 executionChecklistVersion 3、API、数据库和 Source Dataset contract 不变
- new protocol/adapter/fallback: no；复用一条已初始化 App Server stdio 连接、独立 ephemeral thread、per-turn outputSchema、Zod 和现有 typed SSE；没有队列、多 Agent、外部搜索 API 或第二事实源
- compatibility or legacy path changed: yes；历史 Plan URL 只作复核线索，不再无条件复制；旧 JD Provider/parser/测试从生产代码删除，历史运行和快照只读保留
- research update required: yes；R-038 更新为最多两个同阶段 repair turn，R-045 记录确定性饱和循环、失败清算和真实 v9 证据
- architecture or ADR update required: yes；内部规划工作流从单次品牌分母改为六镜头发现加逐查询饱和核查，公共模块 ownership 与 contract 不变
- tests and real-surface validation: 15 个 staged runtime 测试、15 个 Planning 集成测试、全仓 typecheck/test/build、真实 Chrome 页面完整重新规划、API/Source Dataset 持久结果审计
```

```text
Patch Disposition:
- delete: 单轮巨型 Plan 输出、模型生成交叉引用 key、模型自报 newlyAddedBrands、历史来源无条件继承、旧 JD Catalog Provider/parser 及测试、保护旧继承行为的过时集成测试断言
- keep: JD 排除、六类品牌发现镜头、逐品牌/逐 topic Research Audit、当前 task revision 非 JD 候选连续覆盖、人工确认/Start 门、public.web-resource、不可变 Source Dataset 与历史计划/运行只读记录
- rewrite: 品牌发现拆为六镜头 schema 与单查询 saturation schema；Workbench 按规范名称/别名计算新增和连续零新增；品牌官网按 1-10 批次独立核对；共享精确 URL 只建一个 target；同阶段最多两次原错误有界修正
- reason: 真实失败依次证明巨型交叉引用、模型自报收敛、别名/相邻品类污染、候选末端校验和一次 repair 都不能稳定闭环；放宽质量门会保存歧义或不完整计划
```

实现与清理：

- `CRAWL_PLANNING_BRAND_BATCH_SIZE` 为整数 1-10、默认 3；本轮真实验收显式用 10，证明批次参数不是固定样例。每批一个独立 thread；改成 1 只改变批次数和总时长，不改变最终 contract 或质量门。
- 六镜头发现后，Workbench 最多发起 6 个相互独立的 saturation query；规范名称和 aliases 共用身份集合，产品线、相邻品类、排除形态和身份不明确线索不计新增。只有两个不同查询连续零新增才停止。
- 官网批次和标准阶段在保存前就检查所属当前候选；planned/unresolved 使用判别联合，来源 URL 双向归属、target 唯一性、topic 和非 JD 候选都在所属小阶段修正，避免整轮末尾才报错。
- App Server client 支持每次传入 threadId/outputSchema；同阶段最多两个 repair turn，始终复用现有解析/校验错误和同一 schema，没有新增验证规则或网络重试。
- 旧 JD provider/parser 与对应测试已删除，worker 组合根不再导出；旧巨型 prompt/runtime 和历史来源强制继承也已删除。测试 fixture 从 581 行文件拆到独立 tests support，两个文件分别 323/256 行；没有把产品代码拆成空 manager/service 层。

真实 Workbench 与持久化证据：

- 从 `http://127.0.0.1:6173/` 真实 Chrome 依次点击“电视抓取任务 → 抓取计划 → 重新规划并生成新版本”。运行 `crawl-planning-run-968eb7d4-e3bf-4800-bd94-10836cc260f4` 状态 completed，用时 18 分 24 秒；六镜头阶段页面记录搜索 412 个网页，之后 3 个独立饱和查询以最后两个不同查询零新增停止。
- 实际保存 v9 draft `crawl-plan-b049a5fb-3ed6-4384-9016-d9adfddcd96a`：25 品牌、20 planned、5 unresolved、24 个 `public.web-resource` 来源、42 个互不重复的精确 target，四类 Research Audit 与 10 个 task topic 全部存在。
- Capture Task 当前 revision 的 9 个非 JD candidate URL 和 ID 各恰好进入一个 source/target；JD URL/Provider 为 0；全部 brand_official source 都归属 planned 品牌，planned 品牌引用也都存在，没有悬空或孤儿来源。
- 页面停在“确认此计划”，未点击确认、Prepare 或 Start。Source Dataset API 为 4 个历史 batch、43 个历史 source run，plan version 9 的 batch/source run 均为 0；本轮没有访问或抓取任何计划 target。

验证：`npm run typecheck` 六个 workspace 通过；聚焦 staged runtime 15/15、Planning 集成 15/15；全仓 `npm test -- --reporter=basic` 为 38 files passed、3 skipped，151 tests passed、8 skipped；`npm run build` 六个 workspace 通过，Web 2304 modules、648.84 kB / gzip 192.83 kB，仅有既存大 chunk warning。`git diff --check` 在最终文档更新后再次核对。

本轮架构影响：改变（内部规划工作流）。Crawl Planning 的 owning fact source、公开 v3 contract 和 Web → API → Workbench → DB 依赖方向不变；内部从“单个巨型研究输出”改为独立阶段加 Workbench 确定性组装。没有新增外部服务、数据库工作流、Provider 或执行 fallback。全部修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

下一步：负责人在系统里审查 v9 的 25 个品牌、5 个 unresolved 和 42 个 target；若确认，再从 planned 品牌中选择三个结构不同的官网进入 ROADMAP 1E 真实目录 POC。未确认前不开始抓取。

## 35. 2026-08-25 原始数据页历史状态永久轮询修复

简单说明：原始数据页此前只要在任何历史记录里看到 `running`，就每 2 秒请求一次接口。8 月 21 日有一条进程中断后未收口的旧运行，因此用户没有操作时请求也永远不停。现在页面只把最新批次当作当前执行候选，并且只刷新该批次内仍在运行的详情；历史异常记录继续保留审计，但不再冒充当前活跃任务。

```text
Baseline Impact:
- touched modules: Web Source Dataset 轮询判定与聚焦测试、PROGRESS
- owning fact source: Source Dataset 的版本化 Batch/Run 状态；Web 只读取和投影
- public interface changed: no
- new protocol/adapter/fallback: no
- compatibility or legacy path changed: yes；历史无批次或旧批次 running 不再触发活跃轮询
- research update required: no；恢复 ADR 0013 已定义的“仅运行中批次轮询”语义
- architecture or ADR update required: no；模块职责、事实源和依赖方向不变
- tests and real-surface validation: Web 聚焦回归、typecheck、build、真实页面 CDP 网络计数
```

```text
Patch Disposition:
- delete: 扫描全部历史 Batch/Run，只要任意 running 就永久轮询的判断
- keep: 最新批次真实运行时每 2 秒刷新列表和所属运行详情；离开原始数据页即卸载查询
- rewrite: 列表只依据最新批次，详情还必须同时属于该最新运行批次
- reason: 2026-08-21 的失联运行仍为 running，旧判断使 2026-08-25 的空闲页面持续请求
```

失败复现与修复证据：修复前真实页面停在“原始数据”6.5 秒，捕获 4 次同一 `/source-runs` GET；切回“抓取范围”为 0。回归测试先得到 2 个预期失败：最新终态批次被历史 running 触发为 true，且缺少详情归属判断。修复后 5/5 聚焦测试通过；真实页面重新进入“原始数据”并静置 6.5 秒，`/source-runs` 请求为 0。

验证：Node 24.12.0；`npm test -- apps/web/tests/sourceDatasetPanel.test.tsx` 5/5；`npm run typecheck:web` 通过；`npm run build:web` 通过，2304 modules，648.94 kB / gzip 192.87 kB，仅有既存大 chunk warning。

本轮架构影响：无变化。没有修改历史 Batch/Run 原始审计记录，没有增加定时器、状态源、恢复协议或后台服务；正在执行一半时进程强杀后的领域状态自动收口仍是 ADR 0013 已记录的独立恢复门。本轮修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

## 36. 2026-08-25 电视 v9 真实抓取链路稳定跑通

简单说明：本轮不再把“v9 是否一次抓全”当作开工门。用户要求先把整条链路稳定跑通，完整度以后持续增量。因此系统在真实 Workbench 确认并执行当前 v9，三个批次都到达终态，第三轮有 13/24 个来源完成、11 个按源站实际状态失败。现在能从页面发起，经后台队列、运行记账、不可变快照、页面查看和 JSONL/CSV 导出，再经服务重启仍保留。这叫“链路稳定”，不叫“来源已全”；下一步按 11 个真实失败继续增量。

```text
Baseline Impact:
- touched modules: Source Execution/Source Dataset 失联恢复、Graphile 组合根、Source Request Admission gate 升级、public.web-resource 内联原文解码、相关集成/回归测试、RESEARCH/ADR/ARCHITECTURE/ROADMAP/PROGRESS
- owning fact source: Crawl Plan 继续拥有来源、内容和数量；PostgreSQL Source Dataset 继续拥有 Batch/Run/Request/Gate/Snapshot 执行事实
- public interface changed: no；没有改 Capture Task/Crawl Plan/Source Dataset 公开 contract
- new protocol/adapter/fallback: yes；新增内部 Batch advisory lease 和启动收口，HTML 边界复用 WHATWG encoding-sniffer；没有第二队列、网络自动重试或站点特别放行
- compatibility or legacy path changed: yes；旧的 closed/空闲 gate 可安全升级到更严格政策，历史快照和请求记录不清理
- research update required: yes；R-046 从候选改为接受，R-047 记录 gate 升级与 WHATWG 编码依据
- architecture or ADR update required: yes；失联恢复、gate 升级和 inline_text 原文语义成为当前架构基线
- tests and real-surface validation: 失联/gate/编码红绿测试、全仓 test/typecheck/build、三轮真实 v9 Batch、Workbench 原始数据页、JSONL/CSV 导出和 API/Web 重启
```

```text
Patch Disposition:
- delete: 删除“页面不再轮询就等于执行进程已恢复”的错误假设；未删除任何历史数据
- keep: Graphile 持久派发、Source Run 显式继续、Request/Gate 审计、不可变 Snapshot、失败关闭和原始数据导出
- rewrite: 进程失联后的领域状态收口；旧 gate 政策安全升级；HTML 非 UTF-8/误报 charset 解码
- reason: 真实旧孤儿、三轮 v9 和 Sony 页面分别证明 UI 轮询、队列默认锁与强制 UTF-8 都不能单独保护领域终态和原文不可变性
```

根因与实现：

- Graphile Worker 普通版在 `SIGKILL`/掉电后不能立即恢复在途 job，且项目明确使用 `maxAttempts=1` 避免自动重发来源请求。新实现让 Batch 在整个执行期间持有 PostgreSQL session advisory lease；API 启动时在 Graphile runner 之前只收口已不存在活动 lease 的 `running` Batch，复用已有 Resume 收口语义，不发网络请求、不自动恢复、不读 Graphile 私有表。
- 历史孤儿 `source-batch-6a8bb6b7-0d9f-4774-9daf-63ec1290c298` / `source-run-b2d16955-b1f0-4d09-bda7-42155c34919f` 在首次真实恢复调用中如实收口；它本来就没有 Snapshot，没有因测试删数据。集成测试证明活动 Batch lease 下零副作用，lease 释放后只收口未终结状态且保留快照。
- 原有 gate 对 policy version 只做绝对相等比较，导致安全低频新政策无法复用旧 origin 记录。现在只升级 closed、无人工继续要求、当前零 `started` attempt 的 gate，并继承更严格的 `nextEligibleAt`；真实 Hisense/TCL/Samsung 在不清表的前提下通过。
- `public.web-resource` 原先把原字节强制解码为 UTF-8，再将已替换文本的长度/哈希与原响应字节对账，Sony GB2312 页面因此失败。现在复用 `encoding-sniffer@1.0.2` 和 Node `TextDecoder`：HTML/XHTML 遵守 WHATWG 规则；HTTP charset 不能无损解码时才有界选择更完整的页内 meta 结果；合法 `U+FFFD` 不会误回退。

三轮真实 v9 执行：

- 第一轮 command `source-command-905c0f0a-1d69-4899-bc06-dd2cd9c6161d`，Batch `source-batch-60aeda17-4ca7-4376-b26e-ba139f16fc9d`：6/24 完成、18 失败，15 个 Snapshot（12 accessible）。这轮如实暴露 gate policy 冲突和 Sony 字节/哈希不一致，没有把失败隐藏成完成。
- 第二轮 command `source-command-481e7a0d-e1b1-4fc0-bf46-6d1df9c50244`，Batch `source-batch-1b5a2caa-5a41-4cfb-ad04-931c7ad7222d`：11/24 完成、13 失败，19 个 Snapshot（18 accessible）；gate/哈希内部错误归零，但真实 Sony 快照的错误 HTTP UTF-8 头仍产生替换字符，因此继续修正而不收口。
- 第三轮 command `source-command-15750b35-70f2-49af-9810-077d88300a68`，Batch `source-batch-a6f49bf5-6c14-4941-aaf2-b4cf9598c076`：`partial`，13/24 完成、11 失败，21 个 Snapshot（20 accessible、1 source_error），44 个 completed request attempt、4 个 failed attempt，无 `running`。失败是 access denied、证书域名不匹配、robots 301/302/504、source_error、5 MB 上限和超时；“gate 身份/策略冲突”和“字节数或内容哈希不一致”均为 0。

原文、页面、导出与重启验证：

- Sony run `source-run-938de170-1fb3-4171-a68e-87ae9d3757d1` 完成，追加 Snapshot `source-snapshot-c3827c6f-1aae-43be-9e0b-934e7c97b4c2`：`charset=GBK`、`bytes=396`、payload hash `448780c4dee5e29853cc341a55dba569e74fda44d00e549ebe830ebee1b51a0c`，正文无替换字符且标题为“无标题文档”。旧有损快照继续保留。
- 真实 Workbench “原始数据”页显示第三批 24 个 Source Run、21 条记录、每个失败原因和 Sony completed run；不从 UI 文案反推领域状态。
- Sony JSONL 导出 HTTP 200，1 行/1682 bytes，SHA-256 `8bd4e5f9a0b15a55e055c1018d72f43fb098b58f5c1b913a61790e6dc345e8d5`；CSV HTTP 200，13 行/988 bytes，SHA-256 `bf3d353a24d2aef8a6c1df3b5e298e1d8ed164d3e7be7eaf6b89e3c3698b52a4`。
- 最终停止 API/Web 并重新启动。启动恢复后全库 `running` Batch/Run 均为 0；第三批仍为 `partial 13/24`，Sony Snapshot charset/bytes/hash/正文不变，Workbench 刷新后仍显示最终批次与 Sony run。

工程验证：Node 24.12.0；聚焦编码回归 11/11；全仓 `npm test -- --reporter=basic` 为 38 files passed、3 skipped，158 tests passed、8 skipped。末次清理曾误删 `snapshotCommon` 仍需要的 `mediaType` 参数，聚焦测试以 6 个 `mediaType is not defined` 失败与 TypeScript 错误拦住；该清理补丁已完全撤销，之后 11/11 和 worker typecheck 重新通过，没有改测试或叠加 fallback。`npm audit --omit=dev` 仍为既存 1 moderate/4 high（ajv、brace-expansion、fast-uri、Fastify/find-my-way 链），本轮不做未经评估的 force fix。六个 workspace 的 `npm run typecheck`、`npm run build` 与 `git diff --check` 均通过；Web 只保留既存大 chunk warning。

本轮架构影响：改变。Source Dataset/Execution 新增 Batch lease 与启动收口，Source Access 明确安全策略升级，`inline_text` 明确 WHATWG 编码和哈希语义；事实源、公开 contract 和依赖方向不变。ARCHITECTURE、R-046/R-047、ADR 0013 和 ROADMAP 已同步。

下一步第一条可执行动作：将第三批 11 个真实失败按“不得绕过的访问限制”和“需调研/原型的来源适配缺口”分类，选三个结构不同的官网进入 ROADMAP 1E 目录 POC，新观察用新 Plan/Snapshot 追加，不覆盖 v9 与本轮原始数据。阶段 2 仍未获授权。当前所有修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

## 37. 2026-08-26 Crawlee 精确资源链路接入与第四批真实内容审计

简单说明：手写 HTTPS 抓取已经由 Crawlee 3.18.1 的稳定 HTTP 组件替换。第四批真实执行从上一轮 13/24 提升为 14/24，并保存了 29 条原始数据；海信原来的超时已修复，TCL 虽因旧计划预算最终标记失败，但 6 个目标已经抓到 5 个，包括电视目录、产品页和 4 MB 说明书。系统没有再把“网页返回 200”当成内容合格：酷开和 Sony 原文已明确判为不满足电视目录目标。当前确认的 v9 不会被后台静默改写；新计划会使用已验证的 25 MB、redirect 预算和更长运行窗口。

```text
Baseline Impact:
- touched modules: public.web-resource 精确传输、redirect 请求审计、未来 Planning 默认访问政策、worker/workbench 测试、RESEARCH/PROGRESS
- owning fact source: confirmed Crawl Plan 继续拥有来源、目标、数量和停止政策；PostgreSQL Source Dataset 继续拥有 Request/Run/Snapshot/Asset 原始执行事实
- public interface changed: no；Provider key/version、Crawl Plan v3 和 Source Dataset contract 不变
- new protocol/adapter/fallback: yes；使用 Crawlee HttpCrawler 作为现有 Provider 内部 HTTP/文件 adapter；没有自动 retry、浏览器 fallback、代理轮换或第二队列
- compatibility or legacy path changed: yes；已确认 v9 保持 5 MB/旧预算不变，只有后续 Planning 草案采用 25 MB、900 秒和 redirect 预算
- research update required: yes；R-048 记录成熟候选、真实三站 POC、第四批、VPN 出口和非流式上限边界
- architecture or ADR update required: no；模块职责、事实源、依赖方向和公共 contract 未改变
- tests and real-surface validation: worker redirect/Fake-IP/编码回归、Planning 组装、全仓 test/typecheck/build、真实第四批、内容 DOM 审计、JSONL/CSV 导出、API/Web 重启持久化
```

```text
Patch Disposition:
- delete: 旧单跳 Node HTTPS 正文传输、把任意 3xx 当 source error 的行为、失败堆栈作为用户 termination reason 的新写入路径
- keep: HTTPS/同源/公网地址 SSRF 门、持久 Request Attempt/Gate、零自动 retry、不可变 Snapshot/Asset、旧 v9 与全部历史运行只读记录
- rewrite: 精确 HTTP/文件请求改为 Crawlee HttpCrawler；redirect 响应结算与下一跳预准入拆开；未来计划预算和最大字节按真实 PDF/redirect 证据升级
- reason: 第三批 11 个失败中有可复现的 redirect、超时和 5 MB 计划缺口；继续给手写传输叠特判不能形成多路径开源底座
```

真实第四批：

- command `source-command-93b4806a-8906-44c7-ab77-2b4321ef0237`，Batch `source-batch-48648747-3e08-480b-964b-3de5cbf6d308`；终态 `partial`，14 completed、10 failed、0 running。
- 29 条 Snapshot 全部 `accessible`：28 条 inline text、1 个 PDF Asset，payload 合计 9,883,724 bytes；60 个 Request Attempt 中 56 completed、4 failed，2 个 redirect 第二跳独立关联 parent attempt。
- TCL run `source-run-667dfde9-b7fe-4774-9ecb-89775b26659e` 已保存 5 条 Snapshot：电视目录 840,156 bytes、商城目录、T7G 产品页、雷鸟产品页和 4,030,287-byte PDF；JSONL 导出 5 条/1,865,144 bytes，SHA-256 `cb4fd22eea85296f08f5bafe1a58727277da01e354b8d4d03eacff46cdffd3c0`。
- 海信 3/3 target 完成：电视目录 359,753 bytes、商城首页 108,308 bytes、65Z600QF-PRO 产品页 215,255 bytes。目录页面声明 61 个产品并包含 103 个产品相关链接。
- 松下目录 166,710 bytes 已保存；隔离原型中的计划内说明书为 5,306,712 bytes、有效 `%PDF-`，SHA-256 `a0f442ca53ec9050705fdc4143690e3bb30b07555529e6603c8e25d005938c76`，证明 v9 旧 5 MB 不是合理上限。

失败与内容结论：

- 10 个失败中，TCL/Vidda/夏新为旧 v9 redirect 预算不足，松下为旧 5 MB 上限；东芝实际从 HTTPS 降级跳转到 HTTP，按安全门停止；PPTV/飞利浦为 TLS 建连中断；小米两项和夏普保留既有 `access_denied`，没有绕过或重开 gate。
- 访问成功不代表目标内容合格。TCL、海信、华为、长虹、LG、松下、三星、OPPO、两条标准和三条技术说明已观察到与电视型号、规格、说明书、标准或显示原理直接相关的原文；Sony 仅 386 字符且无型号/规格信号，酷开两页是同一 4,139 字符企业页壳，明确不计为电视目录完成。
- 当前仍没有 machine-readable 的 capture-unit 内容验收 contract，也没有已确认的官网目录遍历 Plan；因此本轮接受“精确资源链路和真实原文持久化”，不接受“24 个来源内容全部合格”或“电视品类已抓全”。下一实现门仍是三个结构不同官网的目录遍历与 typed gap，不允许 Source Run 自行扩 URL。

VPN 边界：本机第四批继承 `127.0.0.1:7890` HTTP(S) 代理；即使清空进程代理变量，系统 DNS 仍返回 Fake-IP 并由 VPN/TUN 接管，因此同机浏览器/HTTP 切换不能证明出口隔离。需要不同出口时必须用独立 Runner/网络，不启用自动代理轮换、账号切换或反检测。

验证：Node 24.12.0；聚焦 worker 13/13；全仓 `npm test -- --reporter=basic` 为 38 files passed、3 skipped，160 tests passed、8 skipped；六 workspace `npm run typecheck` 通过；production `npm run build` 通过，Web 2304 modules、648.94 kB / gzip 192.87 kB，仅有既存大 chunk warning；`git diff --check` 通过。API/Web 停止后重新启动，Batch 仍为 `partial 14/24`、29 Snapshot/9,883,724 bytes，全库 running Batch/Run 均为 0。

本轮架构影响：澄清。精确资源 transport mechanics 改用成熟 Crawlee，事实源、Provider 公共身份、计划确认门和 Source Dataset 依赖方向不变；浏览器、sitemap 和内容验收仍未冒充已接入。全部修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

## 38. 2026-08-26 多路由抓取与内容验收进入真实系统，v10 草案落库

简单说明：抓取阶段不再只有“给 URL 发请求”这一条路。当前系统会先把品牌官网入口规划成有界站内发现，把说明书、规格页、标准和技术正文规划成精确访问；执行时每个请求先过持久限速和安全门，站内页通过 robots、sitemap 和同源链接进入 Crawlee 持久队列，原始响应全部追加保存，但只有确实包含计划所需品牌、型号、规格、说明书、标准或技术信号的内容才算完成。真实 Workbench 已生成并保存当前 v10 草案；它仍为 draft，没有被确认，也没有开始正式抓取。

```text
Baseline Impact:
- touched modules: Crawl Plan v4 contract/Planning stages、public.web-resource@2.0.0、Crawlee RequestQueue/robots/sitemap adapter、内容 assessment、Source Dataset 计数/页面、API composition、测试、Skill、RESEARCH/ADR/ARCHITECTURE/ROADMAP/产品文档/PROGRESS
- owning fact source: confirmed Crawl Plan 继续拥有来源、exact/site 路由、内容信号、数量、预算和停止门；PostgreSQL Source Dataset 继续拥有 Batch/Run/Request/Snapshot/Asset 与内容验收观察；Crawlee 队列只拥有本机派发 mechanics
- public interface changed: yes；新增 execution checklist 4、public.web-resource@2.0.0 的 typed exact/site 配置，以及 Snapshot observation 的可选 contentAssessment
- new protocol/adapter/fallback: yes；新增显式 exact/site route 与成熟 Crawlee RequestQueue、RobotsTxtFile、parseSitemap adapter；没有自动浏览器 fallback、代理轮换、登录/验证码绕过或第二业务工作流
- compatibility or legacy path changed: yes；execution checklist 3 和 Provider 1.0.0 历史计划只读不可新启动，历史 Plan/Run/Snapshot 不迁移不删除
- research update required: yes；R-048 记录开源候选、三站原型、生产替换和内容门，R-045 记录整表品牌复核的真实否决与增量复核
- architecture or ADR update required: yes；ADR 0019 接受显式多路由/内容验收，ADR 0018 修订新增品牌的增量事实链，ARCHITECTURE/ROADMAP 已同步
- tests and real-surface validation: Provider/Queue/Planning/Source Dataset 红绿回归、全仓 typecheck/test/build、真实 Workbench v10、API 数据审计、API/Web 重启持久化
```

```text
Patch Disposition:
- delete: exact-only/任意 2xx 即完成的旧假设；新增品牌后让模型重写全部六镜头品牌表的错误流程；临时的“复核后保留别名”补丁；Provider 1.0.0 新启动路径
- keep: Capture Task 与人工确认门、JD 排除、PostgreSQL Request Admission、SSRF/Fake-IP/HTTPS/同源 redirect 门、不可变 Snapshot/Asset、Graphile Batch、历史数据只读审计和显式 Resume
- rewrite: Planning 确定性组装为 v4 exact/site；官网增量品牌携带原查询/证据并入既有品牌账后只继续饱和查询；Provider 用 Crawlee 持久队列执行 robots/sitemap/HTML 同源发现；Source Dataset 只让 accepted 增加有效完成数
- reason: 真实运行证明精确 URL 只能取回少量页面、2xx 可能只是企业页壳、失败请求需要可恢复队列；整表品牌复核还会丢证据或把红米/REDMI重复扩张，不能继续叠修补
```

真实系统实现：

- `public.web-resource@2.0.0` 只接受 `mode=planned_routes`，target 必须是 `exact` 或 `site`。`site` 冻结 seed、至少两个 required terms、深度、最少合格页；v10 每个 site 最多 40 页、深度 2、至少 2 页 accepted，单来源最长 30 分钟、6 请求/分钟、10 秒最小间隔。
- site 先通过 audited transport 读取 robots/sitemap；XML 使用 `@crawlee/utils parseSitemap`，robots 使用 `RobotsTxtFile`，seed/sitemap/HTML 同源候选进入按 Batch/Source/Target 命名的 Crawlee 持久 RequestQueue。失败或进程退出不把请求标成 handled；负责人显式继续时领取原队列未完成项。单元/集成测试证明失败页立即 reclaim，恢复不等待双锁窗口。
- 内容验收写入 Snapshot observation：`accepted`、`rejected`、`supporting`。site HTML 要有足量可见正文、计划信号，以及 JSON-LD Product、至少两个型号或至少两个相关链接之一；品牌 exact HTML 也需要计划信号和商品证据；PDF 要有 `%PDF-` 文件签名。sitemap 原文是 supporting，无关企业/新闻页 rejected；均可保存原文，但 supporting 不算成功也不算失败，只有 accepted 增加有效完成数。
- 请求预算覆盖 robots、sitemap、页面和每个 redirect hop；25 MB 上限、30 分钟总时限和 AbortSignal 已进入计划/执行；TLS、跨源/降级跳转、登录、验证码、403/429 继续失败关闭。浏览器路径未进入生产，不能因 HTTP 失败或内容 rejected 自动切换。
- 抓取阶段在 ROADMAP 1E 明确展开为 13 个执行分段：范围、调查、计划、确认、Prepare、持久派发、逐跳准入、多路由、不可变保存、内容验收、终态结算、审查导出、恢复与持续增量。

真实 Planning 修复与 v10：

- 首次 v4 运行 `crawl-planning-run-70d08aad-310b-4778-bad0-e8a2f12392e4` 搜索 800 个网页，最终门拦住品牌集合/华为智慧屏参数证据不一致，没有保存坏计划。
- 第二轮 `crawl-planning-run-0bc2933e-4c8c-47f9-9962-790bc04ed16c` 把红米/REDMI 等重复身份扩成 44 个新增待核对项，已从真实 Workbench 主动中止；第三轮 `crawl-planning-run-edecf60e-9c0f-4234-ba61-154a0138c1ed` 证明整表复核会把旧品牌证据 URL 留空，truthful failed。错误流程和临时补丁均已删除。
- 最终运行 `crawl-planning-run-7bb4e4fb-386c-4a24-9a7f-4f3af299b519` 状态 completed，约 20 分 15 秒，页面记录搜索 551 个网页；真实保存 v10 draft `crawl-plan-764c592a-7ee9-4219-b5cd-2a16b90b53ea`，execution checklist 4。
- v10 有 40 个品牌：25 planned、15 unresolved；29 个来源、50 个唯一 URL target，其中 22 个 site、28 个 exact，Provider 全部为 `public.web-resource@2.0.0`。10 个 task topic 与 9 个非 JD Capture Task candidate ID 全部闭合；JD URL、execution blocker 均为 0；最后两个独立饱和查询均零新增。23 个品牌官网来源中 22 个含 site，剩余 AOC 来源是一个计划明确的精确 PDF 说明书。
- v10 仍为 draft。Workbench 页面停在“确认此计划”，未点击确认；Source Dataset 中 v10 Batch/Source Run 均为 0，全库 running Batch/Run 均为 0。最终停止并重启 API/Web 后，页面仍显示“Crawl Plan v10 · 执行清单 4”和“确认此计划”。

验证：Node 24.12.0；全仓 `npm run typecheck` 六个 workspace 通过；`npm test -- --reporter=basic` 为 38 files passed、3 skipped，166 tests passed、8 skipped；`npm run build` 六个 workspace 通过，Web 2304 modules、650.23 kB / gzip 193.26 kB，仅有既存大 chunk warning；`git diff --check` 通过。`npm audit --omit=dev` 仍为既存 1 moderate/4 high（ajv、brace-expansion、fast-uri、Fastify/find-my-way 链），本轮不做未经评估的 force fix。

本轮架构影响：改变。规划公共执行清单、Provider 版本、显式 route 和 Snapshot 内容 assessment 成为当前基线；品牌新增复核改为增量事实链；事实源归属、人工确认、请求准入和不可变原始数据边界不变。当前修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

下一门：负责人审查并显式确认 v10 后，才能从 Workbench Start 创建正式 Batch/Source Run，届时验收只看 accepted 原始内容、rejected/supporting、失败原因、覆盖缺口和导出对账；未确认前不访问 v10 target，不把 draft 或测试说成数据已抓取。

## 39. 2026-08-26 ZOL 电视产品库低频多路由验证

简单说明：ZOL 电视产品库值得作为品类市场目录来源。真实系统用每 30 秒一次的低频节奏取得了门类页、品牌页和单品页，原文中确实有大量型号、参数和产品链接；但当前通用解码把这些页面的中文变成乱码，内容验收因此全部拒绝。现在只能确认“来源有价值、传输链能运行”，不能确认“系统已经得到可用产品数据”。

```text
Baseline Impact:
- touched modules: 无生产代码修改；只使用 public.web-resource@2.0.0、Source Execution、Request Admission、Crawlee RequestQueue 与隔离 Source Dataset 做真实验证，并更新 RESEARCH/PROGRESS
- owning fact source: 有界验证计划拥有 URL、路由、频率和停止门；隔离 Source Dataset 拥有本轮 Request/Snapshot/assessment 事实
- public interface changed: no
- new protocol/adapter/fallback: no
- compatibility or legacy path changed: no
- research update required: yes；R-048 记录 ZOL 真实来源密度、访问频率、Snapshot/hash 和编码阻塞
- architecture or ADR update required: no；模块职责、事实源和依赖方向未改变
- tests and real-surface validation: 真实 ZOL exact/site 计划前置校验、6 个低频请求、Source Dataset 内容审计
```

```text
Patch Disposition:
- delete: 一次性隔离验证脚本与临时数据库/RequestQueue；没有删除正式任务、计划或历史数据
- keep: Provider v2、持久准入、30 秒同源间隔、robots/sitemap、不可变原文、内容验收和失败关闭
- rewrite: none；本轮授权是来源验证，不改通用 HTML 编码 seam
- reason: 真实运行已经把阻塞精确定位到编码选择；修复属于新的通用能力决策，必须先完成成熟方案调研和多编码原型
```

真实验证：

- 来源：ZOL 电视产品库；用户明确个人非商用。本轮只验证电视门类，不访问其他家电门类，不下载图片，不进入登录、论坛或跨源电商页面。
- 计划：一个深度 1、最多 4 页、至少 2 页 accepted 的 `site` route，加一个最新产品列表 `exact` route；每分钟最多 2 次、同源最少间隔 30 秒、请求预算 22、最长 12 分钟。
- 运行：首次计划预算 20 在网络请求前被 Provider 完整性门拒绝，0 个外部请求；预算按公式修正为 22 后启动。正式运行共 6 个请求，相邻间隔为 30.1/30.1/30.1/30.1/30.0 秒，无访问受限。
- 原始结果：4 个 accessible HTML Snapshot，共 1,061,161 bytes。门类页、华为品牌页和两个单品页均包含大量产品结构；模型规则分别观察到 27～71 个型号、66～328 个相关链接。
- 内容结果：4 个 Snapshot 全部因中文编码为 mojibake、计划信号为 0 而 rejected；`site` target failed，`exact` target 未继续，Batch/Run truthful failed。临时数据库和队列已删除，正式电视任务及 v10 草案未改变。

本轮架构影响：澄清。ZOL 可承担高密度第三方品类目录候选；现有多路由传输、频控、队列和原始持久化已在真实来源工作。后续原字节对照证实：当时的乱码不是 ZOL 虚假声明编码，而是 Crawlee 在 Provider 前已转码 body 但保留旧响应头；修复和重跑见第 40 节。当前修改仍未提交、未推送，只在本机工作树，不构成跨电脑接续点。

下一门：先调研成熟编码检测实现，以 ZOL 乱码页、既有 Sony GBK 页和正常 UTF-8 页完成隔离原型；只有三类样本都能保持原文、charset、bytes/hash 和内容信号一致，才允许修改生产 decoder 并重新执行同一 ZOL 低频计划。未经该门不得加入 ZOL 正式 Source Run。

## 40. 2026-08-26 原字节保留修复与 ZOL 系统重跑

简单说明：乱码已在真实系统内修复，不是只在 Codex 实验里可用。ZOL 门类页、3 个系列页和最新产品页已按 30 秒间隔走完真实 Provider、Request Admission、Crawlee 队列、Source Execution 和 Source Dataset，5 页全部验收通过，中文可读且没有替换字符。这证明“ZOL 路径能抓到有用原文”，不代表电视品牌和产品已全量覆盖。

```text
Baseline Impact:
- touched modules: public.web-resource Crawlee transport 编码选项、HTML 编码回归、RESEARCH/PROGRESS
- owning fact source: Source Snapshot 继续拥有当次原文与 content assessment；transport 只保留原字节
- public interface changed: no
- new protocol/adapter/fallback: no；复用 Crawlee 3.18.1 公开选项和已接受 encoding-sniffer
- compatibility or legacy path changed: yes；GBK 等 Node 非原生编码不再被 Crawlee 预转码，Sony 错误 HTTP charset 纠正和正常 UTF-8 保持
- research update required: yes；R-048 纠正 ZOL 根因、记录 FileDownload/HttpCrawler 处置和锁版升级门
- architecture or ADR update required: no；模块职责、事实源、公共 contract 和依赖方向未变
- tests and real-surface validation: 17 个 Provider 回归、worker typecheck、ZOL/Sony/TCL 三编码真实 transport、两批隔离 ZOL Source Dataset
```

```text
Patch Disposition:
- delete: 临时 `bodyEncoding` 字段、“信任 Crawlee 已转码 body”的 decoder 分支和对应测试
- keep: WHATWG encoding-sniffer、错误 HTTP charset 的有界回退、SSRF/redirect/频控/零自动重试、不可变 Snapshot
- rewrite: Crawlee transport 保留源站原字节，内容层继续依 HTTP/meta 选择编码
- reason: 真实 ZOL 原字节和 Crawlee handler body 对照证明乱码发生在 HttpCrawler 的 handler 前转码，不能在错误补丁上继续叠 fallback
```

实现与工程门：

- 锁定的 Crawlee 3.18.1 会对 GBK 等 Node 非原生编码执行 iconv 转码。生产 `HttpCrawler` 使用其公开 `forceResponseEncoding: "utf8"` 关闭该分支，让 handler 保留原字节；这不表示把正文当 UTF-8 解码，真正编码仍交给内容层。
- `FileDownload.streamHandler` 在当前版本不复用 adapter 的 User-Agent、redirect hop 预准入和 DNS pinning，因此不接入；没有新增下载器、站点特判或自研编码检测。
- 真实生产 transport 三源对照：ZOL 276,978 原字节→GBK，电视/品牌/产品命中 194/12/24；Sony 391 原字节，错误 HTTP UTF-8 头下恢复 GBK 标题“无标题文档”；TCL 840,081 原字节→UTF-8，电视/产品命中 593/122。三者替换字符均为 0。
- `npm test -- packages/worker/tests/publicWebResourceProvider.test.ts --reporter=basic` 为 17/17；`npm run typecheck:worker` 通过。

隔离 ZOL 系统重跑：

- 计划保持一个深度 1、最多 4 页、至少 2 页 accepted 的 `site` route，加一个最新产品 `exact` route；每分钟最多 2 次、同源最少间隔 30 秒、请求预算 22、最长 12 分钟。
- 首批 `source-batch-a1fd64a8-c4a4-45de-9684-5ce4de87150e` 在门类页 accepted 后，第二个页面的 TLS 建连被当前网络中断；Batch/Run 如实 failed，没有自动 retry、忽略 TLS 或把已有 Snapshot 改写成完成。
- 新建的第二批 `source-batch-5ba28124-88e7-4ca3-8134-1fc502cc80ed` 在 183 秒后 completed；Run `source-run-168773e7-166a-4acf-a56a-585690e8ccda` 与两个 target 全部 completed。7 个 Request Attempt 全部 completed，相邻开始间隔 30.050～30.067 秒，无 401/403/429、验证码或 robots 禁止。
- 5/5 Snapshot 均为 accepted、GBK、0 替换字符：电视门类页、Sony XR-X90J 系列页、飞利浦 PUF6172/T3 系列页、创维 G650 系列页和最新电视页；解码后 payload 共 1,112,293 bytes。
- 验证用脚本、Crawlee 队列/资产目录和临时 PostgreSQL 数据库已删除。本轮没有确认 v10、没有创建正式电视 Source Run，也没有访问其他家电门类、图片、论坛或登录内容。

本轮架构影响：澄清。`public.web-resource` 的职责、Source Snapshot 事实源、依赖方向和公共 contract 不变；只纠正锁定 Crawlee 版本在 transport 边界对原字节的预转码。当前修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

下一门：将“ZOL 市场目录作为品牌/型号/参数补全来源”写入新电视计划候选，并修正官网、市场目录、标准/科普三类来源的内容、数量、停止和缺口表达。只生成可审查 draft，不确认、不开始正式抓取；随后再进入站内发现关系持久化和数据地图展示。

## 41. 2026-08-26 市场目录规划阶段、品牌质量门与持久规划原型

简单说明：系统已经能把 ZOL 作为独立“跨品牌市场目录”写进规划，而不是冒充某个品牌官网。但第一次真实生成新电视草稿时发现 115 个候选品牌，其中混入 `placeholder`，而当前规划所有阶段只放在一个长进程内；17 分钟后仍只跑到第 10～12 个品牌，失败会全部重来。坏运行已失败关闭且没有生成 v11。占位品牌质量门已修复；成熟 DBOS 组件的强杀恢复原型证明完成阶段不会重做，是否接入正式 Planning 仍需负责人确认。

```text
Baseline Impact:
- touched modules: Crawl Planning 内部 market catalog 阶段、品牌候选校验、阶段 prompt/assembler/runtime/Skill/tests、RESEARCH/PROGRESS；另做隔离 DBOS 原型
- owning fact source: Capture Task 继续拥有确认范围；最终 Crawl Plan 继续拥有来源计划；失败 Planning Run 只保存时间线，DBOS 尚未成为生产事实源
- public interface changed: no；Capture Task、Crawl Plan v4、Provider 与 Source Dataset 公开 contract 未变
- new protocol/adapter/fallback: no production change；内部多一个市场目录阶段；DBOS 仅为隔离候选原型
- compatibility or legacy path changed: no；v10 保持 draft，历史计划/运行不改写
- research update required: yes；R-049 比较 Graphile/pg-boss/Temporal/DBOS 并记录当前规划强杀门
- architecture or ADR update required: no，尚未接入；若确认 DBOS 生产接入则需要修改 ARCHITECTURE/ADR
- tests and real-surface validation: 规划 runtime 红绿测试、真实 ZOL 搜索规划运行、PostgreSQL 计划状态核对、DBOS 五阶段强杀恢复原型
```

```text
Patch Disposition:
- delete: 临时电视草稿生成脚本；失败运行没有对应 Plan，不删除其审计时间线
- keep: ZOL 独立市场目录阶段、官网/标准/原理独立来源、最终确定性组装、人工确认和 Start 边界
- rewrite: 品牌发现/饱和统一拒绝占位标记；长运行候选从“继续加 timeout”改为成熟 durable workflow 调研门
- reason: 真实运行已经证明非品牌噪声会触发无意义官网搜索，且阶段只驻留内存无法承受 115 品牌长规划
```

实现与真实运行：

- 新增内部 `marketCatalogStage`，只接受品牌发现 `authoritative_directory` / `broad_market_catalog` 的精确证据 URL，来源类型只能是 `other`/`retailer`，每个来源一个品类 seed；Workbench 将其组装为有界 `site` route。ZOL 不进入 `brand_official`。
- 规划顺序变为品牌发现与饱和 → 跨品牌市场目录 → 逐品牌官网/参数/说明书 → 标准监管/技术原理 → 最终确定性组装。市场目录、官网和知识来源仍分别拥有自己的 target，Provider 不决定抓什么。
- 真实运行 `crawl-planning-run-3cf7d9a3-2a98-4f19-9210-6960d619c2c4` 已实际搜索并核实 ZOL，品牌分母扩为 115；第 10～12 个品牌出现 `placeholder` 查询。运行 17 分 33 秒后失败，Workbench 保存 failed 终态和错误，没有生成 v11、没有 supersede v10，也没有创建 Batch/Source Run。
- 品牌发现与饱和 schema 现在统一拒绝 `placeholder/unknown/n-a/null/undefined/todo/tbd/待定/未知/其他/示例品牌/品牌名` 等模型占位标记；错误在同一发现 thread 内进入既有有界修正，不会等到官网批次才记为 unresolved。规划 runtime 聚焦测试 18/18 通过。

持久规划候选原型：

- R-049 证明 Graphile Worker 适合持久派发但不提供函数级检查点；用它单独拼阶段链会重新自研工作流和 crash recovery。Temporal 满足能力但新增独立服务；pg-boss 同样仍以 job queue 为主。DBOS 4.25.14 只依赖现有 PostgreSQL，进入隔离原型。
- 五个稳定子 workflow 依次模拟品牌发现、市场目录、两个品牌批次和标准原理。在第一个品牌批次进行中 `SIGKILL`，新进程按同一 workflow ID 恢复；最终五个 typed 结果完整。
- 日志对账：已完成品牌发现和市场目录各执行一次；在途品牌批次 `start` 两次、`done` 一次；后续品牌批次和标准原理各一次。它接受“已完成阶段不重做、在途外部调用至少一次、后续接续”，不宣称模型搜索 exactly-once。隔离数据库和临时依赖已删除，可从系统废纸篓恢复临时目录。

工程验证：Node 24.12.0；规划 runtime 聚焦测试 18/18；全仓 `npm test -- --reporter=basic` 为 38 files passed、3 skipped，168 tests passed、8 skipped；六个 workspace `npm run typecheck` 通过；production `npm run build` 通过，Web 2304 modules、650.23 kB / gzip 193.26 kB，仅有既存大 chunk warning；`git diff --check` 通过。正式 PostgreSQL 中 running Planning Run 为 0，最新计划仍是 v10 draft。

本轮架构影响：澄清。市场目录作为规划内部阶段没有改变公开 contract 或事实源；品牌占位校验是既有 schema 的输入质量门。DBOS 仍是候选，尚未修改生产组合根、数据库 schema 或 API 生命周期。当前修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

下一门：负责人确认是否接受“Planning Run 由 DBOS 按稳定阶段/品牌批次持久恢复；Workbench 仍是任务、运行与最终计划事实源”。确认后才允许把 DBOS 加回生产依赖并重跑电视新草稿；未确认前不靠延长 timeout 再赌一次，也不确认 v10、不启动抓取。

## 42. 2026-08-26 DBOS 正式接入 Crawl Planning

简单说明：负责人已经允许接入 DBOS。真实电视规划在页面断开和 API 两次被强制终止后都从已完成阶段继续，最终生成一份 v11 草稿；没有自动确认计划或开始抓取。v11 的来源与品牌账已经成形，但质量审计发现 ZOL 的主题归属过宽，因此它仍不能进入确认门。

```text
Baseline Impact:
- touched modules: Crawl Planning 阶段 runtime/编排、DBOS adapter、Workbench stage checkpoint/plan 唯一约束、API 组合根与 SSE 生命周期、Web 轮询交互、migration、RESEARCH/ARCHITECTURE/ADR/PROGRESS
- owning fact source: Workbench 继续拥有 Capture Task、Planning Run、用户可见 Stage Checkpoint 与最终 Crawl Plan；DBOS 只拥有内部执行检查点，Graphile/Source Dataset 不变
- public interface changed: no schema change；POST SSE 仍返回既有 typed event，但 socket 关闭只停止投影，不再中断领域运行
- new protocol/adapter/fallback: yes；新增专用 DBOS parent/child workflow adapter；没有模型 fallback、自动确认、自动 Start 或浏览器 fallback
- compatibility or legacy path changed: yes；旧 interrupted/failed/plan 历史只读保留；新运行跨页面恢复，同一任务拒绝并发第二轮
- research update required: yes；R-049 从候选更新为接受并记录正式强杀门
- architecture or ADR update required: yes；ARCHITECTURE、CRAWL-PLANNING-DESIGN 与 ADR-0020 已记录执行事实和生命周期变化
- tests and real-surface validation: 正式 adapter SIGKILL 恢复、Codex 分阶段回归、PostgreSQL migration、全仓 test/typecheck/build、生产 API 无任务启动与 HTTP 200
```

```text
Patch Disposition:
- delete: Planning Run 由页面连接拥有、断页触发 turn interrupt、阶段结果只驻留父进程内存的生产行为
- keep: 现有阶段 schema/Zod 校验、两次同 thread 修正、确定性 Plan v4 组装、人工确认/Prepare/Start 门、Graphile Source Execution 与 Source Dataset
- rewrite: Codex runtime 拆成可独立调用的 typed Stage Runtime；父编排用稳定 stage key 调用 DBOS 子 workflow；SSE 改为后台运行的只读投影
- reason: 115 品牌真实运行已经证明整轮内存执行不可恢复；成熟 DBOS 原型和正式 adapter 均通过强杀门
```

实现：

- 新依赖锁定 `@dbos-inc/dbos-sdk@4.25.14`。生产使用独立 `domain_analysis_crawl_planning` system schema；没有恢复 ADR-0015 退出的旧知识流水线。
- Planning Run ID 作为父 workflow ID；`brand-discovery`、每次 `brand-saturation`、`market-catalog`、按复核轮次和批次编号命名的 `brand-mapping`、`knowledge-sources` 形成稳定子 workflow ID；阶段子 workflow 经 DBOS concurrency=1 Queue 串行复用现有 App Server 连接。
- 子 workflow 的 App Server 调用、结构化解析与现有 Zod 阶段校验属于一个 `retriesAllowed:false` durable step。进程强杀后完成 step 不重做；在途 step 按至少一次语义重做，不宣称网页搜索 exactly-once。
- Workbench 新增 `crawl_planning_stage_checkpoints`，用 `run_id + stage_key` 与 `run_id + sequence` 唯一约束阶段投影；typed 阶段结果只在 DBOS 检查点中持久恢复，不复制到业务表。`source_collection_plans.planning_run_id` 新增 partial unique，最终 step 重放仍只生成一个草稿版本。
- 页面 socket 关闭只 abort SSE 投影。Web 对 Workbench 运行视图每秒轮询，显示“后台规划中”；刷新或离开页面不会发送取消。API 启动时对 Workbench 中仍为 running 的 ID 幂等启动/恢复；相同 task 同时只允许一个 Planning Run。
- DBOS 最终只调用 Workbench 既有输出校验与 Plan 写入；确认计划、Prepare 和 Start 仍需要独立人工动作，DBOS 不访问正式来源。

验证：

- 正式强杀集成测试在 `brand-mapping:0:1` 阶段执行中向首进程发送 `SIGKILL`。第二进程用相同 run/workflow ID 恢复：品牌发现、两个饱和阶段和市场目录的完成结果未重做；在途批次 `start` 两次、`done` 一次；第二品牌批次和知识来源各一次；最终 status=completed 且 planCount=1。
- Codex 分阶段 runtime 18/18；API/Web 聚焦回归 25/25。全仓 `npm test -- --reporter=basic` 为 39 files passed、3 skipped，169 tests passed、8 skipped。
- `npm run typecheck` 六个 workspace 全部通过；`npm run build` 通过，Web 2304 modules、650.39 kB / gzip 193.34 kB，仅有既存大 chunk warning。
- 真实生产 Planning Run `crawl-planning-run-3f868a0d-bb9d-49aa-85cf-893ef6ab258f` 从 2026-08-26 17:11:55 到 17:42:45，历时 1,851 秒，12/12 个稳定阶段 completed。页面在品牌发现后断开，运行继续；随后分别在 `brand-saturation:2` 和 `brand-saturation:3` 执行中两次强杀 API，均从同一 run/workflow 恢复。
- 第一次真实重启暴露 API 在 `DBOS.launch()` 已自动恢复后又调用一次 `startWorkflow`，日志出现 queue name 冲突。启动恢复现先查询同 workflow 状态：存在且运行中只等待 DBOS 自动恢复，终态与 Workbench 不一致时失败关闭，仅在 workflow 不存在时幂等启动。第二次强杀后的恢复日志不再出现该冲突；正式恢复测试也增加了对应反断言。
- 最终只生成一个 v11 draft `crawl-plan-a40e1363-f931-4fc6-b52b-8865d6d75d3f`：50 个品牌中 37 planned、13 unresolved；43 个来源、72 个唯一 target，37 exact、35 site；36 个品牌官网、1 个 ZOL 市场目录、2 个监管、1 个标准机构、3 个技术出版来源。Provider 均为 `public.web-resource@2.0.0`，execution blocker、JD URL、重复 source/target URL 均为 0。
- ZOL 已作为 `other` 独立来源写入 `https://detail.zol.com.cn/digital_tv/`，职责明确为发现品牌、型号、参数字段与站内产品页，不冒充官网、标准或原理来源。但其 target 的 `taskTopics` 被模型填成全部 10 个任务 topic，确定性 topic audit 因而错误把 ZOL 算进标准和技术原理覆盖；这是当前真实质量缺口，v11 保持 draft 且不得确认。
- v11 对应 Source Collection Batch=0、Source Run=0；全库 running Planning Run=0。本轮没有 Prepare、Start 或来源访问。

本轮架构影响：改变。Crawl Planning 的执行生命周期从页面连接内前台运行改为 DBOS 稳定阶段恢复；Workbench 新增唯一的用户可见阶段投影事实，Plan/Capture Task/Source Dataset 的 ownership 不变。真实恢复中发现并修正的是启动编排 bug，没有新增第二事实源或 fallback。当前修改未提交、未推送，只在本机工作树，不构成跨电脑接续点。

下一门：先让市场目录 target 只能声明其实际提供的市场/品牌/型号/参数 topic，并用新的真实电视 Planning Run 证明 ZOL 不再被算作标准或原理来源；旧 v11 不改写。新草稿通过语义审计后仍需负责人独立确认，未确认前不 Prepare、不 Start、不抓取；随后再进入站内发现关系持久化和原始数据地图展示。
