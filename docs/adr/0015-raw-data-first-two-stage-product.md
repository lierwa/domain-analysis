---
status: accepted
date: 2026-08-18
amended: 2026-08-19
supersedes_product_scope: ADR-0001, ADR-0002, ADR-0006, ADR-0007, ADR-0010, ADR-0011, ADR-0013, ADR-0014
---

# 先完成标准商品原始数据抓取，再设计数据清洗

项目只保留“数据抓取、数据清洗”两个阶段。阶段 1 从专业采访形成 Capture Task，按确认后的 Crawl Plan 从多个真实来源保存不可变原始数据；阶段 2 只能消费这些原始数据，待阶段 1 全部验收后另行设计。旧 Evidence、Knowledge Factory、Market Universe、DBOS 知识流水线、知识包和 Runtime 已退出当前生产组合根，不得因历史 ADR 曾为 accepted 而恢复。

这一决定保留 PostgreSQL/Drizzle、Fastify、assistant-ui、Codex App Server、Crawlee、p-queue 和 cockatiel 等仍服务当前职责的成熟资产；旧 ADR 中关于访问授权、隐私、不可伪造完成证据和原始观察不覆盖的安全约束仍可作为历史依据，但其旧产品对象、流程和完成状态不再有效。
