# 数据抓取与清洗平台架构基线

状态：2026-08-24 已冻结“AI 深度来源规划＋品牌官网抓取”的阶段 1 架构

## 1. 简单说明

用户新建一个“抓取任务”，直接输入“抓冰箱”之类的标准商品需求。系统先像专业抓取任务顾问一样调查商品边界、相关标准、应该关注的内容和真实来源，再用推荐答案、依据和代价帮助负责人理解真正需要决定的取舍。对话结束后得到一份可读的 Markdown 范围草案；用户确认文字范围后，系统才单独转换成正式 Capture Task。范围不够时可以回到同一段对话继续补充；再次确认会形成同一任务的新版本，旧草案不被覆盖。

当前不处理手工制品、孤品、定制品等非标准商品。对冰箱等家电，Planning Agent 主动深搜品类品牌版图，把每个发现品牌对账到官网，并调查参数/说明书、标准/监管和技术原理入口。当前正式计划排除 JD；系统不要求负责人枚举品牌或选择网站。

用户只面对一个逻辑抓取任务。AI 调查、官网补齐和缺口修复可以分别产生已确认 Crawl Plan version 和 Batch；Workbench 先在计划页展示 Research Audit 的品牌清单、官网映射、topic 对账和未解决项，Batch/Source Run 只作为执行审计与定向重试入口。系统不能保证外部网站公开所有数据，但不能把未知、缺失或访问限制伪装成完整。

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
  -> DBOS 按稳定阶段 ID 持久执行并恢复
  -> AI web search：品牌版图 / 市场目录 / 官网 / 参数说明书 / 标准原理
  -> Research Audit：逐品牌与逐 topic 对账
  -> 版本化 Crawl Plan Draft
  -> 用户确认 Crawl Plan
  -> 用户显式开始（服务端重读 confirmed plan）
  -> PostgreSQL 持久 Graphile job（HTTP 202 后与页面生命周期分离）
  -> 持久 Source Collection Batch
  -> Provider preflight / 服务端 Source Run
  -> Source Dataset (raw)
  -> [官网目录或型号缺口] 新的 Crawl Planning Run / confirmed plan version
  -> 后续品牌官网 Source Run / Source Dataset (raw)
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
| 规划过程、阶段审计和结果状态 | Crawl Planning Run / Stage Checkpoint | DBOS 只拥有内部执行检查点；Codex 只交付候选；Web 只投影 Workbench |
| 品牌版图、官网映射、topic 对账与搜索停止口径 | Crawl Plan Research Audit | Planning Agent 生成候选；Workbench 校验并随 plan version 冻结 |
| 每个来源抓什么、抓多少、何时停止 | 版本化 Crawl Plan | 用户确认前不能执行；Provider 只执行冻结版本 |
| 一次 Start 的计划版本、开始/结束与总结果 | Source Collection Batch / PostgreSQL | UI 按批次展示；不能用 Source Run 时间戳推导 |
| 清单中每个 target 的尝试、状态与计数 | Source Target Attempt | Source Run 汇总只能由 target 事实对账，不从 Provider 结束事件猜测 |
| 动态发现对象的待抓、运行、完成与终止状态 | Capture Work Item / PostgreSQL | Crawlee 只按稳定 work key 派发，不拥有用户可见完成事实 |
| 每个实际 HTTP hop 与跨进程访问门状态 | Source Request Attempt / Source Access Gate / PostgreSQL | Source Access 先预留再出网；UI 只投影预算、冷却与熔断事实 |
| 一次访问发生了什么 | Raw Source Observation | UI 与导出读取 |
| 来源当时返回的原始内容 | Source Snapshot / Source Asset | 后续清洗只读，不覆盖 |
| 快照中观察到但未下载的外部资源 URL | Source Resource Reference | Provider 提交原始 URL 与定位关系；不冒充附件或已取得字节 |

