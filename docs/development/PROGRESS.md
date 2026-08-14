# Agent 知识生产平台开发进度

这是当前阶段、已验证事实、阻塞项和下一步的单一权威来源。

更新日期：2026-08-14
当前阶段：阶段 2——项目与可恢复流水线骨架（typed contract 与新产品库 migration 已完成，进入 Product Module）
总体状态：阶段 0、1A～1D 全部完成；DBOS、数据库边界、Product/Pipeline contract 和 4 表新产品库已通过；下一步实现草稿保存/确认的深 Product Module

## 1. 当前 Git 与环境基线

- 仓库：`/Users/guojunxi/Desktop/work/domain-analysis`
- 分支：`master`
- 本轮修改前 HEAD：`787597e84ed3fee74ff3e3bc90a0e3c6fb0bde03`
- 本轮修改前本地/上游一致：`HEAD == origin/master`，ahead/behind `0 0`
- Node：`v21.7.3`
- npm：`10.5.0`
- `node_modules`：已通过锁文件恢复；本轮新增并精确锁定官方 `@openai/codex-sdk@0.147.0`
- CodeGraph：已初始化；59 个文件、527 个节点，`codegraph status` 显示索引为最新

Git 信息是 2026-08-14 本地核对结果；Node/npm 基线来自 2026-08-13。新上下文必须重新验证，不能永久当作当前事实。

## 2. 已确认的产品与工程决定

- 继续在现有 `domain-analysis` 仓库上开发，不新建项目或仓库。
- 最新六份产品文档是产品需求、边界和验收输入，不是现成详细架构。
- 工程架构由当前项目真实代码、产品约束和开源调研共同形成。
- 能使用成熟开源方案或官方实现的能力必须优先使用，禁止先自研再调研。
- 任何架构或技术决策必须先记录调研证据，不能凭直觉冻结。
- 开发周期跨多个上下文，仓库文档而不是聊天摘要承担长期事实源。
- 每个非平凡任务必须对应路线图阶段和最终架构目标；局部问题不能脱离架构直接堆补丁。
- 每次开发结束必须更新本文件并记录架构影响；模块职责、事实源、依赖方向或公共 contract 变化时同步更新 `ARCHITECTURE.md`，没有变化时明确记录而不制造文档噪音。
- 跨电脑接续只以已提交并推送的 Git 内容为准；聊天、模型记忆和本机未跟踪文件不算共同事实源。
- 当前阶段只授权阶段 2 的隔离 migration、正式 contract 和最小骨架收敛，不授权无关全面重构。
- 通用能力一律先采用最合适的成熟开源库或官方实现；调研后确无合适方案时必须停下并请用户决定，未经确认不得自行实现替代品。
- 项目自身实现仅限产品特有领域规则、成熟组件的薄 adapter 和已验证组件的流程组装；“MVP 简化版”不能作为自研通用能力的理由。
- MVP 直接复用用户本机已安装并登录的 Codex CLI 完成知识加工，不接通用模型 API，也不要求本地推理服务。
- Cookie、认证 Header 和浏览器 Profile 不进入 Codex 任务；项目不读取、复制或持久化 Codex CLI 的用户认证文件。
- 知识项目围绕可被多个 Agent/Skill 复用的商品知识资产，不围绕单一目标 Agent。
- 所有商品品类共用稳定商品知识模型和共享属性字典；品类差异必须是版本化数据。冰箱不得成为生产 Schema、类、数据库列或 Runtime API。
- 首轮只采品牌官网/说明书、平台官方自营或经核实旗舰店、监管/标准资料；普通第三方与小型商家排除。用户已明确选择教育研究用途的京东网页采集；技术上只组装成熟开源能力，不自研反检测、验证码或账号切换。淘宝作为京东闭环后的下一来源单独调研。
- Tutor 不属于知识库且不作参照；`Perfume` 只可参考下游引导式交互，不能定义本项目知识架构。
- Runtime 使用精确匹配、结构化筛选、全文检索、关系导航、证据/质量状态的查询顺序；向量或语义检索只可作为真实缺口证明后的可选增强。
- 更新按来源和知识变化速度分层，稳定知识与时点信息不强制同频；任何接受的变化生成新快照和新知识包版本，不覆盖历史。
- 本地 Workbench Web 是日常入口，Codex 负责引导，结构化页面负责审核、恢复、差异和发布；CLI 只用于开发、诊断和自动化。
- 采集、Codex 加工、审核、评测和建包留在本机；本地或远程 Runtime 只消费已发布知识包，基础查询不依赖模型、网络或 embedding。
- 当前仓库原地演进并复用工程底盘；旧 Social Intelligence 领域对象、API、UI 和未合并分支不作为兼容目标。

## 3. 已完成并有证据的事项

### 产品资料入库

- `91ec1fb` 已新增六份产品文档和一份历史接续文档，共 7 个文件、1247 行；该提交没有业务代码修改。

### 当前代码只读盘点

- 已核对 monorepo、Fastify、React/Vite、Zod、Drizzle/SQLite、Crawlee、Project/Run/Task、Collection Plan、Raw Content、scheduler 和 worker placeholder。
- 已确认现有领域契约、表、运行编排和 UI 主流程仍被 Reddit/Social Intelligence 语义贯穿。
- 已确认 `clean`、`analyze`、worker `report` 仍为 placeholder。
- 已确认本轮接入前的 `master` 没有 Codex CLI、模型 SDK 或 AI Provider 的真实调用；只有 job、API/UI 状态和 deterministic report 骨架。
- 已确认未合并分支 `origin/codex/analysis-batch-delete-fix` 存在 `AiInsightAnalyzer`、批处理、Zod/证据校验和子进程模式，但实际 Provider 是 Vercel AI SDK＋API Key，不是 Codex CLI。
- 已确认进程内 `TaskQueue` 在进程重启时会丢失 running 任务。
- 已确认 `rawHtmlPath` 和 `screenshotPath` 只是预留字段，当前主流程没有完成原始页面和截图保存。
- 已只读检查两个未合并远程分支；其中浏览器运行、失败分类和恢复代码只作为参考，不视为 `master` 已有能力，也不计划整体合并。
- 已移除 `.env.example` 中当前代码未读取且与 Codex CLI 路径冲突的 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `OPENAI_MODEL`，避免继续暗示需要另配模型 Provider。

### 工程治理和跨上下文文档

