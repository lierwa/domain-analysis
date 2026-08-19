# PRD：从品类采访到可执行抓取任务的最小闭环

Status: ready-for-agent

## Problem Statement

用户希望在 Workbench 新建一个标准商品品类抓取任务，通过自然语言采访让系统主动调查品类边界、标准、品牌、型号、内容方向和真实来源，最终得到一份人能直接审查、抓取程序能够确定执行的 Crawl Plan，并在用户显式点击开始后产生真实 Source Run 和不可变原始数据。

当前系统没有交付这个结果：

- 采访运行时的决定 proposal 同时保存“推荐标记”和“推荐选择”，同一事实重复表达，模型输出轻微不一致就导致整轮失败；外部来源字段的 `null` 或 URL 形状也曾让采访阶段直接失败。
- 历史结构化草稿被包进 Markdown 代码块后当作新草稿展示，用户看到的是原始 JSON 和代码围栏，不是可读方案。
- 当前 Crawl Plan 只表达来源、捕获内容、数量、遍历文字和停止文字，没有绑定真实 Provider、Provider 可校验的执行配置、有效入口、访问策略和原始输出要求。
- 数据库同时容纳旧 Source Collection Plan 与新 Crawl Plan 两种不完整结构，没有一个唯一、可执行的计划事实源。
- API 只能生成和确认计划、读取 Source Run；没有“开始抓取”入口。
- Worker 只有频控、熔断和临时存储基础，没有真实来源 Provider、计划执行入口或 Source Dataset 写入链。
- Source Dataset 模块只能查询和导出历史行，不能由真实抓取写入 Source Run、Source Object、Source Snapshot 和 Source Asset。
- 自动测试保护了“确认计划不创建 Source Run”，却没有证明用户能够从真实页面启动真实来源抓取。
- 本地 PostgreSQL 未运行时，开发启动曾直接以 `ECONNREFUSED 127.0.0.1:5432` 失败，用户不得每次手工启动依赖。

因此，当前展示出来的计划只是“规划候选”，不是可执行抓取任务；测试通过也不能说明真实用户路径可用。

## Solution

Workbench 提供一条最小但完整的主路径：

1. 用户新建抓取任务并输入标准商品品类。
2. Capture Task Interview 保存用户原文、助手文字、真实调查活动、已确认决定、未决项和事实记录。采访只使用自然语言和最小决定协议，不提前输出完整任务或来源 schema。
3. 当不存在必须由负责人处理的未决项时，系统生成版本化、可直接阅读的 Markdown Capture Task Draft。页面正确渲染标题、段落、列表和表格，不显示 JSON dump。
4. 用户确认最新草稿后，系统只依据已确认采访资料生成结构化 Capture Task。转换不能搜索、提问或添加采访中不存在的新事实。
5. 用户要求生成抓取方案。Crawl Planning 调查具体来源并生成一个版本化 Crawl Plan Draft。该计划既有可读投影，也有同源的机器结构；不是两套相互漂移的内容。
6. Crawl Plan 中每个来源项必须同时包含真实入口、已注册 Provider 绑定、Provider 已校验配置、捕获目标、数量、去重、访问策略、停止条件和原始输出要求。缺少任一执行条件时，计划显示明确阻塞，不能确认。
7. 用户审查并确认无阻塞的 Crawl Plan。确认只冻结计划版本，不自动访问外部来源。
8. 用户显式点击“开始抓取”。API 读取数据库中的已确认计划，而不是信任 Web 重新提交的计划内容；随后创建 Source Run，并让 Worker 根据 `providerKey` 调用真实 Provider。
9. Provider 从计划的入口开始，按自己的站点/协议实现完成发现、翻页、对象识别、内容捕获和访问状态识别。计划决定抓什么，Provider 代码决定具体怎样操作来源；JSON 不能替代 Provider。
10. Worker 把源站返回内容按原始格式写成 Source Object、不可变 Source Snapshot 和 Source Asset，并持续更新 Source Run 计数与停止原因。
11. 页面展示真实运行状态、成功/失败/阻塞计数和原始数据入口。用户可以停止当前运行；关闭前台连接时，最小版本将运行记为 stopped，不伪装成完成，也不自建后台恢复系统。

