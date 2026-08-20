# Issue 02：提高规划来源密度、统一京东契约并为大结构化输出增加错误回填

Status: ready-for-human

## 简单说明

当前问题不是“电视只能有 5 个来源”，也不是“模型不能输出大 JSON”。真正的问题有三处：采访阶段把少量代表来源当成了足够的执行种子；京东的任务要求和 Provider 校验互相矛盾；一次较大的计划 JSON 只要有一处本地校验失败，整次规划就直接结束。

本 Issue 只做一条最短闭环：采访仍主动调查，但不再每个方向找到一两个入口就收工；京东是否覆盖由任务中的真实京东入口判断，Provider 只校验自己能够执行的 URL；规划候选第一次校验失败时，在同一个 Codex ephemeral thread 中把具体错误交还给模型修正一次，再校验一次。第二次仍失败才结束，不无限重试、不换模型、不丢掉第一轮搜索上下文。

用户最终得到的是：更密集、可追溯的来源种子；不会因 `search.jd.com` 与 `www.jd.com` 的内部规则冲突而无解；常见的大 JSON 格式、清单完整性和 Provider 配置错误有一次自动修正机会。该 Issue 只制定和验证 Crawl Plan，不点击 Start。

## 真实问题与证据

2026-08-20 新建电视任务并确认范围后：

- Interview Session：`interview-session-4ea52c9a-3b2b-45f6-ba33-7d6dad744645`；
- Capture Task：`capture-task-080bebbf-c29f-4136-bf7f-0440829167c6`，revision 1；
- 任务只有 5 个 `sourceCandidates`：京东 i-search、小米官网、TCL 官网、GB 24850—2020、Wikipedia LED 背光技术页；
- Crawl Planning Run：`crawl-planning-run-96225135-e198-4510-b942-c7af113a4603`；
- Agent 已搜索 72 个网页，也发现了额外官网、说明书和标准入口，但没有保存任何 Crawl Plan；
- 最终错误：`抓取计划遗漏了任务中必须覆盖的京东来源`。

失败来自仓库内部的互斥规则，而不是模型完全没有计划京东：

- `codexCrawlPlanningRuntime.ts` 按真实入口主机绑定 Provider：只有 `www.jd.com` 使用 `jd.catalog-product`，`search.jd.com` 使用 `public.web-resource`；
- 同一 Prompt 又明确 `jd.catalog-product` 只接受一个 `www.jd.com` HTTPS 入口；
- `crawlPlanningModule.ts` 最后却把“任务要求京东”解释成“计划必须出现 `jd.catalog-product`”；
- 因此任务里只有 `search.jd.com` 京东候选时，即使计划忠实保留该入口，仍会被后置全局检查拒绝。

仓库已有一条可用的质量基线，但它不是所有品类的硬编码模板：历史电视 task revision 4 有 29 个候选，确认计划有 29 个来源、32 个 target，覆盖零售、多个品牌官网、标准、监管、行业组织和技术资料。这证明“5 个代表入口”与“足够支撑专业导购的数据抓取计划”不是同一件事，也证明当前 schema 能承载更密集的计划，不需要新建第二套来源模型。

## 服务的架构基线

- `ROADMAP.md`：阶段 1B“真实来源 Crawl Plan”；计划必须明确来源、内容、数量和停止口径，确认后仍由用户单独点击 Start。
- `ARCHITECTURE.md`：Capture Task 是已确认范围事实；Crawl Planning Run 拥有规划过程和搜索活动；版本化 Crawl Plan 独占“每个来源抓什么、抓多少、何时停止”的计划事实。
- 继续复用 PostgreSQL、Zod、Codex App Server ephemeral thread、现有 `plan-product-crawl` Skill、现有两类 Provider 及其 `validate`；不增加依赖。
- 产品特有代码只承担来源规划纪律、京东任务语义与 Provider 能力之间的薄映射，以及一次修正回合的应用编排。

## 调研结论

官方 Codex App Server 协议把一次对话建模为 thread 中的多个 turn：先 `thread/start`，随后可对同一个 `threadId` 多次调用 `turn/start`；`outputSchema` 是每一轮的参数，只约束当前 turn。因此可以在第一次规划输出完成并经过本地校验后，继续同一个 ephemeral thread 发起第二轮，把校验错误作为用户输入并再次附上相同 `outputSchema`，无需重新创建持久 Session，也无需把整个巨大无效 JSON 再复制一遍。