- 已以成熟项目规则为母版重建根目录 `AGENTS.md`，移除与本项目无关的专属架构规则。
- 已强化开源优先、调研先于决策、禁止先自研、架构基准和跨上下文 progress 协议。
- 已建立根目录领域词汇表 `CONTEXT.md`。
- 已建立开发文档导航、架构基线、阶段路线图、技术调研登记和本进度文件。
- 已完成 R-004 第一轮只读调研：当前 `schema.ts` 与 `initializeDatabase()` 手写 DDL 是双重事实源且已有约束漂移；候选收敛为项目现有 Drizzle Kit/ORM migration，不新增 migration 库、不升级现有依赖。

## 4. 当前架构状态

以下是提议基线，尚未经过阶段 1 原型冻结：

- 模块化单体 Workbench＋独立只读 Runtime；
- Workbench 控制库、原始资料区、知识包区物理分离；
- Provider、数据搜集板块、来源对象、采集快照和证据引用分离；
- 数据搜集板块运行前必须冻结来源身份、允许用途、访问方式和敏感数据边界；JD Web Adapter 使用 Crawlee＋Patchright＋本机 Chrome，登录态原始页只进受限采集快照区，通过白名单投影和严格 Schema 后才能进入清洗和 Codex 加工；
- Pipeline 阶段、生命周期、任务尝试和人工介入分离；
- Runtime 通用 interface 保持品类中立、消费者中立；
- Knowledge Factory 使用稳定商品知识模型、共享属性字典和数据化品类知识定义；规格、功能、机制、适用条件、取舍与决策维度进入知识包；
- 架构冻结前必须通过第二商品品类迁移门，生产 Schema、数据库结构、通用 interface、Runtime API 和同来源 Provider 实现零修改；
- Knowledge Factory 通过 `CodexExecutionPort` 使用薄 `CodexSdkAdapter`；官方 SDK 在内部驱动 Codex CLI，SDK/CLI 类型不泄漏到领域 module；
- 现有工程底盘保留，旧 Social Intelligence 产品核心重构或淘汰。

SQLite＋FTS5 单文件知识包已按 ADR-0006 接受，京东 adapter 已按 ADR-0004 接受 Crawlee＋Patchright，正式编排器已按 ADR-0007 接受 DBOS。DuckDB、Orama、Temporal、Restate、向量数据库和 Great Expectations 不进入 MVP 当前依赖。

## 5. 决策记录与待人工事项

### B-001 知识加工执行器（已纠正并解决）

用户已于 2026-08-13 纠正执行前提：MVP 不接外部模型 Provider，也不要求本地模型；直接复用用户本机已登录的 Codex CLI。先前“受控外部模型 API”解释无效，已从文档和 ADR 中替换。

本机已验证全局 `codex-cli 0.144.5` 且 `Logged in using ChatGPT`。R-005 已接受官方 `@openai/codex-sdk@0.147.0`：真实 read-only thread 成功复用登录并返回符合 JSON Schema 的结构化结果。图片、并发、超时、取消、恢复和错误分类仍是阶段 1B 的 adapter 验证项。

### B-002 CodeGraph 初始化（已解决）

用户已于 2026-08-13 明确授权，已运行 `codegraph init -i`。初始化生成本机索引和可提交的 `.codegraph/.gitignore`；数据库文件由该规则忽略。

验证：索引覆盖 59 个文件、527 个节点、973 条边，`codegraph status` 返回 `Index is up to date`。该事项不再阻塞后续结构分析。

### B-003 MVP 验收范围

用户已确认目标是覆盖目标市场中某品类的大多数主流品牌和型号，并排除普通第三方卖家；覆盖口径选择“监管合规台账＋官方在售总体＋有许可时才增加市场份额优先级”。原文中的固定数量和准确率不得作为门槛。

影响：产品覆盖口径和质量分层已确认，R-010/R-011 隔离 POC 已完成；实际来源枚举、更新窗口、分层数值门槛和最终工具组合必须在阶段 1A/1C 从真实样本派生。

### B-004 需求基线逐项确认（已完成）

用户要求使用 `grill-with-docs` 完成需求对齐，并要求剩余问题每 8 个一组。2026-08-14，用户先确认 Q005、Q006、Q008～Q013 全部选择推荐 A，随后确认 Q014～Q018 全部选择推荐 A；固定问题树的 18 项产品决定已全部确认。详细审计见 `REQUIREMENTS-ALIGNMENT.md`。

2026-08-14 用户进一步纠正：数据目标是覆盖目标市场中某品类大多数主流品牌与型号，只需要官方直营、经核实官方旗舰店、品牌官网/说明书和监管/标准资料；普通第三方与小型商家无必要。知识价值必须覆盖参数、功能、机制、适用条件、取舍、需求映射和比较，而不是只做规格库。

同日确认最高优先级是低成本跨品类：冰箱只是首个完整 MVP，换电视或微波炉时不得重新造系统。第一版 LinkML `RefrigeratorModel` 子类方向因此被拒绝；R-008 已改为稳定商品知识模型＋共享属性字典＋数据化品类知识定义，并用冰箱/电视两个数据文件验证同一 Schema。该 POC 仍是隔离候选，不是生产组件决定。

用户明确 `opencode-dev` 的 Tutor 不算知识库，不得作为参照物。已确认不从 Tutor 继承任何知识建模、检索或 Runtime 设计；`Perfume` 只保留下游主动提问/工作流参考，知识资产仍通过独立知识包和 Runtime/SDK 交付。

该边界满足难逆转、易被未来误解且存在真实取舍的 ADR 条件，已记录 ADR-0002。官方依据包括 Schema.org `additionalProperty`、Akeneo Family/Variant 和 Pimcore Classification Store；它们证明数据化品类属性有成熟实践，不代表直接引入整套 PIM。

R-010/R-011 已完成产品口径调查和隔离验证：覆盖总体拆成合规身份台账、官方在售总体和有许可的市场优先级；质量门拆成确定性数据硬门与 Runtime/下游任务评测。用户已确认产品口径；R-010 领域 contract 和 R-011 质量 contract 已接受。真实来源枚举、知识存储和当前评测器仍分别留到阶段 1A/1C，不得直接进入生产 Schema、数据库或流水线实现。

最后一批确认同时锁定：结构化/全文优先查询、按变化速度分层更新、Workbench Web＋Codex 引导、本地重生产＋轻量 Runtime、只复用当前仓库工程底盘而不兼容旧社交业务。以上是产品与模块责任基线，不冻结 SQLite/DuckDB/Orama、编排器或最终物理 Schema。

### B-005 京东采集路线（用户改选并已完成首轮验证）