第一条真实纵向验收采用“家用冰箱＋京东”作为标准商品与主要平台样本：实现一个真实京东 Provider，使用一个经过核实的冰箱入口，至少完成商品发现与一种商品原始内容捕获，写入正式 Source Dataset。该验收用于证明通用计划与 Provider 边界真的可运行，不把冰箱、京东、SKU 或价格字段写进通用 Crawl Plan contract。

## User Stories

1. As a 抓取任务负责人, I want to create a task by entering a product category in natural language, so that I do not need to understand crawler configuration before starting.
2. As a 抓取任务负责人, I want the system to investigate standards, brands, models, product structure, and likely sources, so that searchable facts are not pushed back to me as interview questions.
3. As a 抓取任务负责人, I want to be asked only decisions that materially change the result, so that the interview remains short and professionally useful.
4. As a 抓取任务负责人, I want every recommendation to include its basis and main trade-off, so that I understand what accepting it changes.
5. As a 抓取任务负责人, I want to answer, correct, supplement, reject a premise, or ask a question in one natural-language message, so that the Composer does not become a rigid form.
6. As a 抓取任务负责人, I want my original message saved before model processing, so that a failed turn never loses my input.
7. As a 抓取任务负责人, I want a failed or interrupted turn to be retryable from the latest original input, so that I do not need to retype it.
8. As a 抓取任务负责人, I want interview proposals to distinguish a recommendation from my confirmed selection, so that schema duplication cannot reject an otherwise valid answer.
9. As a 抓取任务负责人, I want incomplete source observations to remain textual interview facts, so that an unknown timestamp or unverified URL does not crash the whole interview.
10. As a 抓取任务负责人, I want completed searches and their safe source links preserved in the timeline, so that the resulting scope can be traced to actual investigation.
11. As a 抓取任务负责人, I want the system to generate a readable Markdown Capture Task Draft, so that I can review the proposed category scope without reading JSON.
12. As a 抓取任务负责人, I want headings, lists, tables, and links rendered as content, so that Markdown syntax is not displayed as raw code.
13. As a 抓取任务负责人, I want legacy structured records clearly marked and kept out of the current confirmation path, so that historical JSON cannot masquerade as a new draft.
14. As a 抓取任务负责人, I want each new draft to have a version, so that later corrections do not overwrite earlier review history.
15. As a 抓取任务负责人, I want only the latest complete draft to be confirmable, so that an old or stale scope cannot become the active task.
16. As a 抓取任务负责人, I want draft confirmation to use only already recorded facts, so that a conversion step cannot silently invent sources or requirements.
17. As a 抓取任务负责人, I want the confirmed Capture Task to retain the original request, category boundary, market/time scope, included topics, exclusions, decisions, and unresolved system work, so that planning has one stable scope input.
18. As a 抓取任务负责人, I want to request a Crawl Plan from the confirmed task, so that concrete source research is separated from conversational drafting.
19. As a 抓取任务负责人, I want the plan displayed as a readable execution sheet, so that I can understand the result without opening its machine representation.
20. As a 抓取任务负责人, I want every planned source to show its publisher and verified entrypoints, so that I know where the crawler will begin.
21. As a 抓取任务负责人, I want every planned source to show which registered Provider will execute it, so that a URL is not mistaken for implemented crawling capability.
22. As a 抓取任务负责人, I want the plan to state what each source contributes, so that duplicate or irrelevant sources can be rejected.
23. As a 抓取任务负责人, I want each Capture Target to state its capture unit and raw formats, so that “抓商品资料” becomes an auditable output definition.
24. As a 抓取任务负责人, I want every target to use all-available, target-count, or sample quantity with a denominator and rationale, so that vague quantities such as “尽量多” cannot pass confirmation.
25. As a 抓取任务负责人, I want every target to define a stable unique key, so that pagination and repeated discovery do not create duplicate Source Objects.
26. As a 抓取任务负责人, I want every source to define traversal and stopping conditions in Provider-readable form, so that Worker does not interpret natural-language prose at runtime.
27. As a 抓取任务负责人, I want access policy and request limits frozen with the plan, so that execution cannot silently use a more aggressive policy.
28. As a 抓取任务负责人, I want planned raw outputs to state whether HTML, source JSON, documents, images, or other attachments will be preserved, so that the Source Dataset is predictable.
29. As a 抓取任务负责人, I want missing Provider, invalid entrypoint, login, CAPTCHA, permission, or rate-limit requirements shown as execution blockers, so that an unimplemented source cannot be confirmed as runnable.
30. As a 抓取任务负责人, I want blocked and executable plans visually distinct, so that I cannot accidentally start a plan that only exists on paper.
31. As a 抓取任务负责人, I want plan confirmation to freeze an exact version and content hash, so that execution always refers to the version I reviewed.
32. As a 抓取任务负责人, I want starting a crawl to be a separate explicit action, so that confirming a plan never accesses an external source unexpectedly.
33. As a 抓取任务负责人, I want the server to reload the confirmed plan from PostgreSQL on start, so that modified browser payloads cannot change execution scope.
34. As a 抓取任务负责人, I want start to fail before creating a fake run when a Provider is absent or its configuration is invalid, so that the run list remains truthful.
35. As a 抓取任务负责人, I want a successful start to immediately create a Source Run bound to task revision, plan version, source item, Provider, and access policy, so that every capture is auditable.
36. As a 抓取任务负责人, I want one reusable Provider to execute multiple plans for the same source family, so that every plan does not require a new crawler implementation.
37. As a 抓取任务负责人, I want a single planned source to expand into the concrete discovery, detail, media, or review capture work required by its targets, so that one source is not incorrectly treated as one HTTP request.
38. As a 抓取任务负责人, I want the Provider to stop on login challenge, CAPTCHA, access denial, or risk control, so that the system does not bypass source restrictions.
39. As a 抓取任务负责人, I want source errors and stop reasons persisted exactly, so that failure is not shown as completed coverage.
40. As a 抓取任务负责人, I want every successful observation saved as an immutable Source Snapshot, so that subsequent runs cannot overwrite earlier source truth.
41. As a 抓取任务负责人, I want downloaded documents and media saved as Source Assets with content hashes, so that exported records can refer to preserved originals.
42. As a 抓取任务负责人, I want run counts, exported records, objects, snapshots, and assets to reconcile, so that completion can be independently checked.
43. As a 抓取任务负责人, I want to inspect and export the raw Source Dataset after a run, so that captured data is useful before any cleaning stage exists.
44. As a 抓取任务负责人, I want stopping a foreground crawl to persist `stopped` rather than delete or complete the run, so that operator actions remain visible.
45. As a developer, I want `npm run dev` to start local PostgreSQL only when needed, so that development does not fail on port 5432 and does not repeatedly launch duplicate services.
46. As a developer, I want the first real acceptance case to use the production Web, API, PostgreSQL, Worker, Provider, and Source Dataset seams, so that fixtures cannot substitute for a runnable user result.
47. As a developer, I want common Crawl Plan and Source Dataset contracts to contain no refrigerator-, JD-, Taobao-, SKU-, or price-specific assumptions, so that product and source differences remain in plan data and Provider implementations.
48. As a developer, I want Provider-specific configuration validated by the selected Provider before plan confirmation, so that arbitrary JSON metadata cannot cross module boundaries unchecked.
49. As a developer, I want no Codex invocation after a confirmed plan starts, so that execution is deterministic and constrained to the frozen plan.
50. As a developer, I want the minimum implementation to reuse the existing interview timeline, PostgreSQL records, planning UI, access gate, raw dataset tables, and export path, so that fixing the main path does not create another platform layer.

