# 数据抓取与清洗平台架构基线

状态：2026-08-20 已收口到标准商品两阶段；当前只实施阶段 1 数据抓取

## 1. 简单说明

用户新建一个“抓取任务”，直接输入“抓冰箱”之类的标准商品需求。系统先像专业抓取任务顾问一样调查商品边界、相关标准、应该关注的内容和真实来源，再用推荐答案、依据和代价帮助负责人理解真正需要决定的取舍。对话结束后得到一份可读的 Markdown 范围草案；用户确认文字范围后，系统才单独转换成正式 Capture Task。范围不够时可以回到同一段对话继续补充；再次确认会形成同一任务的新版本，旧草案不被覆盖。

当前不处理手工制品、孤品、定制品等非标准商品。对冰箱等家电，京东是必须覆盖的核心平台来源，淘宝是后续同级多平台来源；系统解释这一规划，但不为了凑选项询问“是否纳入京东/淘宝”或要求负责人选择网站。当前没有淘宝专用 crawler；通用公共资源 Provider 只能按计划保存精确公开入口或一次受控同源链接，不能冒充淘宝分页、商品发现或完整平台覆盖。

未完成对话会保存在任务记录中，刷新页面后继续原会话。未关联正式任务的对话可以确认后删除；正式任务的“删除”只归档并移出活动列表，历史版本和已经形成的原始数据不会被物理抹掉。

系统根据不同来源决定原始捕获单元：网页保存 HTML 或源站 JSON，H5 说明书保存原始 HTML，文档保存 PDF，表格保存 CSV/XLSX，图片和其他媒体保存原文件。Crawl Plan 逐项列出入口与正文 target；Source Dataset 保存这些不可变原件。阶段 1 不判断哪些字段最终有用，也不把所有来源硬塞进同一个参数模板。

用户当前只需要验收两件事：对话产出的任务是否正确，以及后续抓回来的原始数据是否真实、持久、可查看、可导出。清洗、Evidence、知识加工和知识包不在当前实现里。

## 2. 两阶段边界

### 阶段 1：数据抓取

负责：

- 通过专业引导式对话形成标准商品抓取范围和候选来源；
- 用户确认正式抓取任务；
- 为每个真实来源制定可执行计划；
- 在许可、登录、频控和停止条件内访问来源；
- 以尽量接近源站的格式保存原始业务数据；
- 重启后继续存在，并在 Workbench 查看和导出。

不负责：字段标准化、去噪、实体合并、证据裁剪、知识判断或模型加工。

### 阶段 2：数据清洗

只在阶段 1 验收后设计。它将消费阶段 1 的不可变原始数据，不得反向改变或覆盖原始捕获。

## 3. 当前数据流

```text
用户首句
  -> Category Interview Module
  -> 保存用户原文并重放采访工作资料
  -> 任何新输入先使上一版草稿离开当前可确认态
  -> 隔离产品工作目录中的 Codex App Server ephemeral 单轮调查/提问
  -> 校验并提交本轮文字事实/决定/未决项/Markdown 草稿增量
  -> 版本化 Markdown 抓取范围草稿
  -> 用户确认文字范围
  -> 不搜索、不增加事实的独立 materialization
  -> 结构化 Capture Task
  -> [范围需调整] 回到原 Interview 生成新草稿版本
  -> 用户再次确认，更新同一 Capture Task 的当前版本
  -> 用户显式启动可见 Crawl Planning Run
  -> 版本化 Crawl Plan Draft
  -> 用户确认 Crawl Plan
  -> 用户显式开始（服务端重读 confirmed plan）
  -> Provider preflight / 前台 Source Run
  -> Source Dataset (raw)
  -> Workbench 查看 / JSONL、CSV 导出
```

确认抓取任务不会自动开始访问外部来源。计划确认和正式执行是后续独立通过门。

## 4. 单一事实源