2026-08-14 官方规则和开源方案调研的历史依据保留；用户随后明确改选“教育研究用途的京东网页采集”。ADR-0003 已被 ADR-0004 取代，不再是当前执行门。新路线仍排除普通第三方店铺、自动验证码、账号切换、未公开接口和自研反检测基础设施。

离线同条件对照显示：Playwright 报告 `navigator.webdriver=true`，Patchright 报告 `false`，两者均使用有界面的本机 Chrome。使用 Patchright＋Crawlee、已登录专用 Profile、并发 1 和零重试后，S01 真实商品页返回 200，型号、标题和关键规格进入不可变 HTML/文本/截图/资源清单，哈希复核一致。新建匿名 Profile 到达普通登录页而非风险页，说明当前商品详情仍需人工登录。第一次只抓到页面骨架的假成功已用“型号就绪＋Crawlee 成熟滚动器”纠正。

登录态原始页可含配送地区等个性化数据。JD 原始产物已标为 `restricted`；S05 当次为正常商品，S06 当次正确分类为 `discontinued`。按 ADR-0005 用 Cheerio 白名单投影＋Zod 严格结构门实测得到 S05 34 个、S06 26 个商品属性，输出不含整页正文、账户/地址容器或浏览器材料。公开样本的中断恢复也已通过：先完成 1 条，重启后只补齐剩余 2 条并正常退出。

## 6. 下一步唯一执行顺序

1. 实现深 Product Module：调用者提交完整草稿，module 内部用 RFC 8785 开源实现生成哈希、分配版本并原子保存/确认；不暴露四张表的 CRUD。
2. 把新产品库 migration 接入新的 Workbench 启动链；默认新文件路径，旧库保持不动，旧 `initializeDatabase()` 不再扩展。
3. 实现薄 DBOS Pipeline adapter，用冻结输入身份作为 workflowID；不复制步骤历史、不自行实现队列/信号/恢复。
4. 用不可变资料提交跑通最小连续运行并真实终止恢复；随后才接 Workbench 页面。淘宝仍不插入阶段 2 核心链路。

R-007 依赖治理已从当前执行顺序移出，未来必须作为独立、可回退的工作处理。阶段 2 按上述顺序连续推进，不以汇报、提交或推送作为停工点。下一次需要用户介入的正常节点是专用 Profile 登录失效、出现验证码、权限审批或会改变产品方向的决定，不再追加产品访谈问题。

## 7. 验证记录

### 2026-08-13 文档基线

执行结果：

- 专属术语检查通过：`AGENTS.md`、`CONTEXT.md` 和 `docs/development/` 未发现来源项目的产品名、模块名或专属架构规则。
- 导航路径检查通过：本轮声明的现存权威文档路径均存在。
- 格式检查通过：已运行 tracked diff 的 `git diff --check`，并对所有新增文档执行行尾空白扫描，均无错误。
- 变更范围检查通过：`git status --short --branch` 仅显示 `AGENTS.md`、`CONTEXT.md` 和 `docs/development/`，没有业务代码变化。
- 未运行测试、类型检查和构建：本轮仅修改 Markdown 治理文档，且 `node_modules` 尚未恢复；工程基线验证保留为下一阶段的明确任务。

### 2026-08-13 CodeGraph 初始化

- 已按用户授权执行 `codegraph init -i`，命令成功退出。
- `codegraph status` 确认 59 个文件、527 个节点、973 条边，索引状态为最新。
- 初始化器曾提示无法解析 `mcp.json` 并将备份后重写；项目目录内未发现该文件或备份，Git 变更中也没有对应文件。
- 新增 `.codegraph/.gitignore`，本机数据库 `codegraph.db` 已被正确忽略，不会进入版本控制。

### 2026-08-13 Codex CLI 知识加工边界

- 用户明确 MVP 直接连接其本机 Codex CLI；先前外部模型 A/B 解释被纠正。
- 本机 `codex-cli 0.144.5` 已安装，并通过 ChatGPT 登录。
- OpenAI 官方文档和仓库确认 `@openai/codex-sdk` 是封装 Codex CLI 的 TypeScript SDK，可复用 CLI 登录并提供 structured events、JSON Schema、thread 继续与恢复能力。
- 当前 `master` 只有接入骨架和 placeholder；未合并分支有可提取的 analyzer/批处理/子进程模式，但没有 Codex CLI adapter。
- 已在 worker workspace 精确锁定 `@openai/codex-sdk@0.147.0`；不再自写 CLI 子进程、JSONL parser 或 session 层。
- 真实 SDK 调用使用 read-only sandbox、never approval、禁用网络与 Web 搜索，并返回符合 JSON Schema 的 `{status: "ok", message: "Codex SDK connected."}`；R-005 已接受官方 SDK，不建设多 Provider 模型层。

### 2026-08-13 依赖恢复与工程基线

- `.env`、`.env.local` 和各应用本地 env 文件均不存在；数据目录只有受忽略规则保护的 `.gitkeep`，没有需要迁移的现有业务数据。
- 在项目原有 Node `v21.7.3`、npm `10.5.0`、x64 环境中，`npm ci` 多次成功。npm 的旧锁文件 warning 不影响当前安装结果，未把它扩大为运行时或架构迁移。
- `npm test` 通过：12 个测试文件、52 个测试全部通过。
- `npm run typecheck` 通过：shared、db、worker、api、web 五个 workspace 全部通过。
- `npm run build` 通过：五个 workspace 全部成功；Web 生产 bundle 构建成功，1641 个 module 完成转换。
- `npm audit` 报告 37 项，`npm audit --omit=dev` 报告 24 项生产依赖风险；已登记 R-007，未运行 `npm audit fix` 或 `--force`。

### 2026-08-13 依赖误扩张回退

- 曾尝试把现有基线迁移到 Node 24 arm64，并移除根目录 Rollup x64 包；该动作超出当前任务范围，也违背“原项目已能直接运行”的已验证事实。
- 已删除新增的 `.nvmrc` 和 Node `engines`，恢复根 `package.json` 的原有 Rollup 依赖，并回退 npm 11 产生的 lockfile 重排。
- 回退后根 `package.json` 相对 HEAD 无变更；`package-lock.json` 只新增 `@openai/codex-sdk@0.147.0`、其官方 CLI/平台包和 worker workspace 依赖声明。
- 回退后的当前环境重新验证：`npm ci` 成功；12 个测试文件、52 个测试通过；五个 workspace 类型检查通过；五个 workspace 构建通过。

### 2026-08-13 R-004 数据库迁移只读调研

