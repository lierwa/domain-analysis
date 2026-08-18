# 数据抓取与清洗平台开发进度

更新日期：2026-08-18
当前阶段：`ROADMAP.md` 1A 对话生成抓取任务
总体状态：代码清理、新 1A 契约和本机迁移已完成；真实 Workbench 已能逐 token 显示 Agent 中文 commentary、逐条显示搜索/工具活动、单击确认负责人选项、生成可继续修改的任务草稿，并从已确认任务回到原对话生成新版本。运行链已验收，采访问题颗粒度和 Skill 内容仍等待用户讨论与验收。
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
- 任务修订真实数据库回归：只返回 `question` 的 runtime output 能形成结构化选项；点击非推荐项后 confirmed selection 保存实际点击值；首次确认创建任务，确认后继续对话形成新草稿，再次确认保持 task ID 不变、revision 前进，并保留两个不可变 confirmed draft 版本。
- 当前自动验证：六 workspace `npm run typecheck` 通过；生产 `npm run build` 通过（Web 2297 modules，主 JS 553.19 kB / gzip 163.62 kB，仍有既存 500 kB warning）；连接本机 PostgreSQL 的全量 Vitest 为 8 files passed、1 skipped，17 tests passed、1 skipped。
- 当前真实浏览器验证：720px 视口下 document scrollHeight=720、聊天区高 487px、composer bottom=646px；空闲只有 Send、运行只有 Stop。发送后 700ms 出现“连接本机 Codex”，运行中逐条展示真实 web search query 和只读命令摘要，无空白 Agent 气泡；点击“仅商品信息”后无需第二次确认，数据库 confirmed selection 精确为“仅商品信息”。确认后产生 v1 草稿，显示 3 个本轮实际候选来源、“继续补充或修改”和版本不覆盖说明；既有已确认任务可进入“继续对话修改范围”。
- 本轮真实页面验收创建的临时会话 `interview-session-6f9d8f50-602d-4651-a78d-59cba05b4e69`（5 消息、2 决定、1 草稿、0 正式任务）已按精确 ID 在单事务中清理，复查 remaining=0；未删除或修改用户既有正式任务。API/Web 已停止，4000/6173 监听均为空。
- 开发端口复验：宿主权限执行 `npm run dev:stop` 能一次释放 4000/6173；随后 API 以 Node watch 启动，触碰入口文件后旧 PID 退出、新 PID 成功重新监听 4000，Ctrl-C 后 `lsof` 无监听。保留单一 `kill-port-process` 跨平台依赖，不再叠加 watcher、shell 或平台专属清理脚本。
- 默认测试门修正：此前直接 `vitest run` 未加载 `POSTGRES_DATABASE_URL`，会把抓取任务确认/修订集成测试静默标成 skipped。根 `npm test` 现在先确保本地库，再由 Node 24 官方 `--env-file` 直接启动 lockfile 声明的 Vitest CLI；第一次采用 `node --run` 中转的补丁仍会跳过，已删除并重写，不新增依赖。
- 真流式协议验收：本机 `@openai/codex@0.147.0` 稳定生成类型确认 `thread/start.ephemeral`、`item/agentMessage/delta` 和 commentary/final_answer phase；临时生成目录已删除。真实 CLI 探针证明带 `outputSchema` 时 commentary 也是 JSON，移除后正常中文按 token 到达，final_answer 仍能被 JSON/Zod 校验。
- 真实 Codex 直连验收：`gpt-5.6-terra + medium` 的冰箱首轮连续产出中文 `text_delta`、多个 `web_search` activity，并最终返回通过业务 schema 的京东范围问题；进程正常退出。
- 真实 Workbench 浏览器验收：新建“电饭煲”任务后，8 秒内已有连接/启动/分析及 elapsed 状态，随后出现逐 token 中文气泡与真实搜索活动；本轮完成后显示结构化三选一京东问题，console error/warn 为 0。验收产生的精确临时 session `interview-session-5a47a5b8-b9f4-4c70-bd16-8734bc723604` 已在单事务中删除其 1 session、2 messages、1 decision、2 unresolved items，复查 remaining=0；未改用户既有正式任务。

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

下一步第一动作：用户重新启动 Workbench，验收真实中文流、活动列表、负责人选项和任务草稿；随后单独讨论采访问题颗粒度与 Skill 的追问设计，本轮没有修改 Skill。

本轮架构影响：改变外部运行 seam，但不改变领域事实源。Codex 入口由 `exec --ephemeral --json --output-schema` 改为版本锁定的 App Server `stdio`＋`thread/start(ephemeral:true)`；公共 SSE contract 不变，`assistant.delta` 现在来自真实 commentary delta。Workbench 仍是唯一产品会话/任务事实源，没有持久 Codex thread、第二 Provider 或 fallback。

HARD STOP：1A 未人工验收前，不实现 Crawl Plan，不访问真实来源，不调用清洗/Evidence/知识加工链。

## 9. Git 状态

- 仓库：`/Users/guojunxi/Desktop/work/domain-analysis`
- 分支：`master`
- 起始 HEAD：`22625c3f1e0ec3b954934e3ca2afa76db3a9acfd`
- 当前变更仅在本机，未 commit、未 push，尚未形成跨电脑接续点。
