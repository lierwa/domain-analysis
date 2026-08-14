# 技术调研与开源方案决策登记

状态：持续维护
更新日期：2026-08-14

## 1. 强制流程

涉及架构、技术选型、新基础能力或公共 interface 时，按以下顺序执行：

1. 定义产品问题和不可取消的约束；
2. 检索官方文档、官方仓库和成熟开源实现；
3. 登记候选、许可证、维护状态、Node/TypeScript 支持、部署与安全成本；
4. 设计针对本项目真实风险的最小原型；
5. 记录实测证据、失败和退出成本；
6. 标记为接受、拒绝或继续调研；
7. 只有已接受候选才能进入正式架构；难以反转的决定再写 ADR。

禁止“先实现自研版本，再证明开源方案不好用”。

## 2. 状态定义

- `待调研`：问题已登记，尚未完成官方资料核验。
- `调研中`：已有候选和资料，尚未完成真实原型。
- `待确认`：证据充分，等待人工接受决策。
- `已接受`：可以进入正式架构和实现。
- `已拒绝`：记录明确不适用原因和证据。
- `已替代`：历史决定被新决定取代，保留迁移说明。

“候选”不等于“已接受”。

## 3. 统一评估维度

每项候选至少评估：

- 与 PRD、总体技术方案和阶段停止门的符合度；
- 开源许可证和商业使用约束；
- 官方维护活跃度、版本稳定性和社区成熟度；
- Node/TypeScript interface 和类型质量；
- 本地、离线、跨机器和未来 2 核 4G Runtime 适配；
- 外部服务、数据库、队列、容器和原生二进制依赖；
- 崩溃恢复、幂等、人工信号、可观测性和测试能力；
- Cookie、原始资料、模型输入和知识包安全边界；
- 引入、升级、迁移、替换和退出成本；
- 与现有 Fastify、React、Zod、Drizzle、SQLite、Crawlee 的集成复杂度。

## 4. 调研队列

### R-001 京东访问合规与浏览器自动化诊断

状态：已替代（合规结论保留；采集路线由 ADR-0004/R-012 取代）
目标阶段：1A

问题：京东资料应通过什么获准入口进入系统；“PC频控页”是否足以证明访问过快；本机 Chrome 在 Playwright 控制下暴露哪些自动化信号。

当前事实与证据：

- 2026-01-20 生效的《京东用户服务协议》规定，除法律允许或京东书面许可外，不得复制其知识产权内容、复制/修改网站交互数据，或通过非京东授权的第三方软件、插件、系统登录和使用服务；普通账号登录成功不等于获得系统化采集授权。
- 京东宙斯开放平台提供应用、OAuth2、API 网关、权限申请和商品 API；京东联盟公开商品查询/推广商品信息 API。它们是候选合规入口，但需要 app key、授权和具体权限，且当前公开字段不能证明覆盖完整家电规格。
- 2025 年修订的《反不正当竞争法》第十三条禁止以避开或破坏技术管理措施等不正当方式获取、使用其他经营者合法持有的数据；因此风控出现后实现指纹伪装、验证码绕过或未公开接口回退不进入候选。
- 京东隐私政策公开说明其为识别真实自然人和异常行为会使用设备、系统/软件、网络、日志、IP、浏览与操作等多类信号；具体网页风控规则不公开，不能声称已知道京东使用了哪一项。
- 本地纯空白页差分证明：Playwright 控制本机 Chrome 时，有头与无头模式的 `navigator.webdriver` 均为 `true`；无头模式另有 `HeadlessChrome` User-Agent。有头真 Chrome 因此仍明确暴露自动化控制，但现有证据不能证明京东只靠这一项拦截。
- 本轮没有开始批量提取商品数据，但确实发生了有界页面导航。已保存的 7 次样本导航各自加载 12～117 个资源；“打开一次页面”不是“一次 HTTP 请求”。这可以解释风控为何可能在抓取前出现，但“PC频控页”仍只是京东的风险响应分类，不是高频原因的证明。
- Crawlee 3.18.1 的 RequestQueue、恢复和 Playwright-compatible launcher 已通过隔离原型；Patchright 1.61.1 可作为 `launchContext.launcher` 复用本机 Chrome，不自研队列、浏览器或滚动器。自动化 Profile 与日常 Profile 必须隔离。
- Crawlee 3.16 经 `file-type 20.5.0` 带入中危拒绝服务公告且恢复进程不能正常退出；官方 3.17/3.18 已有对应修复。R-001 隔离升级到 3.18.1 后 audit 为 0 且两段式恢复通过，根生产依赖未顺手升级。

官方资料：

- https://help.jd.com/user/issue/945-4583.html
- https://jos.jd.com/doc/channel.htm?id=808
- https://jos.jd.com/jdunion
- https://help.jd.com/user/notice/detail-68f1de19e4b04df9580dcd25.html
- https://www.npc.gov.cn/npc/c2/c30834/202506/t20250627_446247.html
- https://www.w3.org/TR/webdriver1/
- https://playwright.dev/docs/browsers

历史结论：`rate_limited` 更正为 `risk_controlled`，且当时停止京东网页访问。用户随后明确改走教育研究网页采集，当前决定见 ADR-0004/R-012；本节不再定义执行路线。

### R-002 可恢复流水线编排

状态：已接受（产品/领域口径；生产来源枚举属于阶段 1A）
目标阶段：2

问题：如何支持多阶段执行、崩溃恢复、长时间等待、人工信号、取消、重试、幂等和可观察历史，同时保持本地部署复杂度可接受。

候选：

- Restate Workflow：单二进制、TypeScript SDK、durable promise 和人工信号；
- Temporal TypeScript SDK：成熟 durable execution、Signal、Update 和 Workflow 测试；
- 现有数据库状态＋任务执行器只作为对照基线，不默认允许扩展成自研工作流引擎；
- BullMQ 只解决任务队列，不能单独满足完整人机协同流水线。

官方资料：

- https://docs.restate.dev/tour/workflows
- https://docs.restate.dev/develop/ts/services
- https://docs.restate.dev/develop/ts/testing
- https://docs.temporal.io/develop/typescript/workflows/message-passing
- https://docs.temporal.io/develop/typescript/best-practices/testing-suite
- https://docs.temporal.io/cli/command-reference/server

