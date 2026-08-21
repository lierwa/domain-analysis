# 数据抓取与清洗平台开发进度

更新日期：2026-08-21
当前阶段：`ROADMAP.md` 1B 完整清单已确认；1C/1D 抓取前准备已接入，京东纵切片部分通过；1E 多来源执行尚未完整验收
总体状态：采访 → Markdown 确认 → Capture Task → 完整可执行 Crawl Plan → 运行准备 → 显式 Start → Source Dataset 已形成生产主链。计划确认不再依赖 Chrome；运行准备可以自动启动项目专用 Chrome、校验 9222 并把京东登录/验证投影为人工动作，只有 ready 后 Web 才开放 Start。真实准备已到达登录门，本轮没有启动新的 Source Run。
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

## 20. 2026-08-21 真实抓取共享节奏与 fake-IP TUN 冲突处置

简单说明：上次 18 个来源全部失败有两个系统性原因。京东的准备检查、最终检查和每个来源各自重置了访问节奏；公共来源则被本机 Mihomo TUN 解析成 `198.18.*` fake IP，现有 SSRF 正确拒绝。当前代码已让一次 confirmed plan 内的全部京东导航共用一个低频 gate；经用户明确允许，本次真实运行临时关闭 TUN，公共 Provider 继续使用原有严格 SSRF，不加白也不新增 DoH。自动化门已通过，下一步必须由用户在正式 Web 点击 Prepare/Start 才能判定真实结果。

```text
Baseline Impact:
- touched modules: JD Provider、Source Execution、Raw Source Observation typed contract、测试、Issue/RESEARCH/ARCHITECTURE/ADR/PROGRESS
- owning fact source: Crawl Plan 继续拥有来源/策略；Source Execution 编排一次 Provider execution；Source Dataset 继续拥有 run/target/observation/snapshot
- public interface changed: yes；SourceProvider 增加可选 begin/end execution；Raw Source Observation 增加 rate_limited；HTTP 路由与 PostgreSQL schema 不变
- new protocol/adapter/fallback: 只扩展现有 Provider 生命周期；不增加公共 DNS/代理 adapter、自动重试或 fallback
- compatibility or legacy path changed: 历史 18 个 failed run 不改写；公共 Provider 与 SSRF 代码保持；JD Provider key/version 保持
- research update required: yes；R-039 记录 Mihomo/Node/Got 官方依据、DoH 原型与最终不采用结论
- architecture or ADR update required: yes；记录 plan execution 共享 gate、同 Provider stopped 审计与 rate_limited
- tests and real-surface validation: 4 个定向文件、全量 test/typecheck/build、用户 Web Prepare/Start、页面/API/PostgreSQL/Source Dataset 对账
```

```text
Patch Disposition:
- delete: 每个 JD source 内新建 gate、preflight 绕过 pacing、pc-frequent-pro 误记为 access_denied
- keep: p-queue/cockatiel、Playwright CDP、data/jd-cdp-profile、零重试、公共 SSRF/redirect/HTTPS/同址连接、历史运行事实
- rewrite: Provider execution 用 plan identity/version 贯穿 Prepare/Start；访问面受限后其余同 Provider 来源只写 stopped 审计，其他 Provider 继续
- reason: 不能在错误生命周期上叠 sleep/白名单；节奏必须只有一个事实，fake-IP 仍必须按保留地址拒绝
```

实现与当前证据：

- `SourceProvider` seam 增加可选 `beginExecution/endExecution`。Source Execution 先校验并按 Provider 分组；Prepare 与 Start 使用同一个 plan execution key。JD Provider 的 Prepare、Start preflight、目录、详情和跨 source 调度均进入一个既有 `PacedAccessGate`，总最长窗口按来源窗口合计，但 2 次/分钟、10 秒同域间隔和零重试不变。
- `login_required`、`verification_required`、`access_denied`、`rate_limited` 会阻断其余同 Provider 导航，并为每个剩余 source/target 写 `stopped`；`not_found/source_error` 只结束当前 source，其他 Provider 继续。`pc-frequent-pro`/HTTP 429 现在保存为 `rate_limited`；历史 observation 不迁移。
- 用户授权后经 Mihomo 官方本地 controller 把运行时 TUN 从 true 切为 false。`198.18.*` 虚拟路由消失；Node 对 NIST、海尔、SAMR 恢复真实 A/AAAA；NIST HTTPS 为 200 且 TLS authorized。公共 Provider、BlockList 和 package/lockfile 均未修改，Clash Verge 重启后可能恢复原设置。
- 定向为 4 files / 13 tests passed；全量 `npm test` 为 32 files passed、124 tests passed、1 个既有 realtime acceptance skipped；六个 workspace `npm run typecheck` 通过；`npm run build` 通过，Web 2301 modules、596.41 kB / gzip 176.27 kB，仅有既有大 chunk warning；`git diff --check` 无错误。

本轮架构影响：改变。事实源和依赖方向不变；现有 SourceProvider seam 新增一次 confirmed plan 的临时 execution 生命周期，Raw Source Observation 扩展 `rate_limited`，已同步 ARCHITECTURE 与 ADR-0013。真实页面/API/PostgreSQL 结果尚未产生，当前不得标记完成，也尚未提交推送。

正式 Web 后续已在 `127.0.0.1:6173` 启动并读取目标任务、confirmed plan 与历史 Source Run，但连续三轮没有收到用户 Prepare/Start POST。正式 API 列表和 PostgreSQL 直接查询均为历史 54 条 run，latest `2026-08-20T17:53:16.251Z`；数据库累计 failed 51、completed 3、stopped 0，没有本次新增 run/target/observation/snapshot/asset。真实抓取因此分类为 blocked/untested，而非 passed 或 failed；按用户“无论结果都提交远端并关机”的明确指令，当前转入报告定稿与远端交付，Goal 不得标成 complete。
