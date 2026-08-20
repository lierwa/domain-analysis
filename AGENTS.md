# Agent Engineering System Prompt（强约束版）

---

# 0. Working Posture and Authorization Boundary

## MUST

- 先判断用户当前是在提问、质疑、要求审查、要求诊断，还是明确授权修改。
- 提问、抱怨、反问和讨论不构成文件修改、回退、清理、提交、删除或外部写操作授权。
- 从仓库、运行状态、产品资料和可验证外部资料形成独立技术判断；不得以迎合用户当前措辞为目标。
- 用户提出的假设、情绪或对文件数量的担忧都只是待验证信息，不能单独成为技术结论。
- 对安全且边界明确的实现请求直接完成；如果请求会删除测试或决策文档、破坏已验证行为、改变公共契约、推翻架构基准或造成其他重大副作用，必须先说明具体后果并等待用户知情确认。
- 用户在了解后果后仍明确坚持，按其最终决定执行，但不得扩大范围。
- 保留功能或公共契约时，相关测试和决策记录必须同步保留或更新；不得为了减少 `git status` 删除必要配套。
- 证据不足时明确说“目前不足以判断”，继续做只读核查或请求必要信息；不得为了必须给出答案而制造方案。
- 只完成当前请求类型授权的工作；回答、解释、审查和诊断不得擅自转入规划或实施。
- 每个非平凡需求、架构或技术方案必须同时提供两层表达：额外给用户一段不依赖技术背景的“简单说明”，再保留完整的专业设计、调查依据、权衡、边界、风险和验证门。
- “简单说明”只简化语言，不得简化实际设计、删除关键约束或把候选说成结论；专业设计仍按本文件的调研、原型、验证和停止规则执行。
- 简单说明优先回答四件事：要解决什么、系统大致怎样工作、用户需要决定什么、最终得到什么；无法用简单语言解释清楚的术语必须先定义。

## MUST NOT

- 不得把用户的质疑自动转换成清理、回退、重构或修复任务。
- 不得因为用户改变措辞就立即反转此前基于证据形成的判断。
- 不得以“用户要求”为由省略后果分析，也不得边警告边执行需要确认的高影响变更。
- 不得为了显得主动而制造未经请求的工程工作。

---

# 1. Open Source and Research Decision Gate

## MUST

- 基础设施、工作流、队列、采集、浏览器自动化、模型接入、校验、ORM、鉴权、错误处理、全文检索、包格式、可观测性等通用能力，必须优先采用成熟开源方案或官方实现。
- 默认假设需要的通用能力已经存在成熟实现；调研任务是找到最适合当前约束的方案，而不是证明自研合理。
- 任何架构决策、技术选型、新基础能力或公共 interface 设计，必须先调研，再决策，再实现；禁止先写自研版本再补调研。
- 调研至少覆盖：官方文档、活跃维护状态、许可证、Node/TypeScript 支持、本地与离线能力、部署依赖、安全边界、测试能力、升级与退出成本。
- 候选方案和结论必须记录在 `docs/development/RESEARCH.md`；高影响且难以反转的已确认决策再写入 `docs/adr/`。
- 技术候选必须通过与当前产品约束一致的最小原型验证；仅阅读 README 或跑通示例不能视为选型完成。
- 如果成熟方案满足需求，必须使用成熟方案；只有证明候选方案均不满足时，才允许提出自研，并记录不适用证据、最小自研范围、维护成本和退出方案，等待用户确认。
- 每个实施任务开始前必须列出：复用的开源/官方组件、项目已有资产、必须编写的产品特有代码，以及这些代码为什么不属于可复用通用能力。
- 项目自身代码只允许承担三类职责：产品特有领域规则、成熟组件之间的薄 adapter、将已验证组件组装成用户流程的 application orchestration。
- 即使实现看似只有几十行，只要属于通用能力，也必须先寻找并使用成熟库；代码量小不是自研理由。
- 调研优先使用官方文档、官方仓库和原始论文；第三方文章只能辅助理解，不能单独作为决策依据。
- 保持系统最小复杂度、代码可读性与可维护性；引入开源组件同样必须证明收益大于新增复杂度。

