# Provider 接口规范（历史资料）

状态：已退出当前产品规范
退出日期：2026-08-18

本文件原先服务于“证据驱动知识生产平台”的 Provider 设计，其中 EvidenceRequest、EvidenceItem、知识加工和知识包等前提已经退出当前生产组合根。原内容保留在 Git 历史中，不得继续作为实现依据。

当前产品只实施“数据抓取、数据清洗”两阶段，且当前停在 Roadmap 1A。新的 Provider 产品规范只能在用户人工验收抓取任务采访后，根据一个已确认 Capture Task 和一个真实来源的 Crawl Plan 调研重新形成。

重新设计时至少必须遵守：

- Provider 只执行冻结的来源计划，不决定抓取范围；
- 京东、淘宝、品牌官网和监管来源可以采用不同 adapter，但写入同一 Source Dataset；
- 访问状态、登录、验证码、许可、频控和风控必须 typed 且失败关闭；
- 不自研浏览器、队列、重试、熔断或逐站通用 DOM projector；
- 计划确认前不运行真实批量访问。

当前权威边界见 `01-产品需求文档-PRD.md`、`02-总体技术方案.md`、`05-MVP实施计划.md` 和 `docs/development/ARCHITECTURE.md`。