Codex 不拥有产品 thread、任务或来源数据。每个采访 runtime 只建立并初始化一次 App Server `stdio` 连接；每个业务轮次仍创建新的 `ephemeral: true` 内存 thread，不 `resume`、不持久化 Codex 产品会话，Workbench 关闭时结束该连接。每轮先把仓库内权威采访 Skill 同步到不继承工程 `AGENTS.md` 的隔离目录标准 `.agents/skills/` 位置，再通过官方 `skill` input 显式注入该副本；该产品运行时关闭官方 `shell_tool` 和 `unified_exec` feature，只保留采访所需的网页搜索。Workbench 先持久化用户原文，再重放 PostgreSQL 中的采访工作资料；Codex 解释本轮完整原文并只返回推进采访所需的最小增量：说明、决定、未决项、可选 `draftMarkdown`，以及仅在生成草案时出现的 `scopeEvidenceUrls` 调查凭证，不返回完整任务 schema。Workbench 将凭证逐条对照已完成的会话搜索活动和 Markdown 原文；它只证明品类范围经过调查，不要求采访穷举品牌、官网、标准或技术执行入口，也不持久化为第二份来源事实。运行中的 commentary 通过官方 delta 协议展示，最终机器 JSON 只在进程边界由 Zod 校验。用户确认 Markdown 后，同一 runtime 另起 ephemeral 纯转换回合生成正式 Capture Task；该回合禁止搜索和新增事实。首次调查回合必须观察到已完成的 `web_search` item；只有 started/failed 不满足调查门。后续纯解释或范围未变回合不重复强制搜索。

## 5. 当前模块

### 5.1 Category Interview Module

- 接受用户首句，不重复确认已经明确的门类；
- 先判断是否属于标准商品，主动调查标准/监管、品牌/型号、内容范围和候选来源；
- 用普通对话解释专业判断，每个真实问题给出推荐答案、依据和主要代价，不为凑选项制造问题；
- 把品牌、网站和入口选择视为系统调查事实；当前不把 JD 写成必需平台，也不让负责人先行枚举品牌或官网；
- 保存消息、带 2–3 个建议和唯一推荐项的负责人问题、决定和未决项；
- assistant 消息同时保存按到达顺序组成的文字/活动时间线；Web 刷新只重放该事实，不从浏览器内存或最终文本猜测工具历史；
- 将结构化问题统一保存为 proposed Decision，但在 Timeline 中投影为普通助手消息；它只是下一条自然语言的上下文，不增加独立题板或第二个“确认”动作；
- 任意 Composer 输入都先保存原文并进入 Codex 回合。Codex 可以同时解释选项回答、附加事实、纠正、否定问题前提或追问；明确回答才提交 `decisionResolution`，成立的前提否定提交 `decisionWithdrawal`。Workbench 校验二者引用当前 proposal 后生成 confirmed Decision 或撤回该问题，不允许同一回合同时解决和撤回；
- 用户只是追问解释且没有改变抓取范围时，Codex 用普通说明回答，不生成决定或草稿修订；
- 任意新输入都会把 session 从 `task_ready` 或已确认读取态切回运行态；只有最新回合结束后处于 `idle + task_ready`、最新草稿完整、没有负责人未决项且范围证据来自本轮已完成搜索时，后端才接受确认；
- 接受 Codex 的 `draftMarkdown`，但品类、市场、内容和排除边界必须有本会话已完成搜索的原样 URL 证据；品牌全集、官网、参数/说明书、标准和原理来源由确认后的 Planning Agent 深搜，不再由采访提前伪造完整来源清单；模型生成草稿不等于用户确认；
- 只在用户显式确认最新 Markdown 后调用独立 materialization，校验并生成或推进 Capture Task；确认后仍接受增量消息并形成后续草稿版本；
- failed/interrupted 回合只允许以最近一条失败/中断的用户原文重试，且其后不能已有完成的 assistant 消息；历史消息不能被选择为 retry target；
- 列出尚未关联正式任务的未完成采访，支持刷新恢复和继续；运行中的采访不能删除，已关联正式任务的采访不能脱离任务单独删除。

### 5.2 Capture Task Module

保存和读取确认后结构化任务的当前版本：原始需求、标准商品边界、市场/时间口径、内容范围、平台与官方来源范围、候选来源、排除项和未决项。首次确认创建任务；后续确认保持任务 ID 不变并推进 revision，历史确认范围由不可变 Markdown 草稿保留。删除活动任务记录时只把状态改为 `archived` 并从活动读取接口隐藏，不级联删除采访、草稿版本或 Source Dataset。它不保存参数 schema 或清洗规则。