| 事实 | 唯一拥有者 | 其他模块职责 |
| --- | --- | --- |
| 对话消息、用户原文、消息内有序文字/活动时间线、当前状态、未决项 | Category Interview Module / PostgreSQL | 共同组成采访工作资料；UI 展示并在刷新后重放；Codex 每轮读取快照 |
| 用户确认的取舍 | Interview Decision | Skill 提建议并解释本轮原文；Workbench 校验其引用的当前 proposal 后提交规范化决定 |
| 标准商品边界、准备抓什么、从哪里抓 | 版本化 Markdown 抓取范围草稿 | 用户确认前不能结构化或执行；历史版本不可变 |
| 正式候选来源及其记录时间 | Capture Task / PostgreSQL | 只从已确认文字结构化；Workbench 在转换时写入时间，模型时间不具权威性 |
| 当前已确认抓取范围 | Capture Task | 指向最新确认版本；Crawl Planner 只读指定版本 |
| 规划过程、搜索活动和结果状态 | Crawl Planning Run | Codex 只交付候选；Web 只投影 |
| 每个来源抓什么、抓多少、何时停止 | 版本化 Crawl Plan | 用户确认前不能执行；Provider 只执行冻结版本 |
| 清单中每个 target 的尝试、状态与计数 | Source Target Attempt | Source Run 汇总只能由 target 事实对账，不从 Provider 结束事件猜测 |
| 一次访问发生了什么 | Raw Source Observation | UI 与导出读取 |
| 来源当时返回的原始内容 | Source Snapshot / Source Asset | 后续清洗只读，不覆盖 |

Codex 不拥有产品 thread、任务或来源数据。每个采访 runtime 只建立并初始化一次 App Server `stdio` 连接；每个业务轮次仍创建新的 `ephemeral: true` 内存 thread，不 `resume`、不持久化 Codex 产品会话，Workbench 关闭时结束该连接。每轮先把仓库内权威采访 Skill 同步到不继承工程 `AGENTS.md` 的隔离目录标准 `.agents/skills/` 位置，再通过官方 `skill` input 显式注入该副本；该产品运行时关闭官方 `shell_tool` 和 `unified_exec` feature，只保留采访所需的网页搜索。Workbench 先持久化用户原文，再重放 PostgreSQL 中的采访工作资料；Codex 解释本轮完整原文并只返回推进采访所需的最小增量：说明、决定、未决项、可选 `draftMarkdown`，以及仅在生成草案时出现的四组 URL `draftCoverage` 校验凭证，不返回完整任务 schema。Workbench 将凭证逐条对照已完成的会话搜索活动和 Markdown 原文；凭证不持久化为第二份来源事实，只保存“本版本已通过覆盖门”的布尔结果。运行中的 commentary 通过官方 delta 协议展示，最终机器 JSON 只在进程边界由 Zod 校验。用户确认 Markdown 后，同一 runtime 另起 ephemeral 纯转换回合生成正式 Capture Task；该回合禁止搜索和新增事实。首次调查回合必须观察到已完成的 `web_search` item；只有 started/failed 不满足调查门。后续纯解释或范围未变回合不重复强制搜索。

## 5. 当前模块

### 5.1 Category Interview Module

