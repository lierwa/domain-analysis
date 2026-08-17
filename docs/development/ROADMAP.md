# Agent 知识生产平台阶段开发路线图

状态：2026-08-17 商品知识恢复纵切片与全量路线基线
版本：V0.7
更新日期：2026-08-17

## 1. 使用规则

本文件只定义阶段顺序、产物和停止门。当前完成度只记录在 `PROGRESS.md`。

所有非平凡能力遵守：官方/成熟方案调研 → 与产品约束一致的最小原型 → 人工确认高影响决定 → 正式实现 → 生产入口/真实表面验证。任一门未过，保持候选或阻塞，不用测试接线冒充阶段完成。

## 2. 当前纠偏顺序

```text
阶段 0R 权威文档纠偏与旧补丁清算
  → 阶段 0I 品类启动采访与调研任务书
  → 阶段 1A 目的驱动来源访问与最小证据
  → 阶段 1B 最小证据到候选/审核
  → 复核阶段 1C 知识包与离线查询
  → 复核阶段 1D 第二品类迁移
  → 重做阶段 3 官方来源冰箱搜集板块
  → 重做阶段 4 商品知识加工厂
  → 阶段 5 知识包与 Runtime
  → 阶段 6 联调、评测与交付
```

既有阶段 2 Product/Pipeline 骨架可以复用，但需换接新 contract。原阶段 3/4 完成结论撤销；旧整页快照、DOM projector 和不可达生产路径不能作为后续输入。

### 2.1 M0～M7 恢复纵切片

M0～M7 是在上述正式阶段内恢复一条可运行最小纵切片的执行路线，不是另一套阶段，也不能替代 1A～1D 的完整矩阵。当前完成证据只看 `PROGRESS.md`。

| 里程碑 | 要解决什么 | 最小停止门 |
| --- | --- | --- |
| M0 基线与硬门 | 清算错误完成表述和旧补丁，冻结事实源、访问许可、模型与跨品类边界 | 不把历史 identity/fixture 当真实知识；无许可不访问受限来源 |
| M1 服务端来源 Planner | 从 confirmed brief 生成持久来源计划，不让 UI/Provider 猜范围 | 只接 project ID；来源分配、Knowledge Need、许可和 waiting 均为 typed fact |
| M2 代表性权威来源 | 取得能证明底层原理、品类规则和真实对象的公开技术/监管小批次 | 真实来源、许可、原始最小内容、取消和失败关闭可审计 |
| M3 通用来源执行 | 让同一 Provider/DBOS/频控/熔断链可服务不同来源与品类 | 逐对象持久化、强杀恢复、真实时间窗、取消后零继续；JD 未获许可仍零访问 |
| M4 来源数据到 Evidence | 从 Source Dataset 选择支持明确问题的最小证据 | EvidenceRequest、locator、许可和内容哈希完整；整块正文不自动冒充最小证据 |
| M5 Factory 与 Review | 把底层概念、品类知识和型号事实加工成可审核候选 | 确定性与模型分开；模型固定、无 fallback；候选绑定 Evidence，人工决定唯一 |
| M6 Package 与 Runtime | 把已审核知识变成可复制、可回滚的离线知识包 | 内容寻址稳定；精确/筛选/全文/关系/证据查询；Runtime 不依赖生产系统补答案 |
| M7 第二品类迁移 | 用真实非冰箱品类证明系统能切换品类 | 只增加品类数据和来源规则，不修改公共 Schema、流程、Factory/Package/Runtime interface |

## 3. 阶段 0R：权威文档纠偏与旧补丁清算

### 目标

先统一产品、领域、架构、调研、ADR、路线和进度，再删除错误/死亡代码；禁止边改旧实现边补文档。

### 阶段产物

- `EvidenceRequest / SourceObservation / EvidenceItem / ExtractionCandidate` 统一术语和事实归属；
- ADR-0011 与 R-026 调研/候选状态；
- Product/Provider/Architecture/Progress 不再出现整页持久化、逐站字段 projector 或错误完成声明；
- 逐项 `delete / keep / rewrite` Patch Disposition；
- 基于真实生产组合根、CodeGraph、package entry/exports 和测试不变量的死代码清单。

### 通过门

- 六份产品文档、`CONTEXT.md`、`AGENTS.md`、`ARCHITECTURE.md`、`ROADMAP.md`、`RESEARCH.md`、ADR 与 `PROGRESS.md` 无权威冲突；
- 文档链接、格式和 `git diff --check` 通过；
- 新模型/OCR/图片语义用途明确保持候选，未绕过用户确认；
- 删除范围能说明为什么错误/不可达，以及保留代码保护哪个新不变量。

## 4. 阶段 0I：品类启动采访与调研任务书

### 目标