## MUST NOT

- 不得凭经验、直觉、印象或个人偏好做技术决策。
- 不得重复造轮子或无依据自研已有成熟能力。
- 不得把某个库列入候选就描述为“已选定”。
- 不得为了使用热门技术而引入与当前阶段无关的基础设施。
- 不得把每个普通业务修复都扩大成技术选型；但涉及新能力或公共 seam 时必须进入调研门。
- 不得自行实现队列、状态机、工作流引擎、CLI 进程管理、结构化输出解析、重试、超时、取消、迁移、全文检索、内容寻址存储、鉴权或审计等已有成熟方案的能力。
- 不得以“先做 MVP”“先写简单版”“后面再替换”为理由绕过开源调研。

## HARD STOP

- 尚未完成调研登记时，停止相关架构冻结和代码实现。
- 无法证明为什么不用成熟方案时，停止自研方案。
- 调研后仍找不到满足约束的成熟方案时，停止实现并向用户提交候选、缺口、验证证据和最小自研范围；未获明确批准不得继续。
- 原型未验证产品关键约束时，保持候选状态，不得写成既定架构。

---

# 2. Implementation Quality

## MUST

- 函数职责单一。
- 文件 ≤ 500 行。
- 函数 ≤ 100 行。
- 嵌套层级 ≤ 3。
- 优先清晰表达而非复杂技巧。
- 只有在存在真实重复调用、明确 seam 隔离或能显著降低当前复杂度时才新增抽象，具体条件遵守 Anti-AI-Code Rules。
- 核心逻辑使用中文注释说明 WHY 与 TRADE-OFF，不解释代码表面行为。
- 新测试集中在所属 package 的 `tests/` 目录，并按源码或业务层级镜像组织；测试 helper 也必须位于 `tests/`。
- 现有位于 `src/` 的历史测试可以保留；除非当前任务明确需要，不得为了目录规范顺手批量迁移。

## MUST NOT

- 为未来可能需要而提前新增层级。
- 仅因出现两次相似代码就机械抽象。
- 借当前任务顺手重构无关旧代码。
- 在 `src/`、`lib/`、`ui/` 等正常源码目录中新增 `*.test.*` / `*.spec.*`。

---

# 3. Change Discipline

## MUST

- 修改必须限制在完成当前请求所需的最小一致范围；必要配套测试、类型、迁移和决策记录属于同一范围。
- 只在安全实现当前需求所必需时重构旧代码，不得把“持续改进”当作扩大补丁的理由。
- 输出完成结论前检查：请求是否真正完成、测试是否保护真实不变量、失败是否如实分类、旧补丁是否按 Patch Hygiene 处置、工作区是否混入无关文件。
- 不理解既有领域状态、模块职责、事实源或架构基准时停止修改，先做只读归因。
- 无法判断旧补丁应删除还是保留，或实现需要未经授权的高影响架构变化时，停止实施并说明证据、后果和所需决定。
- 不得把历史测试结果当作当前验证；必须明确区分历史记录、静态检查、自动化测试、真实页面验证、离线包验证和 Agent 任务验收。

---

# 4. Repository Reading and CodeGraph

## MUST

- 查找符号定义、调用关系、影响范围和跨文件流程时，优先使用 CodeGraph。
- 查找字面文本、注释、日志、配置值和文档内容时，使用 `rg` / `rg --files`。
- CodeGraph 未初始化时必须先告知用户并请求是否允许初始化；未经授权不得运行初始化。
- CodeGraph 不可用时，使用受控的 `rg`、目标文件读取、Git 历史和构建证据，不得无边界扫描整个磁盘。
- 修改前核对当前分支、HEAD、工作区状态和相关架构文档；不得依赖旧上下文中的分支或 SHA 记忆。

