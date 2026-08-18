# Agent 知识生产平台开发进度

这是当前阶段、已验证事实、阻塞项和下一步的单一权威来源。阶段计划只看 `ROADMAP.md`，技术候选只看 `RESEARCH.md`。

更新日期：2026-08-18
当前阶段：M0～M7 恢复路线的最小真实纵切片已通过；`ROADMAP.md` 阶段 1A 冰箱纵向第 6 步已通过 Windows 技术/监管隔离小批次，但获许可的品牌详情/说明书和完整市场/媒体矩阵仍未完成；京东继续零访问
总体状态：系统既有 R-034 电视第二品类全链证据；本轮 R-033 又在 Windows 用 confirmed brief→服务端 Planner→DBOS→NIST/USDA/能效标识 Provider→Source Dataset→最小 Evidence 形成 3 条隔离真实证据，美的说明书因许可不足零请求。开发库只完成 NIST 与能效标识，USDA 当前两次 HTTP 403 已作为 typed failure 保留，所以开发库 Evidence 为 0，不冒充隔离验收。Windows SQLite 文件生命周期、长路径知识包和全仓回归已通过；目标 Linux、获许可品牌资料、三品类、多站点、动态页、图片和完整市场总体仍未通过。历史 737 identity 仍不是当前来源数据或商品知识。
当前积分：85.5（以 `AGENT-SCORECARD.md` 为准）

## 1. 当前 Git、环境和接续边界

- 仓库：`D:\work\domain-analysis`
- 分支：`master`
- 本轮开始 HEAD：`058438a`
- 本轮开始上游：`origin/master` 同 SHA，ahead/behind `0 0`
- 交付范围：用户已授权继续开发和本地验证，尚未授权本轮 commit/push；本地数据库、Evidence、知识包、浏览器状态和认证材料仍排除。动态 Git 状态以 `git status`、`git rev-parse` 和远程 ahead/behind 为准。
- Node 基线：根 `package.json#engines` 固定 Node `>=24 <25`、npm `>=11 <12`，`.nvmrc` 提供 24.12.0 推荐版本；本轮 Windows 实际使用 Node 24.14.1/npm 11.11.0 并通过运行时门，Node 24 内的小版本不再被文档误写成唯一可运行值。
- CodeGraph：Windows 已初始化且状态健康；2026-08-18 读数为 284 files、3547 nodes、7042 edges，backend 为 Node 内置 SQLite/WAL/FTS5。
- 跨电脑启动入口为 `docs/development/HANDOFF.md`。接续点只有在包含该文件的 `master` 已推送且本地/远程 SHA 经动态核对一致时成立；本文不固定自身提交 SHA，避免自引用失真。

## 2. 2026-08-15 架构纠偏决定

用户明确确认采用目的驱动的最小证据，并否定以下旧方向：

- 不能认为“一个官网写一个解析器”可以满足跨品类和未知 DOM；
- 采集必须带着明确事实/知识问题寻找证据并记录来源 URL；
- 不把完整原始页面永久保存下来；
- 图片何时保存、如何证明图片与对象/知识点关系必须单独设计和验证；
- 文档正确后才允许删除旧错误/死代码并写新实现，不保留垃圾兼容层。

2026-08-17 用户进一步纠正了上述边界的适用阶段：最小 EvidenceItem 约束不能反向裁掉京东第一轮来源数据发现。京东必须先有界保存分类/筛选体系、核实后的自营/官方旗舰店商品目录、每款商品完整内容区，以及评价汇总和前 50/100 条样本；再从这些来源快照归纳市场总体、属性、比较维度和知识问题。整页导航、广告、账户、Cookie、Header、Profile 与无关个性化内容仍禁止保存。详细方案为 `JD-COLLECTION-DESIGN.md`；用户已授权实施，R-031 已由工程按 ADR-0014 冻结并完成本地跨品类纵切片。

当前权威结论：

- `Knowledge Need` 拥有“要解决什么”；`EvidenceRequest` 拥有“为什么采”；
- `SourceObservation` 只记录访问发生了什么；访问成功不等于证据充分；
- `EvidenceItem` 拥有“当时实际看到了什么”，只保存支持明确请求的最小不可变内容、URL、时间、哈希、locator、对象关系和隐私等级；
- HTML/完整文档/页面图片可以在本机临时读取，证据提交或失败后清除未选内容；URL-only 不是证据；
- 文本、PDF、表格和图片分别使用可复核 locator；图片关系无法证明时保持 unknown/人工审核；
- 规则、结构化数据、OCR、Codex 或视觉模型都只产生 ExtractionCandidate，必须引用 evidence ID，不能自动发布；
- 用户在批次级确认知识范围、证据政策、例外和发布，不逐字段排网页；其他独立任务不会因一个未知项停下；
- “同类”只按 typed request/reason/source/evidence/category version 筛选，不再调用 LLM 先判断同类。

ADR-0011 已接受上述决定；ADR-0005 已被取代；ADR-0010 只保留 `cacache` 内容寻址和公开/受限物理隔离，存储对象收窄为最小证据。

### 2.1 2026-08-15 品类启动采访决定

用户确认先按以下方向推进：

- 新品类从 Workbench Chat Timeline 开始，用户可以直接说“开启冰箱品类”；
- 专用 `interview-product-category` Skill 一次只问一个必须由负责人决定的问题，系统自行调查品牌、型号、参数、部件、原理和来源；
- Workbench 分别保存规范化消息、append-only Interview Decision、未决项和版本化 Category Research Brief，并独占多轮继续上下文；Codex 每轮 ephemeral 执行不拥有持久 thread；
- 模型建议不是项目事实，只有用户确认的决定才能进入 confirmed brief；confirmed brief 再生成 Product Project 草稿和阶段 1A 冻结输入；
- 现有 ProductProjectForm 改为检查修改面，不再作为从零创建事实源；
- 前端接受 `assistant-ui` ExternalStoreRuntime；旧 Codex App Server `stdio` 例外已撤销。R-029 当前接受官方稳定 `codex exec --ephemeral` 薄 adapter，真实验收已证明全局 Session 零新增；UI 与运行时仍是两个独立通过门；
- MVP 不引入 Pi Agent、agent registry、多 Provider 或自动 fallback；采访 modelId/reasoning 用真实采访样本另行评测，不继承批次 `gpt-5.3-codex-spark + low`；
- DBOS 从任务书确认后的正式研究 Pipeline 开始，不持久化每一条聊天消息。

ADR-0012 已接受产品流程、Workbench 事实归属、“不引入 Pi”和无 Session 的 ephemeral exec adapter；它没有提前接受尚未重写/验收的采访 Skill 行为或整个阶段 0I。

## 3. 当前阶段判定

| 阶段 | 当前判定 | 可复用证据 | 尚缺什么 |
| --- | --- | --- | --- |
| 0R 文档与清算 | 通过 | 权威文档一致性/链接/diff 门通过；错误 contract/module/route/UI/test/dependency 已删除；跨电脑交接入口已加入提交范围 | CodeGraph 删除索引仍陈旧；索引重建需单独授权 |
| 0I 品类采访与任务书 | 已通过 | R-028 Chat Timeline、R-029 ephemeral exec/Session 隔离、采访 Skill、真实 Workbench 决策树/调查/任务书/确认/项目草稿、取消/失败/重试/重启与 PC 主流程均通过；确认后自动推进且不合成用户消息 | 无；后续只能消费 confirmed brief，不得恢复第二套创建事实源 |
| 1A 来源与证据 | 最小真实纵切片通过；完整矩阵未通过 | confirmed brief 驱动 Planner；电视 DOE/EPA 与冰箱 NIST/USDA/能效标识经 DBOS 形成 Source Dataset 和最小 Evidence；许可禁止、外部 403 或未知时失败关闭 | 获许可的品牌详情/说明书、京东真实许可与 1＋3 探针、完整市场总体、动态页、图片和第三品类 |
| 1B 证据到候选 | 最小 Factory/Review 纵切片通过；完整质量门未通过 | 确定性转换与固定 `gpt-5.3-codex-spark + low` 分开；模型只产待审候选；底层概念 owner、关系、许可和人工决定均有 typed contract | 完整共享属性字典、冲突/unknown 统计、图文机制、多型号比较与人工频次门 |
| 1C 包与离线查询 | 当前 Evidence contract 与 Windows 门通过；完整跨平台门未通过 | 内容寻址 SQLite＋FTS5 包、激活/回滚、精确/筛选/全文/关系/证据查询；Windows 原子发布、长路径和复制单文件离线查询通过 | 目标 Linux 安装与离线验收、完整验收集和安全升级处置 |
| 1D 第二品类迁移 | 电视最小真实迁移门通过；完整迁移门未通过 | R-034 未修改公共 Schema/Factory/Review/Package/Runtime interface 即贯通电视底层概念、型号与真实 DOE/EPA 来源 | 第三品类、动态/图片/多站点矩阵以及更大规模质量门 |
| 2 Product/Pipeline | 最小生产组合可达 | confirmed brief、Planner、两个 DBOS Queue、typed lifecycle/取消/强杀恢复和 API 组合根已接通 | 完整阶段处理器、总验收与发布权限闭环 |
| 3 数据搜集板块 | 通用最小链路通过；京东真实采集未通过 | Source Dataset、Provider Router、持久工作项、显式频控/熔断/取消/恢复、PC 查看和导出已通过；电视与冰箱技术/监管真实来源通过 | 获许可的品牌详情/说明书、JD reader/探针、动态/图片、多品牌和多站点完整门 |
| 4 Knowledge Factory | 通用最小链路通过；完整知识质量门未通过 | Evidence→确定性/模型候选→Review 已在电视真实证据上通过；无品类分支、无模型 fallback | 完整知识需求矩阵、冲突/unknown、图文原理和比较质量门 |
| 5～6 | 最小包/Runtime/PC 联调通过；正式交付未通过 | SQLite 包、离线查询、内容重建稳定、PC Workbench 真实表面通过 | 跨平台、完整故障矩阵、第三品类和发布总验收 |

不得把“M0～M7 最小纵切片通过”写成“阶段 1A～1D 全量完成”或“京东已抓取”。两者的验收范围不同。

## 4. 仍然成立的已验证资产

以下只是可复用资产，不等于新阶段已通过：

- 项目、品类定义、确认范围和搜集板的版本化 PostgreSQL/Drizzle 事务；
- DBOS workflow 的稳定 identity、重试、人工等待、失败 fork 和强杀恢复；
- Crawlee 请求队列/恢复、Patchright/Playwright 本机浏览器访问、登录/验证/风控等历史 POC 证据；旧 Provider 实现已删除，待按新输出 contract 重写；
- Crawlee sitemap/FileDownload、文件签名与大小门的历史 POC 证据；旧整页/完整文件交付代码已删除；
- `cacache` 原子内容寻址、SRI 完整性、公开/受限物理隔离；
- `unpdf@1.7.0` 对历史真实 16 页 PDF 的页级读取、`read-excel-file@9.3.10` 对监管表精确行读取、`mathjs@15.2.0` 的确定性单位处理历史证据；旧依赖和 projector 已从生产包删除，复用前必须按 R-026 重新 POC；
- 候选/冲突/unknown、evidence ID 绑定和 append-only Review Decision 的历史局部不变量；旧 contract/module 已删除，阶段 1B 重新设计；
- SQLite＋FTS5 只读、离线、版本切换/回滚知识包方向；
- 旧窄用途 Codex 批次曾以正确 `gpt-5.3-codex-spark + low` 真实返回结构化候选。旧 adapter/SDK 依赖已删除；该历史证据只适用于“未映射最小事实 → 待审候选”，不授权网页语义寻找、图片理解、OCR 后推理或富知识抽取。

所有历史测试/构建结果只是当时证据；代码清算后必须重新运行，不能直接继承为当前通过。

## 5. Patch Disposition

### Delete

- `OfficialProductMaterialProjector`、京东/官网商品字段 DOM projector 及其站点 selector；
- `Capture Snapshot / Restricted Capture Snapshot / Processable Material Projection` 作为公共/领域 contract 的实现；
- 默认保存 HTML、全页截图、完整页面文本和资源清单的持久化路径；
- 为旧 projector、整页重放或错误完成声明服务的 helper、wrapper、test、fixture 文案和 UI 投影；
- 只在测试注入、生产组合根不可达且不保护新不变量的 Stage 3/4 interface/route/module；
- 重复事实源、兼容 fallback、误导命名和无调用方扩展点。

### Keep

- confirmed/frozen project 版本、typed lifecycle/source state、DBOS/Crawlee 恢复和人工接管；
- 来源授权/隐私门、内容哈希/公开受限隔离和 evidence binding；
- 模型只产候选、服务端按 evidence ID 恢复/校验、append-only Review、人工发布门；
- 知识包/Runtime 与 Workbench/浏览器/模型物理隔离。

### Rewrite

- Acquisition Plan → EvidenceRequest Plan；
- Provider capture → SourceObservation＋临时待选证据；
- Raw Material/Snapshot/CAS catalog → EvidenceItem catalog；
- coverage/source revision → 请求充分性＋独立来源观察；
- Knowledge Factory 输入 → EvidenceItem；
- Workbench 页面 → 请求/证据/例外队列，不显示旧快照/字段投影语义；
- 生产组合根 → 全部真实 handler 可达后一次接通。

删除前必须用 CodeGraph 从真实 entry/组合根检查调用和影响，再核对 package exports、CLI/migration/config/动态入口和测试不变量；不可达只是删除候选，不能机械删除。此次不引入 Knip：当前 Node 21 与其最新 Node 22 engine 不匹配，且多 workspace entry 未配置会级联误报；详见 R-027。

