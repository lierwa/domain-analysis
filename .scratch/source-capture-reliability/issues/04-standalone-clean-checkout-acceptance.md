# Windows 干净 checkout 无人值守验收

Status: ready-for-agent
Priority: P0
Implementation: delivery authorized; clean Windows acceptance pending

## 目标

证明系统而不是 Codex 完成执行：在包含全部 P0 修复的干净 checkout 上启动 API/Worker，由负责人确认已有 Crawl Plan 并执行一次 Start；此后不修改代码、不手工逐条干预，系统自行进入可解释终态。

## 验收

- Git checkout、依赖、`.env`/`.env.local` 本地边界和数据库连接可重复建立。
- Start/Resume 由正式 PostgreSQL Background Command Queue 消费。
- 允许既有安全条件下的自动 Resume；不允许运行期间补代码后再次手工 Resume 冒充通过。
- 全部 Run、Target、Work Item、Request Attempt 终态。
- 覆盖通过，或以真实访问限制/来源穷尽形成明确 gap；不得保留可访问页面的假 404。
- 权威文档记录 Batch/Run ID、数量、测试和 Git SHA。

## Delivery gate

未经负责人明确授权不得提交或推送；在远程 SHA 一致前只能标记“本机实现”，不能声明跨电脑可继续。

## Comments

- 2026-09-02：本次 Batch 依赖运行期代码修改和两次人工 Resume，只能作为失败证据，不能作为本验收的通过证据。
- 2026-09-02：P0-01/02/03 已通过 226 项全量测试、六 workspace 类型检查和生产构建。当前修改尚未提交，不能建立包含这些修复的干净 checkout；需负责人授权本次明确路径的 Git 交付后再启动新 Batch。
- 2026-09-02：负责人已授权提交并推送当前审计范围到 `origin/master`，随后直接启动新 Batch，并每 10 分钟检查一次进度。
