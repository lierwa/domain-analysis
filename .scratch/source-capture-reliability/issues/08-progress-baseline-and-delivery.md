# 当前进度基线与 Git 交付一致

Status: ready-for-agent
Priority: P1
Implementation: active

## 问题

`PROGRESS.md` 仍以历史成功微波炉 Batch 作为当前入口，同时只记录新 Batch 的运行中观测，没有记录其 `partial` 终态。当前八个代码/测试/文档文件存在未提交修改，`HEAD` 与 upstream 仍为 `786668410284a52109b70139227558eb17c39ffd`。

## 验收

- 保留历史成功 Batch 的真实证据，同时把新 Windows 复验标记为当前可靠性回归。
- `PROGRESS.md` 只记录当前完成度、阻塞和下一步；任务顺序继续由 `ROADMAP.md` 拥有。
- 每个 issue 的实现、测试、真实表面验证和交付状态可独立核对。
- 未提交/未推送时明确写为本机状态；只有本地、upstream 和 origin SHA 一致后才能形成跨电脑接续点。

## Comments

- 2026-09-02：本问题库创建后，当前开发入口以本 PRD 和这些 issue 为准，不再依赖聊天摘要。