历史执行结果：旧 `acquisition/raw material/processable material/knowledge factory/review` 共享 contract、Workbench module、Provider/projector、API route、Web 区块、测试和直接依赖曾被删除；Product Project、DBOS Pipeline、`cacache` 和内容哈希被保留。该历史记录不再证明 Rewrite 已完成。当前必须重新审计所有未提交改动，并为采访 Skill、Session 运行时、生产组合入口和市场总体采集分别给出新的 `delete / keep / rewrite` 结论；审计前不删除文件、不清理全局 Session、不继续叠补丁。

### 5.1 2026-08-16 当前 dirty diff 审计

审计范围：`63` 个 tracked 修改文件、`105` 个 untracked 文件，共 `168` 个文件；已排除所有 `node_modules`。本表是后续修复的文件处置基准，未列为 Delete 的用户 WIP 不得清理或覆盖。

| 路径/文件组 | 处置 | 审计结论与下一动作 |
| --- | --- | --- |
| `AGENTS.md`、`CONTEXT.md`、`docs/product/agent-knowledge-platform/**`、`docs/development/{README,ARCHITECTURE,ROADMAP,RESEARCH,REQUIREMENTS-ALIGNMENT,PROGRESS,AGENT-SCORECARD}.md`、`docs/adr/0001,0002,0004,0005,0008～0012` | Keep＋纠错 | 保留需求、事实源和架构边界；删除错误完成措辞。只有 Session 方案或事实源归属改变时再更新 RESEARCH/ADR/ARCHITECTURE。 |
| `docs/development/pocs/r001,r014,r015,r016` | Keep | 作为历史调研证据，不是当前完成证明；本轮不运行、不扩写。 |
| `docs/development/pocs/r026/**`（7 个 untracked） | Keep/Frozen | 保留 PDF/XLSX/图片/网页的隔离样本证据；阶段 0I 未通过前禁止继续运行或升级为生产依赖。 |
| `docs/development/pocs/r028/**`（原 16 个 untracked） | Compact completed | 生产 Chat Timeline 已接入并完成 PC 验收；删除平行应用、测试、构建配置、独立 package/lockfile，只保留一份压缩 README。 |
| `docs/development/pocs/r029/**`（原 12 个 untracked） | Compact completed | App Server/SDK thread 已拒绝，生产改为 `exec --ephemeral` 并有 Session 零新增回归/acceptance；删除旧探针、POC Skill、独立 package/lockfile 和配置，只保留一份压缩 README。 |
| `.agents/skills/interview-product-category/{SKILL.md,agents/openai.yaml}` | Rewrite | 现有 Skill 只复制了一次一问规则，没有实际组合 `grilling`＋`domain-modeling` 的行为和文档沉淀纪律；按 `skill-creator` 最小更新并重新校验。 |
| `packages/shared/src/category-interview.ts`、`packages/shared/tests/category-interview.test.ts` | Keep＋Rewrite | 保留 Message/Decision/Unresolved/Brief 分离和 strict typed output；补有来源主动调查、任务书充分性和不依赖持久 Codex thread 的 contract。禁止把空 `factReferences` 或固定少量属性视为完成。 |
| `packages/db/src/productKnowledge{Schema,Client}.ts`、对应 tests、`drizzle/product-knowledge-postgres/**`、DB package/config | Keep＋Rewrite（Session 部分已完成） | PostgreSQL、职责分表和 append-only 事实保留；`codexThreadId` 已从 schema/contract 删除并生成追加 migration，未 reset 现有数据库。 |
| `packages/workbench/src/categoryInterviewModule.ts`、其 integration test、`productKnowledgeWorkbench.ts` 及测试 | Keep＋Rewrite | 保留 Workbench 作为消息/决定/Brief 单一事实源、revision 和失败记录；改写 runtime continuation、主动调查阶段和任务书完成门。 |
| `packages/workbench/src/codexAppServerClient.ts`、`codexCategoryInterviewRuntime.ts`、相关 package/config | Delete＋Rewrite（已完成） | 删除 App Server client、`thread/start/resume`、`codexThreadId` 和只服务旧路径的 JSON-RPC/stream-json 依赖；runtime 改为 `codex exec --ephemeral`，fake 与真实验收均证明 Session 零新增。 |
| `apps/api/src/routes/categoryInterviewRoutes.ts`、API tests、`apps/web/src/pages/CategoryInterviewTimeline.tsx`、`apps/web/src/lib/api.ts` 相关采访部分、SSE/assistant-ui 依赖 | Keep＋Rewrite | HTTP/SSE 与 ExternalStoreRuntime 是可复用薄 adapter；改写为新 runtime contract，并从真实页面验证一次一问、恢复、取消、失败和确认，不保留文案反推。 |
| `apps/web/src/pages/{ProductProjectWorkspacePage,ProductProjectForm,CategoryDefinitionSection,ScopeCollectionSections}.tsx`、form model/labels、App/AppShell/styles | Keep＋Rewrite | 保留任务书确认后的检查修改面和项目浏览；禁止恢复第二套从零创建事实源。UI 只在真实采访门通过后验收。 |
| `packages/workbench/src/productProjectModule.ts`、`productPipelineModule.ts`、DBOS pipeline 及 tests、`apps/api/src/routes/productProjectRoutes.ts` | Keep＋Rewrite composition | 冻结 project 和 durable pipeline 不变量保留；当前 ProductPipeline 只在测试注入，生产 `apps/api/src/index.ts` 未注入，不能称完整链路。待批量 plan handler 存在后接一次真实组合根。 |
| `packages/shared/src/{evidence,source-access}.ts`、Evidence tests、`packages/workbench/src/{evidenceModule,evidenceCandidateValidation,evidenceError,cacacheContentStore,contentHash,projectEvidenceReader}.ts` 及 tests | Keep | 请求/观察/最小不可变证据、对象关系、SRI/CAS 和按目标充分性是有效不变量；保留并作为后续批量规划的下游 seam。 |
| `apps/api/src/routes/evidenceRoutes.ts`、API evidence tests、`packages/worker/src/{publicWebTextSource,documentExcerptSource,energyLabelRecordSource,cnisRegistryTableSource,sourceTextLocator,sourceAccessError}.ts` 及 tests | Rewrite production entry | Source adapter 中真实外部协议、HTTPS allowlist、typed failure 可复用；当前四类 POST 由调用者手填 URL/selector/requiredText/型号，并在 HTTP route 临时创建单条 EvidenceRequest，必须移出正式用户入口，改由 Acquisition Planning 批量编排。 |
| `apps/api/src/{index,server,config}.ts`、`.env.example`、各 workspace package/tsconfig、root lockfile | Partial Rewrite | 采访 runtime 已改为无状态 ephemeral exec 并收敛旧依赖；四类手工 source 与未注入 ProductPipeline 仍待恢复顺序第 6/7 项处理，当前不得顺手扩张。 |
| `apps/api/data/evidence/**`（原 16 个 untracked CAS 文件） | Delete completed | 已从源码工作树移出并原样迁移到根目录忽略区 `data/evidence`；API 现在将 Evidence/Knowledge Package 相对路径锚定仓库根，`.gitignore` 同时阻止 `apps/*/data/` 再次进入 Git。Evidence 字节未丢失。 |
| 2026-08-16 全局 Codex `sessions` 中与 cwd/POC/采访相关记录 | Delete/Archive candidate | 只读盘点发现当日有 `18` 个 cwd 指向本仓库的 JSONL，其中包含正常 Codex 对话、R-029 探针和采访尝试，不能按 cwd 整批删除。下一步必须按 session id、首个业务输入和来源逐条生成精确清单；用户确认前不删除。 |
| `packages/worker/src/adapters/{reddit,x}.ts`、既有 DBOS 恢复修改等非本轮采访/采集修复 WIP | Preserve | 属于共享 dirty worktree 的既有修改；除非依赖收敛证明必须联动，否则不借本轮顺手重构或回退。 |

已确认的两条生产路径：

1. 采访旧路径已重写：`apps/api/src/index.ts` → `openProductKnowledgeWorkbench` → `CategoryInterviewModule.runTurn` → `codexCategoryInterviewRuntime` → `codex exec --ephemeral`；每轮从 Workbench typed state 重建上下文，不写 `codexThreadId`，不创建/恢复 Codex thread。
2. 收集：`apps/api/src/index.ts` → 四个 Source adapter → `registerEvidenceRoutes` 的人工单条 POST → route 内创建 EvidenceRequest → capture/commit。`ProductPipelineModule` 只在测试注入，生产组合根不可达；该路径必须 Rewrite 为 `MarketUniverseVersion/Knowledge Need → batch EvidenceRequest → Source Access → Evidence`。

本轮 Patch Disposition：没有删除任何文件或 Session；Keep 项保护的真实不变量如上，Rewrite 项按第 9 节顺序推进，Delete candidate 只有在精确目标、影响和恢复方式确认后执行。

## 6. 调研与实现硬门

R-026 当前结论：

- 已接受：W3C selector 语义、Playwright 定点 screenshot/clip、现有 `cacache` 作为最小证据 CAS；
- 已通过 POC：`unpdf` PDF 单页、`libarchive-wasm`＋`read-excel-file` RAR/XLSX 最小区域、`sharp` 整图 hash/格式/尺寸/单帧与 macOS/Linux 安装门；
- 待 POC：动态页面；Stagehand 在未知 DOM 上寻找候选；Tesseract.js 中文印刷 OCR；图片裁片原图一致性；任何多模态模型；
- 已拒绝：Firecrawl 作为 Workbench 基础设施，原因是 AGPL、自托管多服务、默认截图/Cloud 能力差异、全量/远程内容边界和退出成本。

候选未完成真实 POC 前不得进入生产依赖或写成既定架构。任何新的 Codex/模型用途必须先与用户确认任务粒度、输入输出、modelId、推理深度、数据边界、批次和人工门。

## 7. 人工参与边界

预期人工动作：

- 在品类采访中确认研究目标、边界、质量/成本/时效取舍和最终 Category Research Brief；系统不得要求用户枚举可自行调查的品牌、型号、参数、部件、原理或来源；
- 批次级确认知识范围、权威来源与证据政策；
- 必要时完成登录/验证码（登录部分不属于本轮能力承诺）；
- 批量处理来源冲突、证据不足、对象/图片关系不明、异常值和模型候选；
- 批准品类定义变化和知识包发布。

系统不得每遇一个未知字段就暂停整个运行。人工频次目前不足以给数字；阶段 1B 必须报告每 100 个请求/候选的例外数量、原因、可批量比例和耗时，数据出来后再决定产品门槛。

## 8. 当前文档改动与架构影响

本轮已更新：

- `AGENT-SCORECARD.md`：按用户明确要求追加 -5，积分 94.5；
- `RESEARCH.md`：新增 R-026、R-027，并追加 R-028 Chat Timeline 与 R-029 Codex 交互运行时/Pi 边界；
- ADR-0001 批次用途边界、ADR-0005/0010，并新增 ADR-0011、ADR-0012；
- `CONTEXT.md`、`AGENTS.md`；
- 六份产品文档中的导航、PRD、总体方案、Provider、知识包、MVP 计划；
- `ARCHITECTURE.md` 与 `ROADMAP.md`；
- 本文件；
- 新增 `packages/shared/src/evidence.ts` 与 `packages/workbench/src/evidenceModule.ts`，并在 Workbench 组合根启用；
- 数据库收窄为项目版本＋Evidence 三表，迁移从未提交 WIP 重生；
- 删除旧 Stage 3/4 contract、module、Provider/projector、route、UI、测试和直接依赖；API 不再初始化 Codex 或空 Provider。

架构影响：改变。EvidenceRequest 成为采集目的事实源，SourceObservation 拥有来源 identity/URL/typed 状态，EvidenceItem 成为观察内容事实源；充分性按每个目标对象的证据数量和独立 source identity 计算，不能以全局数量掩盖未覆盖对象。Raw Material/Snapshot/Projection 目标 contract 已被删除；Source Access、Evidence、Factory 的依赖方向和公共 seam 发生变化。

历史架构影响（已由 2026-08-16 Session 纠错覆盖 thread 部分）：Category Research Brief 成为阶段 1A 冻结研究输入的权威来源；阶段 0I 插入阶段 1A 之前，ProductProjectForm 的目标职责从启动录入改为任务书/项目草稿检查修改面。Workbench 现已进一步独占继续上下文，不再保留 Codex thread。

2026-08-16 冰箱公开网页纵切片架构影响：无变化。实现沿用 ARCHITECTURE 5.4～5.6 已确认的 Acquisition Planning → Source Access → Evidence 依赖方向；没有改变事实源、模块职责或 Evidence contract，也没有增加 Provider registry、fallback 或站点/品类字段 projector。

2026-08-16 能效备案纵切片架构影响：无变化。新增薄 `EnergyLabelRecordSource` 只隔离已 POC 的外部两步 POST JSON 协议，输出仍是现有未清洗 `EvidenceItem`；Workbench/PostgreSQL/CAS 的事实归属、Evidence contract 和依赖方向未改变。

2026-08-16 PDF 页摘录 POC 架构影响：无变化。复用既有 `document_excerpt` locator/Evidence contract，新增薄 `DocumentExcerptSource` 隔离 Crawlee HttpCrawler＋unpdf；没有改变 Workbench/PostgreSQL/CAS 事实归属。正式写入因已确认 Collection Board 缺少 `official_manual` 路线而保持阻塞，未绕过冻结范围。

2026-08-16 CNIS RAR/XLSX 纵切片架构影响：无变化。复用既有 `table_region` locator 与 `regulatory_check` 路线，薄 `CnisRegistryTableSource` 只隔离 CNIS 外部归档/工作簿布局；未改变 EvidenceItem、Workbench/PostgreSQL/CAS 事实归属或依赖方向。

2026-08-16 海尔整图 POC 架构影响：无变化。`sharp` 只增强既有图片候选的字节真实性验证；正式图片 Source/API/UI 尚未接入，二进制读取公共 contract 未改变。该 contract 获确认前保持 HARD STOP，不以 POC 冒充功能完成。