- CodeGraph 定位到 `createDb()`、`initializeDatabase()`、repository 和 API 启动链；目标读取确认 `schema.ts` 与手写 DDL 同时维护 9 张表。
- 已发现真实漂移：手写 DDL 的 `sources.platform` 有 `UNIQUE`，Drizzle schema 没有；继续复制维护会扩大差异。
- 官方 Drizzle 文档确认 `schema.ts` 可作为 migration 事实源，现有 Drizzle Kit 支持 `generate` 和带 migration log 的 `migrate`。
- 当前结论只收敛候选，不生成 migration、不修改数据库、不升级 Drizzle；隔离原型的输入、对照、通过门、回退和停止条件已落入 R-004。

### 2026-08-14 R-008 商品知识模型与验收生成隔离原型

- 所有候选依赖通过 `uvx`、`uv run` 和临时 Node 目录运行；项目 `package.json`、lockfile、数据库和业务代码未因 R-008 改动。
- `linkml==1.11.1`：schema lint 返回 `No problems found`，metamodel validate 返回 `No issues found`；正确用途样例通过，错误样例按预期报告 5 项错误。
- LinkML 原生 TypeScript 生成结果存在多值枚举、枚举和 decimal 类型降级，已明确拒绝；`json-schema-to-typescript@15.0.4` 生成结果保留 union、非空数组和必填约束。
- RJSF `6.5.3` 服务端渲染成功，输出 10,907 字节 HTML 并包含 5 个核心必填字段和枚举选项；默认暴露内部字段的问题已记录为必须通过公开 schema/`uiSchema` 解决的产品边界。
- `allpairspy==2.5.1`：324 个全组合生成 16 个 pairwise 场景，独立核对 102/102 个值对覆盖且无缺失；NIST 对高阶交互的警告已进入停止条件。
- `statsmodels==0.14.6`：四组演示目标算出 25、73、457、165 个样本；59/59 全部成功的单侧 95% Clopper–Pearson 下界约为 95.05%。这些数字只证明计算链路，不是已接受产品门槛。
- 持久化后的 POC 再次真实运行：两个 Python 脚本分别复现 16/102 场景结果和四组样本量，RJSF 脚本再次输出 10,907 字节 HTML；LinkML lint/validate 通过，错误样例按预期非零退出。
- `git diff --check` 通过；对治理、开发、产品 Markdown/YAML/Python/MJS 的行尾空白扫描无命中；所有本轮文件均不超过 500 行，两个 POC 函数脚本均不超过 100 行。
- 未运行业务 test/typecheck/build：本轮只修改治理/需求文档和隔离 POC，没有改生产代码或项目依赖；此前工程基线结果仍单独保留，不能冒充本轮业务回归。

### 2026-08-14 跨品类架构纠偏

- 按用户确认撤销 `RefrigeratorModel`/每品类生产 Schema 方向；新增 ADR-0002，领域词汇改为稳定商品知识模型、共享属性字典、品类知识定义、下游知识消费者和品类迁移门。
- PRD、总体方案、Provider、知识包、实施计划、工程架构、路线图、调研和需求记录均已同步“官方来源、主流型号、专业知识分层、第二品类迁移门”。
- Tutor 明确排除出知识库参照；`Perfume` 只保留下游交互参考，独立知识包＋Runtime/SDK 路线未改变。
- R-008 LinkML `1.11.1` 重新真实验证：lint 为 `No problems found`，metamodel validate 为 `No issues found`；冰箱和电视两份 `CategoryKnowledgeDefinition` 均由同一 Schema 校验通过；正确 `KnowledgeUseBrief` 通过。
- 错误 `KnowledgeUseBrief` 按预期非零退出，报告空用途、空能力问题、错误新鲜度枚举、错误风险枚举和错误时间共 5 项。
- 本次验证只修改文档和隔离 POC；未修改业务代码、数据库或生产依赖，未把 LinkML/Akeneo/Pimcore 接受为生产组件。

### 2026-08-14 R-010/R-011 第一轮调研与需求批次

- 中国标准化研究院能效备案、市场监管总局 2026 新规和京东自营入口证明：合规身份、当前在售与市场份额是三个不同总体；2026 新旧能效标识允许并存，市场总体必须版本化并带快照日期。
- W3C DQV/SHACL、Ajv、Great Expectations、Soda Core、Spectral 和 Promptfoo 的官方资料证明：结构、批次质量与 Runtime/Agent 效果需要分层评测。SHACL 不适合当前非 RDF 包；Soda Core 因 ELv2 托管限制淘汰；Ajv 优先复用现有依赖；其余组件均未写入生产依赖。
- 已把 Q005、Q006、Q008～Q013 共 8 项改写为产品行为、简单说明和专业推荐；用户于 2026-08-14 确认全部选择 A。确认结果已进入需求记录和领域词汇，但不会跳过 R-010 来源许可/枚举和 R-011 组件原型停止门。

### 2026-08-14 R-010 市场总体版本隔离原型

- 京东自营标识、品牌官方目录和授权店铺规则已形成来源核验依据；仅凭“旗舰店”店名不得进入白名单，必须保存品牌反链、平台资质或授权证据。
- 新增非生产 `MarketUniverseVersion` LinkML POC；冰箱与电视用同一 Schema 表达合规身份、官方在售、许可、未知项和关闭的市场优先级，不新增品类类或通用字段。
- Schema lint 和 validate 均无问题；冰箱、电视正确样例通过；错误样例按预期报告错误日期、非法状态和三个空列表共 5 项。R-010 产品/领域口径已接受，LinkML 未转为生产依赖，真实完整枚举移入阶段 1A。

### 2026-08-14 R-011 知识质量分层隔离原型

- 许可证复核纠正了第一轮候选：Soda Core 当前主分支是 Elastic License 2.0，存在托管服务限制，已淘汰；Great Expectations 为 Apache-2.0，Ajv/Promptfoo 为 MIT，Spectral 为 Apache-2.0。
- 复用现有 `ajv@8.17.1` 的结构 POC：正确 JSON 通过；错误 JSON 以 5 项错误被拒绝，但重复 `claim_id` 未被发现，证明 JSON Schema 不能代替批次一致性。
- `great-expectations==1.20.0` 仅在 `uvx` Python 3.12 隔离环境运行，安装 35 个隔离包；正确 CSV 通过，错误 CSV 因重复 ID、非法枚举、空证据、错误时间和冲突标记触发 6 个失败规则。
- Promptfoo 最新版与 Node 21 不兼容；兼容的 `0.119.0` 隔离下载超过两分钟无输出后主动终止。评测配置已保留，正式采用前须在受支持 Node LTS 上用当前版本复验。没有升级 Node、修改项目依赖或接受旧版为生产组件。
- R-011 质量 contract 已接受；Great Expectations/Promptfoo 的生产采用仍分别受真实知识存储和当前 Node LTS 原型约束，禁止自写通用质量或评测引擎填补空白。

