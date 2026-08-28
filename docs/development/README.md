# 数据抓取平台开发文档

状态：当前开发入口
更新日期：2026-08-28

## 权威阅读顺序

1. 根目录 `AGENTS.md`
2. 根目录 `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `ZOL-CATEGORY-COLLECTION.md`
5. `RESEARCH.md`
6. `ROADMAP.md`
7. `PROGRESS.md`

## 文档职责

| 文档 | 唯一职责 |
| --- | --- |
| `CONTEXT.md` | 产品目标、阶段边界和领域术语 |
| `ARCHITECTURE.md` | 模块职责、事实源、依赖方向和访问边界 |
| `ZOL-CATEGORY-COLLECTION.md` | ZOL 门类到品牌、型号、参数的技术设计与验证门 |
| `RESEARCH.md` | 外部调研、候选方案、采用结论和退出条件 |
| `ROADMAP.md` | 开发验证的阶段顺序和停止门 |
| `PROGRESS.md` | 当前完成度、证据、阻塞和下一步 |

## 当前开发入口

当前只开发和验证 ZOL 单来源链路：门类品牌发现、品牌优先级、第一优先级品牌的型号与参数捕获，以及同源控频下的多品牌调度。

实现从 `PROGRESS.md` 的下一步开始。任何真实批量抓取都必须先通过 `ZOL-CATEGORY-COLLECTION.md` 定义的 V0 与 V1 验证门。