2026-08-16 R-029 纠错架构影响：无变化。没有修改生产模块、事实源、依赖方向或公共 contract；只删除越界的隔离 POC 产物并纠正候选证据。此前由单一“不调用工具”样本外推 TypeScript SDK 缺少富事件的判断作废。

2026-08-16 Session 持久化纠错架构影响：改变。删除 App Server thread 事实与 `codexThreadId` 公共/数据库 contract；Workbench 成为多轮继续上下文的唯一拥有者，Codex 改为官方稳定 `exec --ephemeral` 私有执行 adapter。同步更新 R-029、ADR-0012、ARCHITECTURE、ROADMAP、CONTEXT 和 migration；沿用本机 Codex 登录，不新增 Provider/API 凭证。

2026-08-16 第 5 项真实验收中间修复架构影响：无变化。typed `question` 已由 Codex adapter 产生，但 Workbench 时间线只持久化 `assistantText`；在既有 adapter seam 增加确定性投影，确保问句可见，不新增事实源、公共 contract、fallback 或模块职责。旧补丁没有删除；保留 typed question，重写其用户可见投影。

2026-08-16 第 5 项主动调查完成门架构影响：澄清。Category Research Brief 公共 contract 加强为至少一条来源引用、六类 `investigatedFacts`（品牌、型号、参数、部件、原理、来源入口）及引用闭包；Codex adapter 还必须从官方 JSONL 观察到 `web_search` item 才能接收 brief candidate。事实源、模块职责和依赖方向不变；Skill 负责采访/调查行为，Workbench 仍独占消息、决定、未决项和 confirmed brief。

2026-08-16 第 5 项移动首次恢复修复架构影响：已被后续 PC-only 纠正覆盖。该工作不是当前产品要求；`restoreComplete` 条件挂载补丁已删除，不再作为阶段 0I 完成门。

2026-08-16 PC 采访主流程修复架构影响：改变。Category Interview turn 公共 contract 新增 `user_message / decision_confirmed` discriminated trigger；显式确认仍先追加 Workbench Decision 事实，再由 Web application orchestration 自动发起下一轮。系统推进不写入用户消息，Codex adapter 从 typed trigger 读取本轮语义；事实源、模块依赖和 ephemeral Session 边界不变。ADR-0012 与 ARCHITECTURE 已同步。

2026-08-16 / 6.3 监管生产批任务架构影响：改变。新增 `RegulatoryReconciliationRun` 与逐型号 typed outcome 公共 contract，以及专用 `MarketUniverseRegulatoryPipelineModule` 父/子 workflow；WorkBench PostgreSQL 仍独占 Market Universe 事实，DBOS 只拥有运行执行，API/Web 只投影。最终业务写通过冻结 candidate ID/version/hash、稳定 operation ID 和乐观锁一次生成新 candidate，取消/失败不写半版。没有新增工作流引擎、Provider registry、fallback 或监管全表枚举；ADR-0007、ADR-0013、ARCHITECTURE 与 RESEARCH 已同步。

2026-08-16 / 6.3 监管运行恢复与取消修复架构影响：澄清。保留父/子 workflow、Queue concurrency=1、稳定 ID 和最终一次 Workbench 写入；父级改为当前型号完成后再入队下一个，并记录至多一个在途子任务供取消。父运行 ID 同时作为输出 candidate operation ID；API 增加按项目读取最近运行，Web 刷新不再依赖 React 本地状态。事实源、模块职责和公共领域状态枚举不变；ADR-0007、ADR-0013、ARCHITECTURE 与 RESEARCH 已同步。

2026-08-16 / 6.3 海信集团目录架构影响：无变化。复用既有 Crawlee/Cheerio、`OfficialCatalogSource` 与 Market Universe 聚合 seam，只新增隔离海信集团官网目录/详情差异的薄 adapter 和生产组合注入；Workbench/PostgreSQL 事实归属、公共 contract、来源角色枚举和依赖方向均未改变。该集团多品牌来源保持 `partial`，不能替代海信/容声两个独立官网完成证明。

2026-08-16 / 6.3 美菱官方目录架构影响：无变化。复用既有 Crawlee `HttpCrawler`、`OfficialCatalogSource` 与 Market Universe 聚合 seam，只新增隔离美菱商城分页/型号字段差异的薄 adapter 和生产组合注入；Workbench/PostgreSQL 事实归属、公共 contract、来源角色枚举和依赖方向均未改变。

2026-08-16 / 6.3 统帅官方目录架构影响：无变化。复用现有 JSON 分页 Source 实现、Crawlee `HttpCrawler`、`OfficialCatalogSource` 与 Market Universe 聚合 seam，只补充 Leader 官方参数和品牌投影；未新增协议、事实源、公共 contract、fallback 或模块层级。

## 9. 恢复开发的唯一执行顺序

以下顺序是恢复开发的唯一控制文件。必须逐项完成并记录证据；前一项未通过时，禁止启动后一项。不得用内部 thread、手工 API、固定 fixture、组件测试或少量定点样本代替真实用户表面和生产路径验收。

1. **纠正事实与冻结扩张**：撤销 `0I 已通过`、`当前已进入 1A`、四份样本代表收集成果等错误结论；暂停动态页面、图片正式接入、电视/微波炉、数据清洗、Knowledge Factory 和新 POC。停止门：本文件的阶段判定、阻塞项与用户原话一致，且无其他权威文档继续宣称错误完成状态。
2. **旧补丁清算**：对当前 dirty diff 按文件和生产可达路径列出 `delete / keep / rewrite`，重点覆盖采访 Skill、Category Interview Module、Codex runtime、HTTP/UI、Product Pipeline、四份 Evidence 数据与全部 POC。停止门：每个保留项都能说明其保护的业务不变量；每个删除项都有影响范围和可恢复方式；未经确认不删除全局 Session 或本机数据。
3. **冻结 Session 隔离方案（已通过）**：官方稳定 `codex exec --ephemeral` 替代 App Server `thread/start/resume`；Workbench 持有全部多轮上下文。已删除 `codexThreadId` 与旧 client/依赖，完成/取消 fake 回归通过；一次真实 `gpt-5.6-terra / medium` acceptance 完成，`~/.codex/sessions` 前后新增文件为 `[]`。停止门已满足。
4. **重写系统内采访 Agent（已通过）**：Skill 已内联组合 `grilling` 的决策依赖树/一次一问/每问推荐与 `domain-modeling` 的术语挑战、具体场景、代码/资料核对；因 runtime 只读且 Workbench 是事实源，原版写 `CONTEXT.md`/ADR 的产物被正确映射为 proposed Decision、未决项和 Brief candidate。真实第 5 项发现首版 Skill 仍允许跳过调查生成空 `factReferences`，该旧完成门已清算：现在生成 brief 的同一轮必须实际搜索并打开官方来源，六类 `investigatedFacts` 全部绑定非空来源，runtime 还必须观察到官方 JSONL `web_search` item。`quick_validate.py` 与 fake 成功/拒绝回归通过；Skill SHA-256 `2a500ca0d30aab0f0cafb955d0d093eb87857f72204307b86ab49b61d8d32001`。
5. **真实采访验收（已通过）**：真实 Workbench 已完成主动调查、一次一问、推荐理由、显式决定、任务书确认、项目草稿、刷新/进程重启恢复、取消、失败与重试；PC 流程回归证明显式确认后自动进入下一问且不新增“继续”用户消息。任务书包含有来源的品牌、型号、参数、部件、原理和来源框架；全局 Codex Session 没有新增采访线程。
6.0 **覆盖与能力审计（已完成）**：已证明 7 个品牌标签只来自 3 个目录，当前 contract 不含产品类型覆盖，京东无生产 Source adapter，实际数据库无市场总体和 Evidence；13 个属性/4 个判断维度不是知识成果。证据见本文件第 11 节。
6.1 **修正 R-010 覆盖定义（已完成调研）**：已形成品牌投影＋发现来源账、型号唯一总体、分轴类型覆盖、scoped blocking unknown、官方来源矩阵、8 项 contract 缺口和 12～20 型号隔离原型计划；未修改生产 Schema。证据登记在 `RESEARCH.md` R-010/6.1。
6.2 **修正 Market Universe contract（已完成）**：20 条真实型号观察隔离原型归并为 19 个 identity，16 个拟纳入、2 个冷柜和 1 个酒柜明确分开；同型号跨官网/CNIS 只增加来源引用。共享 Schema、Workbench、API、PC 投影和测试已一次更新，显式 confirm 使用 expected version/hash 并拒绝 blocking unknown、未核验 identity 和必填分类未知。实际库旧行数为 0，JSONB 无 DDL 变化，因此没有生成空 migration。
6.3 **完成品牌官网与监管同窗分母（已通过）**：九个生产来源同窗只读并集为 737 个唯一“品牌＋厂商型号”、15 个实际目录品牌：海尔 271、统帅 49、美的系 222、TCL 44、海信/容声 16、美菱 85、康佳/新飞 6、西门子 43、荣事达 1。当前 19 个已观察品牌标签均已有来源状态：5 个独立完整目录，7 个仅有完整多品牌官方目录，2 个仅有集团 partial，荣事达仅有官方渠道 partial，米家/小米、志高、奥克斯 5 个保持 typed missing。最终生产监管批次完成 737/737：381 matched、338 not_found、18 producer_conflict、0 failed，生成 v2；399 个型号带至少一个监管生产者，358 个 blocking unknown 保留。6.3 的任务是形成可审计品牌官网/监管分母与 unknown，不把缺口冒充完成；京东仍显示“更多”，品牌与渠道市场总体要到 6.4/6.5 才能冻结。
6.4 **真正接入京东（工程前置门通过，真实访问继续停止）**：R-031/R-032 已实现通用来源 run/object/snapshot/asset、逐条落盘、失败保留、JSONL/CSV、API/PC、DBOS 逐对象持久工作项与强杀恢复；真实 60 秒窗口验收为每分钟最多 2 次，第三次在 `60.029s` 后派发。通用 JD Provider 已通过电视＋冰箱 fixture，并在没有已验证 reader 或显式政策时失败关闭。尚缺书面访问许可、真实 JD reader、三个相互冷却窗口及每窗口 1 目录＋3 详情受控探针，因此未访问京东，不能称为京东频控现实门或数据抓取已完成。
6.5 **确认 R-010 市场总体（待开始）**：完成监管、官网、官方自营和核实旗舰店的同窗并集、去重、差异及 unknown 审核。停止门：品牌、类型、型号都有可审计分母；关键 unknown 未处置时只能保持 candidate。
7.0 **冻结 Knowledge Need 矩阵（最小纵切片通过，完整矩阵待完成）**：电视任务书已显式覆盖底层概念、品类知识和型号事实；完整身份/类型/安装/规格/功能/机制/条件/边界/取舍/时点/说明书/图片矩阵仍待扩展。
7.1 **批量生成 EvidenceRequest（最小纵切片通过，完整范围待完成）**：Planner 已从 confirmed brief 的显式来源分配确定性生成请求；没有从客户端字段或 Provider 猜测。完整 Market Universe × Knowledge Need × 来源矩阵仍未完成。
7.2 **执行批量来源访问与最小证据（最小纵切片通过，完整范围待完成）**：电视真实 DOE/EPA 来源已形成 4 条 Source Dataset 和 4 条最小 Evidence；PC 又通过显式 TextQuote 选择提交 349-byte Evidence。完整官网/动态/图片/JD 范围仍待完成。
8.0 **完成 1A 真实矩阵（部分通过）**：静态 HTML、PDF 页和结构化开放数据已通过；动态页、图片、登录/验证/下架/限流、三品类/双站点和目标 Linux 门仍未通过。
9.0 **建立可审核比较知识（最小纵切片通过）**：Evidence→确定性/模型候选→Review 已在真实电视证据上产出 22 条已审核候选和 3 条关系；完整属性字典、冲突/unknown 统计、多型号与品牌范围比较仍待完成。
10.0 **建立技术原理图文知识（文本最小纵切片通过）**：电视底层显示架构、适用关系和来源定位已入候选/包；图片区域、OCR/视觉模型和完整机制质量门仍未通过。
11.0 **构建知识包与 Runtime（最小纵切片通过）**：当前 Evidence 已构建内容寻址 SQLite＋FTS5 包，支持激活/回滚、精确/筛选/全文/关系/证据查询，相同内容重建版本一致，复制单文件后离线查询通过；完整问答集和目标平台门仍待完成。
12.0 **联调与总验收（第二品类最小联调通过，正式总验收待完成）**：PC Workbench 已显示电视底层概念、型号、来源、Evidence、22 条已审核知识和激活包；完整故障矩阵、质量/人工频次、第三品类、另一机器和发布门仍未通过。

执行纪律：一次只推进一个编号；任何失败先清算本编号产生的旧补丁，再决定删除、保留或重写。公共 interface、依赖与测试策略由工程在完成调研/原型后通过 ADR 负责；新增模型用途、产品目标、业务边界、人工权限或发布取舍才提交对应负责人确认。

## 10. 当前阻塞与未通过项

