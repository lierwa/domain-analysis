# ADR 0020：Crawl Planning 采用 DBOS 稳定阶段恢复

- 状态：Accepted
- 日期：2026-08-26
- 影响阶段：ROADMAP 1E
- 替代：ADR 0018 中“阶段结果只驻留内存、Planning Run 由前台连接承载”的运行边界

## 背景

电视来源规划加入跨品牌市场目录后，真实一次运行发现 115 个品牌候选。默认每批 3 个品牌时需要约 39 个官网阶段；运行 17 分 33 秒只到第 10～12 个品牌，进程失败后已完成的品牌发现、饱和查询、市场目录和官网批次全部丢失。继续延长 timeout 或要求负责人保持页面打开不能形成稳定系统。

R-049 比较了 Graphile Worker、pg-boss、Temporal 和 DBOS。Graphile 与 pg-boss是成熟队列，但单独使用仍需应用自建顺序阶段检查点和 crash gap；Temporal 需要独立服务。DBOS TypeScript 4.25.14 为 MIT、直接复用现有 PostgreSQL，并通过与当前规划阶段一致的强杀原型。

## 决定

1. API 组合根使用 `@dbos-inc/dbos-sdk@4.25.14` 承载 Crawl Planning 内部执行恢复，system schema 固定与 Workbench `workbench` schema 分离。
2. Planning Run ID 是父 workflow ID。六镜头品牌发现、每次饱和查询、跨品牌市场目录、每个品牌官网批次和知识来源使用稳定子 workflow ID；所有阶段子 workflow 进入 DBOS concurrency=1 Queue，以匹配一条复用 App Server `stdio` 连接。单个子 workflow 把一次 App Server 搜索、结构化输出和现有 Zod 校验包在一个无自动业务重试的 durable step 中。
3. 已完成子 workflow 不重做；进程在 step 中强杀时，该在途模型搜索按 DBOS 至少一次语义允许重做。系统不宣称外部网页搜索 exactly-once。
4. Workbench 继续拥有 Capture Task、Planning Run、用户可见 Stage Checkpoint 和最终 Crawl Plan Draft。Stage Checkpoint 以 `runId + stageKey` 幂等投影阶段状态与时间线，不保存 DBOS typed result，不读取 DBOS 内部表推导用户状态。
5. 最终 Plan 只在全部阶段通过后由 Workbench 确定性组装、校验并一次写入；`planningRunId` 唯一约束保证父 workflow 最终 step 重放不会创建两个计划版本或两个草稿。
6. SSE 连接只拥有进度投影。页面关闭或刷新停止投影，不取消 workflow；API 启动时用 Workbench 中仍为 `running` 的 run ID 幂等恢复。相同任务已有运行时拒绝并发启动第二轮。
7. DBOS 不确认计划、不执行 Prepare/Start、不访问正式抓取来源，也不替代 Graphile Source Execution、Crawlee Provider 或 Source Dataset。

## 验证

- 隔离候选原型在品牌批次 step 内 `SIGKILL` 后恢复：已完成发现和市场目录各执行一次，在途批次 `start` 两次、`done` 一次，后续阶段各一次。
- 正式 `DbosCrawlPlanningModule` 强杀集成测试使用真实 PostgreSQL、正式 migration、父/子 workflow、Stage Checkpoint 与 Plan 写入：强杀发生在 `brand-mapping:0:1`；恢复后发现、市场目录和其他已完成阶段不重做，在途批次只完成一次，最终只有一个 Plan Draft。
- Codex 分阶段运行时 18 项测试、全仓 169 项测试、六个 workspace typecheck、生产构建通过；生产组合根无运行任务启动后 `/health` 与任务列表返回 200。
- 真实电视 Planning Run 在页面断连和两次 API `SIGKILL` 后完成 12/12 个稳定阶段并只生成一个 Plan Draft。第一次重启暴露 `DBOS.launch()` 自动恢复后重复显式启动的 queue name 冲突；恢复器改为先查询既有 workflow 状态，只在 workflow 不存在时启动，第二次强杀和集成测试均未再出现该冲突。

## 结果与边界

- 长品类规划可以跨页面和 API 进程恢复，失败成本从“整轮重来”缩小到“最多重做在途单阶段”。
- DBOS 只解决执行持久性，不替代计划内容质量门；真实 v11 因市场目录 topic 归属过宽而保持不可确认，这不由 workflow 成功状态自动提升。
- PostgreSQL 新增 Workbench 阶段投影表和独立 DBOS system schema；DBOS 进程生命周期由 Workbench 组合根统一启动和关闭。
- Cookie、Profile、认证 Header、验证码材料和抓取原文不进入 workflow 输入；规划仍只使用公开网页搜索。
- 删除 DBOS adapter 和 system schema 即可退出，Capture Task、Planning Run、Plan 与历史 Stage Checkpoint 不依赖 DBOS 类型。任何替代方案必须通过同一强杀恢复门，不能退回内存数组或自研工作流状态机。