必须原型验证：

- 本地安装和启动成本；
- 进程和编排器重启后的恢复；
- 登录等待、审核等待和发布批准信号；
- 同一输入幂等、阶段重试、取消和版本升级；
- 测试隔离、时间跳跃、可观察历史；
- 开发机和目标 Linux 环境的资源消耗。

尚未决策。不得继续扩展 `p-queue + setInterval` 为自研正式编排器。

### R-003 知识包结构化存储与全文检索

状态：调研中（质量分层已确认；工具选型仍需原型）
目标阶段：1C、5

问题：如何用可复制、离线、只读、可验证的包同时支持结构化筛选、关系查询、全文检索和证据返回。

候选：

- SQLite＋FTS5，单文件同时保存结构化数据和全文索引；
- DuckDB Node Neo＋Orama，结构化分析和全文索引分离；
- DuckDB 自带全文扩展，需验证扩展的离线可用性和 Node 打包。

官方资料：

- https://www.sqlite.org/onefile.html
- https://www.sqlite.org/fts5.html
- https://duckdb.org/docs/lts/clients/node_neo/overview
- https://docs.orama.com/docs/orama-js

必须原型验证：

- 中文、型号、别名和短字符串检索；
- 精确查询、组合筛选、排序、关系和证据联查；
- 由 R-008 生成的版本化验收集及放大数据集的大小、构建时间和查询延迟；
- macOS 构建后复制到 Linux 或另一台机器加载；
- 只读打开、校验、版本切换和回滚；
- 无网络条件下不下载扩展、不调用模型或 embedding。

当前倾向：先用 SQLite FTS5 做最小对照原型，因为单文件可降低包内双存储复杂度；该倾向不是已接受决策。

### R-004 Workbench 数据库与迁移

状态：已接受（领域 contract 与 1A 可行性；完整多品牌总体留到阶段 3）
目标阶段：0、2

问题：如何继续利用 Drizzle＋SQLite/libSQL，同时替换当前手写 DDL 和 schema 双重事实源，建立可测试的正式迁移流程。

当前代码事实：

- `packages/db/src/schema.ts` 已定义 9 张表及索引，repository 全部通过该 schema 使用 Drizzle。
- `packages/db/src/client.ts` 的 `initializeDatabase()` 又维护了一份约 170 行 `CREATE TABLE IF NOT EXISTS` 手写 DDL；API 启动和所有数据库测试都调用这份 DDL。
- 两份事实已经出现漂移：手写 DDL 把 `sources.platform` 声明为 `UNIQUE`，Drizzle schema 没有相同约束。
- `packages/db/drizzle.config.ts` 已配置 schema、SQLite dialect、数据库 URL 和输出目录；db workspace 已有 `drizzle-kit generate` script。
- 当前没有 `drizzle/` migration 产物、`migrate` script 或 `__drizzle_migrations` 历史；已安装版本为 `drizzle-orm@0.32.2`、`drizzle-kit@0.23.2`、`@libsql/client@0.7.0`。

候选：

- Drizzle Kit `generate`＋`migrate`：由 TypeScript schema 生成版本化 SQL，并由官方 migration log 判断待执行项；当前项目已经安装和配置，无需引入新库。
- Drizzle ORM 的 libSQL migrator：复用同一批 Drizzle migration，在应用启动时执行；是否优于显式 CLI migration 需要用本地启动和失败恢复原型验证。
- `@libsql/client` 继续只承担数据库 driver，不把 `executeMultiple` 扩展成自研 migration manager。
- `drizzle-kit push` 只作为临时 schema 试验对照，不作为需要版本历史和升级审计的正式流程。

官方证据：

- Drizzle 明确把 TypeScript schema 作为查询和 migration 的事实源：https://orm.drizzle.team/docs/sql-schema-declaration
- `drizzle-kit generate` 会比较 schema 与上一份 snapshot 并生成 SQL migration：https://orm.drizzle.team/docs/drizzle-kit-generate
- `drizzle-kit migrate` 会读取 migration 文件、查询已执行历史、只执行未应用项并写入 migration log：https://orm.drizzle.team/docs/drizzle-kit-migrate
- 官方 SQLite/libSQL 指南同时给出 `generate`＋`migrate` 流程：https://orm.drizzle.team/docs/get-started/sqlite-new
- 当前项目的 Drizzle ORM 0.32／Kit 0.23 组合来自同一官方 release，已具备相关命令：https://orm.drizzle.team/docs/latest-releases/drizzle-orm-v0320

当前倾向：选择项目已有的 Drizzle Kit/ORM migration 能力，让 `schema.ts` 成为单一结构事实源；删除手写 DDL 只能在生成的初始 migration、空库、旧 DDL 库和测试库全部验证后进行。该倾向不涉及升级 Drizzle 版本。

#### R-004 隔离原型方案

Baseline Impact：

- touched modules：仅 `packages/db` 的 migration 产物、初始化 seam 和 migration contract test；
- owning fact source：`packages/db/src/schema.ts`；
- public interface changed：原型阶段否；
- new protocol/adapter/fallback：否，直接使用现有 Drizzle migration；
- compatibility or legacy path changed：原型阶段否；
- dependency change：否；
- tests and real-surface validation：隔离 SQLite 文件、db/API tests、全量 test/typecheck/build。

输入：

1. 当前 `schema.ts`；
2. 一个全新临时 SQLite 文件；
3. 一个由当前 `initializeDatabase()` 创建的旧 DDL 临时文件，只用于识别切换行为；
4. 当前空的 `data/` 基线。若发现真实用户数据库或业务数据，立即停止，不对其执行原型。

执行对照：

1. 使用项目现有 `drizzle-kit@0.23.2` 从 `schema.ts` 生成初始 migration，不升级依赖；
2. 用 Drizzle Kit CLI `migrate` 应用到空库，并重复执行一次；
3. 用 Drizzle ORM libSQL migrator 对另一空库执行同一 migration；
4. 分别验证 9 张表、索引、外键、默认值和 `sources.platform` 唯一约束；
5. 对旧 DDL 临时库只记录官方 migrator 的真实行为，不自动补写 baseline、repair 或兼容分支；
6. 在隔离库注入一条必然失败的 migration，观察事务、migration log 和 API 启动失败边界；
7. 验证文件备份后迁移、恢复备份和再次启动。

