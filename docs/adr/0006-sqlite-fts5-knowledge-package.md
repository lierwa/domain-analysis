---
status: superseded by ADR-0015
date: 2026-08-14
---

# MVP 知识包采用 SQLite＋FTS5 单文件

MVP 把已审核知识、关系、证据和全文索引构建为一个不可变 SQLite 文件，使用 SQLite 官方 FTS5 trigram tokenizer 支持中文、型号和短别名检索。Runtime 只读打开知识包，通过包哈希校验和原子版本指针完成激活与回滚；查询过程不依赖 Workbench 数据库、网络、模型、向量数据库或 embedding。

## 调查与对照

- SQLite 官方明确数据库可由一个跨平台文件组成；FTS5 内建全文索引、短语和 trigram tokenizer。
- DuckDB 自带 FTS 需要安装扩展，官方说明首次使用会从扩展仓库下载，不满足首次离线启动门。
- DuckDB＋Orama 不需要 DuckDB FTS，但形成结构化库和搜索索引两个产物；Orama 3.1.18 官方持久化插件实测恢复后丢失 Mandarin tokenizer，核心官方 `save/load` 可绕开该问题，但仍需维护双产物一致性。
- R-015 用同一组 9 项冻结查询和 1000 商品/2000 claim 放大 fixture 对照。两者均通过语义门；SQLite 产物 1.77 MB、查询 4.85 ms，DuckDB＋Orama 产物 4.60 MB、查询 25.29 ms。该单机数据只作方向性证据，选型的首要原因是一份事实和一个索引文件的较小一致性成本。

## 后果

- 知识包物理 Schema、FTS 表和 Node binding 留在 Runtime/Package adapter 内，不泄漏到领域 interface；Workbench 控制库的 Drizzle 迁移是另一项独立决策。
- 包文件构建完成后改为只读；Runtime 连接同时启用 `query_only`。新包先校验哈希和冻结查询，再原子替换指针；旧包保持不变以便回滚。
- 全文查询默认返回前 10 条；精确查询、结构化筛选、关系与证据查询继续走普通 SQLite 表和索引，不把 FTS 当作事实源。
- 不引入 DuckDB、Orama、向量数据库或自研 tokenizer。只有后续真实能力问题证明 SQLite FTS5 不足时，才重新调研可选检索 adapter 并建立新 ADR。
- 版本身份只由规范化知识内容、证据投影和物理 schema 决定，不包含构建时钟；相同输入重复构建必须复用同一版本哈希和已有 manifest。
- 证据许可逐条执行：允许再分发的最小证据可携带内容；受限或未知再分发的证据只携带 locator、hash 和审计元数据。
- 2026-08-17 R-034 已用电视第二品类复核：相同内容重复构建哈希一致，复制单文件后在无 PostgreSQL、浏览器和模型条件下完成精确、全文、关系和证据查询；未修改物理 Schema、通用查询 interface 或流程分支。第二品类最小迁移门通过；完整多品类/多站点验收仍按 ROADMAP 继续。
