---
status: accepted
date: 2026-08-20
---

# 可执行 Crawl Plan 与前台 Source Run

## 简单说明

计划不再只是说明文字。每个来源必须指向仓库里真实存在的 Provider，并冻结入口、品类筛选、请求预算、频率、停止条件和原始输出。用户确认计划后，系统先准备项目专用浏览器并检查端口与登录；准备不创建抓取记录，完成后才允许点击“开始抓取”。最终得到可查看、可导出的 Source Run、对象和不可变快照。登录、验证码、拒绝或风控会如实要求人工处理或停止，不会绕过。

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

## 2026-08-21 修订：Provider execution 共享访问面

Prepare 与 Start 不再各自绕过频控访问站点，也不在每个 source 的 `collect()` 中重建 gate。Source Execution 用 confirmed plan identity/version 建立一次 Provider execution；JD Provider 在该生命周期内让 Prepare、最终 preflight、目录、详情和全部同 Provider source 共用现有 `p-queue`/`cockatiel` gate。来源计划窗口只合计为整个 execution 的最长寿命，每分钟预算和最小间隔保持原计划值。登录、验证、拒绝或 `rate_limited` 后不再导航同 Provider 的剩余来源，但为每个剩余 source/target 写入 `stopped` 审计；其他 Provider 不受牵连。`rate_limited` 加入 Raw Source Observation typed vocabulary，历史 `access_denied` 记录不改写。