通过门：

- lockfile 和依赖版本零变化；
- migration 产物由 `schema.ts` 生成且进入版本控制，手写 DDL 不再成为第二事实源；
- 空库首次迁移成功，重复迁移不重复执行；
- CLI 与 libSQL migrator 对 schema 和 migration log 的结果一致，随后再按本地直接启动体验选择一个正式入口；
- 失败 migration 不得让 API 带着未知 schema 继续启动；部分提交、回滚和恢复结果有测试证据；
- 现有 52 个测试、类型检查和构建继续通过，并新增 migration contract test。

停止条件：

- 工具要求升级依赖、重建 lockfile 或引入新 migration 库；
- 发现真实用户库、非空业务数据或无法验证的旧 schema；
- 官方 migrator 无法满足失败可见、重复执行或 migration log 需求；
- 旧库切换需要自研 baseline/repair 机制。出现任一项都停止并向用户提交证据和候选，不自行实现兼容基础设施。

原型完成前保持“调研中”，不得先改 `initializeDatabase()`，也不得生成或应用真实数据库 migration。

### R-005 Codex CLI 接入与结构化知识加工

状态：已接受
目标阶段：1B、4

已确认产品边界：MVP 复用用户本机已登录的 Codex 能力，不接通用模型 API，不要求本地推理服务。该决定见 `docs/adr/0001-codex-cli-as-knowledge-processor.md`。

官方与本机证据：

- OpenAI 官方 Codex SDK 文档说明 TypeScript SDK 用于以编程方式启动、继续和恢复本地 Codex thread，并支持结构化结果：https://developers.openai.com/codex/sdk
- OpenAI 官方 SDK 仓库说明 `@openai/codex-sdk` 封装 `@openai/codex` CLI，通过 JSONL 交换 structured events；SDK 已提供 `runStreamed()`、`outputSchema`、图片输入、线程持久化、工作目录和环境控制：https://github.com/openai/codex/tree/main/sdk/typescript
- OpenAI 官方非交互文档确认底层 `codex exec` 可复用已保存登录，支持 JSONL、JSON Schema、sandbox 和 session resume：https://developers.openai.com/codex/noninteractive
- npm 包元数据确认 `@openai/codex-sdk@0.147.0` 为 Apache-2.0，要求 Node.js 18 以上，并精确依赖同版本 `@openai/codex`。
- 本机全局 `codex --version` 返回 `codex-cli 0.144.5`；`codex login status` 返回 `Logged in using ChatGPT`。SDK 使用其官方依赖的 CLI 0.147.0，真实调用仍成功复用了现有登录。
- 当前 `master` 已有 `analyze`/`report` job、API/UI 流程和 placeholder，但在本次依赖接入前没有 Codex 调用。

最小原型：

- 在 worker workspace 精确锁定 `@openai/codex-sdk@0.147.0`，不使用浮动版本表达能力边界。
- 使用 `sandboxMode: read-only`、`approvalPolicy: never`、禁用网络和 Web 搜索启动 thread。
- 使用 JSON Schema 约束结果为 `{status: "ok", message: string}`，调用成功返回 `{"status":"ok","message":"Codex SDK connected."}`，并收到 2 个 structured item。
- 原型没有读取或复制认证文件，没有把 Cookie、认证 Header 或浏览器 Profile 放入任务。

结论：

- 接入实现选用 OpenAI 官方 `@openai/codex-sdk`；它是当前需求下最合适且维护边界最清晰的官方实现。
- 定义领域中立的 `CodexExecutionPort`，由薄 `CodexSdkAdapter` 实现；SDK event 和 thread 类型不得泄漏到领域 module。
- 禁止用 `child_process`、Execa、自写 JSONL parser 或自建 session 层重复实现 SDK 已提供的 CLI 启动、事件解析、线程继续与结构化输出能力。
- JSON Schema 负责执行出口约束，项目已有 Zod 负责领域 contract 与证据规则；两者职责不同，不互相替代。

正式进入知识加工流水线前仍须验证：图片输入、并发限制、超时与取消、进程崩溃后的 thread 恢复、版本变化、费用/额度错误、证据引用、人工否决和认证隔离。上述验证影响 adapter contract 和运行策略，不改变已接受的官方 SDK 选型；若 SDK 缺失必要能力，必须重新进入调研并请用户决定，不得补写自研 CLI 基础设施。

### R-006 原始资料不可变存储

状态：待调研
目标阶段：1A

问题：如何原子保存 HTML、JSON、图片、截图和资源清单，生成哈希并支持重放，同时让认证状态与可发布证据保持隔离。

候选方向：

- 本地文件系统不可变快照目录＋控制库元数据；
- 成熟内容寻址存储库；
- 嵌入式数据库 Blob 仅作为对照，不默认采用。

必须验证：部分写入恢复、原子提交、重复资源、内容哈希、目录迁移、磁盘增长、备份恢复和发布清理。

尚未决策。

### R-007 依赖可复现性与安全升级

状态：待调研
目标阶段：发布前独立治理，不阻塞当前阶段 0 架构工作

问题：当前锁文件可以安装、测试和构建，但 npm 报告锁文件修复提示及多条依赖安全告警；后续如何在独立分支和独立验证范围内治理，而不干扰已工作的产品工程基线。

当前证据：

- 多次 `npm ci` 均成功，但 npm 提示 `invalid or damaged lockfile detected`；verbose 日志将提示定位到旧锁文件中 `node-fetch` 的 3 个空元数据节点。现有 test/typecheck/build 不受影响。
- 接入官方 Codex SDK 后，`npm audit` 报告 37 项：1 low、19 moderate、14 high、3 critical；`npm audit --omit=dev` 报告 24 项生产依赖风险：14 moderate、10 high。
- 生产依赖链涉及 Drizzle ORM、Fastify/find-my-way、Crawlee/file-type、AJV、WebSocket 等；完整审计还包括 Vite/Vitest、concurrently/shell-quote 等开发工具链。
- npm 对多个问题建议跨大版本升级，不能把 `npm audit fix --force` 当作经过验证的方案。

候选处理方式：