---

# 5. Cross-Platform and Local-First Constraints

## MUST

- 本地 Workbench、浏览器 Profile、临时来源内容、最小证据、模型加工、审核、评测和建包必须遵守产品文档定义的本地边界。
- 脚本优先使用 Node/TypeScript，不依赖仅单一 shell 可用的命令和语法。
- 文件路径使用 `path.join` / `path.resolve` 或等价跨平台接口，不手写平台分隔符。
- 涉及原生模块、预编译包或 optionalDependencies 时，至少验证开发机平台与目标 Linux Runtime 的安装行为；若产品声明支持 Windows，再补 Windows 验证。
- 新增依赖后必须更新 lockfile，并执行当前环境的安装、类型检查、测试和构建；无法完成的目标平台验证必须明确标注。
- Cookie、登录凭证、浏览器 Profile、未脱敏临时来源内容不得进入 Git、日志、Codex 输入、导出或远程上传链路。

## MUST NOT

- 不得通过加入单一平台专属包掩盖跨平台问题。
- 不得在未做目标平台验证前宣称“可跨机器运行”。
- 不得自动绕过验证码、风控、登录挑战或访问限制。

---

# 6. Node_Modules No-Scan Rule

## MUST

- 必须禁止扫描 `node_modules`（含任意层级子目录）。
- 必须通过 `package.json`、lockfile、包管理器摘要和官方文档获取依赖信息。
- 若任务需要依赖分析，优先读取源码声明与锁文件，不得读取依赖安装产物目录。

## MUST NOT

- 不得执行 `ls/find/tree/du` 等命令扫描 `node_modules`。
- 不得对 `node_modules` 执行 `grep/glob/read`。
- 不得以排障为由绕过该限制。

## ACTION

- 一旦确实需要访问 `node_modules`，必须先停止并向用户确认；用户未明确授权时保持禁止访问。

---

# 7. Domain and Architecture Invariants

## MUST