## Implementation Decisions

- The main user result is one versioned Crawl Plan with two projections of the same facts: a readable execution sheet and a validated machine representation. The UI must not maintain a second plan model.
- Capture Task Interview continues to own messages, ordered activities, user originals, Interview Decisions, unresolved items, and Capture Task Draft history. It does not own Provider configuration or execution state.
- A proposed Interview Decision contains the question, two or three options, exactly one recommended option, and rationale. It does not contain a user `selection`. Selection exists only in a confirmed Decision Resolution created from the user's later answer.
- Interview runtime output contains assistant text, decision/resolution deltas, unresolved-item deltas, and optional `draftMarkdown`. It does not contain a complete Capture Task, Source Candidate array, observed timestamp, Crawl Plan, or Provider configuration.
- Draft Markdown is stored as text and rendered as Markdown. Historical structured JSON remains a legacy record and is never automatically converted into a current confirmable draft by surrounding it with code fences.
- Capture Task is the confirmed scope input to planning. It owns the original request, standard-product/category boundary, market/time scope, task topics, exclusions, confirmed decision references, and unresolved system work. It does not contain source traversal, selectors, request frequency, or execution lifecycle.
- Crawl Plan becomes the only active plan contract. Old Source Collection Plan content remains read-only legacy data and cannot be accepted by the new confirmation or start paths. The active database column must no longer treat two shapes as equally authoritative.
- A Crawl Plan envelope contains plan identity, Capture Task identity and revision, version, status, content hash, readable summary, excluded content, source items, creation time, and confirmation time.
- Each source item contains a stable source key, source name, publisher, source kind, role, one or more entrypoints, Provider binding, Capture Targets, effective access policy, source-level stop policy, raw output policy, and execution blockers.
- An entrypoint contains a validated URL and a semantic role such as category catalog, search result, product catalog, registry query, standard catalog, or document index. Search discovery alone may create a candidate entrypoint, but plan confirmation requires the selected Provider to validate that it can accept the entrypoint shape.
- Provider binding contains a stable Provider key and version plus Provider-owned configuration. The common plan does not contain JD selectors or site-specific field names. Provider-specific configuration enters through the external seam and is validated immediately by the selected Provider before persistence or confirmation; arbitrary `unknown` metadata is not retained as an internal contract.
- A Provider is reusable code, not generated JSON. It knows the source mechanics: starting a session, accepting entrypoints, pagination or discovery, identifying external objects, capturing source responses, detecting login/CAPTCHA/access denial, and returning raw observations. It does not decide business scope, quantities, or cleaning fields.
- The minimum composition root uses an explicit injected map from Provider key to Provider implementation. It does not introduce dynamic plugin discovery, a general registry framework, or per-plan crawler source generation.
- A single source item can produce many concrete capture operations. For example, one marketplace catalog source can perform catalog discovery and then capture many product details and assets. The Provider performs this expansion within the frozen source/target boundaries; the Worker does not ask Codex how to proceed.
- Each Capture Target contains a target key, task-topic references, capture unit, accepted raw formats, quantity mode and denominator, unique-key definition, Provider-readable traversal configuration, target stop policy, and raw output requirements.
- Quantity is limited to `all_available`, `target_count`, or `sample`. A count mode requires a positive count; every mode requires a reviewable denominator and rationale. Free text such as “尽量多”“适量” or “若干” is invalid.
- Stop policy separates normal completion from forced stop. Normal completion includes denominator reached, target count reached, or no new unique keys according to an explicit limit. Forced stop includes CAPTCHA, login challenge, access denial, circuit breaker, maximum runtime, request budget, and operator cancellation.
- Access policy records the effective policy used for the run, including manual or paced access and its frozen limits. Provider defaults may propose values, but the confirmed plan owns the effective policy.
- Raw output policy declares the source-native payloads to retain: inline text, HTML, source JSON, document, table, image, or other asset. No normalization or common product parameter schema is introduced in this PRD.
- A plan with any execution blocker remains a draft and cannot be confirmed. Workbench confirmation reloads the latest Capture Task and plan, checks revision leases, resolves every Provider key from the injected composition, validates every Provider configuration/entrypoint, validates topic coverage and quantities, and only then freezes the plan.
- The start command accepts plan identity and expected version, not the complete plan body. API reloads the confirmed plan from PostgreSQL and repeats readiness validation to protect against stale UI state or changed Provider availability.
- Starting creates Source Runs bound to the exact task revision, plan ID/version, source key, Provider key/version, and effective access policy. A missing Provider or failed preflight returns a typed error without inserting a running row.
- The initial execution seam is a visible foreground Source Run streamed over the existing SSE pattern. Closing or cancelling the stream requests cancellation and persists `stopped`. Durable background scheduling, automatic resume, and distributed queues are not built in the minimum vertical.
- Worker dispatches each source item to its bound Provider. Provider observations are validated at the seam and immediately persisted through one Source Dataset write interface; Web and API never derive raw-data state from display strings.
- Source Dataset write behavior creates or reuses Source Objects by task/source identity/external key, appends immutable Source Snapshots, stores Source Assets, updates run counters transactionally, and records the exact termination reason. Existing read and export behavior remains the same consumer interface.
- The first production Provider is a bounded JD catalog/product Provider used by the refrigerator acceptance case. JD-specific navigation and page/interface recognition live inside that Provider. The generic plan, Workbench, Source Dataset, and Worker dispatch contracts remain source- and category-neutral.
- The JD Provider must use an access mechanism selected through the repository research gate and must stop rather than bypass login, CAPTCHA, verification, or risk control. Existing access-gate, cancellation, pacing, and circuit-breaker assets are reused.
- Planning can mention an unimplemented source, but it must attach an execution blocker such as `provider_missing`. It cannot manufacture a Provider key or mark the source executable.
- Plan and interview errors are returned as stable typed codes with readable Chinese messages. Raw Zod paths, ANSI output, stderr, and internal schema text are logged only at the bounded server seam and are not shown as the main user message.
- Existing interview failures are corrected at the contract source rather than with retries or fallback: proposal selection duplication is removed; optional external observations are not required in interview output; formal URL/provider validation occurs during planning; one same-model repair path is not introduced.
- Existing historical JSON rows are preserved without deletion. They are displayed as legacy structured records or excluded from the active draft list, and they are never eligible for new confirmation until explicitly revised through the current interview.
- `npm run dev` keeps one idempotent local PostgreSQL start step before schema assurance. If port 5432 already serves the configured PostgreSQL instance, it does nothing; if a known local PostgreSQL installation exists but is stopped, it starts it once; if no supported installation is available, it exits with one actionable message.
- No separate manager, coordinator, engine, kernel, dynamic plugin framework, duplicate plan DTO, or generalized workflow platform is added. The product-specific code is limited to domain validation, thin Provider/DB adapters, and the application orchestration required by this path.
- The implementation must first dispose of the current dirty patch: keep the Interview Working Record and Markdown-draft direction; rewrite the historical JSON migration/display, decision proposal contract, active plan contract, plan confirmation gate, and documentation that claims execution is complete; retain the PostgreSQL startup change only after its idempotency tests pass.
- This PRD proposes a public plan/start execution contract beyond the accepted interview ADR. Before production implementation is declared complete, authority documents must be reconciled so that the glossary, requirements, architecture, roadmap, progress, and relevant ADR describe the same executable result rather than repackaging the current module sequence.