- 0I 已通过，不再是阻塞项：真实 Workbench 已证明采访 Skill 的主动调查、完整负责人决策树、有来源任务书、显式确认、项目草稿、失败/取消/重试、重启恢复和 PC 主流程；确认后自动推进，不需要额外“继续”。
- Session 隔离已通过，不再是阻塞项：本轮基线时间后全局 `~/.codex/sessions` 新增文件为 0，且没有残留 `codex exec` 进程；既有全局 Session 仍不擅自删除。
- 6.2 已完成：`variantCount` 已删除；品牌 identity/监管生产者、型号身份状态、三类覆盖维度、来源完整性和 scoped blocking unknown 已进入同一版本事实。6.3 已完成来源角色 contract、专用 DBOS 生产 seam、九个生产来源的 737 型号同窗候选和 737/737 监管对账；不再继续改 Market Universe 核心 contract。容声 TLS、米家/小米厂家型号、志高/奥克斯目录等缺口作为 typed unknown 保留，下一门由 6.4 京东官方渠道补充分母。
- 京东商品规格停止门：监督式 Codex Browser 已完成 5 页目录并真实读取前 16 个详情观察，第 17 个请求进入京东安全验证；用户人工扫码后仍转入 403 频控，单次正常重试未恢复。现有本机自动化启动/连接候选仍未通过，Codex Browser 也没有 Workbench 可调用的稳定 Provider contract。当前没有从标题猜型号、没有复刻签名、没有绕过验证、没有输出 Cookie/Profile；完整 299 个详情、验证恢复和生产 Provider 门通过之前，6.4 保持未通过。
- 1A 最小真实纵切片已通过但完整矩阵未完成：R-034 已贯通电视真实 DOE/EPA→Package/Runtime；R-033 又在 Windows 隔离库贯通冰箱 NIST/USDA/能效标识→3 条最小 Evidence。开发库 USDA 当前 403、品牌官网缺明确机器采集/派生发布许可，官网完整详情/说明书、动态页、图片、三品类/多站点与目标 Linux 门仍未通过。
- 京东真实访问仍被权限和现实探针门阻塞：DBOS 逐对象持久工作项/强杀恢复、真实 60 秒窗口和本地熔断门已经通过；尚缺书面许可、已验证 JD reader、连续三个冷却窗口和受控 1＋3 探针。完成前不得访问京东，也不得把本地工程门称为京东现实频控已解决。
- 整图 hash/格式/尺寸/单帧验证已通过；裁片原图一致性仍失败关闭。图片字节暂不能通过现有 `contentText` 公共读取 contract 诚实投影，确认判别联合前不接正式图片入口。
- Stagehand/OCR/图片语义仍待原型；在用户确认新的模型用途前，不能冻结模型辅助证据寻找或图片判断方案。
- 本机 PostgreSQL 14 仅按项目需要以用户态监听 `127.0.0.1:5432`，不配置系统自启动。开发库 `domain_analysis` 当前有一个 ready 冰箱项目；NIST/能效标识运行完成，USDA 两个运行失败，Evidence 为 0。完整三证据验收只存在于已精确删除的隔离测试库，不能回填或伪装成开发库成功。
- CodeGraph 当前索引健康并覆盖本轮新增文件；结构判断继续以 CodeGraph＋类型/测试共同验证，不从 AST 索引推断运行时验收。
- Node 24 主版本门已落地；Windows 当前 Node 24.14.1/npm 11.11.0 全门可运行。依赖审计本轮被配置的 `npmmirror` 以 `/-/npm/v1/security/* not implemented` 阻塞，不能沿用旧机器的漏洞数量冒充当前结果，也未执行 `audit fix`。
- 本轮尚未授权 commit/push；完成本地实现不等于远程已交付。只有用户明确要求交付后，才核对工作区范围、远程 SHA 和 ahead/behind。

### 1.1 其他来源实际采集审计（2026-08-17）

- 九个品牌官网来源历史隔离运行分别得到：海尔 271、统帅 49、美的系 222、TCL 44、海信/容声 16、美菱 85、康佳/新飞 6、西门子 43、荣事达 1，共 737 个唯一“品牌＋厂家型号”。监管对 737 个型号的结果为 381 matched、338 not_found、18 producer_conflict。
- 这些数字只证明当时读取过目录并完成 identity 投影。生产 `OfficialCatalogEntry` 每项只允许 `brand / manufacturerModel / sourceItemId / sourceUrl`，另有可选 identity 状态、监管生产者和分类；没有商品详情参数、功能文案、图片、价格、库存、说明书或评价。
- 各 Crawlee 来源使用 `MemoryStorage({ persistStorage:false })`；原始目录 JSON、详情 HTML 和请求队列没有持久化。历史监管批次所在隔离 PostgreSQL、临时证据目录和一次性脚本已经删除。
- 当前开发库 `market_universe_versions=0`，所以 737 个 identity 仍没有保存在当前 Workbench。2026-08-18 已新增一个真实冰箱项目及 NIST/USDA/能效标识来源运行，但该批次因 USDA 403 未形成 Evidence；此前“5 个 observation/3 个 fixture Evidence”只属于 2026-08-17 审计时点，不能继续当作当前库状态。
- 因此准确结论是：“九源目录 identity 纵切片和监管对账曾在隔离环境跑通，但没有形成当前可查看的品牌官网原始资料库。”不得再说“其他官网数据已抓完”。
- 本轮仅只读审计，没有删除12个项目行、测试 observation/evidence 或任何文件。后续是否清理必须先识别每行归属并取得单独授权。

下一步第一条可执行动作：继续停留在 `ROADMAP.md` 阶段 1A 冰箱纵向第 6 步，先取得或选择一条明确允许本地读取、最小证据保存、模型输入和派生发布的品牌型号详情/说明书来源，再把它作为 confirmed brief 的新 source assignment 走既有 `Planner → DBOS → Provider → Source Dataset → Evidence`。在许可或外部状态变化前不重试当前 USDA 403，不访问京东，不重写已通过的 typed contract、逐条持久化、PC 查看、导出和 DBOS 恢复。

## 11. 本轮当前验证证据

以下条目是历史组件、POC 或人工定点样本证据，只用于保留审计链；任一条都不能单独证明阶段 0I、1A、真实系统内采访 Agent 或批量数据收集已经完成。

- 2026-08-18 / R-033 Windows 冰箱小批次：隔离 PostgreSQL 中 NIST、USDA、中国能效标识三个 lane 均 `succeeded`，分别形成 1 条可访问快照和 1 条最小 Evidence；美的说明书 `waiting` 且零请求。Planner 同 Provider/政策的跨 lane 幂等碰撞已由失败回归定位并修复为绑定 lane＋完整 work items。开发库项目 `project-225f3d6a-ab31-4ce6-b136-b6f1cf74a010` 只显示 NIST/能效成功与 USDA 两次 typed 403 失败，Evidence 为 0；PC Workbench 已核对该部分状态，没有第三次重试、没有访问京东。
- 2026-08-18 / Windows 工程门：`@libsql/client` 的不确定文件句柄已由 Drizzle 官方支持的 `better-sqlite3@12.11.1` 替换；知识包 native 边界支持 Windows 命名空间长路径，legacy SQLite/API 显式关闭连接。定向受影响测试 `22/22`；全新隔离 PostgreSQL 全仓 `63 files passed / 2 skipped`、`225 passed / 2 skipped`，测试库已整库删除。七个 workspace typecheck 与 production build 通过；Web 2,316 modules、主 JS 688.24 kB / gzip 202.24 kB，保留既有 >500 kB warning。
- 6.3 监管生产与真实批次：隔离业务库经真实生产 API 从海尔 271、美的系 222、TCL 44 得到 537 个唯一型号；运行 `market-universe-regulatory:29d4883c158a05ce33db5c682b2b81aef8db8b11a395ca8a2ed3ba2192cb426d` 完成 537/537，结果为 matched 274、not_found 251、producer_conflict 12、failed 0，并生成 v2 candidate。v2 仍为 537 型号、537 identity confirmed、286 个型号带监管生产者；监管全局 unknown 被移除，251 个未找到与 12 个冲突转为逐型号 blocking unknown，另保留京东与其余品牌来源阻塞。隔离 PostgreSQL 和 131,072-byte 临时 SQLite 已精确删除，未写开发库。
- 6.3 恢复/取消回归：旧 Web 只把 run ID 放在 React state，刷新后看不到正在运行；旧父 workflow 又预先入队全部子任务，取消父级仍可能继续访问。旧补丁处置为：保留 DBOS Queue/稳定 ID/最终一次写入，重写逐项入队、在途子任务取消和服务端 latest-run；删除输出 candidate ID 的二次 hash。真实 PostgreSQL 集成 `2/2` 证明成功运行可刷新恢复，取消后最多访问一个已在途型号且不写候选；API/Web 定向 `29/29`。全新隔离 PostgreSQL 全仓 `37` 个测试文件 / `140` 项通过，`1` 个真实模型 acceptance 按设计跳过；测试库已精确删除。
- 6.3 海信集团真实目录：标准 TLS/Crawlee concurrency=1 读取官方类目声明 21、发现详情链接 21、详情成功 21；title/meta/主标题可明确确认 20 行，按品牌＋厂商型号得到 16 个唯一 identity，品牌为海信和容声。产品 1340“海信222冰箱”只在图片 alt/文件名出现 `BCD-222WTDGS`，按失败关闭规则不纳入。生产 Source 标为 `multi_brand_official_catalog/partial`；fixture 回归与 API 四源组合 `9/9`、worker/API typecheck 通过。没有保存完整页面、Cookie、Profile 或认证信息。
- 6.3 美菱真实目录：官方类目接口确认冰箱 `columnId=721`，生产 Crawlee `HttpCrawler` 以 concurrency=1 读取 5 页、93/93 个在线 SKU，得到 85 个唯一厂商型号；8 组重复为颜色/SKU，不新增型号 identity。`400WP9BT`、`505WP9BT`、`503WP9BT`、`506WQ3ST`、`MRF-205WPBG1` 等按官网原文保留，不擅自补 `BCD-`。官网返回非标准 `text/json`，adapter 复用 Crawlee 官方 `additionalMimeTypes` 能力显式允许，没有自研 HTTP。生产 Source 标为 `independent_brand_catalog/complete`；定向测试 `13/13`、六 workspace typecheck、隔离 PostgreSQL 全仓 `37` 文件 / `142` 项通过，`1` 项真实模型 acceptance 按设计跳过；隔离库已精确删除。
- 6.3 统帅真实目录：官方 `leader_product/getProduct` 对 `channelId=41824`、`psale=0` 声明 49、读取 49、缺失型号 0、唯一型号 49；复用已有 JSON 目录分页实现并接入第六个生产来源，标记为 `independent_brand_catalog/complete`。定向测试 `14/14`；最终隔离 PostgreSQL 全仓 `37` 文件 / `143` 项通过，`1` 项真实模型 acceptance 按设计跳过，隔离库已精确删除。
- 6.3 六源当前并集：同一轮真实只读枚举得到海尔 271/271、统帅 49/49、美的 384/384（接收 284 SKU、222 identity）、TCL 44/44、海信集团 21/21（接收 20、16 identity、partial）、美菱 93/93（85 identity），合并为 687 个唯一“品牌＋厂商型号”和 11 个实际目录品牌。没有写开发库；新增的 150 个 identity 尚未跑监管，待品牌来源稳定后统一对账。
- 6.3 九源最终并集与监管：同一轮真实枚举得到海尔 271、统帅 49、美的系 222、TCL 44、海信集团 16、美菱 85、康佳集团 6、西门子 43、荣事达 1，合并为 737 个唯一“品牌＋厂家型号”和 15 个实际目录品牌。康佳集团 7/7 商品排除 1 个冷柜后接收 6；西门子“商城在售”46/46 排除 2 个酒柜和 1 个独立冷冻箱后接收 43；荣事达当前产品中心重复两次均为 1/1、`partial`。全新隔离 PostgreSQL 的生产监管运行 `market-universe-regulatory:9eed9da331b59fd56e76beb1d77267b64ba1978cac67acfbc49b78cf3101ba4f` 完成 737/737：matched 381、not_found 338、producer_conflict 18、failed 0；生成 v2，737 个 identity confirmed，399 个型号带监管生产者，358 个 blocking unknown 保留。隔离数据库、临时证据目录和脚本已精确删除，开发库未写入。
- 2026-08-16 / 6.3 最终官网与监管门架构影响：无变化。新增康佳集团、西门子和荣事达薄来源 adapter，并为所有 Crawlee Source 注入每次枚举独立的官方 `MemoryStorage`，修复重复刷新误复用持久请求队列；未改变 Workbench/PostgreSQL 事实归属、公共 Market Universe contract、Provider 职责或依赖方向。Patch Disposition：保留已验证九源 adapter、DBOS 父/子 Queue 和最终一次业务写；重写过时的新飞 partial/西门子 candidate 文档；删除一次性监管运行脚本与隔离资源。Node 24.12.0 / npm 11.6.2 下六 workspace typecheck、production build、`git diff --check` 通过；全新隔离 PostgreSQL 全仓 38 文件 / 147 项通过，1 个真实模型 acceptance 按设计跳过，测试库已整库删除。Web 2,307 modules、主 JS 655.65 kB / gzip 194.94 kB，保留既有 >500 kB warning。
- 2026-08-16 / 6.4 京东生产候选：新增薄 `JdOfficialRetailSource`，复用 Crawlee `BasicCrawler`/独立 `MemoryStorage` 与 Patchright 1.61.1 的系统 Chrome 持久 Profile；目录 5 页只发现自营 SKU，详情只以“品牌＋能效网规格型号＋类型”确认 identity，冷柜计读取但排除，标题永不入库。API 刷新成功时并入第十来源；typed 访问失败时保留九个官网结果并写 scoped `source_access` unknown。新专用 Profile 两次真实运行均返回 `verification_required`；第二次证明重定向竞态修复后无执行上下文异常，没有绕过验证或输出 Cookie/Profile。现有 shared `SourceObservation` 由 `EvidenceRequest` 拥有，只属于 7.1/7.2；6.4 按 ADR-0013 使用 `OfficialCatalogSnapshot`/scoped unknown，未提前伪造 EvidenceRequest。后续差分诊断又证明历史旧 Profile和无 Profile Patchright均进入 `risk_handler`，Playwright空骨架、Puppeteer频控、普通 Chrome＋CDP临时 Profile进入登录页；同时 Codex普通浏览器无需登录即可读取 `MC-186DMD` 等26项规格。因此“人工验证即可完成”结论作废，当前根因边界改为自动化浏览器表面差异。Patch Disposition：保留分页/详情 parser、九源成功隔离和 typed failure；重写页面状态检测并分开“详情已读取数/冰箱接收数”；删除“持久 Profile/登录是前置”的结论和未被既有 contract 接受的 `official_direct_retail` coverageKind 尝试。架构影响：澄清，Workbench/PostgreSQL 继续拥有 Market Universe，公共 contract、事实源和依赖方向无变化。Node 24.12.0 / npm 11.6.2 下六 workspace typecheck、production build、`git diff --check` 通过；全新隔离 PostgreSQL 全仓 39 文件 / 151 项通过，1 个真实模型 acceptance 按设计跳过，测试库已整库删除。Web 2,307 modules、主 JS 655.68 kB / gzip 194.98 kB，保留既有 >500 kB warning。6.4 仍因生产浏览器 Provider 未通过三商品真实门，不能进入 6.5。
- 2026-08-16 / R-012 京东浏览器候选重评架构影响：澄清。OpenAI 官方文档确认 Codex 内置 Browser 仅在 ChatGPT/Codex 桌面会话可用，使用独立 Profile、站点权限和敏感操作确认，不在 Codex CLI/IDE 提供任意本地 Worker API；Chrome DevTools MCP 1.7.0 为 Apache-2.0、Node 24 可用且当前 Chrome 151 满足版本门，但可信 Profile `--autoConnect` 需要用户现场开启远程调试并点 Allow，且可读取整个所选 Profile。结合专用 CDP 原型失败，当前候选均未满足无人值守和最小权限门。Patch Disposition：删除 Patchright 的优先生产候选结论、自动浏览器生命周期、`JD_BROWSER_PROFILE_DIR` 配置和生产依赖；保留 Crawlee 编排、注入式 parser、typed failure、九源隔离与历史 POC；生产 bootstrap 未注入合格 reader 时立即 `source_abnormal`，不启动浏览器、不访问京东。未新增替代 Provider、fallback 或公共领域 contract；仅删除未交付 WIP factory 的失效 `profileDir` 输入。ADR-0004 已同步修正，6.4 继续失败关闭。Node 24.12.0 / npm 11.6.2 下定向 `12/12`、六 workspace typecheck、production build 和 `git diff --check` 通过；全新隔离 PostgreSQL 全仓 `39` 文件 / `152` 项通过，`1` 项真实模型 acceptance 按设计跳过，测试库已精确删除并复核不存在。Web 2,307 modules、主 JS 655.68 kB / gzip 194.98 kB，保留既有 >500 kB warning；依赖安装仍报告 1 low/6 moderate/10 high/3 critical，未擅自执行 `audit fix`。
- 最终工程门：Node 24.12.0 下六 workspace typecheck 与 production build 通过，Web 2,307 modules、主 JS 655.53 kB / gzip 194.87 kB，保留 >500 kB 非阻塞 warning；`git diff --check` 通过，相关生产文件均小于 500 行。一次隔离全仓命令误用了本机不存在的 `postgres` 角色，26 个集成测试在鉴权前失败；该精确临时库已删除并验证不存在，改用实际本机角色后 143/143 通过，未触碰开发库。
- 6.3 测试库纠错：首次 139 项全仓门误把开发库作为测试库，产生 11 个可精确识别的测试项目、8 个测试 Market Universe 及 4 个本轮 DBOS test schema。已在事务内只删除这些测试项目的关联行和对应 1 个测试采访会话，并精确删除 4 个测试 schema；复核本轮测试项目数 0、测试 schema 数 0，03:33 的真实“家用冰箱品类知识项目”仍为 draft。随后新建独立数据库 `domain_analysis_codex_test_20260816_1720` 重跑 139/139 通过并整库删除。该事故未删除真实项目，但以后 PostgreSQL 全仓门只允许使用本轮新建且可整库删除的测试库。