### 2026-08-14 最终需求确认与阶段 0 结束门

- 用户确认 Q014～Q018 全部选择 A；固定 18 项产品问题树全部闭环，没有遗留产品方向待拍板。
- 需求记录、领域词汇、架构基线和开发入口已同步查询顺序、分层更新、Workbench Web 主入口、本地重生产/轻量 Runtime 和旧项目复用边界。
- `ROADMAP.md` 已为阶段 1A～1D 分别冻结输入、代表样本、输出、通过门和停止门；阶段 0 的工程基线、产品范围和下一阶段验证 contract 满足通过条件。
- 阶段状态已切换到阶段 1；这不授权全面业务代码重构或任何未调查依赖变更。

### 2026-08-14 R-001 当前依赖与持久登录调研刷新

- 当前安装的是 Apache-2.0 的 Crawlee 3.16 系列；其 Playwright 集成已经存在，但项目没有安装可选 peer `playwright` 或 `playwright-core`，因此未把“包可引用”误报为“真实浏览器可运行”。
- Crawlee 3.16 官方能力已覆盖持久 RequestQueue、`uniqueKey` 去重、重试统计和 Playwright `userDataDir`，方向收敛为复用现有队列和浏览器集成，不自研队列、Profile adapter 或登录态层。
- Playwright 官方要求使用专用自动化 Profile，并将认证状态视作敏感资料；阶段 1A 将使用隔离命名存储、禁止启动清空、Profile 并发 1，且 Profile/Cookie/Header 不进入 Codex、日志或发布物。
- 本次只读刷新没有安装 Playwright、下载浏览器、访问京东或修改业务代码；随后已完成有界样本清单，实际安装与登录接管仍是原型执行时的明确依赖门和人工停止门。

### 2026-08-14 阶段 1A 有界真实样本清单

- 已核验京东自营判断规则、京东冰箱自营入口、美的官方商城和海尔官方产品/说明书页面；普通第三方和无法举证的旗舰店未纳入。
- `pocs/r001/README.md` 固定 6 个真实官方页面和 8 个执行场景，覆盖正常、匿名受限、人工登录、同型号多颜色、图片/说明书、风险验证、下架和中断恢复。
- 京东 MR-531WSPZE 调查访问发生风险验证跳转；海尔 BCD-505WGHTD14S8U1 调查结果显示已下柜。两者保留为异常样本，不尝试绕过或换页制造成功。
- 本轮架构影响：无变化。只形成阶段 1A 原型输入，没有安装依赖、运行浏览器、修改业务代码或把页面调查结果当成真实采集结果。
- 下一条动作：调查并确定与 Crawlee 3.16、当前 Node 环境兼容的 Playwright runtime 和浏览器二进制，再开始隔离原型。

### 2026-08-14 R-001 浏览器运行兼容与首轮结果

- Playwright 当前官方运行要求为最新 Node 22/24/26 和 macOS 14+；项目现用 Node 21 不在官方支持列表，但本机已有 arm64 Node 22.22.3。
- npm registry 当前 `playwright` 为 1.62.1；Playwright 官方支持本机 Stable Chrome，Crawlee 3.16 也提供 `useChrome`。当前改为复用本机 Chrome 151.0.7922.138，只隔离项目 Profile，不再按原型下载浏览器。
- 已在 `pocs/r001` 增加隔离 package 和匿名采集脚本，固定 Crawlee 3.16.0 与 Playwright 1.62.1。它不属于根 workspace，不修改根依赖、根 lockfile、Node 21 运行基线或业务代码。
- 隔离 `npm audit` 发现 Crawlee 3.16 的 `file-type 20.5.0` 有两个中危拒绝服务公告。当前原型不走文件类型识别/上传路径，允许继续验证；3.16 不得直接进入生产，Crawlee 3.18.1 的升级兼容与回退留给 R-007 单独处理。
- 首次限制 2 个请求的运行完成：S03 美的官网返回 200 并完整保存；S01 京东正常自营样本被重定向到“京东验证”，正确分类为 `challenge`，没有绕过。Crawlee 停止后剩余 4 个请求仍在持久队列中。
- 首次运行使用了已下载的配套 Chromium；用户指出长期重复下载没有必要，已纠正为复用本机 Chrome 程序＋项目专用 Profile。用本机 Chrome 恢复后，S02/S04 正常，S05 进入验证，S06 进入登录；证明队列能跨进程恢复且浏览器程序无需重复下载。
- S06 v1 的最终 URL/HTML/截图正确，但分类器把登录页误标为 `loaded`。旧快照保持不变，已增加明确的 `login_required` 规则和新请求 key；下一条动作只重跑 S06 验证纠正，然后进入人工登录/验证码停止门。
- S06 v2 实际再次进入京东验证并正确标为 `challenge`，证明页面状态会变化，不能预设成登录或下架。全部 7 个请求记录已处理且没有重试；HTML/截图 SHA-256 与 metadata 逐项匹配。
- 已准备 `login:jd` 和 `capture:jd` 两个最小入口：复用本机 Chrome 程序，但隔离京东专用 Profile。阶段 1A 现在到达明确人工停止门，等待用户在窗口内自行登录或处理验证码。
- 用户完成登录后，同一 Profile 的京东首页连续 3 次正常返回 200；S01 商品页在等待型号后进入 `pc-frequent-pro.pf.jd.com`，页面标题为“PC频控页 - 京东商城”。这只证明商品详情访问进入京东风险响应页，不证明真实原因是短时频率过高。
- 已停止后续京东请求；没有点击刷新/切换账号，没有运行 `capture:jd`，也没有尝试反检测或绕过。误导性的 `rate_limited` 分类已改为 `risk_controlled`。

### 2026-08-14 R-001 京东合规与自动化信号历史结论