- 逐一核对直接依赖的官方安全公告、修复版本、迁移指南和当前维护版本，再按影响面拆分升级；
- 对仅由传递依赖导致且上游已有兼容修复的项，优先升级直接依赖，不长期堆叠无依据 override；
- 只有上游尚未发布修复且风险可被明确隔离时，才记录临时缓解、上游 issue 和删除条件。

本轮处置：不升级现有依赖，不重建 lockfile，不切换 Node 版本，不删除已有平台依赖。此前尝试的 Node 24、Rollup 平台依赖和 npm 11 lockfile 调整已全部回退；当前 lockfile 相对原提交只保留已接受的官方 Codex SDK 新增项。

未来独立治理时必须验证：先固定独立变更范围和回退点；测试、类型检查和构建全部通过；生产依赖告警逐项有可追踪结论；关键升级覆盖 API、数据库、worker 和 Web 的真实启动或 contract 测试。

尚未决策升级组合，当前不进入执行顺序。禁止直接运行 `npm audit fix --force`，也禁止为了压低数量而添加无调查依据的 override。

### R-008 数据驱动商品知识模型、引导访谈与验收集生成

状态：调研中
目标阶段：0、1

问题：如何让不掌握商品分类和属性标准的知识项目负责人，只表达品类、市场、知识用途和业务取舍，由系统基于稳定商品知识模型、共享属性字典和版本化品类数据生成采集范围、知识约束与验收方案；同时避免自研模板语言、让用户手工设计字段，或用无依据的固定样本数代替质量设计。

用户已明确的不可取消约束：

- 冰箱只是“商品”的一个品类，系统必须有相对固定的商品知识骨架，不能每次从零临时定义，造成结构和结果不稳定；
- 换成电视、微波炉等品类时必须极低成本迁移；品类差异不得变成新的生产 Schema、数据库列、TypeScript 类、Runtime API 或通用流程分支；
- 知识项目围绕可复用商品知识资产，而不是围绕一个“目标 Agent”；同一知识包需要被多个 Agent/Skill 使用；
- 专业差异必须来自清洗后的规格、功能、机制、适用条件、取舍、需求映射、比较维度和证据，不能只收参数或依赖通用模型已有知识；
- 首轮覆盖目标是目标市场中大多数主流品牌和型号；来源只取品牌官网/说明书、平台官方自营、经核实品牌官方旗舰店和监管/标准资料，不以普通第三方卖家数量换覆盖率；
- 产品应像 `grill-with-docs` 一样，通过引导式访谈澄清本次搜集和知识用途，但商品知识访谈需要比普通表单承担更多专业判断；
- 用户不负责凭专业知识给出各品类属性、覆盖率或样本量，也不能被要求对没有证据的数字拍板；
- 所有通用建模、约束、表单生成和抽样能力继续遵守开源优先，确无适合实现时必须停下请用户决定。

当前代码事实：

- 现有 `AnalysisProject` 只有 `name`、`goal`、`language`、`market` 和默认数量；`CollectionPlan` 只有 Reddit 平台、包含/排除关键词、周期和批次上限。
- 当前 UI 和 API 能复用项目、计划、运行、暂停/恢复和阶段展示骨架，但没有稳定商品知识模型、共享属性字典、数据化品类定义、基于用途的引导访谈或有依据的验收集生成能力。
- 旧 Reddit 关键词和固定批次模型不能提升为商品知识需求模型。

官方标准与成熟开源证据：

- Stanford Protégé《Ontology Development 101》建议先明确领域、用途、使用者和知识库必须回答的 competency questions，并明确优先复用已有本体；问题集是限制知识范围和后续验证是否足够的依据：https://protege.stanford.edu/publications/ontology_development/ontology101.pdf
- Schema.org 已区分 `ProductModel`、`ProductGroup`、`Product`、`Offer` 和扩展属性，证明商品型号、变体与具体销售要约不应混成一个对象：https://schema.org/ProductModel 、https://schema.org/Offer
- Schema.org `additionalProperty` 使用 `PropertyValue` 表达没有专用词汇的商品特征，同时要求已有专用属性时优先复用，支持“稳定公共语义＋可扩展属性”：https://schema.org/additionalProperty
- GS1 GPC 提供跨市场的商品分类共同语言、层级、Brick 和属性；标准仓库保留版本与归档：https://ref.gs1.org/standards/gpc/ 、https://www.gs1.org/standards/gpc/get-started
- ETIM 用产品组、产品类、特征、值、单位和同义词描述技术商品，每个类绑定自己的技术特征：https://www.etim-international.com/classification/model-information/
- Akeneo PIM Community Edition 是可参考的成熟开源 PIM；其 Family 本身就是产品模板，Family 管理属性和完整性，Family Variant 管理公共属性、变体层级和变体轴：https://github.com/akeneo/pim-community-dev 、https://help.akeneo.com/en_US/serenity-discover-akeneo-concepts/23-serenity-what-is-a-family 、https://help.akeneo.com/serenity-what-about-products-with-variants
- Pimcore 官方文档将 Classification Store 定义为类似 key/value 的动态属性容器，并明确可在不改变产品类定义时处理品类专用属性；其 Object Bricks 对比也说明大量品类/属性场景适合 Classification Store：https://docs.pimcore.com/platform/Pimcore/Objects/Object_Classes/Data_Types/Classification_Store/ 、https://docs.pimcore.com/platform/next/Pimcore/Objects/Object_Classes/Object_Bricks_vs_Classification_Store/
- LinkML 是 Apache-2.0 的开源数据建模框架，支持继承、枚举和约束，并能从 YAML 模型生成 JSON Schema、TypeScript、SHACL、文档和关系图；它是“不自研模板语言”的候选，不是已接受技术：https://linkml.io/ 、https://github.com/linkml/linkml
- `react-jsonschema-form` 能直接从 JSON Schema 生成 React 表单，是“不自研通用 schema 表单引擎”的候选：https://rjsf-team.github.io/react-jsonschema-form/docs/
- NIST 说明比例抽样数量必须由置信度、允许误差、预期缺陷率和统计功效推导，分层时需逐层设计；因此“50 个型号”不是普适验收依据：https://itl.nist.gov/div898/handbook/ppc/section3/ppc333.htm 、https://itl.nist.gov/div898/handbook/prc/section2/prc242.htm
- NIST ACTS 的 covering array 用因素和值的组合覆盖生成小而有效的测试集，可用于品牌、页面状态、变体、信息载体和异常类型的组合场景覆盖；它不能替代统计抽样，但可避免随意挑异常样本：https://csrc.nist.gov/csrc/media/Projects/automated-combinatorial-testing-for-software/documents/SP800-142-101006.pdf