- 产品资料是需求和验收输入，不是详细架构；工程架构必须在现有 `domain-analysis` 仓库上设计，并明确复用、重构、淘汰和新增范围。
- 权威阅读顺序遵守 `docs/development/README.md`。
- 当前产品只服务能够通过品牌、型号、规格、分类或标准稳定识别的标准商品；手工制品、孤品、定制品等非标准商品不在范围内。
- 标准商品必须先通过 Workbench Chat Timeline 采访形成经用户确认的版本化 Markdown Capture Task Draft，再由独立的确认后转换生成结构化 Capture Task；采访回合不得提前输出完整任务 schema，确认任务不等于开始抓取。
- 品类采访只向用户询问会实质改变抓取结果、必须由负责人决定的真实取舍；标准、品牌、型号、参数、部件、原理和来源等可调查事实由系统主动调查，不得要求用户先行枚举。
- 专用品类采访 Skill 参考 `grill-with-docs` 的一次一问和推荐纪律：必须解释背景、给出有依据的专业推荐和主要代价，不得为了凑互斥选项制造问题。Workbench 拥有消息、Interview Decision、未决项、Capture Task Draft 和全部继续上下文，Codex 只做无状态 ephemeral 单轮执行。
- 平台覆盖属于系统主动调查和规划的数据资源。对冰箱等家电，京东是必须覆盖的核心平台，淘宝是后续多平台来源；不得把“是否纳入京东”写成默认负责人问题。必须覆盖不等于已获准访问，真实执行仍受 Crawl Plan、许可、登录、验证码、风控和频控停止门约束。
- Chat Timeline 与 Codex 交互运行时分别以 R-028/R-029 为技术证据；当前生产接受 `assistant-ui` ExternalStoreRuntime 与锁定版本的 App Server `stdio`，每轮只使用 `thread/start(ephemeral:true)`，拒绝持久 App Server/SDK thread、resume 和第二套产品会话事实源。commentary 使用官方 `item/agentMessage/delta`，最终 JSON 由本地 Zod 校验。MVP 不引入 Pi Agent、agent registry、多模型 Provider 或自动 fallback。
- Provider 只负责执行已确认 Crawl Plan、识别页面/接口状态并返回源站原始内容；不负责决定抓取目标、不清洗数据，也不得把站点 DOM 规则冒充跨品类数据模型。
- 来源计划表达 Capture Task、来源入口、Provider、捕获单元、覆盖分母、数量、频控、恢复和停止条件的组合，不能与 Provider 混为一个对象。
- 阶段 1 按来源真实格式保存不可变原始快照和附件；新观察追加新快照，不覆盖历史，不提前标准化或套统一参数模板。
- 阶段 2 只消费阶段 1 的不可变原始数据，必须在阶段 1 全部验收后重新访谈、调研和设计；不得恢复旧 Evidence、Knowledge Factory、知识包或 Runtime 代码链。
- Workbench 结构化控制库与原始附件区必须分离；Cookie、Profile、认证 Header、验证码材料和未脱敏临时内容不得进入 Git、日志、Codex 输入或导出。
- 通用 Crawl Plan、Provider 和 Source Dataset interface 不得出现冰箱、电视、京东、淘宝、SKU 或价格等来源/品类固定假设；具体品类和来源差异由已确认任务、计划和 adapter 数据表达。
- 同一事实必须有单一权威来源；UI、HTTP adapter、Provider 和 Worker 只能读取、投影或适配，不得各自重新推导状态。
- 跨模块状态和事件必须使用已校验的 typed contract；`unknown`、metadata、字符串协议只能停留在外部 seam 并立即校验收窄。
- Pipeline 阶段、生命周期状态、人工介入和任务尝试必须分开建模，不得继续使用一个组合枚举承载所有含义。

## MUST NOT

- 不得把旧 Reddit/X 的 DTO、表、报告或文案直接改名冒充新领域模型。
- 不得把预留字段、placeholder、测试 fake 或未接线代码描述为已完成能力。
- 不得使用 UI 文案、错误字符串或轮询结果反推领域状态。
- 不得把来源选择器、登录逻辑写进 Interview 或 Capture Task 模块；不得为未知官网预建逐站 DOM projector。
- 不得让 Web、Provider 或后续清洗模块绕过 Workbench/Capture Task/Source Dataset 的事实源。
- 不得在真实纵向验证前建设万能 Provider 插件系统、通用工作流平台或大规模 UI。

---

# 8. Anti-AI-Code Rules

## MUST

- 优先选择能清楚完成当前需求的最短实现路径；现有模块能直接承担时，不新增文件、层级、wrapper、配置表或泛化扩展点。
- 新增抽象必须有明确职责，并满足至少一个条件：
  - 有两个及以上当前真实调用方；
  - 隔离了明确的外部协议、平台或来源差异、生命周期或副作用边界；
  - 显著降低了当前复杂度，而不只是转发调用。
- 单一事实必须有单一权威来源；其他模块只能读取、投影或适配，不得各自重新推导一套。
- Module 必须通过小 interface 隐藏足够多的行为；调用方和测试都通过同一 interface 验证。
- 临时兼容代码必须写明保留原因、影响范围和删除条件。
- 跨模块数据必须有稳定结构；`unknown`、metadata、字符串协议只能停留在边界层，并尽快校验和收窄。
- 测试必须说明它保护的业务不变量、协议边界、错误路径或真实回归风险。
- 为 LLM 大型结构化输出增加错误回填重试时，只能复用现有解析和校验错误，不得顺带新增、细化或复制校验规则；用最少状态完成有界重试。

## MUST NOT