- 接受用户首句，不重复确认已经明确的门类；
- 先判断是否属于标准商品，主动调查标准/监管、品牌/型号、内容范围和候选来源；
- 用普通对话解释专业判断，每个真实问题给出推荐答案、依据和主要代价，不为凑选项制造问题；
- 把平台、网站和入口选择视为系统调查事实；对冰箱等家电把京东作为必需平台范围写入草稿，不把它改写成负责人选择题；淘宝只作为后续同级候选，当前不能声称有可执行 crawler/Provider；
- 保存消息、带 2–3 个建议和唯一推荐项的负责人问题、决定和未决项；
- assistant 消息同时保存按到达顺序组成的文字/活动时间线；Web 刷新只重放该事实，不从浏览器内存或最终文本猜测工具历史；
- 将结构化问题统一保存为 proposed Decision，但在 Timeline 中投影为普通助手消息；它只是下一条自然语言的上下文，不增加独立题板或第二个“确认”动作；
- 任意 Composer 输入都先保存原文并进入 Codex 回合。Codex 可以同时解释选项回答、附加事实、纠正、否定问题前提或追问；明确回答才提交 `decisionResolution`，成立的前提否定提交 `decisionWithdrawal`。Workbench 校验二者引用当前 proposal 后生成 confirmed Decision 或撤回该问题，不允许同一回合同时解决和撤回；
- 用户只是追问解释且没有改变抓取范围时，Codex 用普通说明回答，不生成决定或草稿修订；
- 任意新输入都会把 session 从 `task_ready` 或已确认读取态切回运行态；只有最新回合结束后处于 `idle + task_ready`、最新草稿完整、没有负责人未决项且四类来源覆盖已由 Workbench 验证时，后端才接受确认；
- 接受 Codex 的 `draftMarkdown`，但只有核心零售/市场入口、至少两个独立品牌官方站点、标准/监管和技术原理入口均来自本会话已完成搜索且原样写入 Markdown 时，才形成可确认的版本化草稿；未经过该门的历史文本保留为不可确认版本；模型生成草稿不等于用户确认；
- 只在用户显式确认最新 Markdown 后调用独立 materialization，校验并生成或推进 Capture Task；确认后仍接受增量消息并形成后续草稿版本；
- failed/interrupted 回合只允许以最近一条失败/中断的用户原文重试，且其后不能已有完成的 assistant 消息；历史消息不能被选择为 retry target；
- 列出尚未关联正式任务的未完成采访，支持刷新恢复和继续；运行中的采访不能删除，已关联正式任务的采访不能脱离任务单独删除。

### 5.2 Capture Task Module

保存和读取确认后结构化任务的当前版本：原始需求、标准商品边界、市场/时间口径、内容范围、平台与官方来源范围、候选来源、排除项和未决项。首次确认创建任务；后续确认保持任务 ID 不变并推进 revision，历史确认范围由不可变 Markdown 草稿保留。删除活动任务记录时只把状态改为 `archived` 并从活动读取接口隐藏，不级联删除采访、草稿版本或 Source Dataset。它不保存参数 schema 或清洗规则。

### 5.3 Source Dataset Module

保存来源运行、逐 target attempt、来源对象、不可变快照和附件。每个快照冻结计划 `targetKey`；未知、重复或遗漏 target 不能被 source 级完成状态掩盖。新数据只允许两种原始载荷：

- `inline_text`：HTML、JSON、CSV、纯文本等可安全内联的源站响应；
- `asset`：PDF、XLSX、图片、视频等原文件。

原始附件字节进入本地 cacache 内容寻址存储，相同字节可复用，但每个 snapshot/asset 的来源关系独立保留并可下载。旧来源记录不删除，读取时明确标成 `legacy_structured_json`，不得冒充新原始捕获。

### 5.4 Crawl Planning Module

读取一个当前 Capture Task revision，通过注入式 Codex runtime 生成并校验版本化 Crawl Plan Draft，保存 Planning Run 有序时间线，并在用户显式确认时推进 plan version 状态。它独占“来源、内容、数量”的计划事实；active 清单必须逐项对账全部采访来源候选和全部原文 topic，每个 target 必须绑定真实 Provider 配置。Draft 保存和确认只调用 Provider 的纯结构 `validate`；浏览器、端口和登录等可变化运行条件不属于计划确认事实。说明书、PDF 和附件表格不能用入口页中的链接文字冒充正文；精确入口本身为 PDF/Office 文档时，该 exact target 就是正文并按原始附件留存。API/Web 不复制 Planner 规则，Codex 不写 task ID/revision，也不启动 Source Run。

规划运行复用现有 App Server `stdio`、ephemeral thread、Skill input、web search、官方 `outputSchema` 和 typed SSE；本地 Zod 再校验领域 contract。一个规划 runtime 复用一条已初始化连接，每次运行新建一个 ephemeral thread；首次结构化输出未通过现有解析、清单或 Provider 校验时，只把原错误回填到同一 thread 修正一次，并在第二个 turn 继续附同一 `outputSchema`。它不新增或复制校验，不重开 thread、不换模型、不处理传输/认证失败；第二次仍失败即关闭 Planning Run。连接关闭则中止，官方 `turn/interrupt` 负责取消，已完成结果可刷新恢复。不为最长十分钟的有界规划引入 DBOS、后台队列或第二套 Session。