把“开启一个新品类”做成可恢复、可审核的 Chat Timeline：用户只决定产品取舍，系统主动调查可调查事实，并产出经用户确认的 Category Research Brief。

### 执行顺序

1. 完成 R-028 Chat Timeline 与 R-029 Codex 交互运行时调研登记；候选未过 POC 前不得写成已接受依赖。
2. 在隔离 POC 中验证 `@assistant-ui/react` primitives、ExternalStoreRuntime、现有 React 18/Vite/Tailwind、PC 键盘/滚动/流式和自有持久化；不使用 Assistant Cloud。
3. 通过官方稳定 `codex exec --ephemeral --json --output-schema` 验证真实执行、显式 Skill、结构化输出、取消、错误、临时文件清理和全局 Session 前后零新增；WorkBench 每轮提供完整 typed state，不建立 Codex thread。
4. 创建仓库专用品类采访 Skill；它只拥有采访工作流，不拥有会话、决定、任务书或数据库。
5. 冻结 Category Interview、Interview Decision、Category Research Brief 和 typed timeline/event contract，再实现 Workbench 深 module、Codex adapter 和 HTTP streaming adapter。
6. 替换新建项目入口；现有 ProductProjectForm 只复用为任务书/项目草稿的检查修改面，不保留第二套从零创建事实源。
7. 用真实“开启冰箱品类”完成中断恢复、一次一问、主动调查、决定确认后自动进入下一问、任务书确认、项目草稿生成和 PC 浏览器验收；不得要求用户输入无业务含义的“继续”。

### 通过门

- 用户不需要列品牌、型号、参数、部件、原理或来源；系统能调查并在任务书中说明范围、依据和未决项。
- 一轮只问一个必须由负责人决定的问题；能从项目/官方资料得到的事实不反问用户。
- 模型建议、聊天消息、Interview Decision、confirmed brief 和 Product Project 各自职责唯一；无状态 Codex 执行不拥有产品事实，UI/HTTP 不从文案推导状态。
- 浏览器不直接连接 CLI；Cookie、Codex 认证材料、工作目录和原始工具事件不进入前端或业务事实。
- 不引入 Pi Agent、Agent registry、多 Provider、跨模型 fallback、自写进程管理或 JSONL parser。
- 全 workspace typecheck/test/build、真实 API、PC 浏览器和进程退出清理通过；modelId/reasoning 只有真实采访评测后才接受。
- 真实 `codex exec --ephemeral` 前后全局 `~/.codex/sessions` 文件差分为空；默认测试不调用模型，显式 acceptance gate 才允许一次真实调用。

### 立即停止

- `assistant-ui` 或 ephemeral exec 关键约束未通过却开始写生产 wrapper；
- 任何采访执行写入全局 Codex Session、依赖 Codex thread 恢复或留下临时模型内容；
- 需要同时维护 Pi 与 Codex 两套会话/工具/模型状态；
- 把 Codex thread、模型总结或表单值直接当作已确认任务书；
- 未完成 R-028/R-029 就新增依赖、公共 interface 或数据库表。

## 5. 阶段 1：重新打开的四项可行性验证

在进入来源访问前，必须先通过阶段 0I；阶段 1A 只接受 confirmed Category Research Brief 生成的冻结研究输入，不能继续从完整大表单或聊天文案临时拼装范围。

本阶段只做小规模真实纵切片，不建设万能 Provider、通用工作流平台或大规模 UI。

### 1A：目的驱动来源访问与最小证据

冻结输入：MarketUniverseVersion、品类知识定义、Knowledge Need、EvidenceRequest、来源策略、证据政策和真实样本矩阵。

最小样本：至少三个品类；每品类至少两个布局不同的官方站点；覆盖 HTML 文本、动态页面、PDF、XLSX、图片，以及登录/验证/下架/限流等来源状态。

必须输出：SourceObservation；可复核 EvidenceItem 或 `insufficient / unknown / waiting / failed`；内容哈希、标准 locator、对象关系依据、隐私分类和临时资料清理证据。

#### 冰箱纵向执行顺序

以下步骤必须顺序执行。前一步没有产物和验证证据时，禁止开始下一步；当前完成度只在 `PROGRESS.md` 标记。