许可证、维护与分发边界：

- LinkML 为 Apache-2.0；本轮隔离验证使用 `1.11.1`。RJSF 为 Apache-2.0，本轮使用 `6.5.3`；仓库持续发布且已有大量生产使用案例。
- `json-schema-to-typescript` 为 MIT，本轮使用 `15.0.4`；它只承担从 JSON Schema 生成 TypeScript 声明，不成为运行时事实源。
- `allpairspy` 为 MIT，本轮使用 `2.5.1`；项目明确说明生成结果不保证全局最小，但能提供 pairwise/n-wise 覆盖与约束过滤。`statsmodels` 为 BSD-3-Clause，本轮使用最新稳定版 `0.14.6`。
- 两个 Python 库当前只作为方法与数值基准，不是生产运行时决定。TypeScript 调研发现 stdlib.js（Apache-2.0）提供 beta quantile 等可靠统计原语，但没有完整的比例样本量策略；自行拼装统计过程会违反“不自研通用能力”。微软 PICT 是成熟 MIT 组合工具，但现成 Node/WASM 包是非官方且采用量很低。生产 runtime 选型仍是停止门，不能因原型成功擅自引入 Python、WASM wrapper 或自写算法。
- ETIM 分类模型使用 ODC Attribution 1.0，可在保留署名和许可证通知的前提下共享、修改和制作衍生数据库；模板引用或随包分发前仍需建立第三方声明清单：https://www.etim-international.com/classification/license-info/
- Schema.org 词汇使用 CC BY-SA 3.0；引用其术语需要保留署名和相同方式共享要求：https://schema.org/docs/terms.html
- GS1 GPC 虽可公开浏览和下载，但 GS1 标准免责声明与 IP FAQ 没有给出足以支撑本产品再分发 GPC 数据集的宽松开源许可。当前只允许引用概念或外部版本，不把 GPC 内容内嵌进模板或知识包，直至许可证经明确核准：https://ref.gs1.org/gs1/standards-disclaimer/ 、https://www.gs1.org/docs/gsmp/GS1_IP_FAQ.pdf

候选产品结构（2026-08-14 已确认方向，正式组件仍待验证）：

1. **稳定商品知识模型**：定义商品型号、产品组/变体、Offer、品牌、标识符、属性结论、专业知识结论、来源对象、时点信息、证据和结论状态；任何品类共用。
2. **共享属性字典**：维护可跨品类复用的属性身份、含义、值类型、单位、别名和核准外部映射。
3. **品类知识定义**：只以版本化数据选择共享属性、来源策略、决策维度和能力问题；冰箱不是子类或生产 Schema。
4. **用途配置**：使用 competency questions 表达“这份知识要支持什么判断”，决定哪些知识层、新鲜度和风险重要；它不创建字段或 Schema。
5. **引导访谈**：Codex 根据品类定义和问题缺口追问业务意图、风险与冲突处理偏好；系统给出有证据的默认建议，用户不手填专业字段矩阵。
6. **派生计划**：从品类定义、用途配置和可审计总体派生采集计划、加工约束、质量检查和验收设计。

候选验收设计（尚待用户确认）：

- **范围覆盖**：相对于版本化模板与明确的候选总体/发现台账报告覆盖、排除、不可访问和未知，不声称无法证明的“京东全量”。
- **场景覆盖**：把品牌层级、产品/变体层级、页面状态、文本/图片载体和异常类型作为因素，使用 covering array 或等价成熟工具生成组合场景。
- **质量抽样**：先用小规模试采估计缺陷和差异，再按用户能理解的风险等级映射到置信度与允许误差，由统计方法计算样本量并显示理由；不让用户直接发明样本数。
- **能力验收**：以用途配置中的 competency questions 验证知识包是否能回答目标问题，并验证证据、离线查询、恢复和版本行为。

2026-08-14 隔离原型与纠偏：

- 原型位于 `docs/development/pocs/r008/`，只新增非生产 LinkML 模型、正确/错误样例和调用成熟库的验证脚本；所有生成物和依赖均位于临时目录，没有修改项目依赖、数据库或业务代码。
- 第一版用 `RefrigeratorModel` 继承公共型号，虽然技术上可表达，但会让每个品类产生新的生产 Schema/代码，已按用户纠正明确拒绝。
- 第二版只保留稳定 `ProductModel`、`AttributeClaim`、`ProductKnowledgeClaim`、`Offer` 和证据结构；冰箱与电视各自是 `CategoryKnowledgeDefinition` 数据，由同一个 Schema 校验。电视文件只验证迁移结构，不证明电视知识字段专业或完整。
- LinkML `1.11.1` lint 和 metamodel validate 均为 0 问题；正确用途说明通过，错误样例因空用途、空问题集、错误枚举和错误时间被拒绝。
- LinkML 原生 TypeScript generator 在该模型上把多值枚举、枚举范围和 decimal 降级为不正确的 `string`，因此明确拒绝该生成路径。`LinkML → JSON Schema → json-schema-to-typescript@15.0.4` 能保留枚举 union、非空数组和 required/optional 约束，是继续验证的单一事实源候选。
- RJSF `6.5.3` 从生成的 JSON Schema 成功渲染 10,907 字节 HTML，包含核心必填项和枚举；但默认也展示 ID、模板版本等内部字段。产品交互候选因此是“Codex 引导对话＋RJSF 结构化回顾/修改”，并通过独立公开表单 schema 或 `uiSchema` 隐藏内部字段，而不是自研表单或把技术表单直接交给用户。
- `allpairspy==2.5.1` 将 5 个因素、324 个全组合压缩为 16 个场景，并经独立断言确认覆盖 102/102 个值对。NIST 同时明确 pairwise 并非所有风险都足够，因此二阶只能作为平衡风险的默认候选，更高风险需由需求和试采证据决定是否提升至三阶或更高。
- `statsmodels==0.14.6` 根据四组示例置信度、预期成功率和允许误差算出 25、73、457、165 个样本；59/59 全部成功时，Clopper–Pearson 单侧 95% 成功率下界约为 95.05%。这证明质量目标可以计算，也证明“固定 50 个型号”没有普适含义。

