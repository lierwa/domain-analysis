---
status: superseded
date: 2026-08-14
superseded_by: 0009-unified-postgresql-runtime-store
---

# Workbench 业务库保留 SQLite，DBOS 独占 PostgreSQL 执行库

阶段 2 的 Workbench 业务对象继续使用 Drizzle＋SQLite/libSQL；DBOS 使用自己的 PostgreSQL 系统库保存工作流执行历史。两个存储由 Pipeline adapter 隔离，不复制 DBOS 步骤日志，也不做跨库双写。

## 调查与实证

- 当前所有 repository、API 和 52 项测试都建立在 Drizzle SQLite 上。为统一数据库改写 PostgreSQL dialect、driver、测试和旧 repository，范围远大于阶段 2 的产品骨架。
- DBOS 必须使用 PostgreSQL，但其 SDK 已提供 workflowID、输入、事件、消息、步骤、状态和历史查询；Workbench 没有必要复制一套执行事实。
- R-018 证明 patched Drizzle ORM/Kit/libSQL 可以继续沿用，空库重复 migration 和失败回滚通过；根工程升级后 test/typecheck/build 无回归。
- 旧手写 DDL 库无法直接接收首份 Drizzle migration。项目已确认旧 Social Intelligence 不是兼容目标，但其本地文件仍不得被破坏或伪造 baseline。

## 后果

- 新 Product Knowledge Workbench 使用新的 SQLite 文件路径和正式 migration；旧 `domain-analysis.sqlite` 保留，不清空、不覆盖、不自动 repair。
- `schema.ts` 是业务库结构的唯一事实源；新 Schema 落地时删除新启动链对手写 DDL 的依赖。旧启动链在切换前保持可运行，但禁止再向手写 DDL 添加新产品表。
- Pipeline 运行的权威状态从 DBOS adapter 查询；SQLite 只保存项目、范围、来源、审核、评测和包等业务事实。需要关联时使用由冻结输入确定的 workflowID，不复制内部 step 行。
- 创建业务对象和启动 workflow 不能假装成跨库事务；adapter 使用确定性 workflowID 和 DBOS 幂等启动重试来收敛中断，不自建分布式事务或 outbox 基础设施。
- 只有真实部署证明两种存储不可接受，才重新调研把业务库迁入 PostgreSQL；不能为了表面“只有一个数据库”提前扩大重构。