### 5.5 Source Access

保留 Crawlee 临时存储配置以及 `p-queue`、`cockatiel` 的频控、取消和熔断。composition root 以显式 map 注入 Provider，不建设动态插件系统。`jd.catalog-product@1.0.0` 只接受 loopback CDP、一个 `www.jd.com` 入口和计划中的 `include_text/exclude_text`，固定产生目录与首个合格详情两个 target。它在显式 Prepare 时优先连接 9222；端口不存在则由 Playwright 用项目独立 Profile 启动系统 Chrome，再检查端口和京东登录。同一 confirmed plan 的 Prepare、Start preflight、目录、详情和全部 JD source 共用一个 Provider execution gate；最长窗口可按来源窗口合计，但每分钟预算、同域间隔与零重试不放宽。未登录或出现验证页只返回 typed 人工动作并把页面置前，不保存页面、Cookie 或认证材料。`public.web-resource@1.0.0` 复用 Got、robots-parser、Cheerio 与 Node DNS/net，只访问计划冻结的公网 HTTPS 443 精确 URL，或从已保存前序 HTML 按完整文字唯一跟进一次同源链接；精确 URL 比较先走标准 URL 规范化，不能把根 URL 与其尾斜杠形式误判成两个资源；拒绝 redirect、私网与 fake-IP 地址、自由发现、递归、Cookie/认证和自动重试。Provider 纯结构校验在 Draft 保存和确认时执行，运行准备与 Start 最终 preflight 属于 Source Execution；登录、验证码、拒绝、`rate_limited` 或风控产生 typed stop，不读取日常 Profile。代理/TUN 把系统解析映射到保留地址时继续失败关闭，不加白、不暗中切换解析器；本机网络工具的开关是显式运行条件，不属于 Crawl Plan 或 Provider 持久事实。

### 5.6 Source Execution

读取 confirmed Crawl Plan 的精确 task revision/version。显式 Prepare 只协调 Provider 的临时运行准备并返回 `ready` 或 `action_required`，不持久化另一套业务状态、不创建 Source Run；Web 只有在当前页面拿到 `ready` 后才开放 Start。Prepare 与 Start 用 plan identity/version 复用同一 Provider execution 生命周期；Start 仍重读同一 confirmed plan 并执行最终 preflight，随后才为每个 source 和 target 创建可对账运行事实，并把带 `targetKey` 的 Provider observation 通过 Source Dataset 单一事务入口持久化。一个来源出现登录、验证、拒绝或限流时，同 Provider 的剩余来源不再访问站点，但仍创建 `stopped` run/target 作为逐来源审计；其他 Provider 继续执行。未知、重复、未完成 target 或数量不一致失败关闭；source 完成不能由一个笼统 Provider 结束事件推导。首版复用 SSE 前台运行；断开或取消记为 stopped。运行中不调用 Codex，不解释自然语言 traversal，不自建队列、恢复或第二套计划事实源。

## 6. 物理边界

- PostgreSQL `workbench` schema：对话、任务、计划元数据、运行、来源对象和快照索引；
- 原始附件内容存储：本地 cacache CAS；PostgreSQL 只保存 digest、大小、媒体类型、来源 URL 与 snapshot 关系；
- Cookie、Profile、密码、认证 Header 和验证码信息不得入库、日志、Git 或导出；
- 项目专用浏览器 Profile 只位于 Git 忽略的本机 `data/`，由 Source Access 生命周期使用；
- 不使用结束即删除的隔离数据库冒充正式数据；
- 本地两台电脑的数据不通过 Git 同步。

## 7. 依赖方向

