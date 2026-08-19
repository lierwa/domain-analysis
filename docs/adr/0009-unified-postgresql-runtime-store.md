---
status: amended by ADR-0015
date: 2026-08-14
supersedes: 0008-separate-workbench-and-orchestrator-stores
---

# Workbench 与 DBOS 共用一个 PostgreSQL 运行数据库

> 2026-08-18：Workbench 使用 PostgreSQL 的决定继续有效；DBOS 工作流已退出当前生产组合根，旧 DBOS schema 只作为本机历史结构保留，不得按本 ADR 恢复运行链。

Workbench 的可变业务状态与 DBOS 执行历史使用同一个 PostgreSQL 服务和数据库。Workbench 表由 `workbench` schema 独占，DBOS 系统表由 `domain_analysis_pipeline` schema 独占；应用统一从 `POSTGRES_DATABASE_URL` 取得连接地址。

## 调查与实证

- DBOS 4.25.14 已通过暂停、恢复、人工消息、取消、同 ID 幂等、自动重试、失败阶段分叉和进程强杀恢复，继续保留 ADR-0007。
- R-020 验证的 Resonate 虽能使用 SQLite，但没有通过取消清理、失败步骤分叉和 typed 运行视图等价门；补齐这些缺口会变成自研工作流基础设施，因此拒绝替换 DBOS。
- PostgreSQL 官方把 schema 定义为同一数据库内隔离对象名称和权限的机制；DBOS 官方也提供独立系统 schema 配置。Workbench 与 DBOS 没有跨 schema 事务或互写需求。
- Drizzle ORM 0.45.2、Kit 0.31.7 与当前 MIT `pg` 8.23.0 在 PostgreSQL 14.22 生成并重复执行 4 表 migration；JSONB、外键、事务回滚和时区归一化通过。
- 正式 adapter 在一个临时数据库完成 20 个测试文件、82 项测试；Workbench migration 表和 4 张业务表保持在 `workbench`，DBOS 测试系统表保持在独立 schema，强杀恢复通过。

## 后果

- 新产品运行状态只使用 PostgreSQL，不再创建 `product-knowledge-workbench.sqlite`；Product Module 的 `list / saveDraft / confirm / get` interface 不变，变化只位于 Drizzle schema、client、migration 和生命周期 adapter。
- Workbench 和 DBOS 只能通过稳定业务 ID 或 workflow ID 关联，禁止跨 schema 读取内部表、复制执行历史或增加双写。
- 旧 `domain-analysis.sqlite` 只服务准备退出的 Social Intelligence 兼容入口，不迁移其当前 9 张旧表，也不向其中增加新产品状态。
- 已发布知识包继续使用 ADR-0006 的独立 SQLite＋FTS5 单文件。它是可复制的只读交付物，不属于运行数据库，不能为了技术名称统一塞入 PostgreSQL。
- PostgreSQL 成为本地运行前提；真实持久化测试只在设置 `POSTGRES_DATABASE_URL` 时执行，未设置时普通单元测试仍可运行。
- 原 SQLite migration 作为已执行历史保留但不再加载；新的 PostgreSQL migration 使用独立目录，避免伪造跨方言 migration 历史。
