# 数据抓取平台路线图

状态：Windows 真实采集可靠性回归处理中
更新日期：2026-09-02

## 当前目标

历史微波炉 Batch 已证明同一个品类任务可以形成商品目录、标准监管、专业技术和品牌公开资料并通过最低覆盖；2026-09-02 的新 Windows 真实执行暴露了 ZOL 偶发 404、失败作用域和无人值守收口问题。当前先完成 `.scratch/source-capture-reliability/` 中的 P0，再恢复阶段 2；当前不设计数据清洗、知识包成品或导购 Agent。

## 当前可靠性回归门

状态：`in_progress`

执行顺序以 `.scratch/source-capture-reliability/PRD.md` 为入口：

1. ZOL HTML 首次 404 只执行一次有界复核，最终响应进入请求账本与 Source Dataset；
2. 公开来源按 origin 熔断，ZOL 普通品牌目录 404 只结束当前品牌；
3. 在干净 Windows checkout 中完成一次 Start 后无人值守执行，不在运行期间修改代码或人工逐条 Resume；
4. Source Dataset、覆盖投影、权威进度和 Git 交付状态一致。

通过前，历史成功 Batch 继续作为历史能力证据，但不能替代当前版本的无人值守可靠性验收。

## 固定执行顺序

以下五项服务同一条纵向链路；ZOL 与其他来源在 Planning 中同级，不是先后两个数据阶段。

### 1. 验收现有 ZOL 原始数据

状态：`completed`

产物：微波炉 ZOL 原始数据验收报告。

验收结果见 `ZOL-MICROWAVE-CAPTURE-REPORT.md`：原始数据、型号关联、文件和哈希通过；247 个型号全部处理完成，其中 1 个型号由 ZOL 明确标识为无图片；历史请求失败只保留在运行审计中。

通过门：

1. 对账品牌、型号、原始页面、图片、请求和终态数量；
2. 验证页面与图片属于正确品牌和型号；
3. 验证数据库记录、内容寻址文件、哈希和来源血缘可以互相追溯；
4. 逐项列出缺失、重复、失败及其影响范围；
5. 只说明 ZOL 实际包含和缺少什么，不判断数据是否足以支撑导购，也不进行清洗。

### 2. 核对多来源现有能力

状态：`completed`

产物：现有 contract、Provider 和 Source Execution 的复用结论。

通过门：

1. Crawl Plan 可以保存多个同级来源；
2. `public.web-resource` 可以按计划保存公开 HTML、PDF、文本和附件；
3. Source Execution 按来源分别运行，单一来源失败时保留失败事实并继续其他来源；
4. Source Dataset 继续作为原始内容、附件、请求和血缘的唯一事实源。

### 3. 接通多来源 Planning

状态：`completed`

同一个 Planning Run 完成两类工作：ZOL adapter 确定性核验商品目录；Codex web search 按当前品类拆解原理、部件、安全、性能、使用维护等主题，并发现标准监管、专业技术和品牌公开资料的 HTTPS 直达入口。两类结果合并为一份 Crawl Plan Draft，只经过一个人工确认门。

通过门：

1. 主题规则不包含固定品类、品牌、标准号或网站；
2. 标准监管、专业技术和品牌公开资料每一族都有可执行入口或明确失败记录；
3. 计划只保存公开、可审计、无需绕过登录或验证码的直达 URL；
4. 商品目录和公开资料出现在同一份计划中，执行协议和人工确认门只有一套；
5. 负责人未确认新版 Capture Task 和 Crawl Plan 前，不进入抓取。

微波炉真实结果：Capture Task revision 3 与 Crawl Plan version 3 已确认；Planning 引用同任务已经完成的 ZOL Source Batch，并形成 17 个标准监管、专业技术和品牌公开入口，计划阻塞为 0。

### 4. 执行真实多来源抓取

状态：`completed`

输入是一份负责人已确认的多来源 Crawl Plan。已经通过 Source Dataset 验收的同任务 ZOL Batch 可以作为完成引用，不再次执行；其余公开网页/PDF 来源分别建立 Source Run，由对应 Provider 执行。

通过门：

1. ZOL、标准监管、专业技术和品牌公开资料均由计划内 Provider 执行；
2. 单个 URL 或来源被拒绝、不可达或解析失败时，保存失败事实并继续其他来源；
3. 成功内容保存原始响应、附件、时间、URL 和血缘；
4. 登录、验证码、付费或许可限制不绕过；
5. 执行不清洗、不写研究报告，也不判断资料是否充分。