- Session 隔离当前证据：官方稳定 CLI 文档明确 `codex exec --ephemeral` 不持久化 rollout；旧 App Server 路径的 fake 红灯会写 `rollout-pollution.jsonl`，改写后的完成/取消测试 `2/2` 通过；真实 acceptance 用 `gpt-5.6-terra / medium` 完成一轮，断言 `~/.codex/sessions` 新增文件为 `[]`。Workbench/DB/API typecheck 全通过；Drizzle 生成 `0003_wide_zombie.sql` 只删除 `codex_thread_id`。未删除任何既有全局 Session。
- 第 5 项真实 Workbench 主流程：原 session `interview-session-03a1a45c-7c29-4782-a493-7d5001f1c34c` 已完成五项负责人取舍的显式确认、主动调查、任务书确认和项目草稿创建；当前 `confirmed/idle/revision 32`。confirmed brief 为 `category-brief-e9e7133a-39e3-4c06-abbd-da7845c4fa52`，项目为 `project-64f8c93f-53d2-4d27-ac1d-55cabf8439fc`。进程完整重启后 API 仍从 PostgreSQL 重读同一 session、brief 和 project 关联，证明不是进程内状态。
- 任务书调查门真实证据：同一轮实际搜索并打开海尔官方型号页、国家标准平台 GB 12021.2-2025 和市场监管总局 2026 能效标识规则，共 3 条 `factReferences`；六类事实覆盖品牌、型号 `BCD-500WGHFDB5XAU1`、参数、部件、风冷/双变频原理和来源入口。海尔页可核对 500 L、830×1900×594 mm、283/185/32 L 分区、0.88 kW·h/24h、35 dB(A)、6.5 kg/12h、变频压缩机和变频离心风机。样本只验证研究框架与来源可达性，没有冒充市场总体或批量采集完成。
- 取消/失败/重试真实表面：隔离 QA session `interview-session-8b18d308-a866-4ee7-a76a-fbf5ecdf3c34c` 在 Workbench 点击停止后持久化为 `interrupted`，只有用户消息、没有伪造 assistant 完成；用无效 model 启动后页面显示失败消息与重试按钮，恢复正确 model 后点击同一按钮成功，原用户消息未重复。
- 历史移动表面证据：曾完成 390×844 检查，但用户已明确本产品是 PC Workbench；该证据不再属于当前通过门，也不再投入移动适配工作。当前有效表面是 1280px PC Workbench。
- Session 隔离复核：从 `2026-08-16 08:55:35` 起按全局 Session 文件 birth time 核查，新增文件为 0；没有残留 `codex exec` 进程。ChatGPT/Codex App 自身已有进程未被本项目创建，也未终止。
- 当前 Homebrew PostgreSQL 启动前没有 `domain_analysis` 数据库，昨晚四份样本不在该实例。为真实用户表面验收新建空的本机 `domain_analysis`，使用 Unix socket 连接并追加执行 0000～0003 migration；没有覆盖、drop/reset 其他数据库，也没有把旧样本冒充当前数据。API 4000、Web 6173 与 Homebrew PostgreSQL 当前保持运行，供第 6 项继续。
- 第 5 项最终回归：Node `v24.19.0`、全新临时 PostgreSQL 上 `31` 个测试文件 / `118` 项测试全通过，`1` 个真实模型 acceptance 按设计跳过；测试库 `domain_analysis_codex_step5_20260816` 已精确删除。全 workspace typecheck 与 production build 通过；Web 2,305 modules，主 JS 638.73 kB / gzip 190.01 kB，保留 >500 kB chunk 警告。`git diff --check` 通过。
- 第 5 项继续到五项负责人取舍全部显式确认后，真实模型生成了 draft brief，但其 `factReferences=[]`，且没有品牌、型号、参数、部件、原理的有来源调查事实。该草稿未确认、未生成项目；这是“主动调查完成门缺失”的真实失败，不是可接受的部分完成。
- 本轮旧补丁处置：保留 ephemeral exec、Workbench 状态归属、一次一问和显式确认；删除移动专用 `restoreComplete` 条件挂载与所有成功 assistant 消息上的通用 Reload；重写 turn contract 和 Web orchestration，使确认后自动推进且不合成用户消息。临时 PC Playwright config/spec、失败 trace 和 test-results 在验收后清除。
- R-010 真实官网候选：生产 API 在隔离 PostgreSQL 中从海尔中国冰箱目录读取 271/271 行、唯一型号 271；从美的官方商城读取 384/384 行，按冰箱类目和在售状态接收 284 行，按品牌＋厂商型号去重为 222；从 TCL 中国官网读取 44/44 行并得到 44 个唯一型号。合并枚举 699 行、接收 599 行，得到 537 个唯一型号、7 个品牌；62 个美的系重复行保留为同型号 SKU/颜色变体计数。版本状态为 `candidate`，3 类 unknown 明示监管交叉、京东官方自营和其他品牌目录。
- R-010 PC 表面：1440×1100 Chrome/Playwright 真实打开 Workbench，显示 537、三行来源对账、3 项冻结缺口和“候选版本 v1·未冻结”；body `scrollWidth=clientWidth=1440`，axe 违规 0。未做移动端工作。
- 2026-08-16 PC Workbench 信息架构纠正：新品类采访与项目详情改为互斥模式，项目内使用“概览 / 市场总体 / 原始证据”阶段导航；草稿项目前置条件未满足时后两项禁用，不再把采访面板堆在冰箱项目上方。1280px 真实 PC 页面验证项目模式采访区域为 0、采访模式只有一个标题且项目详情为 0、横向溢出为 0；Web typecheck 通过，x64 Node 21 production build 通过（2,307 modules，主 JS 641.94 kB / gzip 190.93 kB，保留 >500 kB 警告），`git diff --check` 通过。架构影响：无变化；只纠正 Web 组合与信息层级。
- 2026-08-16 覆盖与下游能力审计：当前实际 PostgreSQL 只有 1 个 draft 项目，`market_universe_versions / evidence_requests / source_observations / evidence_items` 均为 0。历史 537 型号候选来自海尔、TCL 和美的商城 3 个目录；所谓 7 品牌为海尔、美的、COLMO/科慕、东芝、小天鹅、华凌、TCL，其中 5 个品牌标签来自同一美的商城，不等于 7 个独立品牌官网已覆盖。`MarketUniverse` 当前只记录品牌、厂商型号和变体计数，没有产品类型/门型/安装形态等分类维度，因此品牌覆盖未完成，类型覆盖目前甚至不可计算；京东没有生产 Source adapter、没有型号观察或 EvidenceItem，只保留 403/验证边界下的 typed unknown。项目草稿中的 13 个属性、4 个判断维度和 4 个能力问题只是待确认研究范围，不是已采集知识；当前没有生产 Knowledge Factory、知识包或 Runtime，不能提供品牌间/型号间证据化比较，也不能提供技术原理的图文知识查询。架构影响：澄清；暴露 R-010 contract 缺少类型覆盖维度，修改跨模块 contract 前须单独完成调研与确认。
- 2026-08-16 执行顺序文档化：`ROADMAP.md` V0.6 已把冰箱纵向拆为覆盖定义、Market Universe contract、品牌/监管分母、京东实采、R-010 冻结、Knowledge Need、批量 Evidence、比较知识、图文知识和 Runtime 的顺序停止门；本文件用 6.0～12.0 记录唯一当前项及完成证据。架构影响：无变化；本轮只明确计划和进度控制，不冻结 taxonomy、不修改公共 contract、不新增 adapter。
- 2026-08-16 / 6.1 官方调研：GB/T 8059—2025 给出四类按主要间室用途划分的监管产品类别；能效备案提供生产者/规格型号而非品牌/在售；当前京东自营冰箱页公开显示至少 48 个品牌标签和多个相互独立筛选轴，但三个商品详情均进入 risk handler。由此冻结候选语言：型号是唯一总体，品牌完整性另看发现来源账，类型是逐覆盖维度投影，监管类别、市场形态和技术配置不得混成一个字段；重复目录行/跨来源引用不是 Product Variant。生产代码审计另发现 `variantCount` 混计重复观察、unknown 无 scope/reason/blocking、basis/status 语义重叠且没有 confirm 命令等 8 项缺口。架构影响：澄清；尚未改变事实源、公共 contract、依赖方向或生产代码，等待 6.2 人工确认。
- 2026-08-16 / 6.2 Market Universe contract：20 条真实型号观察原型、共享 Zod、Workbench 聚合/确认事务、API、PC 投影和测试已完成；删除 `variantCount`，增加品牌 identity/监管生产者、identity 状态、三类覆盖维度、来源 completeness 与 scoped blocking unknown。Node 24.12.0 arm64 下 104 tests 通过、30 条件跳过，临时 PostgreSQL 集成 2/2，全 workspace typecheck/build 与 1440×900 PC 表面通过；真实库未写入。架构影响：改变；Market Universe 公共 contract 与确认命令改变，事实源和依赖方向不变，ADR-0013 与 ARCHITECTURE 已同步。
- 2026-08-16 / 6.3 品牌/监管同窗：`OfficialCatalogSnapshot` 来源账增加 `coverageKind / coverageStatus / observedBrandKeys`，明确区分独立品牌目录、多品牌官方商城、监管按型号查询和官方渠道发现。能效公开接口不能按 `data.total=500` 判定结束：pageSize 100 的第 6 页仍返回 100 条不同记录，且产品类型 81 混合冰箱与冷柜，因此拒绝监管全表枚举。薄 `EnergyLabelRegulatoryCatalogSource` 对官网已知型号逐项交叉；真实 `BCD-501WSPM(Q)`、`BCD-500WGHFDB5XAU1`、`R555Q10-SS` 全部 matched，共 4 条备案，海尔同型号两条备案被保留且生产者一致，不再误判异常或无意义重试。全仓门更新为 Node 24.12.0 arm64 下 106 tests 通过、30 条件跳过，六 workspace typecheck、production build 和 `git diff --check` 通过；Web 2,307 modules、主 JS 650.42 kB / gzip 193.58 kB，保留 >500 kB warning；Market Universe 临时 PostgreSQL 集成 2/2，测试库已精确删除，真实库未写入。架构影响：澄清；来源 contract 增加可审计角色，但 Workbench/PostgreSQL 事实归属、依赖方向和确认门不变。生产批次接线仍未完成，6.3 不能标记通过。
- 2026-08-16 / 6.3 DBOS 批任务 POC：CodeGraph 证明现有 `runStage` 将整个 handler 包成一个 `DBOS.runStep`，不能直接逐型号恢复。复用已接受的 DBOS 4.25.14 Queue 做隔离原型，3 个子 workflow 在 concurrency=1 下由父 workflow 收齐结果；强杀后已完成 M1 未重跑、进行中的 M2 按至少一次语义重做、M3 接续，执行序列 `M1/M2/M2/M3` 且最终结果完整。临时库、marker 和脚本已删除。架构影响：澄清；证明候选组件满足恢复门，但尚未修改公共 Pipeline contract、模块职责或生产组合根。下一步涉及公共 batch seam，未确认前保持候选。
- 2026-08-16 / Node 运行门：Node/npm version 事实源统一为根 `engines`，`.nvmrc` 负责本机选择，`.npmrc engine-strict` 阻断错误安装，npm 11 `devEngines` 与 `check-node-version@4.2.1` 阻断错误脚本运行。实测系统 Node 21.7.3/npm 10.5.0 下 install 与 typecheck leaf 均在业务执行前失败；Node 24.12.0 arm64/npm 11.6.2 下 106 tests 通过、30 跳过，六 workspace typecheck、production build 和 `git diff --check` 全通过。架构影响：无变化；只固定开发运行基线，未改变产品模块、事实源或公共业务 contract。
- R-010 全仓门：全新 PostgreSQL 上 `35` 个测试文件 / `130` 项通过，`1` 个真实模型 acceptance 按设计跳过；六个 workspace typecheck、production build 与 `git diff --check` 通过。Web 为 2,307 modules，主 JS 639.55 kB / gzip 190.34 kB，保留既有 >500 kB chunk 警告。首次门禁只因 Unix socket 简写 DSN 缺少 DBOS 要求的 username/hostname 而失败，未修改代码；改用本机显式 DSN 后在第二个全新数据库完整通过。真实官网/UI 验收库和全仓测试库已精确删除，没有向实际草稿项目写入候选总体。
- R-010 架构影响：改变。新增 Market Universe 公共 typed contract、Workbench/PostgreSQL 单一事实源、三个官方目录 Source adapter 与 API/PC 投影；型号 identity 固定为品牌＋厂商型号，SKU/颜色只计变体。ADR-0013、ARCHITECTURE 与 RESEARCH 已同步；TCL 仅增加同一 typed seam 的来源 adapter，未改变事实源归属，也未新增 Provider registry、模型、fallback 或 Codex Session。
- 本轮验证：x64 Node `v24.19.0`＋全新临时 PostgreSQL 上 `31` 个测试文件 / `119` 项通过，`1` 个真实模型 acceptance 按设计跳过；全 workspace build、四层定向 typecheck、`git diff --check` 通过。生产 PC 页面 1280px Playwright 红灯先稳定复现“确认后请求数为 0”，修复后 `1/1` 通过，并断言下一轮请求为 `decision_confirmed`、页面无“继续”用户消息、成功消息无“重试”。临时数据库已精确删除。
- 第 5 项移动修复回归：生产 390×844→1280 Playwright/Chrome `1/1` 通过；Web typecheck、API client `23/23` 测试和 production build 通过。Web 为 2,305 modules、主 JS 639.14 kB / gzip 190.09 kB，保留 >500 kB chunk 警告。