### 5.3 Source Dataset Module

保存抓取批次、来源运行及其恢复关联、逐 target attempt、Capture Work Item、逐请求 attempt、访问 gate、来源对象、不可变快照、资源引用和附件。每次 Start 先持久化 Batch，再让本轮全部 Source Run 引用同一批次；历史无批次运行保持可读并明确隔离，禁止按时间窗口回填。每个快照冻结计划 `targetKey`；未知、重复、遗漏 target 或仍未终结的 work item 不能被 source 级完成状态掩盖。Provider 的一次 capture 通过同一事务提交 Snapshot 与 Resource Reference；图片 URL 引用不创建图片工作项，也不访问图片服务器。新数据只允许两种原始载荷：

- `inline_text`：HTML、JSON、CSV、纯文本等可安全内联的源站响应。HTML/XHTML 用 WHATWG 编码探测解码；传输层 charset 无法无损解码时，才允许采用页内 meta 的无损结果。`charset`、`bytes` 和 payload `contentHash` 都对应最终保存的内联文本，不用已被替换的文本伪装源字节哈希；
- `asset`：PDF、XLSX、图片、视频等原文件。

原始附件字节进入本地 cacache 内容寻址存储，相同字节可复用，但每个 snapshot/asset 的来源关系独立保留并可下载。Resource Reference 只保存源响应中观察到的 URL、原值、locator、用途、区块和顺序，不进入 cacache。旧来源记录不删除，读取时明确标成 `legacy_structured_json`，不得冒充新原始捕获。

### 5.4 Crawl Planning Module

读取一个当前 Capture Task revision，通过注入式 Codex runtime 生成并校验版本化 Crawl Plan Draft，保存 Planning Run 有序时间线，并在用户显式确认时推进 plan version 状态。它独占“来源、内容、数量”的计划事实。version 4 Planning Agent 必须深搜 `brand_landscape`、`official_source_mapping`、`parameters_and_manuals`、`standards_and_principles` 四个区域。当前 Research Audit 策略 v3 要求权威目录、广覆盖目录、主流、长尾/细分、区域/进口、母品牌/子品牌/授权品牌、饱和核查七个品牌发现镜头，至少四个独立非 JD origin、逐轮发现/新增品牌账和两个不同查询连续零新增；前 N 名、主力/销量/推荐榜不能冒充完整分母。官网批次发现的 `additionalBrands` 使用该批次的真实查询和证据增量并入既有品牌账，再继续独立饱和查询；旧品牌、别名和证据不由模型整表重写。每个发现品牌必须有专门官网检索，`unresolved` 至少两条不同查询；`planned` 还必须有专门参数/说明书检索并映射到 `brand_official` source。品牌账与官网 source 必须双向闭合，每个 task topic 必须映射到实际 source/target。当前正式计划只允许 `public.web-resource@2.0.0`：品牌官网首个 HTML 种子由 Workbench 确定性组装为有界 `site` route，明确正文/附件组装为 `exact` route；路由配置冻结 URL、内容信号、最大深度、最大页数和最少合格页面。排除 JD Provider、`*.jd.com`、搜索结果页和登录入口。API/Web 不复制 Planner 规则，Codex 不写 task ID/revision，也不启动 Source Run。

规划运行复用现有 App Server `stdio`、Skill input、web search、官方 per-turn `outputSchema` 和 typed SSE；本地 Zod 再校验领域 contract。一条已初始化连接依次创建相互独立的 ephemeral thread：六镜头品牌发现 thread、每次一个品牌饱和查询 thread、每个品牌批次一个官网/参数映射 thread、标准/原理 thread。Workbench 按规范品牌名和别名确定性计算首次新增；两个不同查询连续零新增停止，最多六次。品牌批次由 `CRAWL_PLANNING_BRAND_BATCH_SIZE` 配置为 1-10，默认 3；批次报告额外品牌时重跑完整发现与饱和核查，不能直接把新品牌追加进执行计划。