## Testing Decisions

- The primary acceptance seam is one real production-like Workbench journey, not a module test: start from an empty new-task page, interview “抓冰箱”, review a readable draft, confirm it, produce and confirm an executable plan with a real JD Provider binding, click start, and observe a real Source Run produce at least one immutable raw snapshot that remains visible after API/Web restart.
- The real acceptance record must report separately: user-visible interview result, confirmed plan contents, Provider preflight result, source access result, Source Run identity/status/counts, persisted snapshot/asset identities, export count, browser console state, and any login/CAPTCHA/risk-control stop. A fixture pass cannot replace any of these facts.
- A highest-seam automated integration test covers the same orchestration with a controlled Provider implementation: confirmed plan reload, Provider preflight, Source Run creation, observation persistence, counters, completion/stopping, and Source Dataset read/export. This test protects domain orchestration without asserting private helper calls.
- Interview contract tests prove that a proposal with exactly one recommended option does not require a duplicated selection, that a later user resolution stores the selection, and that a recommendation mismatch cannot fail before the user has answered.
- Interview integration tests prove that user input is committed before runtime execution, failed turns preserve input, retry only targets the latest failed input, and textual source facts with unknown access or time do not require formal source fields.
- Draft tests prove that current Markdown renders headings/lists/tables as readable content, legacy JSON is visibly legacy and not confirmable, and a subsequent input invalidates the previous current draft without deleting history.
- Materialization tests prove that only confirmed Interview Working Record facts enter Capture Task, that materialization performs no search, and that newly invented source facts or missing decision references fail closed.
- Crawl Plan contract tests cover entrypoint URL validation, duplicate source/target keys, task-topic coverage, quantity modes, denominators, unique keys, Provider binding, access policy, stop policy, raw output policy, and blocker handling.
- Provider preflight integration tests prove that an absent Provider, incompatible entrypoint, invalid Provider configuration, or unresolved blocker prevents confirmation and start without creating a Source Run.
- API tests prove that start accepts only plan identity/version, reloads the plan from PostgreSQL, rejects draft/superseded/stale plans, and streams typed Source Run events for a confirmed current plan.
- Worker contract tests prove that plan scope is passed unchanged to the selected Provider, that one source can emit multiple observations, that external results are validated at the seam, and that no Codex/model call is made during execution.
- Source Dataset integration tests prove object idempotency, snapshot immutability, asset linkage, transactional counter updates, failure/stop persistence, and JSONL/CSV export reconciliation.
- Access tests prove cancellation, minimum interval, circuit breaker, maximum runtime, login/CAPTCHA/access-denied stop, and that none of those states are recorded as successful capture.
- Web tests prove that execution blockers disable confirmation/start, the readable plan and machine status project from the same server response, running/stopped/completed status comes from Source Run state, and raw internal schema errors are not rendered as the primary user message.
- Development lifecycle tests start with PostgreSQL stopped, run `npm run dev`, verify one server instance and healthy API/Web, stop application services, repeat the cycle, and verify PostgreSQL was not repeatedly launched. A second case with PostgreSQL already running must be a no-op success.
- The refrigerator/JD real acceptance must use a fresh Source Run, zero model repair/fallback, the current production composition root, and a bounded request/quantity policy. If access is blocked, the result is “real access blocked” with the precise observed state, not a fixture or a completed claim.
- Existing tests that assert plan confirmation creates zero Source Runs remain valid because confirmation and start are separate. New tests must additionally prove that the explicit start command creates and executes a real Source Run.
- Typecheck and production build must pass for all six workspaces. Automated evidence, browser evidence, real-source evidence, and blocked evidence must be reported separately.