原型后的候选结论（待用户以真实使用确认）：

1. 用户只说明知识主题、用途、来源许可、新鲜度和业务风险；不输入“目标 Agent”、字段表、品牌数或样本数。
2. 系统用稳定商品知识模型＋共享属性字典＋数据化品类知识定义形成专业结构；用途说明只选择重点，不创建新 Schema。
3. Codex 负责像 `grill-with-docs` 一样追问并解释取舍；结构化表单只用于最终回顾和修订。
4. 系统从可证明的候选总体、场景因素、风险等级和小规模试采派生范围报告、组合场景和统计抽检计划，并把公式、参数与理由展示给用户；具体生产运行库必须另过维护性、许可证和单运行时复杂度门。
5. 品类定义和指标必须保留版本与退出路径；冰箱首轮真实试用可以修改候选数据，不能因本原型通过就冻结生产架构。
6. 架构冻结前用第二品类小样本验证生产 Schema、数据库结构、通用 interface、Runtime API 和同来源 Provider 实现零修改。

停止条件：如果真实冰箱资料无法映射稳定模型/数据化品类定义、切换第二品类需要新增品类类或通用流程分支、Codex 仍要求用户回答专业字段、二阶场景漏掉高风险交互、统计目标无法用业务风险解释，R-008 返回调研，不进入生产实现。GS1 GPC 数据分发许可未解决前禁止内嵌；组合/统计生产运行库未解决前禁止自写算法或直接增加 Python/非官方 WASM runtime。

R-008 已完成文档与隔离能力门，并支撑 Q003/Q004 的方向确认；Q005/Q006 的产品口径已确认，实际来源枚举、质量数值和组件仍依赖 R-010/R-011 原型。LinkML、RJSF、ETIM、`allpairspy` 和 `statsmodels` 仍是候选，不是已冻结的生产依赖。

### R-009 首轮来源、登录、对象身份与发布门

状态：调研中（Q007～Q010 产品边界已确认；JD 原始留证已通过，脱敏与异常原型待完成）
目标阶段：0、1A、1C

问题：Q007～Q010 应让用户确认哪些可见产品行为，而不是要求用户设计浏览器会话、对象主键、快照格式或模型审核状态机。

当前代码事实：生产适配器仍只实例化 `CheerioCrawler`；R-001 隔离 POC 已用 `crawlee@3.18.1` 注入 `patchright@1.61.1`，复用本机 Chrome 和专用 Profile 打通 JD 原始留证及公共样本中断恢复。`Source` DTO 预留 `requiresLogin` 和 `playwright` 类型，但该 POC 尚未进入业务代码。数据库虽预留 `rawHtmlPath` 和 `screenshotPath`，当前返回映射不包含两字段；现有 Reddit `RawContent` 也不能直接充当商品型号、SKU、Offer 或不可变快照。

官方依据：

- Schema.org 将厂商 `ProductModel` 与时点销售 `Offer` 分开，同一型号可以对应多个卖家、SKU 和价格；这支持用户看到“一款型号＋多条销售记录”，而非系统把价格差异误判为多个型号：https://schema.org/ProductModel 、https://schema.org/Offer
- Crawlee 的 SessionPool 已提供会话状态、阻断标记和 cookie 持久化；它只用于获准来源的会话管理，不能充当来源授权或反风控手段，项目不得自研会话池：https://crawlee.dev/api/core/class/SessionPool
- Playwright 明确警告认证状态文件包含可用于冒充用户的 cookies/headers，必须本地忽略且按过期策略清理；因此 Codex 任务、知识包和日志均不得接收认证状态：https://playwright.dev/docs/auth
- WARC 是公开维护的 ISO 28500 Web 归档格式，适合把响应和元数据聚合成可重放采集物；是否使用 WARC 仍需在获准官方资料原型中与 Crawlee 存储能力比较，不能本轮直接冻结：https://www.loc.gov/preservation/digital/formats/fdd/fdd000236.shtml
- W3C PROV-O 以 Entity、Activity、Agent 和 `wasDerivedFrom` 等关系表达跨系统来源链；本项目只需映射必要子集，不自研通用 provenance 语言：https://www.w3.org/TR/prov-o/

已确认产品边界：首轮只从品牌官网/说明书、平台官方自营或经核实旗舰店和监管/标准来源发现资料，普通第三方和小型商家排除。用户已选择教育研究用途的京东网页采集，ADR-0004 取代 ADR-0003；技术上不自研反检测、验证码或账号切换。型号、SKU/变体、Offer 和采集快照分层；确定性转换可自动进入发布候选，Codex 推断、冲突和证据不足必须进入例外审核；新知识包发布需明确批准。

尚未冻结登录态受限原始区到脱敏资料区的成熟组件、WARC/现有 Crawlee storage 组合、型号合并规则和审核批次。这些必须经真实资料和隔离原型验证后再冻结。

### R-010 主流品牌/型号总体与覆盖率

状态：调研中
目标阶段：0、1A

问题：如何为“中国市场某商品品类的大多数主流品牌与型号”建立可审计总体、时间窗口和覆盖率，而不是用已抓 URL、店铺数量或任意品牌/型号数字自证完整。

不可取消约束：只统计品牌官网/说明书、平台官方自营或经核实旗舰店和监管/标准来源；普通第三方商家不进入总体发现；用户不负责发明品牌数、型号数或覆盖率门槛。

第一轮官方证据（2026-08-14）：