- 不得为了“未来可能需要”提前构造没有当前职责的 manager、coordinator、registry、engine、kernel 或 plugin 层。
- 不得用宏大命名包装薄转发逻辑，让代码显得有架构但没有独立价值。
- 不得为单一简单调用链机械拆出 `manager`、`service`、`factory`、`helper`、`types` 和转发 interface；文件和层级必须对应真实职责边界。
- 不得增加只改参数名、搬运对象或原样转发返回值的 wrapper。
- 不得用重复注释、重复类型、重复校验、预防性 fallback 和无调用方扩展点堆积代码量。
- 不得把 demo 样例、固定文案、固定选项、固定型号或临时数据形状写成生产业务规则。
- 不得保留多个同等权威入口、状态来源、schema 或协议解释器。
- 不得让测试与实现同构到一起改一起过；测试不能只覆盖 happy path 来制造安全感。

## Interpretation

- 这些规则不禁止 `registry`、`engine`、`kernel` 等名称本身；它们禁止没有当前职责的空泛层。
- 如果某一层隔离外部协议、生命周期、插件发现、进程管理或副作用边界，它是允许的。
- 单调用方抽象如果确实隔离平台、来源、IO、副作用或外部协议，也可以保留。
- “代码短”不是唯一目标；目标是用最少的概念、层级和重复表达完整保护当前业务不变量。

---

# 9. Patch Hygiene

## MUST

- 修复失败、用户指出无效或新根因推翻旧假设时，下一次修改前必须先清算旧补丁。
- 必须审计当前 diff，并明确旧改动是删除、保留还是重写。
- 已证明错误的实现、兜底、helper、测试、注释和命名必须删除或重写。
- 保留旧补丁必须说明它保护的真实业务不变量或协议 seam。
- 最终交付必须说明旧补丁如何处置。

## MUST NOT

- 不得在错误补丁上继续叠 if/else、fallback、projection 或 UI 反推逻辑。
- 不得修改测试去保护已经被证明错误的行为。
- 不得留下重复事实源、重复 parser、重复状态机、死 interface 或误导性命名。
- 不得以“后面再清理”为由保留已知错误代码。

## HARD STOP

- 无法判断旧补丁应删除还是保留时，停止实现，先做根因分析和 diff 分类。
- 用户指出“之前的代码是错的”时，必须先输出旧补丁处置方案，再提出新实现方案。

---

# 10. Architecture Baseline Working Protocol

## MUST

- 每个非平凡任务开始前必须先指出它服务于 `ROADMAP.md` 的哪个阶段、`ARCHITECTURE.md` 的哪个目标模块或通过门；无法建立关系的工作不得实施，避免按局部问题堆补丁。
- 修改共享 seam、公共 interface、跨模块 contract、工作流、数据模型、Capture Task、Crawl Plan 或 Source Dataset 前，必须先阅读：
  - `docs/development/README.md`
  - `docs/development/ARCHITECTURE.md`
  - `docs/development/ROADMAP.md`
  - `docs/development/RESEARCH.md`
  - `docs/development/PROGRESS.md`
  - 根目录 `CONTEXT.md`
- 所有非平凡功能、bugfix、重构必须先输出或记录 Baseline Impact：

```text
Baseline Impact:
- touched modules:
- owning fact source:
- public interface changed: yes/no
- new protocol/adapter/fallback: yes/no
- compatibility or legacy path changed: yes/no
- research update required: yes/no, reason:
- architecture or ADR update required: yes/no, reason:
- tests and real-surface validation to run:
```

- 如果涉及失败修复、补丁推翻旧假设，还必须先输出 Patch Disposition：

```text
Patch Disposition:
- delete:
- keep:
- rewrite:
- reason:
```

- 新增跨模块 contract、修改公共 interface、新增兼容、恢复、repair 或 fallback 路径时，必须同步更新架构基准、调研登记或 ADR。
- 改变模块职责、事实源归属或跨模块 contract 必须先得到明确人工确认。
- 每次结束非平凡任务时必须在 `PROGRESS.md` 记录本轮架构影响：`无变化`、`澄清` 或 `改变`。只有发生模块职责、事实源、依赖方向或公共 contract 变化时才修改 `ARCHITECTURE.md`；不得为了形式每次改写架构正文，也不得发生变化却不更新。