- 本节保留当时调研和停止决策的历史；用户后续明确改选京东教育研究网页采集，当前执行以 ADR-0004 和 B-005 为准。
- 京东 2026-01-20 生效的用户协议明确限制未获书面许可的第三方工具接入、站内内容和交互数据复制；JOS/京东联盟提供需 app key、OAuth/权限申请的官方 API，普通网页登录不属于替代授权。
- 2025 年修订的《反不正当竞争法》第十三条明确规制避开或破坏技术管理措施获取、使用其他经营者数据；项目不会实现指纹伪装、验证码绕过或未公开接口回退。
- 7 次已保存样本导航各自加载 12～117 个资源。因此“尚未开始批量抽取”与“浏览器已经产生多次网络访问”可以同时成立；但京东具体命中规则仍未知。
- 离线空白页探针验证有头/无头 Playwright Chrome 均为 `navigator.webdriver=true`；只有无头模式 User-Agent 含 `HeadlessChrome`。探针不访问京东或其他外部网站。
- package 已移除全部采集/登录命令，只保留离线浏览器信号探针；历史采集脚本中的默认样本也只保留美的/海尔官方页面。品牌官网完成逐源授权调查前不重新开放运行入口。
- 架构影响：已改变。来源身份与来源授权分离，Provider 只运行获准入口；同步更新 PRD、Provider 规范、实施计划、领域词汇、架构图、路线图，并新增 ADR-0003。

### 2026-08-14 长期维护与跨设备接续约束

- 用户明确要求后续开发不能依赖普通聊天上下文，所有工作必须服务于最终架构，并共同维护架构说明和进度说明。
- 已把“任务必须映射路线阶段/架构目标”“结束时记录架构影响”“架构变化才同步修改架构正文”和“跨电脑必须验证 Git 远程一致性”写入根 `AGENTS.md` 与开发导航。
- 本轮架构影响：澄清开发治理和接续规则，没有改变系统模块、数据流、品类复用方案或阶段 1A～1D 原型 contract。
- 当前跨 Session 的本机恢复入口已经存在；但架构、进度和治理文档仍有未提交内容，因此当前状态只能标记为“仅本机，尚未形成跨电脑接续点”。在未获得提交/推送授权前不得宣称跨电脑可继续。
- 按用户要求复核 `work/opencode-dev/AGENTS.md` 的 `Anti-AI-Code Rules`，已将其通用约束补入本项目并移除平台专属内容；新增直接实现优先、禁止机械分层、禁止纯转发 wrapper、禁止重复注释/类型/校验和无调用方扩展点等明确规则。
- 本轮补充只收紧代码生成与审查纪律，不改变商品知识平台的系统架构或阶段顺序。
- 已按用户要求建立独立积分账本 `AGENT-SCORECARD.md`：初始 100 分，明确“扣分”减 1 分并记录原因/纠正/防复发，明确“加分”加 0.5 分并记录正确行为；本轮未发生积分变化。

### 2026-08-14 R-012 京东官方与开源路线调查

- 京东联盟不能被当成“免费完整商品参数库”；VOP/B2B 的真实费用和字段依合作方案确认。这些调研作为路线取舍证据保留，但用户已明确不走官方 API 路线。
- 开源候选包括 Patchright、fingerprint-suite、rebrowser 和 Camoufox。现有项目已用 Crawlee/Playwright，Crawlee 的 `launchContext.launcher` 支持注入 Playwright 兼容 BrowserType；因此首选 Patchright 是最小替换，不新建浏览器、队列或指纹层。
- 隔离原型精确锁定 Patchright 1.61.1，使用本机 Chrome、持久 Profile、有界面、原生 viewport，并关闭 Crawlee 默认 JS 指纹注入。它不修改根项目依赖或业务代码。
- 本地空白页对照：Playwright 的 `navigator.webdriver=true`，Patchright 为 `false`；两者均不含 `HeadlessChrome`。这只证明 Patchright 消除了一个已观测差异，不猜测京东完整规则。
- S01 真实运行：首轮骨架页没有冒充成功；增加型号就绪门和 Crawlee `infiniteScroll` 后，已登录专用 Profile 返回真实商品标题、型号和主要规格，HTTP 200，HTML/文本/截图/资源清单及 SHA-256 均已保存并复核。
- 新建匿名 Profile 进入普通京东登录页，不是风险页；当前详情访问需人工登录。登录态原始页可含个性化数据，已分类为 `restricted`；只有标记 `sanitized` 的白名单投影可进 Codex 或知识管道。
- 使用同一路线各访问一次 S05/S06：S05 当次正常加载，S06 当次正确分类为 `discontinued`；两者均是 HTTP 200、型号存在、零重试。这证明异常状态必须来自当次页面证据，不能由 URL 或 HTTP 状态预设。两次产物的 HTML/文本/截图/资源清单 SHA-256 与 metadata 逐项一致，受限目录和 Profile 均已确认被 Git 忽略。
- R-013 对比后拒绝以 Presidio/黑名单作为主门：官方明确自动 PII 检测不保证找全，中文需额外 NLP/识别器配置。隔离 POC 显式锁定工程已有的 `cheerio@1.0.0-rc.12` 和 `zod@3.25.76`；S05/S06 分别产生 34/26 个属性的 `sanitized` 投影，只有标题、描述、亮点、属性和快照证据，不携带整页 HTML 或个性化容器。Node 官方测试验证正常投影通过，故意注入受限地址文本时失败关闭，2/2 通过。
- 本轮白名单投影改变 Raw Material 到 Knowledge Factory 的依赖方向，已更新 `CONTEXT.md`、`ARCHITECTURE.md`、`ROADMAP.md` 并新增 ADR-0005；Knowledge Factory 不再允许直接读受限采集快照。
- 本轮架构影响：已改变。ADR-0003 已被 ADR-0004 取代；JD Web Adapter 采用 Crawlee＋Patchright＋本机 Chrome，原始资料增加受限隔离区，淘宝登记为京东闭环后的下一 Provider。fingerprint-suite/Camoufox 只在 Patchright 出现可复现能力缺口时重新评估。
- Crawlee 3.16 的首次恢复实测保住了剩余请求，但进程没有自行退出；官方 3.17/3.18 发布说明包含 `maxRequestsPerCrawl` 防误丢请求、浏览器关闭计时器不再阻止 Node 退出和存储修复。隔离 R-001 因此升级到 3.18.1，未修改根依赖；`npm audit` 从 13 个中危依赖项降为 0。
- 3.18.1 真实恢复门通过：首次只处理 S02，结果 1 条、退出码 0；同一持久队列重启后只处理 S04/S03，结果 2 条、累计 3 条、退出码 0。Crawlee 统计按官方 `statisticsOptions.id` 与队列版本隔离，避免旧 POC 累计统计误占本轮限额。
- 调查队列时曾误调用 `queue.drop()`，随后一次只读检查又因遗漏 `CRAWLEE_PURGE_ON_START=false` 触发默认清理；两次只影响可从固定公开样本重建的本地 R-001 公共测试队列，没有删除页面快照、京东 Profile、代码或 Git 数据。已停止直接检查队列，换用新队列版本并通过端到端结果验证恢复。
- 本轮新增版本升级和恢复证据不改变既定模块边界；架构影响：无变化。下一步第一条动作是完成 1A 品牌官网/监管代表来源范围闭环。

