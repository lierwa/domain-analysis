# Issue 04：多来源正式抓取不得被单一 Provider 运行准备全局阻断

Status: ready-for-agent

## 简单说明

冰箱 Crawl Plan v6 同时包含京东、品牌官网、标准、监管和技术资料。当前京东需要扫码登录时，系统在创建任何 Source Run 前直接返回 422，导致其余公开来源也完全不运行。

本 Issue 将运行态失败限制在对应 Provider：京东仍停止并如实记录，不绕过登录；其他 Provider 继续执行。计划或 Provider 的结构错误仍在任何运行前失败。最终用户能从同一次 Start 看到哪些来源失败、哪些来源完成，而不是因为一个登录门得到零条运行事实。

## 真实证据

- Capture Task：`capture-task-f6aaf4e8-41d4-43f5-bbb5-6f0764b119c5`，revision 2；
- confirmed Crawl Plan：`crawl-plan-e81605a8-6749-46ae-9a13-9eeac38bdcfd`，version 6；
- 清单：8 sources、12 targets，其中 1 个 `jd.catalog-product`、7 个 `public.web-resource`；
- 2026-08-21 正式 Prepare：`action_required/login_required`；
- 随后正式 Start：HTTP 422 `preflight_failed`；
- Source Run 对账：0。

## Baseline Impact

```text
Baseline Impact:
- touched modules: Source Execution、Source Dataset 运行编排、Crawl Plan Web 启动门、聚焦测试、ADR/ARCHITECTURE/PROGRESS
- owning fact source: Crawl Plan 继续拥有执行范围；Source Dataset 继续拥有每个 source 的 run/target/snapshot 事实
- public interface changed: no；沿用现有 Prepare 响应和 SourceRunEvent SSE contract
- new protocol/adapter/fallback: no；不新增 Provider、重试、队列或 fallback
- compatibility or legacy path changed: 历史 run/snapshot 不改写；结构错误仍全局失败
- research update required: no；沿用 R-036/R-037 已接受组件与边界
- architecture or ADR update required: yes；澄清运行态 preflight 按 Provider 隔离，失败来源形成 failed run，其他来源继续
- tests and real-surface validation: SourceExecution 红灯、Web 启动门红灯、聚焦/全量 test/typecheck/build、同一 v6 正式 Start 与 Source Dataset/API 对账
```

## Patch Disposition

```text
Patch Disposition:
- delete: 任一运行态 preflight 失败就让整份计划零 run 的全局门；多来源 action_required 绝对隐藏 Start 的 UI 语义
- keep: confirmed plan/revision 重读、全部来源结构校验、Provider 会话级去重、登录/验证不绕过、不可变历史
- rewrite: runtime preflight 按 Provider 隔离；失败来源记 failed run；其他 Provider 继续；Web 允许启动未受该 Provider 阻断的来源
- reason: 单一外部来源的会话状态不能取消同一计划中彼此独立的公开来源
```

## 验收门

1. 一条 blocked JD source 加一条可执行公共 source：JD 不调用 collect，形成 failed run；公共 source 仍进入 collect。
2. 同一 blocked Provider 的多个 source 不重复 preflight，但各自有可对账 failed run。
3. Provider 缺失、版本错误、配置错误或 execution blocker 仍在创建任何 run 前返回 typed HTTP 错误。
4. 多 Provider 计划出现 `action_required` 时页面显示“开始其余来源”；只有同一受限 Provider 时仍要求先完成人工动作。
5. 正式冰箱 v6 重跑后，Source Run 不再为 0；逐项报告 completed/failed/stopped、snapshot/asset 和导出结果。
