# 数据抓取与清洗平台开发进度

更新日期：2026-08-19
当前阶段：`ROADMAP.md` 1A 对话生成抓取任务
总体状态：代码清理、新 1A 契约和本机迁移已完成；2026-08-19 已根据连续两轮真实截图纠正 Timeline 顺序、普通问题文案、Composer、自定义回答、滚动按钮、工具详情、分段空白和生命周期状态。全量类型检查、测试与生产构建通过，正在完成远程交付；1A 尚未通过。
当前积分：85.5（以 `AGENT-SCORECARD.md` 为准）

## 1. 本轮目标

用户已确认项目只有两个阶段：数据抓取、数据清洗。当前只做抓取，并从第一项人工验收开始：在 Workbench 新建抓取任务，输入“抓冰箱”等需求，检查对话和最终抓取任务草稿是否正确。

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

完成对话后得到一个版本化 `抓取任务草稿`，包含：

- 用户原始需求；
- 商品门类；
- 中国大陆普通消费者实际可购买的市场口径，不按品牌国籍排除；
- 通用抓取内容和该品类补充内容；
- 京东抓取意向及固定范围；
- 系统本轮真实调查过的候选来源、格式和访问状态；
- 排除项、未决项和已确认决定。

用户整体确认后生成正式 Capture Task；不会自动开始真实抓取。草稿或正式任务范围不足时都能继续原对话：新草稿追加版本，后续确认保持 Capture Task ID 不变并推进 revision，历史确认版本不覆盖。

## 4. Baseline Impact

```text
Baseline Impact:
- touched modules: shared, db, workbench, worker, api, web, repository skill, migrations, authoritative docs
- owning fact source: Interview Module owns dialogue; Capture Task owns confirmed scope; Source Dataset owns raw captures
- public interface changed: yes, ProductProject/Brief contracts replaced by CaptureTask/TaskDraft contracts
- new protocol/adapter/fallback: no new fallback; old legacy source payload is explicitly labeled on read
- compatibility or legacy path changed: yes, old source rows are preserved; old structured payloads are read as legacy_structured_json
- research update required: no new technology choice; existing accepted PostgreSQL/Drizzle/Fastify/Codex/Crawlee/p-queue/cockatiel retained
- architecture or ADR update required: architecture and roadmap changed; no new hard-to-reverse technology ADR
- tests and real-surface validation to run: typecheck, tests, build, migration, API/Web start, Workbench dialogue acceptance
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

## 6. 验证记录

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

这些结果不等于 1A 通过；系统运行链已真实通过，但采访问题与后续抓取任务草稿仍必须由用户验收。

## 7. 数据迁移结果

迁移已删除已经退出当前阶段的旧表名和知识字段；它保留：

- 采访 session、message、decision、unresolved item；
- 抓取任务基础记录和历史任务草稿行；
- source collection plan/run、source object、source snapshot、source asset；
- 旧快照 `content_json`，读取时标记为 `legacy_structured_json`。

迁移前发现上一版 0010 已经删除阶段 2 表并新增部分列，但没有完成任务表/列改名。当前迁移按真实状态补齐改名、外键和索引，并使用 `IF EXISTS` 兼容“旧表仍存在/已不存在”两种本地状态。保留表行数前后相同。

用户授权清空后又进行了真实页面复验；清理本轮精确测试会话后，当前本机共有 4 个采访 session、9 条消息、2 条决定、1 个任务草稿和 1 个正式抓取任务，均为用户保留或验收形成的数据。昨天没有原始抓取数据写进这台 Mac 的正式数据库。

## 8. 下一步与停止门

本轮交付动作：将 Windows 启停、Timeline/Composer 及本次工具投影纠错作为同一已验证工作区提交并推送，核对本地/远程 SHA 一致后，按用户明确要求关闭电脑。本轮没有修改采访 Skill 的问题颗粒度或“新增来源基本信息”设计。

上一轮真流式修复的架构影响：改变外部运行 seam，但不改变领域事实源。Codex 入口由 `exec --ephemeral --json --output-schema` 改为版本锁定的 App Server `stdio`＋`thread/start(ephemeral:true)`；公共 SSE contract 不变，`assistant.delta` 现在来自真实 commentary delta。Workbench 仍是唯一产品会话/任务事实源，没有持久 Codex thread、第二 Provider 或 fallback。

本轮 Windows 启动恢复的架构影响：无变化。恢复已存在的本机 PostgreSQL 进程，并用已锁定的 `concurrently`、`wait-on`、`kill-port-process` 修正开发进程生命周期；只增加根开发命令的薄 adapter，没有修改业务模块职责、事实源、依赖方向、公共 contract、产品协议或 fallback。

本轮 Timeline/Composer 纠错的架构影响：澄清交互 contract，未改变模块职责或依赖方向。Workbench 仍保存 typed Message/Decision；变化是 proposed Decision 在 Web 投影为普通消息，Composer 原文回答成为 confirmed Decision 的来源消息，同一 assistant turn 通过 assistant-ui ordered parts 投影 commentary 与活动。

本轮工具详情与生命周期纠错的架构影响：澄清交互 contract，未改变模块职责、事实源、依赖方向或 shared/API contract。普通状态与工具活动仍使用同一 typed part，只在 Web 呈现层区分；App Server adapter 继续只投影安全摘要，不新增恢复、repair 或 fallback。

HARD STOP：1A 未人工验收前，不实现 Crawl Plan，不访问真实来源，不调用清洗/Evidence/知识加工链。

## 9. Git 状态

- 仓库：`D:\work\domain-analysis`
- 分支：`master`
- 起始 HEAD：`819c4e8f40df9e8c8b52095abf13727b56dc5f29`，开始时与 `origin/master` 一致且工作区干净。
- 当前交付范围包含根开发生命周期修复、shared/Workbench/Web Timeline 与 Composer 纠错、工具/状态投影、测试及配套产品/架构/调研/进度文档；本轮结束前必须 commit、push 并核对远程 SHA，才能形成跨电脑接续点。