- 中国标准化研究院集中公开冰箱等 8 类家电能效备案，字段含型号、生产者、能效等级和备案号，并说明定期更新；它适合做身份/合规发现台账，不等同于当前在售清单：https://www.cnis.ac.cn/tzgg/202412/t20241231_59316.html
- 该公告的 2016.08～2024.12 冰箱附件已做只读检查：2024 年五个工作簿包含数千条备案记录和数百个生产者，证实备案总体规模远大于任意手定样本；生产者不是消费品牌，备案也不证明仍在售或主流。公告页面未给再分发许可，原始批量数据暂不进入可分发知识包。
- 市场监管总局 2026 年规则自 6 月 1 日实施，同时允许此前出厂/进口产品延迟两年加施新版标识；因此 `MarketUniverseVersion` 必须记录快照日期和适用标准版本，不能假设市场只有一个能效口径：https://www.samr.gov.cn/xw/zj/art/2026/art_622696c3b0d24421b782e1ffd657dbeb.html
- 京东冰箱自营入口当前公开品牌、筛选维度、型号和“自营”标记，可作为时点在售发现源；它只代表该官方零售渠道，不代表全国销量份额：https://www.jd.com/brand/737a81dda3769f80aa8.html

第一轮候选结论：总体分三层而不是一个抓取列表。`合规身份台账` 取监管备案；`官方在售总体` 取品牌官网/说明书、官方自营和核实后的官方旗舰店在同一快照窗口的并集；`市场优先级` 只有获得许可证清晰、可审计的销量/份额数据后才能加入。MVP 先报告 `brand_discovery_coverage`、`active_model_discovery_coverage` 和 `knowledge_complete_coverage`；没有授权市场份额数据时禁止声称 `market_share_weighted_coverage`。

预期产物：`MarketUniverseVersion` 记录市场、品类、快照日期、渠道、来源版本、标准版本、品牌/型号集合、纳入/排除/未知原因；型号身份以生产者型号＋品牌映射＋证据为主，Offer/卖家不构成新型号。用户已确认采用“可审计官方在售总体覆盖”，而不是无法举证的销量加权“大多数”；旗舰店仍须逐个举证，市场数据没有许可时继续关闭优先级。

第二轮调查与隔离原型（2026-08-14）：

- 京东帮助中心明确商品页“自营”标识可区分自营与第三方；授权店铺规则说明品牌店铺依赖商标和授权文件。因此自营可用平台标识确定，旗舰店名称本身不是充分证据，必须另有品牌官网反链、平台商家资质或有效授权证据：https://help.jd.com/user/issue/44-75.html 、https://help.jd.com/user/issue/325-2069.html
- 海尔官方支持中心支持按品类/型号查说明书，美的官方商城展示型号、库存和规格；TCL 官方电视目录公开结果数、型号和购买入口。这证明官方目录可参与身份/在售发现，也证明详情成功不等于已完整枚举目录：https://www.haier.com/support/ 、https://www.midea.cn/1/1000000000400692547081.html 、https://www.tcl.com/cn/zh/tvs
- 公开奥维数据和上市公司引用可以支撑行业趋势，但没有提供可构造品牌/型号销量分母的授权明细或再使用许可；按已确认口径保持 `market_priority=pending`，不阻塞官方在售总体，也不计算销量加权覆盖。
- 隔离原型位于 `docs/development/pocs/r010/`。同一 LinkML Schema 已校验冰箱与电视两个 `structural_sample`；lint 和 schema validate 为 0 问题，两份正确样例通过，错误样例因错误日期、非法生命周期和三个空必填列表报告 5 项错误。原型未修改项目依赖、数据库或生产代码。

结论：接受三层市场总体和 `MarketUniverseVersion` 领域 contract；`frozen` 前必须保留来源核验、许可、纳入/排除/未知项，只有 frozen 版本可作覆盖率分母。LinkML 只承担隔离验证，不因 R-010 接受而成为生产依赖。阶段 1A 又用 Crawlee `SitemapRequestList` 真实读取海尔官方 `product.xml`，得到 1,341 个唯一冰箱产品 URL并回链既有样本；用 `FileDownload`＋`file-type` 保存美的说明书和中国标准化研究院备案附件，哈希、签名和表格字段复核通过。目录发现与监管身份台账的可行性已经成立；完整多品牌总体、逐品牌目录适配和旗舰店资质采集属于阶段 3，不把原型扩大成完整生产采集。

停止条件：权威名录与官方目录无法对齐且没有可解释估计方法；型号身份粒度无法稳定定义。市场报告没有许可时关闭市场优先级，不再阻塞官方在售总体；不得自行把公开聚合文章当销量分母。

### R-011 专业商品知识分层与评测门

状态：已接受（质量 contract；生产组件留到阶段 1C 真实知识存储原型）
目标阶段：0、1B、1C

问题：知识资产需要覆盖哪些规格、功能、机制、适用条件、取舍、需求映射和比较维度，才能让专业导购与通用聊天模型拉开差距；如何用成熟方法验证，而不是用无依据固定准确率或问题数。

不可取消约束：知识必须来源可追溯、限定条件明确、冲突可见；专业知识不寄存在单个 Agent 提示词；下游 Agent 的引导工作流与知识资产解耦；用户不承担品类专家的字段和指标设计职责。

官方依据与候选处置（2026-08-14）：

- W3C DQV 将质量拆为 Dimension、Metric、Measurement、Policy 和 provenance，并明确质量依赖消费者用途；本项目复用该质量记录词汇但不引入 RDF。SHACL 专门校验 RDF 图，当前知识包不是 RDF，因此拒绝为采用它新增 RDF/SPARQL：https://www.w3.org/TR/vocab-dqv/ 、https://www.w3.org/TR/shacl/
- Ajv 是 MIT 的成熟 JSON Schema validator，支持 draft-07/2019-09/2020-12；项目已直接依赖 `ajv@8.17.1`，结构门优先复用它，不重复加 validator：https://github.com/ajv-validator/ajv
- Great Expectations 当前为 Apache-2.0，Expectation Suite 支持批次非空、枚举、唯一性等断言；隔离 `1.20.0` POC 可运行，但引入 Python 3.10～3.13 和 35 个隔离包，复杂图关系仍可能需要自定义 Expectation。因此只保留为阶段 1C 表格/SQL 批次质量候选，不先加入 Workbench 依赖：https://docs.greatexpectations.io/docs/core/define_expectations/ 、https://docs.greatexpectations.io/docs/reference/learn/data_quality_use_cases/uniqueness/
- Soda Core 当前主分支已改用 Elastic License 2.0，明确限制把主要功能作为托管服务提供；它不满足本项目开源优先和未来部署退出边界，直接淘汰，不运行 POC：https://raw.githubusercontent.com/sodadata/soda-core/main/LICENSE
- Spectral 为 Apache-2.0 JSON/YAML linter，规则集适合文档风格治理，但复杂规则要求 JavaScript/TypeScript custom functions；它与 Ajv 结构门重叠且不能免除跨记录质量实现，因此本轮淘汰：https://github.com/stoplightio/spectral
- Promptfoo 是 MIT 的 Runtime/Agent 评测候选，支持确定性断言和自定义 JS/TS Provider。最新 `0.122.0` 要求 Node `>=22.22.0`；`0.119.0` 支持 Node `>=20`，但隔离下载超过两分钟无输出后已主动终止。保留配置和 contract，不升级 Node、不安装生产依赖；阶段 1C 必须在受支持 Node LTS 上用当前版本重验：https://www.promptfoo.dev/docs/configuration/expected-outputs/ 、https://www.promptfoo.dev/docs/providers/custom-api/