微波炉真实结果：本轮没有重新抓 ZOL；17 个公开资料 Source Run 全部进入终态，15 个完成，2 个受源站限制，失败后其余来源继续执行。

### 5. Source Dataset 终态与最低覆盖验收

状态：`completed`

对账每个计划来源的 Batch、Run、Target、Work Item、Request Attempt、Raw Snapshot、Asset、失败原因和终态，再统一检查商品目录、三个必需来源族、五个经确认计划标注的主题入口和独立站点数量。终态闭环但资料未达标时，只把缺口送回 Planning，不重跑已经完成的来源。

微波炉第一次真实结果：公开资料 Batch 保存 16 个 Snapshot（15 个 accepted、1 个 failed）和 4 个 PDF Asset；执行链全部终态，但专业技术资料为 0/3，因此只完成链路验证，没有通过最低覆盖门。

微波炉增量结果：Planning Run `crawl-planning-run-d73f70a5-de0a-41dc-9e6b-c0634a5a2d96` 只规划 5 个新专业技术入口；Batch `source-batch-c370c3dd-9e51-428f-bacb-a4a2fd25349f` 5/5 完成。ZOL 商品目录为 19 个品牌、247/247 个型号有完成关联；累计标准监管 9 条/6 个网站、专业技术 5 条/5 个网站、品牌官方 6 条/3 个网站；五个计划主题入口全部超过 2 条/2 个网站，剩余缺口 0。微波炉阶段 1 最低覆盖通过。

## 当前不进入

- 数据清洗；
- 知识包成品设计；
- 专业导购 Agent；
- 电商与用户评论抓取。

## 已有 ZOL 抓取基线

Workbench 的自然语言门类目标已经可以经过品类采访、Capture Task 确认、ZOL 品牌排行榜规划、Crawl Plan 确认、Prepare / Start 和 Source Dataset 对账。当前纵向验证在该链路上增加同级公开资料来源，不建立第二条研究流程。

## 门类规划链验收

状态：`in_progress`

通过门：

1. 采访草案显式记录品牌榜综合评分阈值、品牌上限、品牌批次、每轮型号量和每品牌型号上限；
2. 确认后的 Capture Task 原值保存上述策略；
3. Planning Run 调查 ZOL 门类入口、品牌排行榜与入选目录，并拆解专业主题、发现公开资料入口；
4. Crawl Plan Draft 同时展示榜单证据、执行品牌、专业主题、公开资料入口和受阻项；
5. 没有可验证排行榜时，受阻草稿不能确认或启动；
6. 负责人可以独立确认无阻塞计划，Prepare 与 Start 保持两个独立动作。

## 排行榜品牌执行验收

状态：`pending`

开始条件：门类规划链通过自动化测试和 Workbench 真实表面确认。

通过门：

1. 默认选择 ZOL 品牌排行榜中综合评分大于 `0` 的品牌，按榜单顺序最多 `20` 个；
2. 同一计划按每批 `3` 个品牌推进，最后一批允许少于 `3` 个；
3. 每品牌每轮推进 `10` 个不同产品 ID，达到每品牌 `20` 个或公开目录穷尽；
4. 目录不足上限时保存全部可识别型号并以实际数量完成，不跨品牌补配额；
5. 参数页、图集页、来源原图、请求、work item、Run、内存和存储量与计划对账；
6. Resume 继续同一 Confirmed Crawl Plan，不在批次之间重新采访或重新确认。
7. 单个品牌、型号或图片的暂时性失败在有界重试后留痕并继续；访问限制、计划/结构/契约/存储错误和预算停止门仍结束整个运行。
8. Worker 或 API 重启后，已持久化的瞬时传输失败可以由确定性 Resume job 自动继续；恢复不会重新采访、改变 Confirmed Crawl Plan 或突破 request budget。

## 跨门类验证

状态：`in_progress`

通过门：

- 规划和 Provider contract 不包含冰箱固定 URL、品牌或数字分片；
- 至少使用两个 ZOL 门类验证 category slug、品牌目录和排行榜映射；
- 每个门类都独立核验排行榜；无榜单门类保持在计划确认门；
- ZOL 来源差异只存在于 Planning Runtime 与 Provider adapter。

## 数据处理阶段

状态：`ready_for_stage_2_interview_and_research`

上述第 5 项已通过。下一步必须按阶段 2 重新采访、调研和设计数据处理；不得直接恢复旧 Evidence、Knowledge Factory、知识包或 Runtime 代码链。
