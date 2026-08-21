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
  -> PostgreSQL 持久 Graphile job（HTTP 202 后与页面生命周期分离）
  -> 持久 Source Collection Batch
  -> Provider preflight / 服务端 Source Run
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
| 一次 Start 的计划版本、开始/结束与总结果 | Source Collection Batch / PostgreSQL | UI 按批次展示；不能用 Source Run 时间戳推导 |
| 清单中每个 target 的尝试、状态与计数 | Source Target Attempt | Source Run 汇总只能由 target 事实对账，不从 Provider 结束事件猜测 |
| 动态发现对象的待抓、运行、完成与终止状态 | Capture Work Item / PostgreSQL | Crawlee 只按稳定 work key 派发，不拥有用户可见完成事实 |
| 每个实际 HTTP hop 与跨进程访问门状态 | Source Request Attempt / Source Access Gate / PostgreSQL | Source Access 先预留再出网；UI 只投影预算、冷却与熔断事实 |
| 一次访问发生了什么 | Raw Source Observation | UI 与导出读取 |
| 来源当时返回的原始内容 | Source Snapshot / Source Asset | 后续清洗只读，不覆盖 |
| 快照中观察到但未下载的外部资源 URL | Source Resource Reference | Provider 提交原始 URL 与定位关系；不冒充附件或已取得字节 |

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

保存抓取批次、来源运行及其恢复关联、逐 target attempt、Capture Work Item、逐请求 attempt、访问 gate、来源对象、不可变快照、资源引用和附件。每次 Start 先持久化 Batch，再让本轮全部 Source Run 引用同一批次；历史无批次运行保持可读并明确隔离，禁止按时间窗口回填。每个快照冻结计划 `targetKey`；未知、重复、遗漏 target 或仍未终结的 work item 不能被 source 级完成状态掩盖。Provider 的一次 capture 通过同一事务提交 Snapshot 与 Resource Reference；图片 URL 引用不创建图片工作项，也不访问图片服务器。新数据只允许两种原始载荷：

- `inline_text`：HTML、JSON、CSV、纯文本等可安全内联的源站响应；
- `asset`：PDF、XLSX、图片、视频等原文件。

原始附件字节进入本地 cacache 内容寻址存储，相同字节可复用，但每个 snapshot/asset 的来源关系独立保留并可下载。Resource Reference 只保存源响应中观察到的 URL、原值、locator、用途、区块和顺序，不进入 cacache。旧来源记录不删除，读取时明确标成 `legacy_structured_json`，不得冒充新原始捕获。

### 5.4 Crawl Planning Module

读取一个当前 Capture Task revision，通过注入式 Codex runtime 生成并校验版本化 Crawl Plan Draft，保存 Planning Run 有序时间线，并在用户显式确认时推进 plan version 状态。它独占“来源、内容、数量”的计划事实；active 清单必须逐项对账全部采访来源候选和全部原文 topic，每个 target 必须绑定真实 Provider 配置。Capture Task 已确认纳入京东时，计划必须包含 `jd.catalog-product@2.0.0` 动态商品来源；保留一个 `search.jd.com` 通用网页 target 不能代替目录、详情、媒体 URL 与评价覆盖。Draft 保存和确认只调用 Provider 的纯结构 `validate`；浏览器、端口和登录等可变化运行条件不属于计划确认事实。说明书、PDF 和附件表格不能用入口页中的链接文字冒充正文；精确入口本身为 PDF/Office 文档时，该 exact target 就是正文并按原始附件留存。API/Web 不复制 Planner 规则，Codex 不写 task ID/revision，也不启动 Source Run。

规划运行复用现有 App Server `stdio`、ephemeral thread、Skill input、web search、官方 `outputSchema` 和 typed SSE；本地 Zod 再校验领域 contract。一个规划 runtime 复用一条已初始化连接，每次运行新建一个 ephemeral thread；首次结构化输出未通过现有解析、清单或 Provider 校验时，只把原错误回填到同一 thread 修正一次，并在第二个 turn 继续附同一 `outputSchema`。它不新增或复制校验，不重开 thread、不换模型、不处理传输/认证失败；第二次仍失败即关闭 Planning Run。连接关闭则中止，官方 `turn/interrupt` 负责取消，已完成结果可刷新恢复。不为最长十分钟的有界规划引入 DBOS、后台队列或第二套 Session。

### 5.5 Source Access

`PacedSessionHttpAccess` 复用 Playwright `APIRequestContext`、`p-queue` 与 Cockatiel，只发送显式 HTTP；关闭自动 redirect，每个手工 hop 必须先由 PostgreSQL 原子预留 request attempt，数据库拒绝时网络请求为零。PostgreSQL gate 是跨进程预算、最小间隔、窗口、冷却、首次受限熔断和人工继续要求的唯一事实源；进程内队列/circuit 只负责当前执行的串行、取消和尽快停机。登录、401/403/429、验证、风险/频控正文、未知跨源跳转和异常响应均失败关闭，不自动 retry、换代理、换账号或绕过。