1. **修正 R-010 覆盖定义**：调研并登记品牌覆盖口径、产品类型/变体分类候选、同窗来源和缺口。类型至少需要回答门体/布局、安装形态、制冷结构和适用场景如何进入覆盖计算，但不得凭经验直接冻结枚举。产物是 R-010 调研补充、公共 contract 影响说明和最小原型计划；未获人工确认前不修改跨模块 contract。
2. **修正 Market Universe contract**：只在上一步确认后，令版本化总体同时表达型号 identity、品牌覆盖、类型/变体覆盖、来源覆盖和 unknown；迁移、共享 Schema、Workbench、API、Web 和测试必须一次完成，不能由 UI 或来源 adapter 各算一套。
3. **完成品牌与监管分母**：在同一观察窗口交叉监管备案、品牌独立官网/说明书和官方在售目录；每个品牌分别记录已覆盖来源、声明数、读取数、唯一型号数、排除项和 unknown。美的商城内出现多个品牌标签不能替代这些品牌各自的独立覆盖证明。
4. **冻结分层知识目标与统一补救门**：明确商品底层知识、商品品类知识和品牌/型号市场实例的关系；把历史 737 identity、监管统计和测试 Evidence 降级为历史运行/候选证据。按 R-030 为制冷循环、压缩机、控温/除霜和保鲜形成代表性 Knowledge Need，未完成权威来源、许可和质量调研前不冻结新 contract。
5. **先通过统一来源数据与本地运行门**：按 `JD-COLLECTION-DESIGN.md` 先实现跨官网/监管/权威技术资料/京东的逐条持久化、PC 查看、导出、恢复和五层合格报告；用 fake 与本地 HTTP fixture 证明幂等、限速、冷却、熔断和取消后零残留。此步骤不访问京东。
6. **重采官网/监管并补底层知识小批次**：代表性官网重新取得目录、完整商品详情、说明书/技术资料和来源完成度；监管保留原文、标准、指标和冲突；底层知识形成“原理链＋条件＋边界＋权威证据”。旧 identity 只能作为待核验 SourceObject 候选，不能补造快照。
7. **有界接入京东来源**：只有频控硬门通过后，才采分类/筛选体系、核实自营与品牌官方旗舰店、枚举店内商品、保存完整商品详情，最后保存评价汇总和每款前 50/100 条代表性评价。第一轮保留来源原始结构；`maxConcurrency: 1` 不等于频控，首次 403/验证立即熔断且不自动绕过。
8. **冻结 R-010 市场总体与完整 Knowledge Need 矩阵**：对监管、品牌官网、官方自营和核实旗舰店做同窗并集、去重和差异审计；再覆盖底层原理、品类技术、身份/系列/型号/SKU、安装、规格、功能、适用条件/边界、需求取舍、Offer、说明书、图片和评价。每项定义目标、证据、时效、充分条件和不能推出的结论。
9. **批量生成并执行 EvidenceRequest**：唯一输入是 confirmed MarketUniverseVersion、confirmed Category Definition、Knowledge Need 和来源/证据政策；按矩阵生成请求并持久化 SourceObservation、EvidenceItem 或 typed failure。不得从手工 URL、既有样本、历史 identity 或页面字段全集反推批次。
10. **完成 1A 真实矩阵**：补齐 HTML、动态页、PDF、XLSX、图片和登录/验证/下架/限流路径，再扩展到三个品类、每类两个布局不同官方站点；只有生产组合根、临时资料清理、五层知识报告和 PC Workbench 全部通过才进入 1B。

通过门：

- 同一 EvidenceRequest/EvidenceItem contract，不增加站点、品牌或品类 DOM 字段分支；
- 文本 exact/context、文档页/片段、表格 sheet/header/range、图片 URL/hash/xywh 都能在保存的最小内容上复核；
- 图片覆盖明确对象关系、同页多图歧义、图中文字和装饰图；不确定关系拒绝自动入证据；
- 完整页面/文件只在临时区存在，成功、失败和取消路径都清理；
- URL-only、HTTP 200、空内容和页面加载成功不能标记证据充分。

立即停止：需要逐官网/逐品类字段 projector；凭据/个人信息泄漏；必须自研浏览器/OCR/工作流/结构化输出；模型或 OCR 未经 POC 即决定事实。

### 1B：最小证据到候选与审核

冻结输入：1A EvidenceItem、真正共享的商品模型/属性字典、品类知识定义、确定性 recipe、候选 Schema、质量 contract。

必须输出：candidate/conflict/unknown、evidence ID、处理版本、人工例外事项和可重放评测；原始证据不被候选覆盖。

通过门：

- 正式候选 100% 引用 EvidenceItem；模型/OCR 输出不能直达发布；
- 同输入与 recipe 可重放；错误能归因到来源、证据、规则、模型或审核；
- 用户不逐字段确认。报告每 100 个请求/候选的人工例外数、原因、可批量比例和处理耗时；批量键只使用 typed request/reason/source/evidence/category version；
- 新 Codex/视觉模型用途已先确认任务粒度、输入输出、modelId、推理深度和人工门。

立即停止：用提示词保存领域事实；品类专用生产代码；无证据内容被补成事实；另用 LLM 判断“哪些问题同类”成为队列前提。

冰箱比较与图文知识还必须通过以下门：