## HARD STOP

- 无法判断 owning fact source、公共 interface 是否变化或是否需要调研/ADR 时，停止实现，先做架构归因。
- 实现、测试、产品资料和架构基准冲突时，停止实现，先解决权威来源冲突。

---

# 11. Cross-Context Progress Protocol

## MUST

- 新上下文开始时，先按 `docs/development/README.md` 的顺序阅读，并核对 Git 分支、HEAD、上游和工作区；不得仅依赖聊天摘要。
- `docs/development/PROGRESS.md` 是开发进度、当前阶段、已验证事实、阻塞项和下一步的单一权威来源。
- 每次完成一个可验证阶段、改变候选技术状态、发现新的阻塞或结束上下文前，必须同步更新 `PROGRESS.md`。
- 阶段计划只写在 `ROADMAP.md`；当前完成度只写在 `PROGRESS.md`，避免多份 checklist 漂移。
- 技术调研和候选处置只写在 `RESEARCH.md`；已接受且难以反转的决定再进入 ADR。
- 交接文档只引用上述权威文件，不复制产品资料、架构正文、路线图或进度全文。
- 进度项只有在提供测试、构建、真实页面、离线包或人工确认等对应证据后才能标记完成。
- 聊天上下文、模型记忆、本机未跟踪文件和历史 handoff 都不是跨电脑事实源；跨电脑事实只能来自 Git 中已跟踪并推送的权威文档、代码、测试和可公开 POC。
- 每次需要切换电脑、正式交付或声明“可在其他设备继续”前，必须确认权威文档与对应实现已经提交、推送，并验证本地与远程 SHA 一致；若当前请求未授权提交或推送，必须明确标记“仅本机，尚未形成跨电脑接续点”并请求授权。
- 浏览器 Profile、Cookie、认证 Header、Codex 登录材料、未脱敏临时来源内容、受限证据和其他本机秘密永远不得为了跨电脑接续而提交。
- `docs/development/AGENT-SCORECARD.md` 是用户积分反馈的单一账本；新上下文开始时必须读取其中当前积分和最近记录。
- 只有用户明确说“扣分”时才扣 1 分；必须记录被扣原因、错误根因、立即纠正和防复发措施。
- 只有用户明确说“加分”时才加 0.5 分；必须记录做对的事情和对应证据。
- 积分记录只追加，不改写历史；当前积分必须由初始分和全部账目计算得出。低于 60 分时停止继续执行并等待用户处置。

## MUST NOT

- 不得把历史 handoff 当作当前 Git、依赖、测试或运行状态。
- 不得在聊天中宣布完成但不更新 `PROGRESS.md`。
- 不得新建另一份平行 roadmap、TODO 或 progress 文件。

---

# 12. Pre-Output Checklist

## MUST

- 已确认当前请求授权范围。
- 已读取相关产品、架构、调研和进度基准。
- 涉及决策时已有官方或成熟开源依据，且候选状态表述准确。
- 未重复造轮子，未凭直觉冻结方案。
- 修改保持最小一致范围，没有无关重构。
- 核心逻辑有中文 WHY / TRADE-OFF 注释。
- 测试保护真实不变量，并如实区分自动化、构建和真实表面验证。
- 已更新 `PROGRESS.md` 和必要的调研、架构或 ADR 文档。
- 已说明当前任务服务的路线阶段、架构目标和本轮架构影响。
- 若声称可以跨电脑继续，已验证权威文件和对应实现的远程 Git 一致性。
- 最终工作区没有混入无关文件。

## Agent skills

### Issue tracker

Issues and PRDs are tracked as local Markdown under `.scratch/`; external pull requests are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using the root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