- 真实冰箱采访：同一 PostgreSQL session 完成一次一问、显式 confirmed decision、Category Research Brief v1 确认并生成 Product Project revision 1 草稿；实际数据库核对仍为 `draft`，未冒充项目已冻结。刷新恢复不依赖 localStorage 作为事实源。两次 strict schema 失败均持久化明确错误，修复 nullable/非枚举 `allowedValues` seam 后用同一用户消息重试成功。
- 真实来源访问：Crawlee `3.18.1` 在 Node `v24.19.0` x64 访问海尔官方 `BCD-500WGHFDB5XAU1` 页面，HTTP 200；选中原始 Schema.org Product JSON-LD 3,997 bytes，SHA-256 hex `c4819d551a766ed09955c115205af4472f5de367127b8800b9571a26d47e529d`。缺失型号样本在成熟重试后返回 typed `evidence_not_found`；`persistStorage:false`，未保存完整页面或 Crawlee 队列。
- 第二官方来源：同一 adapter 访问美的 `BCD-501WSPM(Q)` 页面，HTTP 200；选中 `#product_spec` 中 5,873-byte 未清洗 HTML 规格表文本，SHA-256 hex `3c11f72f24589a90d49c4806fad715b1f297ea742079945f6359c127e8970b06`。EvidenceRequest `request-066f8c40-75ac-4c33-8677-514c07086141`、SourceObservation `observation-15ebdf60-d41f-4639-a29f-b3a9e1c8e0aa`、EvidenceItem `evidence-ff00ae46-d4d6-41d8-8229-4b9880f29993`；SRI `sha256-PBH3LyRYmpDUnEgG+tcVsfKX6nQgeZRfY1nBJ+iXCwY=`；assessment `sufficient`。Workbench 桌面与 390px 重读均显示海尔/美的两份内容；390px 下 document/body scrollWidth 均为 390，无横向溢出。
- 真实监管来源：中国能效标识网对 `BCD-501WSPM(Q)` 返回 1,079-byte 原始 JSON，SHA-256 hex `9d7b01b670d89bdc0d40f83ff90c4832b1b6caca8722afc3016d0ce049494cc3`；EvidenceRequest `request-396fed91-eeb5-4085-9ec4-fe65d1e85c43`、SourceObservation `observation-af2a04d5-538b-4131-ad6f-319b2d7bf31e`、EvidenceItem `evidence-778aacce-674c-4b54-b78d-1ca5eb0d2f41`；SRI `sha256-nXsBtnDYm9wNQPg/+QxIMrG2ysqHIq/DAW0M4ElJTMM=`；assessment `sufficient`。首次正式组合尝试因将 JSON 文本误标为 `application/json` 被 Evidence 核心拒绝；改为已确认的 `text/plain; charset=utf-8` 后成功，原始字符串未改变，首次真实访问的 SourceObservation 仍保留在请求历史。
- 真实 PDF：美的官方说明书 HTTP 200，1,154,097 bytes、16 页、源 SHA-256 `bd173c352c759dea6a4128dcc4dda079b1a8102dec7a01f40f96846036ca2478`；型号出现在 5 页，按“型号＋年综合耗电量＋外形尺寸”唯一定位第 14 页，保留 3,768-byte 原始文本，SHA-256 `97c17f2d1bbea79422a82854bb5153503d157f1b9a5f467cbc38cc6fec6dbc96`。HttpCrawler＋unpdf 的成功/缺失 POC、worker/API typecheck 和 `6/6` 定向测试通过；完整 PDF 未持久化。正式 EvidenceItem 因项目缺少 `official_manual` 路线尚未提交。
- 真实 CNIS RAR/XLSX：公开归档 2,301,639 bytes、14 个条目/13 个 XLSX；目标 2023 工作簿 307,787 bytes。sheet `结果` 中 `A2:G2` 表头与 `MR-457WUSPZE` 唯一 `A479:G479` 行形成 261-byte 原始 JSON；EvidenceRequest `request-7bf21455-54e5-41e5-b93c-ddcc471bb5d9`、SourceObservation `observation-a6d6eebf-1cb3-4c86-a9dc-a336176bcf4b`、EvidenceItem `evidence-3c60c601-cb59-4c99-8fbd-fda7ca6223f6`，内容 SRI `sha256-fdq+uI0tnZSy2qVIXwoarYfaXtq+SsbOH1grUEAEEJM=`、manifest SRI `sha256-r+0CdanrN7slHxzOyGt92JrcRV/T1V09O1bPJ80EcOk=`。完整 RAR/XLSX 只在内存，缺失型号为 typed `evidence_not_found`。
- 真实海尔整图：官方产品页图片无 Referer 首次为 403；只加入官方来源页 Referer 与标准 Accept 后为 200，内容协商为 88,486-byte WebP、1200×1200、单帧，SHA-256 `90a96450d6c91ba5225cb78145fb3415630fff339f99be6e049d8c7a6f474ff6`。macOS 解码与 Linux x64 glibc 隔离安装均通过；完整图片未持久化，正式 API/UI 未接入。
- 完整停止并以 Node `v24.19.0` 重启 API/Web 后，API 从 PostgreSQL/CAS 重读同 ID、同 SRI 的四份冰箱 EvidenceItem；新增 CNIS 内容仍包含 `MR-457WUSPZE`、`GB 12021.2-2015` 和 261-byte 原始区域，证明不是进程内假数据。Workbench 桌面 1280px 与 390×844 均显示这些内容；390px 下 document/body scrollWidth 均为 390，无横向溢出，验收后已恢复普通视口。
- 真实持久化：EvidenceRequest `request-d2ba7c17-c286-4c09-b9ce-f6a1c9e19af7`、SourceObservation `observation-9e5572bd-2230-480f-a0fd-ca91fe78aad6`、EvidenceItem `evidence-1cecd512-13f5-4819-a18b-9f29e20bbd51`；CAS SRI `sha256-xIGdVRp2btCZVcEVIFr0Ry9d42cSe4gAuVcaJtR+Up0=`；assessment `sufficient`。API 重读与桌面/390px Workbench 均显示来源、字节、SRI 和未清洗原始内容；当前页面控制台新日志 0 error/0 warn。
- 本轮新增定向自动化：CNIS worker、Evidence API 与 PostgreSQL integration 合计 `10/10`；图片整图真实性 PostgreSQL integration `4/4`。
- 当前 Node 24 全仓验证：全新临时 PostgreSQL 上 `30 files / 114 tests` 全通过，测试库随后精确删除；DBOS 三次模拟失败日志是预期错误路径。六个 workspace typecheck 通过；production build 的 shared/db/workbench/worker/api TypeScript 与 Web Vite 全通过，Web 为 2,305 modules、主 JS 638.10 kB / gzip 189.76 kB，仍有 >500 kB chunk 警告。
- 首次误用系统 Node 21 跑全仓门时，`execa@10` 因缺少 Node 22+ Set 方法使 6 个 API suite 在收集阶段失败；已执行的 90 项业务测试均通过。没有为错误运行基线修改业务代码或降级依赖，临时库已删除并在 Node 24 全新库重跑转绿。
- `npm audit --omit=dev` 当前仍为 1 moderate/5 high，涉及 AJV/fast-uri、Fastify/find-my-way、brace-expansion、ws；Fastify 修复是 major 升级，未执行 `audit fix --force`。
- 开发 API/Web 与 PostgreSQL 保持本机运行，便于用户次日直接查看四份原始冰箱数据；未新建 Codex App Server 常驻子进程。

- Category Interview API 已提供 start/get、POST turn SSE、显式 decision confirm 和 brief confirm；SSE 使用 Fastify 4 兼容的成熟 plugin，事件逐项通过共享 schema。API typecheck 与 config/route 测试 `4/4` 通过。
- 历史 App Server 样本曾用 `fridge-interview-v1`、`gpt-5.6-terra + medium` 真实执行；该 adapter 已因持久 Session 被删除，只保留为能力审计证据，不能作为当前完成证明。
- PostgreSQL 新增五张职责分离表和 Drizzle migration `0001_bouncy_kingpin.sql`；全新临时 PostgreSQL 上 migrator `2/2` 与 CategoryInterviewModule 集成 `2/2` 通过。测试证明模型 proposal 不会直接成为 confirmed decision/brief/project，显式决定与任务书确认后才生成项目草稿；中断只保存 partial interrupted message，不提升决定。临时 cluster 已停止并移入废纸篓，未触碰已有数据库。
- `packages/shared/src/category-interview.ts` 已冻结 Interview Session、规范化 Message、append-only Decision、Unresolved Item、版本化 Brief、单一 owner question runtime output 和 discriminated timeline event；没有把 Codex thread 暴露为业务事实。新增 contract 测试 `3/3` 通过，shared typecheck 通过。
- 正式 `.agents/skills/interview-product-category` 已按 `grill-with-docs` 重写并通过 `skill-creator` 校验；当前内容 SHA-256 为 `4731f928ac9cbb88203ccb9d7c942dbe18a3347f7aff397713d59340084fbda3`。Skill 不保存消息、决定、未决项或任务书，运行时显式传入 Workbench typed state。
- R-028 已用隔离 Node `v24.19.0` 原样复跑：安装无 engine 告警、typecheck、Vitest `2/2`、Vite build、桌面与 390px Playwright `2/2` 全通过；bundle 为 424.28 kB / gzip 127.82 kB。由此在 Node 24 基线和已记录包体/退出成本下接受 `@assistant-ui/react@0.15.14`。
- R-029 TypeScript SDK 代表矩阵证明 `@openai/codex-sdk@0.147.0` 能返回 command execution 等丰富 item 事件、thread resume 和显式 `$skill-name`；真实缺口是无文本 delta，且 AbortSignal 返回后取消探针子进程仍存活。该残留 PID 仅针对 POC 精确终止并复核无残留。
- R-029 App Server `stdio` 最小例外 POC 完成 initialize、未初始化错误、66 个 delta、typed Skill、interrupt、跨新进程 resume、stdin 正常退出和强杀异常；取消探针无残留。官方 schema 只生成到两个临时目录并删除，未向仓库写入生成代码。
- R-028 首次 Node 21 隔离安装曾产生 `nanoid@6.0.1` engine 告警；该记录只解释为何切换到已获批准的 Node 24 基线，不能覆盖上述 Node 24 通过结论。尚未写根生产依赖。
- R-028 `npm run typecheck`、Vitest `2/2`、Vite build 均通过；673 modules，主 JS 424.28 kB / gzip 127.82 kB。
- R-028 Playwright/Chrome 完整套件 `2/2` 通过：桌面 43.4 秒，390px 9.1 秒；含持久化、流式、立即取消、错误、重试、axe、中文 IME composition、无横向溢出和无外部网络请求。
- R-028 in-app Browser：真实复核消息刷新恢复、自动滚动、桌面/390px 和控制台；Vite/Playwright 进程均已退出，无孤儿进程。详细命令和失败分类见 `docs/development/pocs/r028/README.md`。