```text
shared contracts
  <- db
  <- workbench
  <- api
  <- web

shared contracts
  <- worker (仅阶段 1 来源访问基础)

worker Provider -> workbench 注入式 SourceProvider seam（composition root 组装）
```

Web 不推导任务状态；API 只适配 Workbench；Worker 不拥有任务事实。

## 8. 开源与产品代码边界

- 复用：PostgreSQL、Drizzle、Fastify、assistant-ui、Codex CLI App Server `stdio`/`outputSchema`、Crawlee、p-queue、cockatiel、Got、robots-parser、Cheerio、cacache。
- 产品代码：标准商品抓取任务采访规则、任务确认、来源计划的业务约束、原始数据 Workbench 投影。
- 当前不自研队列、工作流引擎、浏览器自动化框架、重试器或结构化输出解析器。

## 9. 当前通过门

1A 单独验收“对话输出抓取任务草稿”：

1. 输入“抓冰箱”后不重复确认门类，并正确判断它属于标准商品；
2. 系统主动调查标准/监管、品牌、型号、内容范围和候选来源；
3. 家电把京东作为必须覆盖的平台来源并解释原因，不询问“是否纳入京东”；淘宝保留为后续同级多平台候选，并明确当前没有淘宝专用 crawler，公共精确入口 Provider 也不等于平台覆盖；平台、网站和入口选择都不转嫁给负责人；
4. 每个负责人问题都是真实业务取舍，给出专业推荐、依据和代价；不得为了凑 2–3 个选项制造问题；
5. 草稿以 Markdown 可读地展示标准商品边界、范围和来源事实，不出现正式 Capture Task JSON、参数编辑器、Evidence 或知识加工；
6. 每个 assistant turn 按 SSE 到达顺序交错追加 commentary 与经过脱敏的搜索/产品工具活动，并把相同有序时间线随 assistant 消息持久化；同一活动的 started/completed 只原位更新，后到文字不得插到既有活动之前；连接初始化对用户隐藏且跨轮复用，当前轮从“准备本轮分析”开始，thread/turn 生命周期只作为内部协议状态；同轮 `web_search` 默认折叠为一条“搜索了 N 个网页”，展开才显示 App Server 实际交付并去重的 http(s) URL；采访运行时禁用 shell 能力，adapter 对异常/旧 `commandExecution` 仍失败关闭且不投影；`final_answer` 生成期间必须显示可理解的整理校验状态；
7. 负责人问题作为普通消息展示建议，Composer 可发送任意自然语言；每条原文都先进入采访 Agent，明确回答才确认，成立的前提否定会撤回问题；追问、纠正和混合附加事实都能继续且不丢失，不出现独立题板或第二个决定确认动作；
8. ScrollToBottom 只在用户离开 live edge 阅读历史时出现；回到底部后由 assistant-ui 恢复自动跟随，按钮不得覆盖消息或草稿卡；
9. 任意新输入立即退出旧草稿可确认态；只有最新回合 `idle + task_ready` 可确认。纯解释可明确保持当前范围而不产生修订；用户显式确认 Markdown 后才通过独立纯转换生成正式 Capture Task，且不自动制定计划或抓取；已确认任务可以继续原对话并生成同一任务的新版本。
10. 未完成采访显示在任务记录中；刷新恢复当前会话、规范化消息及消息内搜索/工具时间线；删除未完成采访和归档正式任务均需用户确认，且不能误删正式任务历史或原始数据。
11. 首轮和形成换品类草稿时必须完成网页搜索，模型来源时间不可信；失败/中断只允许重试最近一条对应用户原文，不能重放更早历史消息。

1B 的当前通过门：完整计划必须对账全部采访候选与 topic；每个入口/正文/附件都是有数量、分母、唯一键、Provider 配置和停止条件的 target；无 Provider、占位配置、入口-only 附件或 blocker 都不能保存/确认。2026-08-20 的真实家用冰箱 v6 已以 8 个来源、12 个 target 覆盖 7/7 候选与 13/13 topic，并通过确认预检。确认不等于执行；本轮没有点击 Start，多来源真实访问结果仍未验收。