每个阶段只输出自己的小 schema；解析或阶段校验失败时，只把现有错误回填到该阶段的原 thread，最多修正两次，第三次仍失败则关闭整个 Planning Run。DBOS 4.25.14 用 Planning Run ID 作为父 workflow ID，并为六镜头发现、每次饱和查询、跨品牌市场目录、每个品牌批次和标准原理建立稳定子 workflow ID；阶段子 workflow 经 DBOS concurrency=1 Queue 串行使用一条 App Server `stdio` 连接。已完成阶段结果由 DBOS 检查点恢复，在途 App Server 调用按至少一次边界允许重做。Workbench 的 Stage Checkpoint 只保存用户可见阶段状态和时间线投影，用 `runId + stageKey` 幂等覆盖，不读取或复制 DBOS 内部表，也不保存阶段 typed 输出的第二份权威副本。

全部阶段通过后，Workbench 才从本轮已验证 URL/品牌/topic 事实确定性生成 source/target key、`public.web-resource@2.0.0` policy、`exact/site` route 和 topic coverage，最后校验 v4 contract，并以 `planningRunId` 唯一约束一次写入一个 Plan Draft。同一 URL 在一个品牌批次只能形成一个 target；同集团品牌可共同引用它，不能复制 target 或臆造替代 URL。历史 Plan/Run/Snapshot 原样只读保留，其 URL 只作为本轮复核线索，不能把旧 source key 无条件复制进新 Plan；Capture Task 当前 revision 中经负责人确认的非 JD 来源候选仍必须连续覆盖。模型不能生成交叉引用 key，也不能修改 task ID/revision、确认计划或启动 Source Run。

浏览器连接只拥有 typed SSE 进度投影；关闭、刷新或切换页面不会取消 DBOS workflow。API 启动时用 Workbench 中仍为 `running` 的 Planning Run ID 幂等恢复，Web 从 Workbench 轮询阶段时间线；UI 和 API 不查询 DBOS 系统表推导状态。十分钟仍是单个 App Server 阶段 hard timeout，整轮时长随 `六镜头发现 1 + 饱和查询 2-6 + 市场目录 1 + ceil(品牌数/批次大小) + 标准原理 1` 增长。系统不提供隐式取消、自动确认或自动开始抓取。历史电视 v9/v10 和原始批次继续保留，但新的系统验收必须使用 v4 路由与内容 assessment，历史结果不能替代。

### 5.5 Source Access

`PacedSessionHttpAccess` 复用 Playwright `APIRequestContext`、`p-queue` 与 Cockatiel，只发送显式 HTTP；关闭自动 redirect，每个手工 hop 必须先由 PostgreSQL 原子预留 request attempt，数据库拒绝时网络请求为零。PostgreSQL gate 是跨进程预算、最小间隔、窗口、冷却、首次受限熔断和人工继续要求的唯一事实源；关闭、无人工继续要求且当前没有 `started` attempt 的旧 gate 允许升级到新政策版本，但 `nextEligibleAt` 只能取旧值与新最小间隔中更严格者。已打开、受限、要求人工继续或当前有在途请求的 gate 继续失败关闭，不清空历史。进程内队列/circuit 只负责当前执行的串行、取消和尽快停机。登录、401/403/429、验证、风险/频控正文、未知跨源跳转和异常响应均失败关闭，不自动 retry、换代理、换账号或绕过。

composition root 仍以显式 map 注入 Provider，不建设动态插件系统。当前只注入 `public.web-resource@2.0.0`；生产不可达的 JD 历史实现不进入组合根，旧 Plan、Run 和 Snapshot 仍只读展示。公共 Provider 是一个深模块：`exact` 路由保留计划 URL 的原始响应，`site` 路由先读取 robots 和 sitemap，再使用 Crawlee 3.18.1 的成熟 sitemap parser 与持久 RequestQueue 遍历同源页面。每个 robots、sitemap、页面和 redirect hop 都先由 PostgreSQL `SourceRequestAdmissionPort` 创建 work/attempt，并按 Provider 版本＋origin 共享 gate；拒绝跨源发现、私网地址、Cookie/认证、自动重试、代理轮换和隐式浏览器 fallback。原始 sitemap 保存为 supporting Snapshot；页面先保存不可变原文，再用计划内容信号、可见正文和商品结构形成 accepted/rejected assessment，只有 accepted 增加 target 有效计数。Provider 纯结构校验在 Draft 保存和确认时执行，运行准备与 Start 最终 preflight 属于 Source Execution。