- 2026-08-15 品类采访方向本轮只修改权威文档，尚未新增依赖或功能代码；因此没有新增 typecheck/test/build 或真实浏览器通过证据。下列运行证据来自本轮更早的代码清算/Evidence 验证，不能证明阶段 0I。
- OpenAI 官方文档复核：App Server 面向富客户端、默认 `stdio`、支持 thread/turn/item/stream/interrupt 和显式 skill input，但官方当前仍把 App Server 命令及 WebSocket 标为 experimental/unsupported for production workloads；Codex TypeScript SDK 支持 start/continue/resume。R-029 已据此增加独立成熟度停止门。
- R-029 早期无工具最小探针只证明 start/stream/resume；随后上述代表矩阵已经补齐富工具事件、显式 Skill、取消和错误证据，早期从无工具样本外推能力的判断维持作废。
- R-029 清理：1,008 个 App Server 全量生成文件（133,534 行、3,536,891 字节）、Python `.venv`、两个 Python 探针、requirements 和 Python 专用 fixture 已从工作区移到 `/Users/guojunxi/.Trash/domain-analysis-r029-cleanup-20260816/`；可从废纸篓恢复。生产依赖、正式数据库、公共 interface 和生产 Chat 入口均未改变。
- 纠错清理当时 R-029 曾收窄到 5 个非安装文件；随后按正确 TypeScript 路径新增代表矩阵和薄 App Server `stdio` POC。当前 POC 文件/行数以工作区实况为准，不沿用清理时快照。
- `npm run typecheck`：6 个 workspace 全通过。
- `npm test`（未提供 PostgreSQL）：70 项通过、22 项按环境门跳过；此结果不用于证明数据库能力。
- 全新临时 PostgreSQL 上 `POSTGRES_DATABASE_URL=... npm test`：23 个文件、92 项全部通过；包含 4 个并发 migrator、Evidence 三项集成、多目标充分性、DBOS 重试/强杀恢复和 API 项目路由。测试中故意模拟的 DBOS 三次失败日志属于预期错误路径。
- `npm run build`：shared/db/workbench/worker/api TypeScript 与 Web Vite production build 全通过，1655 modules transformed。
- 真实 API 进程：临时 SQLite＋全新 PostgreSQL 启动成功；`GET /health` 返回 200，`GET /api/product-projects` 返回 200/空列表；已删除旧 `knowledge-review` 路由返回 404。
- 文档/补丁：`git diff --check` 通过；所有受控代码文件 ≤500 行。最终文档链接与状态检查仍在结束门执行。
- 临时资源：本轮创建的所有临时 PostgreSQL cluster 和 API 临时 SQLite 均在验证后停止并删除；没有触碰现有数据库。
- `npm audit --omit=dev`：仍有 6 个生产依赖告警（1 moderate、5 high），涉及 AJV/fast-uri、Fastify/find-my-way、brace-expansion、ws。自动修复包含 Fastify 5 breaking change，本轮未获升级授权且未绕过调研门，因此未执行 `audit fix`；应作为独立安全升级任务调研和验证。