### 2026-08-14 R-001 官方目录、文件资料与阶段 1A 结束门

- 调研并采用 Crawlee 3.18.1 已提供的 `SitemapRequestList` 和 `FileDownload`；目录解析、嵌套 sitemap、去重、过滤和文件传输均未自研。文件签名校验采用 MIT `file-type@22.0.1`，只安装在隔离 R-001 目录。
- 海尔官方根 sitemap 指向 `product.xml`；真实完整读取后，`/cooling/` 目录得到 1,341 个唯一产品 URL，已知 S04 在集合内。不可变目录 JSON 的字节数为 79,085，SHA-256 为 `fef40b76b00fffb9e6647100c99a91bd3daf902fcfb5a00bdc471e5995b4304d`。
- 美的官方 MR-457WUSPZE 说明书保存为 1,154,097-byte PDF，SHA-256 为 `bd173c352c759dea6a4128dcc4dda079b1a8102dec7a01f40f96846036ca2478`；Poppler 对 16 页渲染正常，第 5 页可定位型号、尺寸和安装图。
- 中国标准化研究院冰箱能效备案附件保存为 2,301,639-byte RAR，SHA-256 为 `d493ec919949a655c8d9dae9d0319ebaa5eacd257cfa2cf97dcefa618ac97f11`。服务器声明 `text/plain`，文件签名仍正确识别 RAR；`bsdtar` 列出 13 个 XLSX，2024 年 12 月表含 516 条数据及生产者、型号、备案号和能效等级字段。
- 两个下载源最终均为 HTTP 200，独立 `shasum` 与 metadata 一致。一次 response API 用法错误和一次 RAR MIME 别名不符保留为失败尝试，没有覆盖原文件或误报成功。
- 隔离脚本新增目录发现和文件资料入口，共用 Node 核心不可覆盖 JSON/哈希辅助；所有 MJS 语法通过，Node 测试 4/4 通过，固定 Node 22 环境 `npm audit --omit=dev` 为 0。
- 阶段 1A 通过：候选发现、详情/多规格、图片与说明书、监管资料、正常/登录/风险/下架、敏感数据隔离、不可变保存、证据定位、失败分类和恢复门均有真实证据。该结论只接受可行性与 contract；完整多品牌官方总体属于阶段 3，不把 1,341 个历史 URL 误报为当前在售或销量总体。
- 本轮服务路线阶段 1A 和“官方来源到受控原始资料”架构目标；架构影响：无变化，新增的是既有 Provider/SourceObject/Raw Material 边界的实证。下一步进入 1B 样本冻结与开源候选调研。

### 2026-08-14 R-014 首轮混乱资料加工与 Codex 候选

- 经开源比较，隔离采用 Cheerio、unpdf/Mozilla PDF.js、`read-excel-file`、mathjs、Zod、`zod-to-json-schema` 和官方 Codex SDK；拒绝审计含 2 个中危项的 ExcelJS，不安装尚无真实缺口依据的 Fuse.js/Splink，不自写 PDF/XLSX/单位/模型协议。
- 规则抽取真实生成 63 条带快照哈希和页/行/CSS 定位的证据；官网两个同型号变体共同 26 项、颜色差异 1 项、单页缺失 3 项。复跑去除 `createdAt` 后排序内容哈希同为 `a612c316e9ab500dabaa64361dcb7b5b56172c64aa7142316c8cde8080d8cb6a`。
- 本地 Codex CLI 由官方 SDK 直接调用，不接外部模型；真实图片＋文本轮次生成 10 条待审核候选、0 条冲突和 3 条 `unknown`。产物输入哈希、thread ID、token usage、SDK item、原始环境告警和候选均可审计，任一未知 error item 或伪造证据引用都会失败关闭。
- 两次模型输出的结构门和计数一致，但属性拆分与措辞不同；因此模型重放保证相同输入/Schema/证据门和可审计记录，不承诺字节相同。规则抽取才承担字节级确定性。
- 当前 0 冲突是正确结果：颜色变体和字段缺失都不是事实矛盾。下一步使用明确标注的 contract fixture 验证冲突分支，禁止为通过门污染真实知识样本。
- R-014 Node 测试 6/6 通过，最终候选产物独立 SHA-256 复核一致；隔离生产依赖审计为 0。业务代码、根生产依赖、真实数据库和浏览器 Profile 均未修改。
- 根 `npm test` 首次把 `docs/development/pocs/**` 的 Node 原生测试误交给 Vitest；按 Vitest 官方 `--exclude` 参数明确测试边界后，根业务测试 12 个文件、52 项全部通过，R-001/R-014 仍由各自 `node --test` 独立通过。根类型检查和生产构建同时通过。
- 本轮服务阶段 1B 与 Knowledge Factory 证据化候选目标；架构影响：无变化。现有 Raw Material 白名单边界、确定性规则优先、Codex 只产待审核候选和人工发布门得到实证，尚无理由修改总体模块职责。
- I05/I06 真实脱敏投影补入确定性抽取后，分别归到独立的美的/海尔型号；S06 的 `discontinued` 和 description 缺失被保留。Codex 输入使用显式主型号字段白名单，两个其他主体没有进入模型上下文。
- 受控双值 fixture 生成 `X001` 待审核冲突；真实样本继续为 0 冲突。审核 Zod contract 同时约束 claim 接受/拒绝、冲突解决和 unknown 确认，真实候选无审核记录时发布门实测失败。
- 新版真实 Codex thread `019fffe0-50c0-7772-a102-e5b780d806d6` 生成 10 条 claim 和 3 条 unknown，稳定 ID、证据白名单、输入哈希和 SDK 告警均入库；R-014 测试 11/11 通过。
- 阶段 1B 通过；架构影响：澄清但无模块变化。模型输出仍只能到 `review_required`，发布权属于人工审核 contract。下一步已进入 1C，不等待额外人工确认。

### 2026-08-14 R-015 知识包与离线查询对照