### 5.6 Source Execution

读取 confirmed Crawl Plan 的精确 task revision/version，并复用 Crawl Planning 的 version 4 route/内容验收契约与 Research Audit 策略 v3 完整性门；历史 version 2/3/JD 计划在创建批次、Provider preflight 和网络访问前拒绝，不做静默迁移。显式 Prepare 只协调 Provider 的临时运行准备，不创建 Batch/Source Run，也不访问来源。Start 先持久化一个绑定 task revision、plan ID/version 和来源总数的 Source Collection Batch，再执行最终 preflight；一个来源运行态失败只为该来源创建属于本批次的 failed Source Run，不阻断已经独立通过 preflight 的其他来源。批次按全部来源终态结算为 completed/partial/failed/stopped；可执行来源先为每个 source 和 target 创建运行事实，再由 Provider 按 Capture Work Item 派发。Snapshot 总数与内容通过数分别记账；rejected/supporting 原文保留但不能满足 target 数量。

Start/Resume 不再以 SSE 连接承载执行。API 在校验当前 task/plan revision 后向 Graphile Worker 0.17.3 的 PostgreSQL job queue 提交 typed command 并立即返回 202；嵌入 API 进程的单并发 worker 消费完整 Source Execution 流。页面关闭、刷新或切换标签只停止 UI 投影，不发送取消，也不结束 Batch；Workbench 从 Source Dataset 轮询持久 Batch/Run 进度。Graphile 只拥有通用任务派发，payload 只含非秘密 ID/revision，不能从其内部表投影用户状态；领域限制和 Provider 失败仍由 Batch/Run 终态表达，job `maxAttempts=1`，不会把 403/429/登录/频控变成自动重抓。

每个运行持有 PostgreSQL session advisory lease；每个 Batch 也从创建起持有独立 session lease，直到批次结算才释放。API 启动时先于 Graphile runner 扫描 `running` Batch：能取得 Batch lease 才证明旧执行进程已失联，此时复用 `prepareSourceRunForResume` 将 started request 记为 outcome unknown，把未终结 work/target/run/batch 收口为 stopped，并将访问 gate 保持在需人工继续的安全状态；活动 lease 存在时零副作用。该恢复不读 Graphile 私有表、不发网络请求、不自动 Resume，且保留所有已提交 Snapshot。

负责人只能对 stopped/failed run 显式“继续”，系统先把遗留 running attempt/work/target 结算为 unknown/stopped，再创建带 `resumedFromRunId` 的新 Source Run；请求预算与冷却沿恢复链累计，不能通过继续重置。Crawlee 3.18.1 命名 RequestQueue/MemoryStorage 只拥有 Provider 内捕获工作的本机持久派发和 stable uniqueKey 去重，不拥有 Batch 或 Source Dataset 完成事实，也不自动 reclaim 失败项。Graphile 已证明未领取 job 在 runner 重启后继续；Batch lease 只保证失联后可审计收口，不宣称网络副作用或任意步骤 exactly once。

## 6. 物理边界

- PostgreSQL `workbench` schema：对话、任务、计划元数据、运行与恢复关联、target/work/request/gate、来源对象、快照与资源引用索引；Graphile 官方 schema 只保存通用 job 派发，不作为业务查询面；
- 原始附件内容存储：本地 cacache CAS；PostgreSQL 只保存 digest、大小、媒体类型、来源 URL 与 snapshot 关系；
- Cookie、Profile、密码、认证 Header 和验证码信息不得入库、日志、Git 或导出；
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