隔离结果位于 `docs/development/pocs/r011/`。Ajv 正确样例通过，错误样例按预期报告非法知识层、非法状态、空证据、错误时间和错误布尔值共 5 项；它没有发现数组内重复 `claim_id`，证明结构门不能替代批次一致性。Great Expectations 正确 CSV 通过，错误 CSV 以 6 个失败规则拒绝重复 ID、非法枚举、空证据、错误时间和错误冲突标记。两者均未修改项目依赖。

接受的质量 contract：`结构有效性`、`来源与证据完整性`、`身份/属性一致性`、`知识层完整性`、`时效与冲突可见性`是确定性发布硬门；`检索可用性`、`能力问题满足度`、`下游任务效果`使用版本化用例集。模型评分只能补充，不能替代证据和确定性断言。不得自写通用质量引擎；阶段 1C 必须把同一 contract 放到真实 SQLite/DuckDB 候选上，再决定是否需要 Great Expectations。

停止条件：只能评测参数抽取而无法验证功能/机制/取舍；指标无法映射到用户可理解风险；为采用工具必须新增长期运行时、自写大量插件或接受不合适许可证。触发后回到调研，不以“先写个校验器”绕过。

### R-012 京东数据通路与现成开源能力

状态：已接受（隔离 POC 通过首个 SKU；批量与敏感数据门待验证）；目标阶段：1A

问题：官方通路是否收费，以及网页采集、反检测、指纹和私有接口是否已有可复用开源实现。

- 京东联盟公开开通流程未列开户费或 API 调用费，基础商品接口可在审核后使用；但联盟定位是 CPS 推广，关键词等高级接口面向企业会员且公开条件含月订单量大于 3 万。公开商品接口证明可取名称、主图、类目、价格、物流、自营和引单量，未证明覆盖冰箱完整规格：https://news.jd.com/153_1.html 、https://jos.jd.com/jdunion
- VOP/B2B 确有商品详情和大字段接口，但需要企业资料、商务/合同和具体服务许可；公开协议提到“购买的具体服务”且不提供统一价目，费用必须由京东按合作模式报价：https://vop.jd.com/reg/agreement 、https://jos.jd.com/b2b2b
- 官方 SDK 只明确支持 Java/PHP/.NET/Python；Node 候选 `@liuliang520500/jd-sdk` 为 MIT、带类型声明但下载量和维护规模较小，必须先审计和实调，不能仅凭包名进入生产：https://www.npmjs.com/package/@liuliang520500/jd-sdk
- 京东专用 `MarketSpider` 为 MIT/Selenium 且 2025 年仍更新，但只覆盖链接、价格、名称和店铺；README 又限制交流学习并警告封号，不满足本项目商用和深度参数要求：https://github.com/zhangjiancong/MarketSpider
- 通用现成候选包括 Apache-2.0 `Patchright`、Apache-2.0 `fingerprint-suite`、MIT `rebrowser-patches`、MPL-2.0 `Camoufox` 及 MIT `camofox-browser`。它们分别处理自动化泄漏、指纹一致性或引擎级伪装，不包含京东字段提取，也不能授予数据使用权：https://github.com/Kaliiiiiiiiii-Vinyzu/patchright 、https://github.com/apify/fingerprint-suite 、https://github.com/rebrowser/rebrowser-patches 、https://github.com/daijro/camoufox

结论：用户明确选择教育研究网页路线。已精确安装隔离 `patchright@1.61.1`：同一有头持久 Chrome 空白页把 `navigator.webdriver` 从 Playwright 的 `true` 变为 `false`；同一登录 Profile 的 S01 从历史风险页恢复为 HTTP 200 商品页。Crawlee 3.18.1 已保存 HTML、文本、截图、脱敏资源路径和匹配哈希；首次骨架屏假成功已由目标文本门纠正，公开样本先处理 1 条、重启补齐 2 条并正常退出。S05 当次正常加载，S06 正确标记为 `discontinued`；未登录新 Profile 当前进入登录页。不叠加 fingerprint-suite/Camoufox，除非 Patchright 出现可复现缺口。

### R-013 受限快照的可加工资料门

状态：已接受（隔离 POC 通过）；目标阶段：1A、1B
问题：怎样确保登录态整页 HTML 中的账户/地址个性化内容不进入 Codex 和知识包。
结论：Microsoft Presidio 官方明确自动检测不保证找全敏感信息，中文又需额外 NLP/识别器，不作为主门：https://github.com/microsoft/presidio 、https://microsoft.github.io/presidio/installation/ 。选择已在工程依赖链的 Cheerio CSS 选择器白名单投影＋Zod 严格未知字段拒绝：https://cheerio.js.org/docs/basics/selecting/ 、https://v3.zod.dev/ 。S05/S06 实测投影 34/26 个商品属性，不携带整页原文或已知个性化容器；决策见 ADR-0005。

### R-014 混乱资料加工与证据化候选知识
状态：调研中（确定性抽取与 Codex 首轮通过，身份隔离/冲突 fixture/发布门待验）；目标阶段 1B；开源比较、实测与剩余门见 `pocs/r014/README.md`。

## 5. 新调研条目模板

```text
### R-XXX 标题
状态：待调研 | 调研中 | 待确认 | 已接受 | 已拒绝 | 已替代
目标阶段：

问题：
不可取消约束：
候选：
官方资料：
许可证与维护状态：
最小原型：
验证结果：
风险与退出成本：
结论与确认人：
```
