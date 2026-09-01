# 数据抓取平台开发文档

状态：当前开发入口
更新日期：2026-09-01

## 权威阅读顺序

1. 根目录 `AGENTS.md` 的 Output Priority、授权边界和架构协议
2. `AGENT-SCORECARD.md` 的当前积分与最近记录
3. 根目录 `CONTEXT.md`
4. `ARCHITECTURE.md`
5. `ZOL-CATEGORY-COLLECTION.md`
6. `RESEARCH.md`
7. `ROADMAP.md`
8. `PROGRESS.md`

## 文档职责

| 文档 | 唯一职责 |
| --- | --- |
| `AGENT-SCORECARD.md` | 用户积分反馈与当前积分的追加账本 |
| `CONTEXT.md` | 当前领域语言 |
| `ARCHITECTURE.md` | 模块职责、事实源、依赖方向和通过门 |
| `ZOL-CATEGORY-COLLECTION.md` | ZOL 品牌目录、型号参数和完整图集的来源设计 |
| `ZOL-REFRIGERATOR-CAPTURE-REPORT.md` | 本次正式冰箱抓取的终态、覆盖结果和 Source Dataset 对账 |
| `ZOL-MICROWAVE-CAPTURE-REPORT.md` | 本次正式微波炉抓取的数据完整性、来源关联、资产哈希和来源无图片标识验收 |
| `RESEARCH.md` | 当前采用的技术结论、证据和退出条件 |
| `ROADMAP.md` | 后续阶段顺序和停止门 |
| `PROGRESS.md` | 当前完成度、验证证据、阻塞和下一步 |

## 当前开发入口

当前产品链以 Workbench Chat Timeline 中的采集请求为起点：

```text
采集请求
  -> 品类采访
  -> 采访范围草案确认
  -> Capture Task
  -> Planning Run
  -> Crawl Plan Draft 确认
  -> Prepare / Start
  -> Source Dataset
```

品牌目录执行基础已经在正式 Workbench/API/Graphile Worker 链路完成 20 个型号和 502 张图片的真实验证。当前开发入口是正式门类流程：采访确认“榜单综合评分大于 0、最多 20 个品牌；每批 3 个；每品牌每轮 10 个；每品牌最多 20 个”，Planning Run 核验 ZOL 门类品牌榜和入选品牌目录后生成计划；没有可验证榜单时保持在计划确认门。

运行数据、浏览器状态、代理配置、数据库和原始资产只存在本机；跨电脑接续只依赖已提交并推送的代码与权威文档。