- 复用：PostgreSQL、Drizzle、Fastify、assistant-ui、Codex CLI App Server `stdio`/`outputSchema`、Graphile Worker、Crawlee RequestQueue/SitemapRequestList、p-queue、cockatiel、robots-parser、Cheerio、`encoding-sniffer`、Node `TextDecoder`、cacache。
- 产品代码：标准商品抓取任务采访规则、任务确认、AI Research Audit 与来源计划业务约束、官网薄来源 adapter 和 Workbench 投影。
- 当前不自研队列、工作流引擎、浏览器自动化框架、重试器或结构化输出解析器。

## 9. 当前通过门

1A 单独验收“对话输出抓取任务草稿”：

1. 输入“抓冰箱”后不重复确认门类，并正确判断它属于标准商品；
2. 系统主动调查标准/监管、品牌、型号、内容范围和候选来源；
3. 品牌、官网、标准和技术来源由系统主动调查，不要求负责人枚举；当前正式规划排除 JD；
4. 每个负责人问题都是真实业务取舍，给出专业推荐、依据和代价；不得为了凑 2–3 个选项制造问题；
5. 草稿以 Markdown 可读地展示标准商品边界、范围和来源事实，不出现正式 Capture Task JSON、参数编辑器、Evidence 或知识加工；
6. 每个 assistant turn 按 SSE 到达顺序交错追加 commentary 与经过脱敏的搜索/产品工具活动，并把相同有序时间线随 assistant 消息持久化；同一活动的 started/completed 只原位更新，后到文字不得插到既有活动之前；连接初始化对用户隐藏且跨轮复用，当前轮从“准备本轮分析”开始，thread/turn 生命周期只作为内部协议状态；同轮 `web_search` 默认折叠为一条“搜索了 N 个网页”，展开才显示 App Server 实际交付并去重的 http(s) URL；采访运行时禁用 shell 能力，adapter 对异常/旧 `commandExecution` 仍失败关闭且不投影；`final_answer` 生成期间必须显示可理解的整理校验状态；
7. 负责人问题作为普通消息展示建议，Composer 可发送任意自然语言；每条原文都先进入采访 Agent，明确回答才确认，成立的前提否定会撤回问题；追问、纠正和混合附加事实都能继续且不丢失，不出现独立题板或第二个决定确认动作；
8. ScrollToBottom 只在用户离开 live edge 阅读历史时出现；回到底部后由 assistant-ui 恢复自动跟随，按钮不得覆盖消息或草稿卡；
9. 任意新输入立即退出旧草稿可确认态；只有最新回合 `idle + task_ready` 可确认。纯解释可明确保持当前范围而不产生修订；用户显式确认 Markdown 后才通过独立纯转换生成正式 Capture Task，且不自动制定计划或抓取；已确认任务可以继续原对话并生成同一任务的新版本。
10. 未完成采访显示在任务记录中；刷新恢复当前会话、规范化消息及消息内搜索/工具时间线；删除未完成采访和归档正式任务均需用户确认，且不能误删正式任务历史或原始数据。
11. 首轮和形成换品类草稿时必须完成网页搜索，模型来源时间不可信；失败/中断只允许重试最近一条对应用户原文，不能重放更早历史消息。

1B 的当前通过门：version 4 Plan 必须携带 Research Audit 策略 v3，覆盖四类搜索区域、七个品牌发现镜头、至少四个独立非 JD 品牌版图证据源、每轮新增品牌、两个不同查询连续零新增、逐品牌官网与参数/说明书核查，以及全部 topic 的 source/target 对账；每个入口/正文/附件都有数量、唯一键、`exact/site` Provider 配置、内容信号和停止条件。历史 Research Audit v1/v2 与执行清单 v2/v3 只读不可执行。当前只允许 `public.web-resource@2.0.0`，禁止 JD URL/Provider、占位配置、入口-only 附件和 blocker。确认不等于执行。

1C 的当前通过门：真实 Workbench Start 返回 202，Graphile 完成派发，Batch/Run 全部终态，不可变 Snapshot 能在原始数据页查看并用 JSONL/CSV 导出，API/Web 重启后结果和零遗留 `running` 不变。来源的 403/登录/robots/redirect/证书/超时/字节上限必须如实失败关闭，不要求一轮内覆盖全部品牌，也不允许把 `partial` 改写成完整。
