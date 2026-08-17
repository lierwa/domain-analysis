# R-033 权威技术、监管与权限等待正式 Planner 纵切片

本 POC 不是旁路抓取脚本。它使用正式的 Category Interview → confirmed brief → Product Project → Source Collection Planner → DBOS → Provider Router → Source Dataset 链路，在隔离 PostgreSQL 数据库中验证 NIST、USDA、中国能效标识三条可执行来源，以及美的说明书的权限等待门。

通过门：

- Planner 只从 confirmed brief 生成工作项；调用方不能提供 URL/workItems；
- NIST/USDA 使用同一个 `readable-technical-source` Provider；能效备案使用薄 `energy-label-record` Provider；两者都不含冰箱字段规则；
- 每条 SourceSnapshot 保存 URL、时间、HTTP 状态、内容 hash、targetKeys 和 knowledgeNeedIds；
- NIST/USDA 为 `document`，能效备案为保留官方 JSON 原文的 `ordered_record`；
- 美的说明书因公开条款禁止未经书面许可的爬虫/下载，Planner 必须输出 `waiting / local_read_not_allowed` 且不产生来源运行；
- 断言每个来源只绑定 brief 显式分配的 Knowledge Need，禁止同 lane 扩大绑定；
- 输出只含运行/哈希摘要，不复制正文；隔离数据库和临时 Evidence 目录在验收后整体删除。

运行：

```bash
POSTGRES_DATABASE_URL=postgresql://127.0.0.1:5432/<temporary-db> \
  node --import tsx docs/development/pocs/r033/run-real-source-plan.ts
```