- 型号比较只读取共享属性字典中的同口径规范值，并同时返回缺失、冲突、时点和证据；不得把营销文案或 UI 排序当比较事实。
- 品牌比较是对版本化型号事实的可追溯聚合，不另建品牌结论事实源；样本范围和不可比较项必须随结果返回。
- 技术原理知识必须拆成机制、适用条件、边界和取舍，并绑定最小文本/PDF页/图片区域证据；图片必须证明与对象和知识点的关系。
- 图文答案由已审核知识和允许发布的 asset reference 组成；OCR、视觉模型或说明性生成图只能产生候选，不能越过证据和 Review。

### 1C：知识包与离线查询复核

复核旧 SQLite＋FTS5 方向在新 EvidenceItem 上仍满足：跨目录/机器复制后无网络、模型、embedding 和 PostgreSQL可查询；精确、筛选、全文、关系、证据与新旧版本切换完整；包不含整页/受限证据。

### 1D：第二品类迁移复核

用电视或微波炉真实小样本复用 1A～1C 正式 contract。只增加品类定义、Knowledge Need、来源范围和评测数据。

通过门：生产 Schema、数据库结构、通用 interface、Runtime API、通用流程和同来源访问实现零修改；不能为第二品类或新官网增加知识字段 DOM adapter。

任一验证失败，暂停平台化开发，先调整候选或范围，不得用“以后替换”绕过。

## 6. 阶段 2：项目与流水线骨架换接

### 目标

保留已验证的项目版本、PostgreSQL/Drizzle、DBOS lifecycle/恢复/人工信号能力，把冻结输入和真实 stage handler 换成 EvidenceRequest/SourceObservation/EvidenceItem contract。

### 工作内容

- Product Project、Category Definition、Shared Attribute Dictionary、Confirmed Scope、Collection Board；
- Pipeline Run、Stage Execution、Task Attempt、Intervention；
- Evidence Plan 的版本冻结、幂等、取消、失败 fork 和恢复；
- 真实 API/Workbench 组合根，不注册 no-op 或只测试可达 handler。

### 通过门

进程强杀和人工恢复后不重复破坏性执行；已提交 EvidenceItem 不覆盖；临时来源内容不残留；生产入口真实到达首个 EvidenceItem。

## 7. 阶段 3：官方来源冰箱搜集板块重做

状态：未通过。2026-08-15 撤销旧完成结论。

### 工作内容

- 用确认范围、Knowledge Need 和 EvidenceRequest 驱动官方来源发现；
- 品牌官网/说明书、监管数据、获准平台网页的来源访问与人工接管；
- SourceObservation、EvidenceItem、证据充分性覆盖、刷新/变化和失败明细；
- 冰箱多品牌总体与第二品类真实验收；
- Workbench 展示只读取 authoritative projection，不从文案/HTTP/轮询推导状态。

### 通过门

R-010/R-011 冻结的请求充分性、失败解释和人工频次门全部通过；真实生产入口可运行；无站点/品牌/品类 DOM 字段分支、旧 snapshot/projector 兼容层或不可达代码。

## 8. 阶段 4：商品知识加工厂重做

状态：未通过。旧参数纵切片只作为局部组件证据。

### 工作内容

- 单一共享商品模型/属性字典和版本化品类定义；
- EvidenceItem → 确定性候选/冲突/unknown；
- 经确认的模型候选 seam、证据恢复和严格 Schema；
- 追加式 Review Decision、批量例外审核和质量评测；
- 功能、机制、适用条件、取舍、需求映射和比较维度。

### 通过门

候选 100% 证据绑定；共享模型/字典是单一生产事实源；模型不能越过 Review；质量与人工频次达到 R-011；生产组合根真实可达，错误/死代码清零。

## 9. 阶段 5：知识包与 Runtime

构建只读、版本化、可校验知识包；支持精确、筛选、全文、关系和最小证据查看；在本地加载、激活、切换和回滚。包复制到另一台机器仍能离线查询，Runtime 不依赖 Workbench、Evidence CAS、模型或浏览器。

冰箱纵向通过门还包括：同一 Runtime interface 能回答单型号事实、型号对比、品牌范围对比和技术原理图文问题；结果返回知识包版本、事实/结论、unknown/conflict、证据引用和可用 asset reference。Runtime 不临时访问京东、官网、Workbench 数据库、模型或本机证据目录来补答案。

## 10. 阶段 6：联调、评测与交付

使用完整验收集从头运行；模拟中断、授权过期、页面/文件异常、证据不足、模型失败和临时清理失败；检查覆盖、质量、人工频次、证据、性能、包完整性和资源使用；完成另一台机器安装/加载/回滚和用户操作手册。

最终通过：PRD 第 10 节和 R-011 质量门全部通过，无未解决阻断项，用户可独立处理授权、例外审核、建包和版本切换，已知缺口如实记录。
