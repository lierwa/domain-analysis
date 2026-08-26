---
status: accepted
date: 2026-08-20
---

# 可执行 Crawl Plan 与前台 Source Run

## 简单说明

计划不再只是说明文字。每个来源必须指向仓库里真实存在的 Provider，并冻结入口、品类筛选、请求预算、频率、停止条件和原始输出。确认计划不会访问来源；显式 Prepare 也不能制造重复探测。只有用户单独开始后才创建可查看、可导出的 Source Run、逐请求账本、对象和不可变快照。登录、验证码、拒绝或风控会在首个命中时停止，不会自动重试或绕过。

## 背景

原 Crawl Plan 只有来源、目标、数量和自然语言 traversal；数据库还允许旧 Source Collection Plan 与新计划两种 shape 共存。API 没有显式 Start，Source Dataset 只有读接口，Worker 也没有生产 Provider，因此 JSON 和测试不能形成真实抓取闭环。

## 决定

- 版本化 Crawl Plan 是唯一 active plan 事实源；旧 plan 只读，不参与确认或启动。
- 每个 active source 冻结 Provider key/version、Provider 已校验配置、真实入口、访问政策、请求预算、停止政策和原始输出政策。
- composition root 只注入当前真实 Provider map，不建设动态 registry/plugin discovery。
- 计划确认先解析最新 task revision、拒绝 blockers，再由对应 Provider 做纯结构校验；确认不依赖浏览器运行态，也不创建 Source Run。
- Prepare 只接受 plan identity、task revision 与 plan version；服务端重读 confirmed plan，启动或连接项目专用浏览器并返回临时 readiness，不持久化第二套状态。
- Start 使用同一 identity/revision/version 重读 confirmed plan，重复最终 preflight 后才创建 Source Run。
- 首版使用前台 SSE。连接关闭或取消记为 `stopped`；不增加后台队列、自动恢复或模型调用。
- Provider 只负责来源 mechanics。首个 `jd.catalog-product@1.0.0` 使用 loopback CDP、明确 `include_text/exclude_text`、请求预算 2、最小间隔 10 秒和零重试；不读取日常 Profile，不保存登录页内容。
- Source Dataset 通过一个事务写入口创建/复用 Source Object、追加不可变 Snapshot、更新计数；Web/API 只读取和投影。

## 后果与验证门

- 新增官方 `playwright-core@1.62.1`，继续复用 `p-queue` 与 `cockatiel`；许可证、Node/TypeScript、本地边界与退出成本记录在 R-036。
- 通用 contract 不出现冰箱、京东、SKU 或价格字段；品类词和排除词只存在于计划中的 Provider 配置，JD 页面机制只存在于 Provider。
- 自动化必须覆盖 preflight、confirmed plan 重读、显式 Start、幂等写入、停止与导出；真实验收必须独立报告 passed/failed/blocked/untested。
- 阶段 1C/1D 的首个纵切片只证明一个京东目录页和一个详情页，不代表完整京东平台覆盖。

## 2026-08-21 修订：确认与运行准备分离

原“确认时执行运行态 preflight”被本修订替代。原因是 9222 和登录状态会随本机环境变化，不是 Crawl Plan 的业务事实；把它放在确认按钮会让一个合法计划因为 Chrome 未启动而无法确认。Source Execution 现通过显式 Prepare 管理这段临时生命周期：用 Playwright `launchPersistentContext` 和 Git 忽略的独立 Profile 启动系统 Chrome，校验 loopback CDP，再返回 `ready` 或登录/验证人工动作。Start 仍保留最终 preflight，因此准备完成后状态发生变化也不会带病创建运行记录。

## 2026-08-21 修订：请求级持久准入与显式继续

本修订替代上节关于 JD 自动启动浏览器、检查登录的实现结论，也替代“前台运行不恢复”与 `jd.catalog-product@1.0.0` 的当前生产决定。请求级审计证明 `page.goto` 不能代表页面实际网络请求，Prepare/Preflight 导航还会制造额外访问。

- 历史 v1/CDP 路径不再注入；`jd.catalog-product@2.0.0` 只使用显式 HTTP，Prepare 固定零请求，默认真实访问开关关闭。
- 每个 redirect hop 在出网前由 PostgreSQL 原子预留 request attempt；数据库拥有跨进程预算、冷却、窗口、熔断与人工继续状态。进程内 `p-queue`/Cockatiel 只承担当前执行调度。
- Source Dataset 新增 Capture Work Item、Source Request Attempt、Source Access Gate、Source Resource Reference 和 `resumedFromRunId`；这些是通用 contract，不出现京东、SKU 或品类字段。
- Crawlee 3.18.1 命名 RequestQueue/MemoryStorage 只负责本机持久派发和 stable uniqueKey 去重。强杀测试证明已完成项不重复、锁到期前不重复领取、到期后只恢复未完成项；用户可见状态仍只来自 Source Dataset。
- Source Run 持有 PostgreSQL session advisory lease；活进程阻止重复继续，进程断开后 lease 自动释放。只有负责人显式继续 stopped/failed run 才创建恢复 run，请求预算与冷却沿恢复链累计。
- 本阶段图片只保存详情响应中的 URL 引用，不创建图片工作项、不下载字节；Asset/cacache 继续服务计划明确要求下载的其他来源。

真实京东访问、登录和扩批仍不在本修订的自动授权内；本地工程门通过只允许下一步另行批准的匿名最小探针。