- 2026-08-17 / 京东来源开发方案落盘：新增 `JD-COLLECTION-DESIGN.md`，把用户确认的四类产物、来源数据事实边界、执行顺序、频控/停止/恢复、旧实现处置和 A～E 通过门写入项目；README、PRD、总体技术方案、CONTEXT、REQUIREMENTS-ALIGNMENT、ARCHITECTURE、ROADMAP 和 RESEARCH 同步纠偏。没有修改业务代码、公共 contract、迁移或运行京东页面。架构影响：改变（仅文档候选）；新增京东有界来源数据集位于来源访问和 Evidence 之间，等待用户复核后才允许冻结 contract 或实施。Patch Disposition：保留 typed 状态/授权/身份规则；重写窄 JD 输出和内存批处理；禁止继续把单并发当频控或只保存参数数量。验证仅为 `git diff --check` 和文档引用核对，不冒充代码/真实页面通过。
- 2026-08-17 / 其他来源与开发库只读审计：当前开发库实际为12个项目行（7 draft、5 ready）、0个 Market Universe、5个 `example.com` 观察和3个 `example.com` EvidenceItem，纠正此前“1个draft且观察/证据全0”的过时进度。九个官网来源只在隔离运行中投影了737个品牌＋厂家型号，entry仅含品牌、型号、来源ID、URL及少量可选身份字段；原始目录/详情未持久化，隔离库已删除。架构影响：澄清；没有修改数据库、业务代码或来源文件。Patch Disposition：保留九源目录 adapter 作为覆盖候选；禁止把其描述为完整来源数据；来源数据层复核通过后再决定重写/复用范围。
- 2026-08-17 / 商品知识目标与统一补救方案纠偏：用户明确商品知识库必须同时包含商品底层知识和商品品类知识，品牌/系列/型号属于品类知识的市场实例层；京东、官网商品页和评价不能单独证明压缩机、制冷、换热、控温或保鲜等通用原理。`JD-COLLECTION-DESIGN.md` 已合并历史数据合格性审计、官网/监管重采、底层知识补证、京东完整来源数据集和五层完成门；PRD、总体技术方案、REQUIREMENTS-ALIGNMENT、CONTEXT、ARCHITECTURE、ROADMAP 与 RESEARCH R-030 同步记录。架构影响：澄清（尚未修改模块职责或公共 contract）；商品知识资产内容边界及 Factory 输出关系被明确，具体权威来源白名单、质量分级和 contract 仍须 R-030 调研/原型并经人工确认。Patch Disposition：保留安全/typed failure、identity 规则、DBOS/PostgreSQL/CAS/Evidence 基础；历史 737 identity、监管统计和测试数据降级为历史运行/候选证据；重写九源与京东输出、持久化和底层/品类/型号知识关系。本轮没有修改业务代码、数据库或访问外部来源。
- 2026-08-17 / 阶段 1A 实施 A 启动：用户已授权按开发文档开始开发。R-030 现已核对 NIST、USDA、SAMR、FAO、ASHRAE 与 Copeland 官方资料的证明范围和许可：首个制冷/保鲜原理纵切片候选使用可逐项核权的 NIST Technical Series 与 USDA 职务作品；ASHRAE 明确禁止出版物进入 AI，Copeland 默认仅个人非商业使用，FAO 默认非商业，均未获许可前排除出模型输入/知识包；`GB/T 8059-2025` 与 `GB 12021.2-2025` 已自 2026-06-01 生效，旧 2016/2015 版本不得充当当前基准。R-031 已登记唯一 `SourceDatasetModule` seam、四个跨品类 content kind、幂等/不可变/导出/许可门和冰箱＋电视 TDD 纵切片；按公共 contract 人工确认硬门，当前未写迁移、共享 Schema、Module、API 或 Web。架构影响：澄清；事实源和目标模块不变，公共 interface 候选尚未冻结。Patch Disposition：保留 PostgreSQL/Drizzle、DBOS、CAS、Zod、Evidence/Market Universe；拒绝逐站/逐品类表、`unknown metadata`、整页 CAS 和把来源数据直接冒充 Evidence；旧代码本轮未改。下一步第一条可执行动作：用户确认 R-031 seam 后，先写 `SourceDatasetModule` PostgreSQL integration 红灯测试。
- 2026-08-17 / 阶段 1A R-031 与 R-032 本地纵切片：用户明确技术 interface、数据结构、依赖和测试策略由工程负责，不再作为产品负责人确认题。R-031 已实现 category/source-neutral `SourceDatasetModule`、四种 strict content kind、独立 authority/claim scope/使用许可、四张 PostgreSQL 表、CAS 附件关系、JSONL/CSV、只读 API 和通用 PC 来源数据页；冰箱与电视同 interface，未新增品类/京东字段或分支。R-032 采用 `p-queue@9.3.3`＋`cockatiel@4.0.0`，本地随机端口 fixture 通过缩放窗口、同域完成后间隔、抖动、批次冷却、首次 429 熔断、取消/最长运行 AbortSignal 与零残留；生产 JD reader 仍为注入式，没有 reader 或显式 `paced_http` policy 时失败关闭。干净临时 PostgreSQL 全仓 `44` 文件通过、`1` 文件按设计跳过，共 `172` 项通过、`1` 项真实模型 acceptance 跳过；六 workspace typecheck 和 production build 通过，Web `2309` modules、主 JS `673.87 kB / gzip 199.45 kB`，保留既有 >500 kB warning。本地 PC 真实表面已查看冰箱与电视记录、原始字段、用途/许可、导出和 `rate_limited / HTTP 429` 失败；没有访问京东。架构影响：改变；新增来源事实层及公共 contract，Workbench PostgreSQL 独占来源事实，DBOS 继续独占执行，ADR-0014 与 ARCHITECTURE 已同步。Patch Disposition：保留安全状态、identity、九源/JD adapter 的访问/解析候选和 PostgreSQL/DBOS/CAS/Evidence 基础；重写来源输出为统一逐条快照并将 JD 访问包入显式频控/熔断；旧窄 adapter 尚未删除，历史 737 仍仅为待重采候选。下一步第一条可执行动作：接通 DBOS 逐对象持久工作项与重启恢复，并用真实 60 秒窗口完成本地频控证据；通过前继续禁止京东探针。
- 2026-08-17 / R-032 持久执行与真实分钟门：新增 category/source-neutral `SourceCollectionPipelineModule` 及共享 work item/provider result/run contract。DBOS 父/子 workflow 以稳定 ID 逐对象执行，Provider 访问 step 禁止自动重试，快照用工作项 ID 幂等提交；显式 `DBOS.sleep` 保存同域间隔与窗口等待，取消先中止来源 adapter 再关闭来源运行。第一条快照落库后 `SIGKILL` 的双进程验收恢复成功，访问日志为 A/B/C 各一次、三条快照完整且 3 秒等待跨进程保留；真实 60,000ms 本地 HTTP acceptance 运行 `60.029s`，任意一分钟窗口不超过 2 次。当前全仓 `47 files passed / 2 skipped`、`178 passed / 2 skipped`；显式分钟 acceptance 另为 `1/1`；六 workspace typecheck 和 production build 通过，Web `2310` modules、主 JS `675.49 kB / gzip 199.77 kB`，既有 >500 kB warning 保留。没有访问京东。架构影响：澄清；实现了 ADR-0014 已确定的“DBOS 执行、Workbench 来源事实”边界，没有改变事实源，但新增跨模块 typed 执行 contract。Patch Disposition：保留 R-031 事实层和 JD 安全 adapter；新增持久工作项编排；未在旧内存循环上叠恢复逻辑。下一步第一条可执行动作：把 Source Collection workflow 与现有监管 workflow 纳入单一生产 DBOS 组合入口并接注入式 JD reader，再复验取消/恢复；在此之前第 9.1 整体仍未通过，不执行京东探针。
- 2026-08-17 / R-032 生产组合与跨品类 JD seam：`ProductKnowledgePipelineRuntime` 在同一次 DBOS launch 前注册监管和 Source Collection workflow，组合测试证明两个 Queue 在同一 PostgreSQL runtime 同时完成；生产 API 已换用该组合根，真实启动后 `/health` 和项目列表均为 200。`JdSourceCollectionProvider` 只负责京东页面协议到通用 catalog/ordered record 的转换，不判断品类；电视＋冰箱详情使用同一 adapter 测试，目录保留卡片顺序、自营标记和对象引用。没有 `JdPageReader` 时生产只落 typed `source_abnormal` 并停止，本轮没有访问京东。全新空 PostgreSQL 最终全仓 `49 files passed / 2 skipped`、`182 passed / 2 skipped`；首次复用旧测试库导致采访断言看到历史同名项目，未改测试，在全新库重跑转绿。六 workspace typecheck 和 production build 通过，Web `2310` modules、主 JS `675.51 kB / gzip 199.76 kB`，既有 >500 kB warning 保留。架构影响：澄清；生产 DBOS 生命周期收归一个组合根，事实源与依赖方向不变。Patch Disposition：重写独立 DBOS 启动为可组合 workflow 注册；保留两个模块的独立测试入口；删除了本轮一度新增的客户端 work item 写接口，因为它会让 UI 成为采集计划和许可事实源；Source Dataset HTTP 继续只读，正式启动必须由后续服务端 Planner 从 confirmed brief/board 生成；旧冰箱专用 Market Universe 京东枚举明确降级为兼容路径，尚未删除。下一步第一条可执行动作：实现服务端 Source Collection Planner，并完成真实 JD page reader 的 R-012 验收；之后才允许第 9.1 的 1+3 探针，旧冰箱专用入口退出主流程前不得宣称跨品类整链完成。
- 2026-08-17 / M1 服务端来源 Planner：新增 `sourceAssignments`，由 confirmed brief 显式拥有“来源入口→路线→Knowledge Need”关系；新任务书缺少入口分配时确认失败，历史任务书保持可读但 Planner 不猜测。`SourceCollectionPlannerModule` 只接收 project ID，确定性生成并持久化 plan/batch/work item，许可未知/禁止和规则缺失保留 typed waiting；API 不接受客户端 work items。冰箱与电视同一 Planner 单测、采访确认负向集成和 Source Dataset 计划幂等通过。架构影响：改变；新增跨模块 typed plan contract 和 brief 来源分配，Workbench/PostgreSQL 仍为唯一事实源，UI/HTTP/Provider 不获得计划所有权。Patch Disposition：删除按同 lane 知识层交集扩大绑定的错误推导；保留 R-031/R-032 Source Dataset、DBOS 与 Provider seam；重写真实 POC 后确认每个来源只绑定其显式 Knowledge Need。
- 2026-08-17 / M2 权威技术与监管小批次：正式 Category Interview→confirmed brief→Project→Planner→DBOS→Provider Router→Source Dataset 在隔离 PostgreSQL 保存 3 条真实快照；NIST/USDA 为 `document`，中国能效标识 `MR-457WUSPZE` 为保留官方 JSON 原文的 `ordered_record`，两个批次均 succeeded。美的说明书因法律声明禁止未经书面许可的爬虫/下载，计划为 `waiting / local_read_not_allowed` 且零访问；京东同样没有访问。新增 `full_resource / document_excerpt / structured_record_lookup` 通用资源选择，PDF/监管薄 adapter、AbortSignal 取消和未知字段失败关闭；不含冰箱、品牌、SKU、价格字段。全 workspace typecheck、本轮 16 项 Provider/Planner 定向测试、此前 13 项采访/Planner 数据库回归通过；真实隔离库均精确删除。架构影响：改变；扩展 Source Collection 公共 request contract，但事实源和依赖方向不变，ADR-0014、ARCHITECTURE、RESEARCH 已同步。Patch Disposition：保留已验证 Crawlee/unpdf/能效公开查询适配器；历史美的 PDF 降为不可重跑 POC，不以旧成功绕过当前权限；目标 Linux、全仓 test/build、官网完整详情重采仍待后续门。
- 2026-08-17 / M0 基线、旧补丁和访问硬门：按权威阅读顺序核对 dirty WIP、事实源、模块依赖和历史数据；历史 737 identity 继续降级为隔离运行的目录身份候选，不冒充商品详情或商品知识。JD 真实访问被明确分成工程门、书面许可和现实探针门；本轮只完成工程门，没有发送京东请求。Patch Disposition：删除错误的完成表述和重复事实入口；保留 typed 状态、DBOS/PostgreSQL/CAS/Evidence 基础；后续真实 JD 只能在许可与 1＋3 探针门同时满足后启动。
- 2026-08-17 / M3 通用来源执行与 JD 安全 seam：通用 Provider Router、JD taxonomy/store/product/review typed 输出、`p-queue@9.3.3` 访问节奏和 `cockatiel@4.0.0` 熔断已接入；电视＋冰箱 fixture 证明同一 JD adapter 无品类分支。DBOS 稳定父/子 workflow、逐对象幂等提交、取消和强杀恢复通过；真实 60 秒本地门证明每分钟最多 2 次且第三次在 `60.029s` 后派发。生产没有已验证 reader 或显式 policy 时失败关闭。本结论只表示京东工程前置门通过，不表示真实 JD reader、探针或数据抓取完成。
- 2026-08-17 / M4 来源数据到最小 Evidence：新增唯一 `SourceEvidenceModule` bridge；Source Dataset 原始记录不自动成为证据，必须绑定 EvidenceRequest、沿用来源许可并提交精确 locator。Provider 已有 locator 时可确定性提交；无 locator 的长文本必须由 PC 显式选择 TextQuote，不能把整块正文伪装为最小证据。R-034 PC 真实提交 349-byte TextQuote 并在 Evidence 页重读成功。
- 2026-08-17 / M5 Factory 与 Review：确定性属性转换和模型候选分开；`foundational_concept` 作为跨品类知识目标进入公共 contract，品类/型号知识通过 `subject_ref` 和 typed relation 引用底层概念。模型固定 `gpt-5.3-codex-spark + low`，关闭 Web search 和 fallback，只接收已许可最小证据并只产 `review_required` 候选；人工决定是发布状态唯一事实源。错误简称 `codex-5.3-spark` 及其失败补丁已删除，没有 alias/fallback。R-034 产出 22 条候选（模型 21、确定性 1）、0 conflict、0 unknown 和 3 条关系，全部完成人工审核。
- 2026-08-17 / M6 SQLite Package 与离线 Runtime：Package Builder 以规范内容计算版本，不使用构建时间；相同输入重建复用同一版本。公开可再分发 Evidence 可携带最小内容，受限或许可未知 Evidence 只携带 locator/hash。Runtime 只读 SQLite＋FTS5 包，支持型号精确、结构化筛选、全文、关系、证据、激活/切换/回滚，不访问 Workbench PostgreSQL、浏览器或模型。R-034 包含 22 状态、4 Evidence、180224 bytes；复制单文件后离线查询通过。
- 2026-08-17 / M7 电视第二品类真实迁移门：只增加电视 confirmed brief 和 DOE/EPA 来源规则，未修改公共数据库结构、Factory/Review/Package/Runtime interface，也未新增电视/冰箱流程分支。真实链路保存 DOE HTML×2、DOE PDF 页×1、EPA ordered record×1，形成 3 个底层概念、1 个真实型号和 3 条关系；PC Workbench 可见来源、最小证据选择、22 条已审核知识与激活包。Package version `b2bb867cdb10cc9be71a6cddbc30b2645c961b80a7a0037702318e85940e0442`，DB SHA-256 `c5e7379e0c61c2197f23de7c83dd4a415987b7999f5b6e14916330fa1e6552f4`。该门证明系统不是冰箱专用，不等于三品类、多站点、动态页、图片、JD 或目标 Linux/Windows 已通过。
- 2026-08-17 / M0～M7 Baseline Impact：touched modules 为 Category Interview/Brief、Planner、DBOS Source Collection、Providers、Source Dataset、Evidence bridge、Factory/Review、Package/Runtime、API 和 PC Workbench；owning fact source 分别为 confirmed brief、Workbench PostgreSQL、append-only Review Decision、内容寻址 SQLite 包和 stable pointer。public interface changed：yes；新增 `sourceAssignments`、来源选择/locator、`foundational_concept`、候选关系和 package/runtime 查询 contract。new protocol/adapter/fallback：新增 DOE/EPA/Socrata/JD 薄 adapter，无 fallback。compatibility or legacy path changed：通用项目页不再暴露冰箱专用 Market Universe；历史冰箱 module 未在本轮无授权删除。research/architecture/ADR update required：yes，R-033/R-034、ARCHITECTURE、ADR-0001/0002/0006/0014 已同步。tests and real-surface validation：全仓 test/typecheck/build、R-034 真实来源链、内容重建/复制离线 Runtime、PC Source/Evidence/Factory 页面。
- 2026-08-17 / M0～M7 Patch Disposition：delete 为错误 `codex-5.3-spark` 简称、通用 workspace 的冰箱专用入口和把整块正文自动提交为 Evidence 的路径；keep 为 PostgreSQL/Drizzle、DBOS、CAS、Crawlee、typed permission/failure、append-only Review 和历史冰箱 module 的非主流程兼容能力；rewrite 为旧 Codex ADR、模型 adapter、Source Dataset→Evidence bridge、Package 许可投影及受并发污染的测试数据命名。保留项分别保护持久事实、恢复、来源隔离、证据审计和历史调用 seam，不在错误补丁上叠 fallback。
- 2026-08-17 / M0～M7 最终本机验证：Node `v24.12.0`、npm `11.6.2`、隔离 PostgreSQL 上全仓 `63 files passed / 2 skipped`、`222 passed / 2 skipped`；跳过项是显式真实分钟 acceptance 和真实模型采访 acceptance，二者已有独立历史验收，不在默认全仓门重复执行。七个 workspace typecheck 和 production build 全通过；Web 为 2316 modules、主 JS 687.39 kB / gzip 202.13 kB，仅保留既有 >500 kB warning。所有 apps/packages TypeScript/TSX 文件均不超过 500 行；超长模块按采访任务书投影、DBOS 身份、来源持久化、Factory 持久化、Web 业务客户端和测试夹具真实职责拆分，公共导出与行为不变。跨品类硬编码审计在 Runtime、共享知识 contract、Factory/Review/Package 和通用项目页中未发现 refrigerator/冰箱/JD/SKU/price 分支。R-034 PC Workbench 已真实查看来源、Evidence、Factory/Review 和激活包，并提交 349-byte TextQuote。验收后已停止并删除本轮精确临时 PostgreSQL 和 R-034 页面产物目录，进程复核无残留；未触碰仓库数据或其他数据库。架构影响：改变；新增底层概念目标、Source Dataset→Evidence bridge、Factory 模型 port 和 Package/Runtime contract，已同步架构/调研/ADR。当前仍是本机 dirty WIP，未提交推送，不是跨电脑接续点。
- 2026-08-17 / 工作树异常文件与 POC 提交面清理：逐项审计初始 `227` 个未跟踪文件。`apps/api/data/evidence/**` 的 `16` 个运行时 CAS 文件已原样迁移到根目录忽略区 `data/evidence`，源码树中的 `apps/api/data` 已移除；迁移后仍为 `16` 个文件、`28,978` bytes，cacache 按 `8` 个索引记录逐项完成 SRI 读取与大小校验（内容/manifest 合计 `26,264` bytes）。R-028/R-029 已由生产 Chat Timeline 和 `codex exec --ephemeral` 路径替代，且根 workspace/test/build 从不调用其隔离项目；因此删除两个 POC lockfile、独立 package、构建配置、平行 UI、SDK/App Server 探针和 POC Skill 共 `26` 个文件，只保留两份压缩 README，并纠正仍把 App Server/SDK thread 写成当前候选的产品/工程文档。最终保留 `185` 个未跟踪文件：`90` 个生产代码、`49` 个测试、`10` 个 SQL＋`10` 个 matching snapshot＋journal、`14` 个压缩/仍有效 POC 文档、`7` 个其他文档、`2` 个采访 Skill 文件和 `2` 个根配置；Drizzle journal/SQL/snapshot 为 `10/10/10`，无 missing/orphan。当前“新增行”口径从初始 `61,749` 降为 `54,359`，减少 `7,390` 行；余量主要是生产代码/测试、根 lockfile 与 Drizzle 元数据，不冒充手写业务代码。架构影响：澄清；事实源和生产路径不变，只移除已替代/已拒绝的平行实验入口并落实 Evidence CAS 物理隔离。Patch Disposition：Delete＝源码树错误运行目录与两套无调用方 POC 执行树；Keep＝生产代码、测试、迁移链、根 lockfile和压缩调研证据；Rewrite＝API 路径配置、ignore、R-028/R-029 处置及权威说明。验证：Node `v24.12.0`，相关生产回归 `8/8`、七个 workspace typecheck、production build（2316 modules，保留既有 >500 kB warning）、`git diff --check`、忽略命中和 CAS 自校验通过；未运行京东或其他外部抓取，未提交/推送。

- 2026-08-17 / 跨电脑本地数据库启动门：用户确认两台电脑的 PostgreSQL、Evidence 和知识包运行数据各自留在本地，不做跨电脑迁移，并允许把本地数据库连接账号直接提交到 `.env.example`。API 与本地数据库准备脚本改用 Node 24 官方稳定 `--env-file` 直接读取该文件；DBOS 拒绝省略用户名的连接串，因此删除隐式系统账号尝试，改为显式本地账号 `guojunxi`。`npm run dev` 现在先复用现有 `pg` 检查目标库，缺失时只创建空库，再由既有 Drizzle migrator 创建/升级 schema；不复制、覆盖或合并另一台电脑的数据。全新源码副本在无 `node_modules`、`.env`、数据库和 Evidence 的条件下 `npm ci` 成功，七个 workspace typecheck、production build、全新 PostgreSQL 全仓 `63 files passed / 2 skipped`、`223 passed / 2 skipped`，API `/health` 与 Web 均为 200；临时数据库已精确删除，临时源码副本移入废纸篓，未访问京东或其他外部来源。架构影响：无变化；Workbench PostgreSQL、DBOS schema、Drizzle migration 和本地数据分区不变，只补齐开发启动配置。Patch Disposition：Delete＝DBOS 不接受的无用户名 URL；Keep＝两机本地数据隔离、现有 PostgreSQL/Drizzle/DBOS；Rewrite＝提交的连接串与启动前空库准备。

- 2026-08-17 / 跨电脑交接与 Git 交付门：新增唯一启动入口 `HANDOFF.md`，只记录新电脑恢复、权威阅读顺序、启动验证、当前边界和下一项工作，不复制 roadmap/progress/architecture。用户已授权提交和推送本轮全部必要 WIP；交付结论必须以最终工作区干净、`origin/master...HEAD = 0 0` 和本地/远程 SHA 一致为证。本地 PostgreSQL、Evidence CAS、知识包、Profile、Cookie 和 Codex 登录明确排除。架构影响：无变化；没有改变模块职责、事实源、依赖方向或公共 contract。Patch Disposition：Keep＝全部已验证生产实现、测试、迁移和权威记录；Delete＝本地运行数据及秘密材料不进入提交；Rewrite＝旧的“仅本机、未获提交授权”和已经完成的来源 contract 下一步表述。

## 12. 结束更新模板

```text
更新日期：
当前阶段与状态：
本轮完成事项及证据：
当前 Git/依赖/运行事实：
新调研或决策状态：
本轮服务的路线阶段与架构目标：
本轮架构影响（无变化/澄清/改变）：
Patch Disposition：
阻塞和所需人工决定：
下一步第一条可执行动作：
实际运行的测试、构建和真实表面验证：
```
