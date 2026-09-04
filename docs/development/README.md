# 数据抓取平台开发文档

状态：当前开发入口
更新日期：2026-09-04

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
| `MICROWAVE-REAL-CAPTURE-REPORT.md` | 2026-09-02 微波炉真实可靠性 Batch 的终态、覆盖语义和后续收口依据 |
| `RESEARCH.md` | 当前采用的技术结论、证据和退出条件 |
| `ROADMAP.md` | 后续阶段顺序和停止门 |
| `PROGRESS.md` | 当前完成度、验证证据、阻塞和下一步 |
| [产线建设 PRD](../../.scratch/knowledge-processing/PRD.md) | 阶段 2 已确认需求、设计假设、界面操作行为与工程交付要求 |
| `KNOWLEDGE-PACK-PROCESSING.md` | 知识产线各工序的输入、输出、自动/人工边界和合格条件 |
| `KNOWLEDGE-PACK-SAMPLE-INPUT.md` | 固定小样的来源清单与输入核对依据 |
| `KNOWLEDGE-PACK-SAMPLE-REPORT.md` | 固定文字包的消费实验、结果与适用边界 |
| `OCR-SAMPLE-REPORT.md` | 本机 OCR 模型、环境、性能与复核材料 |

## 阶段 2 建设产线入口

完成上述权威阅读顺序后，阅读产线建设 PRD 与工序规范；技术调查见 RESEARCH R-014～R-019，标准成品决定见 [ADR-002](../adr/002-agent-skill-package.md)，审核分流决定见 [ADR-003](../adr/003-knowledge-review-routing.md)，样包报告只作为其声明范围内的验证证据。建设顺序与通过门只维护在 ROADMAP 的“建设产线的实施顺序与通过门”，当前状态、正式版本和验收哈希见 PROGRESS 顶部。隔离原型复跑入口见 [原型说明](../../.scratch/knowledge-processing/prototype/README.md)，正式系统责任与交互结果见 PRD 的“系统接入方案”。

本项目已按完整采集批次贯通知识包的选料、加工、自动内容/OCR/图片判断、人工冲突审核、版本、发布与标准 Agent Skill 导出；正式本机 v4 已验证 `automatic-review-2`、图片副本视觉验收、来源追踪、查询脚本和历史版本保留。下一步按建设 D 使用新的完成且带图片批次扩量验证模型质量、图片抽检、token/机器成本及 Linux/Windows 环境；阶段 1 P1 的目录 coverage 终态语义保持当前规则，待集中确认。Agent 宿主接入继续属于后续跨工程工作。

## 阶段 1 采集入口

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
