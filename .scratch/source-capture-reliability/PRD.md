# 真实来源采集可靠性收口

Status: ready-for-human
Priority: P0
Updated: 2026-09-03

## 简单说明

系统已经能从一份已确认计划抓取 ZOL、标准监管、专业技术和品牌公开资料，但 2026-09-02 的 Windows 真实复验表明：执行仍会把可访问的 ZOL 页面记为 404，局部来源失败也曾扩大为无关来源或整个 Run 的失败。当前工作先让负责人完成 Start 后，后台系统能够在不修改代码、不依赖 Codex 接管的情况下自行收口，再恢复阶段 2。

## 当前事实

- Capture Task：`capture-task-326e80eb-b65f-4f51-9c29-26ce87a2fb62`
- Confirmed Crawl Plan：`crawl-plan-073d11a3-fd9b-469a-bd92-e4346acd9c21` version 6
- Source Batch：`source-batch-b2a25771-63c3-4b8a-8b77-4687989b6c28`
- 终态：`partial`，恢复状态 `none`；21 个 Run 全部终态，15 个完成、6 个 `source_restricted`
- ZOL：19 个品牌、247 个来源型号、234 个完成、13 个需关注
- 原始数据：3489 个 Snapshot、2712 个 Asset
- 公开来源：计划 20 个；14 个本次完成，6 个被既有 origin 安全 gate 如实阻止
- 执行方式：一次正式 Start 后由 Worker 自行收口；运行期间无代码修改、无人工 Resume

## 目标

1. ZOL HTML 偶发 404 在同一请求预算、频控、取消和审计边界内执行一次有界复核。
2. 单个公开网站的访问限制只熔断该 origin；单个 ZOL 品牌目录的普通 404 只结束该品牌。
3. 每个型号形成可审计终态：完成、来源明确无图，或带具体失败资源的需关注；不得用历史问题数冒充当前未完成型号数。
4. 在干净 checkout 上，从已确认计划执行一次 Start 后，后台 Worker 无需运行期改代码即可进入终态；允许产品定义的自动 Resume，不允许 Codex 代替系统修补或人工逐条续跑。
5. 权威进度、研究结论、UI 指标和 Git 交付状态与真实 Batch 一致。

## 非目标

- 不绕过 robots、401、403、429、登录、验证码或风险控制。
- 不把 404 加入所有来源的通用无限重试。
- 不清洗或标准化阶段 1 原始数据。
- 不引入第二套抓取器、队列、重试器或内存状态机。
- 不为了提高完成率删除真实失败型号或缩小已确认计划分母。

## 优先级与顺序

### P0：数据正确性、失败隔离和无人值守执行

1. `01-zol-bounded-not-found-revalidation.md`
2. `02-public-origin-circuit-isolation.md`
3. `03-zol-brand-failure-isolation.md`
4. `04-standalone-clean-checkout-acceptance.md`

### P1：完成语义、规划韧性和用户可读性

5. `05-zol-model-terminal-outcomes.md`
6. `06-planning-runtime-bounds.md`
7. `07-source-dataset-metric-semantics.md`
8. `08-progress-baseline-and-delivery.md`

### P2：本地启动配置

9. `09-windows-environment-contract.md`

## 统一完成门

- 每次真实 HTTP 尝试都经过 Source Access Gate，并保存 Request Attempt。
- 401、403、429、robots、登录与验证码边界保持失败关闭。
- 单个普通 404 不扩大为其他 origin、其他品牌或整个 Batch 的停止。
- 自动化测试覆盖首次 404 后成功、持续 404、访问限制、预算和取消。
- 当前真实失败型号只能通过同一 Confirmed Crawl Plan 的 Resume 重试，已有 Snapshot/Asset 保持不可变。
- 最终以 Source Dataset 的 Batch、Run、Work Item、Request Attempt、Snapshot、Asset 和 coverage 投影验收，不以日志或聊天结论验收。
- `PROGRESS.md` 记录当前事实；需要改变重试采用边界时同步更新 `RESEARCH.md`，只有模块职责或公共 contract 改变才更新 `ARCHITECTURE.md`/ADR。

## Baseline Impact

- touched modules: ZOL Catalog + Gallery Provider、Public Resource Retry、Source Access Gate、Source Dataset 投影、Web 指标、权威文档
- owning fact source: 请求与原始响应归 Source Dataset；执行终态归 Source Execution；最低覆盖归 Source Coverage typed projection
- public interface changed: no（P0 目标）；P1 型号终态若需要扩展公共 contract，必须单独确认
- new protocol/adapter/fallback: no new runtime；P0 只为现有 ZOL adapter 增加来源特有的有界复核策略
- compatibility or legacy path changed: no；历史 Run/Snapshot 保持不可变
- research update required: yes，记录 ZOL 404 的真实复现和现有 `p-retry` 复用边界
- architecture or ADR update required: P0 no；若 P1 改变型号完成语义则另行判断
- tests and real-surface validation to run: Worker/Workbench 聚焦测试、六 workspace typecheck、全量测试、build、干净 checkout 的 Windows 真实执行

## Patch Disposition

- keep：多来源 Planning 的一次校验反馈、公开来源 origin 熔断、ZOL 品牌 404 隔离；它们分别保护已确认覆盖、站点隔离和品牌工作单元边界。
- rewrite：公共请求重试只增加调用方显式选择的 `retryNotFoundOnce`，并只由 ZOL HTML 请求启用；不新增重试器或新的状态源。
- delete：无；本轮审计未发现被新根因推翻、需要保留在工作区的错误补丁。
- reason：同一失败 exact URL 随后返回 200，根因边界是 ZOL HTML 的偶发 404 与失败作用域，不是缩小分母、全局重试 404 或更换事实源。

## Comments

- 2026-09-02：负责人要求先把全部问题落入仓库问题库，按优先级逐项实施，禁止依赖上下文回忆推进。
- 2026-09-02：P0-01/02/03 本机实现完成；49 个测试文件、226 个测试通过，2 个文件与 7 个测试按既有条件跳过；六 workspace 类型检查及生产构建通过。
- 2026-09-03：issue 04 的真实 Batch 已进入终态。P0 的独立执行与失败隔离得到证据；阶段 1 原始资料质量门尚未通过，后续按 P1 issue 05 与 issue 07 收口，详见 `docs/development/MICROWAVE-REAL-CAPTURE-REPORT.md`。
