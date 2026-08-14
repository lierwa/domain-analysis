---
status: accepted
date: 2026-08-14
---

# MVP 可恢复流水线采用 DBOS Transact

MVP 的 Pipeline adapter 使用开源 `@dbos-inc/dbos-sdk`（MIT）承载持久工作流、步骤重试、人工消息、取消、恢复和运行历史，系统存储使用 PostgreSQL。领域 module 只依赖自己的 Pipeline port 和 typed 状态，不直接依赖 DBOS 类型或系统表。

## 调查与对照

- 现有 `p-queue + setInterval` 只保存进程内任务，进程退出后不能恢复，继续扩展会变成自研工作流引擎，拒绝。
- Restate Server 的 BSL 1.1 许可证正文明确不是 Open Source；Inngest Server 为 SSPL，均不满足项目开源优先硬约束。
- Hatchet 为 MIT，但需要独立 Engine、PostgreSQL 和 Worker；Trigger.dev 自托管还需要 Webapp、Redis、PostgreSQL 和 Worker；Kestra 需要独立 Java 平台。它们对当前 TypeScript 模块化单体增加更多运行部件。
- Temporal Server 与 TypeScript SDK 均为 MIT，R-017 实测在服务和 Worker 都重启后可从 SQLite 文件恢复。但本轮 `@temporalio/*` 安装约 170 MB，开发服务二进制约 128 MB；单文件 `start-dev` 官方明确不是生产入口。
- DBOS 4.25.14 的 scope 安装约 2.2 MB，直接嵌入 Node，但要求 PostgreSQL。R-017 强制终止首个 Node 进程后，第二个进程从等待审核处恢复；采集步骤未重做，批准后只执行打包。另一组实测同时通过同 ID 幂等、三次步骤重试、取消、恢复和恰好一次人工消息。

## 后果

- 不新增自研队列、事件日志、锁、重放、信号、调度器或恢复器；这些能力直接使用 DBOS API。
- PostgreSQL 是新增运行前提。DBOS 系统表是执行历史事实源；Workbench 不复制其内部表，不把 DBOS 状态枚举泄漏到领域或 Web contract。
- Workbench 业务控制库是否继续 SQLite，或在后续迁到同一 PostgreSQL，必须由 R-004 隔离 migration 原型决定；本 ADR 不授权双写或数据库迁移。
- `workflowID` 由冻结输入身份确定并作为幂等键；网页采集、Codex、文件提交等副作用仍必须按各自业务键保证重试安全，因为 DBOS step 的执行保证是至少一次。
- DBOS adapter 必须把取消、等待、失败和恢复投影为 Pipeline module 的 typed 状态；应用层不得查询 DBOS 系统表推导业务状态。
- 如果 PostgreSQL 部署成本或 DBOS 版本升级/恢复原型失败，重新打开本决定；不得退回扩展 `p-queue`。