- 先查 SQLite/FTS5、DuckDB FTS/extension、DuckDB Node Neo、Orama Mandarin/持久化官方资料；DuckDB FTS 因首次扩展下载不满足离线门，未自研扩展分发器。
- SQLite＋FTS5 与 DuckDB＋Orama 均通过 9 项冻结查询、跨目录复制、只读写入失败、哈希校验、原子切换和回滚；查询期间不调用网络、模型或 embedding。
- Orama 官方持久化插件 3.1.18 恢复后实测丢失 Mandarin tokenizer；改用 Orama 核心官方 `save/load` 后通过，没有编写兼容层。该候选仍因双产物一致性成本被拒绝。
- 1000 商品/2000 claim 放大 fixture 中，SQLite 为 1.77 MB、构建 2675.27 ms、查询 4.85 ms；DuckDB＋Orama 为 4.60 MB、构建 1740.56 ms、查询 25.29 ms。两边全文结果统一限制 10 条，避免口径偏差。
- 接受 ADR-0006：MVP 知识包为 SQLite＋FTS5 单文件，Runtime 只读、哈希校验、原子指针激活和保留旧包回滚；不引入 DuckDB、Orama、向量数据库或 Great Expectations。
- R-015 测试 3/3 通过，隔离依赖审计 0 漏洞；对照产物 SHA-256 为 `e75d490266d4a0671661f79e8df37eb133fdc3d6c515d2b243109d7748a890cf`。
- 阶段 1C 通过；架构影响：改变。`ARCHITECTURE.md` 已把知识包物理存储从候选更新为 SQLite＋FTS5；下一步已直接进入 1D 第二品类迁移。

### 2026-08-14 R-016 第二品类零分支迁移

- TCL 65T7G 官方页通过同一 R-001 公共网页 Provider 采集：HTTP 200、`loaded`、公开快照；只增加 S07 来源数据，采集实现未改。
- 官方页覆盖身份、144Hz、1000 nit、96% DCI-P3、分区控光、画质机制、游戏接口和场景；正文把一处型号写成 T7E，该异常保留为 `unknown`，未静默纠正。
- 电视定义通过 LinkML 1.11.1；R-016 测试 2/2 通过，同一 R-015 Schema/SQLite Runtime 完成型号、中文全文、144Hz、五层知识、证据和 unknown 查询。
- 阶段 1 全回归：R-001 4/4、R-014 11/11、R-015 3/3、R-016 2/2；根测试 12 文件/52 项、typecheck、build 均通过。
- 阶段 1D 通过，四项可行性验证全部完成；架构影响：澄清。品类中立边界由候选变为实证，没有新增电视模块、表列、Runtime 方法或流程分支。

### 2026-08-14 R-017 可恢复编排器对照

- 先比较 Temporal、DBOS、Hatchet、Restate、Inngest、Trigger.dev、Kestra 与现有队列；Restate/Inngest 因许可证拒绝，Hatchet/Trigger.dev/Kestra 因额外平台部件拒绝，未自研工作流能力。
- Temporal 1.22.0 在 Worker 与服务均终止后，从 CLI SQLite 文件恢复等待状态；`collect` 和 `package` 各执行一次。其本轮依赖约 170 MB、CLI 约 128 MB，且单文件 `start-dev` 不是生产入口。
- DBOS 4.25.14 在首进程 `SIGKILL` 后从 PostgreSQL 恢复；同 ID 幂等、三次步骤重试、取消、恢复和消息幂等均通过，2/2 测试通过；本轮 `@dbos-inc` scope 约 2.2 MB。
- 接受 ADR-0007：Pipeline adapter 使用 DBOS，系统库为 PostgreSQL；不扩展 `p-queue`，不自研队列/事件日志/重放/信号。临时 PostgreSQL 已停止。
- 架构影响：改变。`ARCHITECTURE.md` 新增 DBOS 执行历史边界；Workbench 业务库处置仍由 R-004 决定，未授权双写或数据库迁移。下一步已直接进入 R-004。

### 2026-08-14 R-018 Drizzle migration 与业务库边界

- 根旧 Kit 因 npm workspace 提升问题找不到 db workspace ORM；相同锁定版本隔离共址后成功生成，未误判为 Schema 错误。
- 旧 ORM 命中 GHSA-gpj5-g38j-94v9 high。隔离升级到 ORM 0.45.2、Kit 0.31.7、libSQL 0.17.4 后同一 snapshot 无变化，migration contract 3/3 通过。
- 空库重复 migration 只记录一次；9 表/9 索引/外键/默认值与 `schema.ts` 一致；失败 SQL 整批回滚。旧手写 DDL 库明确失败，未自研 baseline/repair。
- 根依赖完成同版本最小升级；根 generate、12 文件/52 测试、五 workspace typecheck、build 全通过。生产 audit 仍有历史 23 项，但 Drizzle 公告已消失；未运行自动修复。
- 接受 ADR-0008：Workbench 业务库保留 SQLite，新产品使用新文件和正式 migration；DBOS PostgreSQL 只保存执行历史，禁止跨库双写。架构影响：改变。下一步直接进入 Product/Pipeline typed contract。

### 2026-08-14 阶段 2 typed contract 与新产品库

- 按 `codebase-design` 把 Product 冻结输入收敛为项目、品类定义版本、确认范围版本和搜集板版本；跨对象引用、市场、来源策略、已纳入目标和确认时间由一个共享 Zod contract 校验。
- Pipeline module 对调用者只暴露 `start / command / get`；生命周期、当前阶段、阶段执行和人工事项分离，DBOS workflow/step/message 类型未泄漏。
- 新产品库只建 4 张业务表，版本内容保存在严格 contract 下的 JSON 列；没有 Pipeline/TaskAttempt 复制表。Drizzle 正式 migration 已生成到 `drizzle/product-knowledge/`，默认新文件 `data/product-knowledge-workbench.sqlite`。
- 新增 contract/migration 测试 10/10；`npm ci` 从锁文件干净恢复成功。根全量现为 15 文件/62 测试，五 workspace typecheck 和 build 全通过。
- 架构影响：澄清。`codebase-design` 使 SQLite 作为 module 内部本地依赖直接用临时库测试，没有新增假想 DatabasePort；下一步进入 Product Module，不等待额外确认。

## 8. 结束上下文更新模板

每次结束上下文前，在本文件更新：

```text
更新日期：
当前阶段与状态：
本轮完成事项及证据：
当前 Git/依赖/运行事实：
新调研或决策状态：
本轮服务的路线阶段与架构目标：
本轮架构影响（无变化/澄清/改变）：
阻塞和所需人工决定：
下一步第一条可执行动作：
实际运行的测试、构建和真实表面验证：
```