官方资料：https://developers.openai.com/codex/app-server/

这项能力只解决“同一规划上下文内修正结构化结果”。它不替代本地 Zod、任务清单和 Provider 校验，也不作为网络、登录、取消、审批或访问限制的自动 fallback。

## Baseline Impact

```text
Baseline Impact:
- touched modules: Interview 来源调查 Skill/Prompt 与质量测试、Capture Task readiness 语义、Crawl Planning Module、Codex Crawl Planning Runtime、Codex App Server Client、规划测试、RESEARCH/ARCHITECTURE/PROGRESS
- owning fact source: Capture Task 继续拥有已确认来源候选；Crawl Planning Run 继续拥有尝试时间线；Crawl Plan 继续独占可执行来源/内容/数量；不新增事实源
- public interface changed: no；HTTP/SSE/shared schema/PostgreSQL schema 不变。Workbench 内部 CrawlPlanningRuntime/CodexAppServerClient seam 需要支持同 thread 后续 turn
- new protocol/adapter/fallback: yes；增加同一 ephemeral thread 内最多一次 validation repair turn，不增加第二模型、第二 Provider、跨进程恢复或自动 fallback
- compatibility or legacy path changed: yes；历史 task、失败 run 和已有 plan 保持不可变；移除把 jd.disposition 绑定为必须出现特定 Provider 的错误兼容假设
- research update required: yes；登记官方同 thread 多 turn、逐 turn outputSchema 与本项目有界 repair 结论
- architecture or ADR update required: yes；ARCHITECTURE 澄清 Planning Run 可含一次修正 attempt，模块职责和事实源不变；不新建 ADR
- tests and real-surface validation to run: repair 红绿测试、JD 契约测试、来源密度 Prompt/Skill 测试、全量 test/typecheck/build、真实新电视任务与 Crawl Plan 页面/API 对账；不点击 Start
```

## Patch Disposition

```text
Patch Disposition:
- delete: Crawl Planning 完成门中“jd.disposition=included 就必须存在 jd.catalog-product”的全局 Provider 检查；把四类最低门当成来源调查完成标准的测试语义
- keep: 每个采访候选恰好归入一个执行来源、原始入口/类型不丢失、topic 全覆盖、Provider 结构 validate、无效候选不保存为 Plan、历史失败 Run 不改写、用户单独确认与 Start
- rewrite: Interview 来源停止纪律；京东 coverage 与 Provider 绑定规则；Crawl Planning 从单次输出直接成败改为最多两次同 thread 校验
- reason: 旧检查混淆“业务必须覆盖京东”和“某个 Provider 必须出现”；旧单轮路径又把可修复的大结构化输出错误当成终局错误
```

## 实施方案

### 1. 来源候选从“代表书目”改成“执行种子”

修改现有采访 Skill/Prompt 的来源调查纪律，不新增品类表、网站白名单或固定来源数量：

1. 四类来源只保留为确定性最低失败门，不再描述为“达到即完成”；
2. Agent 必须围绕已确认的每个内容方向继续扩展独立、权威、具有明确入口且后续可执行的来源；同一方向发现多个互补发布者或不同原始资料时全部保留，不得每个方向只选一个示例；
3. 去重以发布者、原始资料和执行入口为准，搜索结果页摘要、转载和重复镜像不增加候选数量；
4. 停止条件是本轮查询组合已覆盖任务内容方向，并且继续查询只产生重复、转载、不可执行或明显低权威入口；不是“凑够四类”或“每类一两个”；
5. Capture Task 中的候选仍是已确认种子，不是 Crawl Plan 的数量上限。Planner 必须逐一纳入这些种子，同时可以把本轮核实到的额外精确入口增加为新来源/target。

这一步不把历史电视 29 条写进生产 Prompt，也不规定所有品类必须达到 29 条。真实电视验收会拿该已确认样本做覆盖簇对照，防止再次用 5 条代表入口冒充足量结果。

### 2. 统一京东业务覆盖与 Provider 能力

采用最小语义修复：