## Out of Scope

- Data cleaning, normalization, entity resolution, Evidence, knowledge packages, reports, and any stage-2 schema.
- A universal crawler that interprets arbitrary natural-language traversal instructions.
- Generating Provider source code or DOM selectors from Crawl Plan JSON at runtime.
- Dynamic Provider plugins, provider marketplace, agent registry, workflow platform, or general-purpose job orchestration framework.
- Distributed queues, crash recovery, automatic resume, scheduled recurring crawls, incremental synchronization, and cross-machine execution for the first vertical.
- Automatic model fallback, silent retry, schema-repair loops, or a second product conversation store.
- CAPTCHA bypass, login automation without explicit authorization, Cookie/Profile export, risk-control evasion, or credential persistence in Git/logs/plans.
- Taobao and broad multi-platform execution in the first vertical. They require independently implemented and validated Providers before becoming executable plan sources.
- Prebuilding adapters for unknown brand-official websites. Such sources remain blocked until an appropriate reusable Provider or source-specific adapter is implemented and validated.
- Cleaning source-native HTML/JSON/PDF/images into a unified product parameter schema.
- Deleting historical user tasks, interviews, legacy structured records, or raw data as part of this implementation.
- Rewriting unrelated Settings, shell, UI styling, or historical domain modules.

## Further Notes

- “可执行 Crawl Plan” does not mean a sufficiently detailed JSON can teach a crawler how to operate a website. It means every plan source is bound to already implemented Provider code, with validated entrypoints and typed configuration. The plan supplies business scope and limits; the Provider supplies source mechanics.
- One source item is not one JSON request. It can expand through its Provider into catalog discovery and many product/detail/document/media captures while remaining within the confirmed targets, quantities, and stop policies.
- Human readability and machine executability are projections of one plan fact source. The product must not store a Markdown plan and a separate unrelated JSON plan.
- The minimum successful outcome is deliberately narrow: one real category, one real source Provider, one confirmed plan, one explicit start, one truthful Source Run, and persisted raw data. Additional sources are added only by reusing or implementing Providers against the same contract.
- This PRD is ready for implementation decomposition, but it does not authorize declaring JD access successful before the real Provider preflight and bounded source run have actually passed.