composition root 仍以显式 map 注入 Provider，不建设动态插件系统。历史 `jd.catalog-product@1.0.0` 不再注入；`jd.catalog-product@2.0.0` 只接受五类显式 HTTP target，Prepare 固定零请求，并只在 `JD_REAL_HTTP_ENABLED=true` 时注入匿名、无 Cookie/Profile 的 HTTP access。配置 schema 在未提供环境值时仍失败关闭；项目本地开发配置已在 I0～I4 通过且负责人明确要求真实抓取后显式开启。能力装配不触发请求，只有 confirmed Crawl Plan 上的显式 Start 才出网。当前已验证能力从真实目录商品卡保存商品与图片 URL 引用，图片字节请求为零；匿名详情只返回客户端骨架时首错停止，未取得的详情、店铺和评价 target 不得标记完成。`public.web-resource@1.0.0` 复用 Node 24 官方 HTTPS 代理 Agent、Google Public DNS DoH、robots-parser、Cheerio 与 Node DNS/net；只访问计划冻结的公网 HTTPS 443 精确 URL，或从已保存前序 HTML 按完整文字唯一跟进一次同源链接。系统 DNS 返回 Fake-IP 时，只有环境已显式配置 HTTPS 代理才经可信 DoH 取得公网 IP；通过校验的 IP 固定为 CONNECT 目标，原域名只用于 Host/SNI。每个 robots/target 请求都先由 PostgreSQL `SourceRequestAdmissionPort` 创建 work/attempt 并按 Provider 版本＋origin 共享 gate；拒绝 redirect、私网地址、自由发现、递归、Cookie/认证和自动重试。Provider 纯结构校验在 Draft 保存和确认时执行，运行准备与 Start 最终 preflight 属于 Source Execution。

### 5.6 Source Execution

读取 confirmed Crawl Plan 的精确 task revision/version，并复用 Crawl Planning 的当前完整性门；任务已纳入京东但历史计划没有 JD v2 时，在创建批次、Provider preflight 和网络访问前拒绝。显式 Prepare 只协调 Provider 的临时运行准备，不创建 Batch/Source Run，也不访问来源；JD v2 Prepare 固定零请求。Start 先持久化一个绑定 task revision、plan ID/version 和来源总数的 Source Collection Batch，再执行最终 preflight；一个 Provider 的运行态失败只为使用该 Provider 的来源创建属于该批次的 failed Source Run，不阻断已经独立通过 preflight 的其他 Provider。批次按全部来源终态结算为 completed/partial/failed/stopped。可执行来源先为每个 source 和 target 创建运行事实，再由 Provider 按动态 Capture Work Item 派发；未知、重复、未终结 work、遗漏 target 或数量不一致都失败关闭。

Start/Resume 不再以 SSE 连接承载执行。API 在校验当前 task/plan revision 后向 Graphile Worker 0.17.3 的 PostgreSQL job queue 提交 typed command 并立即返回 202；嵌入 API 进程的单并发 worker 消费完整 Source Execution 流。页面关闭、刷新或切换标签只停止 UI 投影，不发送取消，也不结束 Batch；Workbench 从 Source Dataset 轮询持久 Batch/Run 进度。Graphile 只拥有通用任务派发，payload 只含非秘密 ID/revision，不能从其内部表投影用户状态；领域限制和 Provider 失败仍由 Batch/Run 终态表达，job `maxAttempts=1`，不会把 403/429/登录/频控变成自动重抓。

每个运行持有 PostgreSQL session advisory lease；活动进程存在时拒绝重复继续，进程被强杀后连接断开自动释放 lease。负责人只能对 stopped/failed run 显式“继续”，系统先把遗留 running attempt/work/target 结算为 unknown/stopped，再创建带 `resumedFromRunId` 的新 Source Run；请求预算与冷却沿恢复链累计，不能通过继续重置。Crawlee 3.18.1 命名 RequestQueue/MemoryStorage 只拥有 Provider 内捕获工作的本机持久派发和 stable uniqueKey 去重，不拥有 Batch 或 Source Dataset 完成事实，也不自动 reclaim 失败项。Graphile 已证明未领取 job 在 runner 重启后继续；正在执行一半的整批进程强杀仍需依赖现有 Work/Request 幂等和后续专门恢复门，当前不得宣称任意步骤 exactly once。

## 6. 物理边界

- PostgreSQL `workbench` schema：对话、任务、计划元数据、运行与恢复关联、target/work/request/gate、来源对象、快照与资源引用索引；Graphile 官方 schema 只保存通用 job 派发，不作为业务查询面；
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

1B 的当前通过门：完整计划必须对账全部采访候选与 topic；每个入口/正文/附件都是有数量、分母、唯一键、Provider 配置和停止条件的 target；无 Provider、占位配置、入口-only 附件或 blocker 都不能保存/确认。2026-08-20 的真实家用冰箱 v6 已以 8 个来源、12 个 target 覆盖 7/7 候选与 13/13 topic，并通过确认预检。确认不等于执行；2026-08-21 微波炉计划已显式 Start，6 个公共来源中 4 个完成、2 个按京东 robots 302 与格兰仕 NXDOMAIN 真实失败，证明公共出网和 Source Dataset 闭环，但不代表计划来源质量或京东 v2 已通过。