## 2026-08-21 修订：服务端持久派发替代前台 SSE

本修订明确替代“首版使用前台 SSE，连接关闭记为 stopped”的当前执行契约；Planning/Interview 的可见流式交互不受影响。

- Start/Resume 先通过普通 JSON HTTP 提交 typed command，成功立即返回 202 和一次性 `commandId`。HTTP socket、React 页面和 Codex 控制连接都不再是抓取任务句柄。
- 接受 Graphile Worker 0.17.3 的嵌入式 PostgreSQL library mode；单一 `source_collection` queue 串行消费完整 Source Execution。Graphile 只负责通用持久派发，Source Collection Batch/Run/Target/Work/Request/Snapshot 继续是用户可见唯一事实源。
- Web 在 Batch/Run 为 running 时轮询 Source Dataset；关闭、刷新或离开计划页不会 abort。来源限制和 Provider 失败由现有领域流结算，Graphile job 禁止自动 retry，避免再次发送真实请求。
- 任务 payload 只含 task/plan/run/revision 标识，不含 Cookie、Profile、认证 Header 或原始响应；官方 job schema 不进入 UI/导出，也不得与 Batch 混为一个对象。
- 本机真实原型已证明：HTTP 202 在延迟任务结束前返回，客户端关闭后任务完成；同 queue 在 concurrency 2 下仍 `maxActive=1`；runner 停止期间入队的未领取任务在新 runner 启动后完成；非法 payload 不进入 Source Execution。正在执行一半的 API 强杀还没有形成 exactly-once 保证，保持后续恢复门，不以这次断连修复冒充完成。

## 2026-08-24 历史修订：专用人工登录会话与详情 canary（已被否决）

本修订曾尝试替代“JD v2 使用匿名、隔离 Cookie 的 `request.newContext()`”装配，但真实账号异常已经否决该候选。以下内容只保留为历史实验记录，不得再进入生产组合根；当前决定以 ADR 0017 为准。

- `JD_REAL_HTTP_ENABLED=true` 时只创建 Git 忽略的项目专用 persistent Chrome Profile，不连接日常 Chrome，不复制 `storageState`、Cookie 或 Header。Prepare 继续零请求，也不自动打开浏览器。
- 页面通过 typed Fastify API 显式打开京东登录页；负责人自行完成登录并点击确认。系统不读取认证字段，也不把“确认”冒充源站验证；Provider 只有在会话 ready 后才取得 `BrowserContext.request`，首个计划请求仍负责识别登录、验证、403/429、风险正文和骨架。
- `JD_DETAIL_CANARY_LIMIT` 是本次 1＋2 真实验收的临时运行安全门。每个 Source Run 达到成功详情数后如实失败关闭，剩余 Crawlee work 保持未完成，只有显式 Resume 才能继续。它不改变 Crawl Plan 的全量分母、Source Dataset 事实归属或请求预算/冷却累计。
- 第一条真实详情先保存不可变原始 HTML；只有据此实现详情主图/详情图 URL parser 后，才用另外 2 个 SKU 验证。全部阶段只保存 URL 引用，图片字节请求必须为零。

本地原型只证明夹具 Cookie jar 共享；真实首条详情仍是骨架，随后源站显示账号异常。登录 API/UI/adapter 与详情 canary 必须按 `JD-COLLECTION-ITERATION.md` 的 I0 删除。匿名目录历史快照保留；新执行语义使用目录-only `jd.catalog-market@1.0.0`，不登录、不跳详情、不抓评论。

## 2026-08-25 修订：Batch 失联收口、gate 升级与内联原文无损保存

本修订接受 R-046/R-047 的真实纵向验证，替代“执行中进程强杀仍只是后续恢复门”的现行结论，但不改写 Graphile 与网络副作用的至少一次边界。

- Source Execution 从 Batch 创建到结算持有 PostgreSQL session advisory lease。API 启动时在 Graphile runner 之前检查 `running` Batch；只有能取得该 lease 时才认定旧执行进程已失联，并把未终结 Request/Work/Target/Run/Batch 收口为 unknown/stopped。活动 lease 下零副作用；历史 Snapshot 全部保留。
- 启动恢复不读 Graphile 内部表、不自动 Resume、不发来源请求；Graphile job 继续 `maxAttempts=1`。系统只承诺进程失联后领域状态可审计收口，不承诺 exactly-once。
- 持久访问 gate 的 Provider identity 不可改。只有 closed、无 manual resume 且当前零 `started` attempt 的空闲 gate 允许升级到新 policy version；升级后 `nextEligibleAt` 保留旧政策与新最小间隔中更严格的值。已受限、当前有在途请求或需人工继续的 gate 不自动改写。
- `inline_text` 的 HTML/XHTML 使用 WHATWG `encoding-sniffer`。传输层 charset 在 fatal `TextDecoder` 下无法无损解码且页内 meta 结果更完整时，才采用页内编码；保存的 charset/bytes/payload hash 统一对应最终内联文本。Asset 仍保存原字节，历史有损 Snapshot 不覆盖。

真实电视 v9 在本修订下连续三次通过 Workbench Start → Graphile → Batch/Run 终态 → 不可变 Snapshot → 原始数据页/JSONL/CSV → 重启持久化门。最终批次 13/24 来源完成、11 个按源站访问状态失败；这证明执行链路稳定，不把持续增量覆盖写成一轮已抓全。