- Capture Task 的 `jd.disposition=included` 表示计划必须覆盖任务中已经确认的京东候选；现有“每个候选恰好一次且原入口成为实际 target”已经能校验这一点；
- `search.jd.com`、`www.jd.com` 或其他京东主机分别按真实 URL 与 Provider 能力绑定；不能从发布者名称推导 Provider；
- 删除“只要要求京东，计划里就必须出现 `jd.catalog-product`”这一条宽泛全局检查；
- `jd.catalog-product` 自身继续只接受它真实支持的 `www.jd.com` 入口和固定 catalog/first-matching-product 结构；`public.web-resource` 继续校验精确 HTTPS target；
- Planner 若搜索到兼容的 `www.jd.com` 精确入口，可以作为额外来源使用 JD Provider，但不能伪造 URL，也不能为了通过校验替换或吞掉任务原有 `search.jd.com` 候选。

本 Issue 不扩展 JD Provider 的分页、全量 SKU 枚举或登录能力。来源数量与抓取量必须在 Plan 中诚实表达；如果现有 Provider 能力不足以达到用户要求的量，计划应明确 blocker，而不是用一个 Provider 名称冒充“已经抓得够多”。该能力缺口另立实施项，不混进本次错误修复。

### 3. 为 Crawl Planning 大 JSON 增加一次错误回填

修正回合由 Crawl Planning 应用流程拥有，校验事实仍由现有 Zod、任务完整性检查和 Provider `validate` 拥有。本 Issue 不新增、不细化、不复制任何 JSON 或领域校验；之前怎么校验，修改后仍怎么校验：

1. 第一次 `turn/start` 仍执行完整搜索并输出 `crawlPlanningRuntimeOutputSchema`；
2. 本地依次执行 JSON/Schema 解析、任务 topic/候选完整性、附件规则和 Provider 结构校验；
3. 全部通过则直接保存计划，不产生额外回合；
4. 若属于可修正的候选输出错误，Workbench 把紧凑错误列表写入 Planning Run 时间线，并对同一个 ephemeral `threadId` 再调用一次 `turn/start`；第二轮重新附上相同 `outputSchema`；
5. 第二轮直接回填现有校验抛出的错误消息，并要求保留已完成搜索、只修正无效计划；不新增错误分类器、字段路径收集器或更详细的校验。由于同一 thread 已持有前一轮输出，不重复发送完整巨大 JSON；
6. 如果错误表示缺少一个必须核实的精确来源，第二轮可以补充搜索；不得无条件重跑已经完成的全部查询；
7. 第二次输出重新执行完全相同的本地校验；通过才保存一个 Crawl Plan，仍失败则同一个 Planning Run 记为 failed，不保存半成品。

只有现有输出解析或校验路径抛出的错误进入 repair；不增加新的检查项。取消/中断、App Server 进程或协议失败、认证失效、服务不可用、审批/安全阻断不进入 repair，因为修改 JSON 不能恢复这些错误。

硬上限为一次 repair，也就是每个 Planning Run 最多两个 turn。不得增加循环重试、指数退避、第二模型、自动换 Provider、错误字符串关键词大全或新的 manager/engine。若后续真实证据证明一次修正不够，另行评估，不在本补丁预埋配置框架。

### 4. 最小代码边界

- `codexAppServerClient.ts`：让一次完成结果带回当前 ephemeral `threadId`，并允许下一次显式对该 ID 发起 `turn/start`；默认 `run()` 仍新建 thread，其他采访流程行为不变。
- `codexCrawlPlanningRuntime.ts`：编排最多两次 turn、复用 commentary/activity 投影、格式化 Schema 错误并发送 repair prompt；不持久化业务事实。
- `crawlPlanningModule.ts`：继续拥有任务/Provider 校验和 Plan 持久化；向生产 runtime 提供同一套候选校验结果供 repair，最终保存前仍走该权威校验入口。不得把校验规则复制到 Prompt 或 Runtime。
- 现有 Planning Run 的 `timelineParts` 和 `error` 足以记录“第一次校验失败→修正→成功/失败”，不新增表或 shared contract。无效的大 JSON 不作为 Plan 持久化，也不原样写入错误日志。

如果实施时发现必须把 App Server thread ID 写入 PostgreSQL、增加跨进程 resume、修改 HTTP/SSE contract 或复制一套任务校验器，立即停止；这已经超出最小 repair 边界，需重新确认设计。

