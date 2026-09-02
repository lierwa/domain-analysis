# Source Dataset 指标语义清晰化

Status: ready-for-agent
Priority: P1
Implementation: not started

## 问题

- `7/3 条` 实际是“已接受 7 条／最低 3 条”，容易被理解为完成量／总量。
- `唯一问题 66` 混合当前问题、历史已恢复问题和访问限制，不等于当前失败型号数。
- `Run 38` 是尝试数，不是不同来源数。
- `Run completed` 与 `Batch partial` 缺少直接解释。

## 验收

- 覆盖显示为“已接受 N 条（最低 M 条），来自 X 个网站（最低 Y 个）”。
- 当前未完成型号、当前未解决问题和历史审计问题分开展示。
- Run 尝试数明确标注为执行尝试。
- Run 终态与 Batch/coverage 验收状态分层展示，不修改领域事实源。

## Comments

- 2026-09-02：当前计算顺序正确，问题属于投影命名和用户解释，不得在 Web 重新计算计数。