## 测试与真实验收

### 自动化红绿测试

1. fake App Server 第一次返回 Schema 错误、第二次修正：断言同一个 `threadId` 收到两次 `turn/start`，两次都有 `outputSchema`，最终只保存一个 Plan；
2. 第一次返回任务/Provider 校验错误、第二次修正：断言第二轮输入包含原始错误信息，且没有启动第二个 thread；
3. 两次均无效：断言严格停止在两个 turn，同一 Run 为 failed、错误可见、Plan 数量为 0；
4. 第一次合法：断言只有一个 turn，不产生 repair 文案；
5. 取消、认证、服务不可用和执行失败：断言不 repair；
6. `search.jd.com` 候选绑定 `public.web-resource` 且实际成为 target 时能通过任务京东覆盖；不兼容 URL 仍被各 Provider 自己拒绝；
7. 来源调查测试只保护“最低门不是完成标准、候选是执行种子”的 Prompt/Skill contract，不写死电视站点或全局数量。

### 真实 Workbench 验收

1. 新建一条电视任务，从采访到未确认 Capture Task Draft 检查来源簇；不得再次只有“京东＋两个品牌＋一个标准＋一篇百科”五条代表入口。与历史电视 v4 的零售、品牌、标准/监管/行业、技术资料簇对账，任何明显缺失必须有本轮搜索证据解释；
2. 确认新任务后点击“制定抓取计划”，允许规划主动增加精确来源；计划必须显示每个来源抓什么、抓多少和停止口径；
3. 若真实首轮恰好合法，不人为制造生产错误来证明 repair；同 thread 两轮由 fake 协议测试证明。真实流程只证明计划能成功保存且不会再出现京东 Provider 假阴性；
4. API 对账任务候选数、计划来源数、target 数、全部候选恰好一次、全部原文 topic 覆盖、Planning Run 时间线和错误；
5. 页面 console error/warning 为 0；不确认 Crawl Plan、不点击 Start，Source Run 数量保持 0。

执行聚焦测试后必须再运行 `npm test`、`npm run typecheck`、`npm run build` 和 `git diff --check`，分别报告自动化、构建、真实页面和 API 证据，不能互相替代。

## 停止条件

- 来源密度调整后，真实新电视任务仍只生成少量代表入口：停止，不用固定数字、站点表或后端关键词检查兜底，报告真实搜索与停止判断，再决定是否需要版本化品类来源基线；
- 同一 thread 第二轮无法由当前锁定 App Server 协议稳定完成：停止，不改成持久 Session、重开线程或第二模型；提交协议证据和最小替代方案重新确认；
- 统一京东语义后发现当前 Provider 根本不能兑现计划要求的抓取量：如实标记独立 Provider 能力缺口，不把分页/枚举偷塞进本 Issue；
- 未经用户确认本 Issue，不开始代码修改；未经另行明确授权不提交、不推送、不确认 Crawl Plan、不点击 Start。

## Comments

### 2026-08-20

用户要求“先做到开发留迹，才能进行开发”，并明确指出大 JSON 的 LLM 接口必须把错误信息回填后重试，不能让一次无效输出直接切断流程。本 Issue 因此取代聊天中的临时方案，作为来源密度、京东契约和 Crawl Planning 有界 repair 的唯一实施入口；当前尚未开始业务代码修改。

### 2026-08-21

已按本 Issue 的最小边界完成实现：删除“京东 included 必须出现 `jd.catalog-product`”的错误全局检查；采访来源最低门改为继续扩展的失败门；Planning 第一次输出未通过现有校验时，在同一 ephemeral thread 回填原错误并只修正一次。没有新增、细化或复制 JSON/领域校验。

真实电视回归从 6 个草案链接提高到 15 个；确认后的 Planning 又进行 3 轮搜索，首轮因既有“海信目录缺少说明书正文 target”校验失败，第二轮同 thread 修正成功，保存 16 个来源、25 个 target 的 draft plan。计划未确认、未 Start。

本次真实回归也证明 `jd.catalog-product@1.0.0` 的固定 `catalog + first_matching_product` 只能为 4 个京东入口生成 4 个商品详情，不能兑现任务的“主流品牌全系在售”。按本 Issue 已确认的停止条件，该缺口不偷塞进 repair 补丁，已登记为 Issue 03。
