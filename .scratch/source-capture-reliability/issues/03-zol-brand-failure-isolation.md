# ZOL 品牌目录局部失败隔离

Status: ready-for-human
Priority: P0
Implementation: local implementation validated; real acceptance belongs to issue 04

## 问题

Panasonic 与 Jiayishi 品牌目录的单次普通 404 曾分别结束整个 ZOL Source Run，造成两次人工 Resume。品牌目录是独立采集单元，普通不存在不能升级为整个来源的结构错误。

## 采用方案

品牌目录普通 404 保存 `not_found` 观察，保留该品牌此前已发现的型号并进入后续品牌；401、403、429、身份/结构无法绑定、预算和取消仍保留 Run 级停止。

## 验收

- 第一个品牌目录 404 后，第二个品牌仍执行。
- 分页后续页 404 时保留已发现型号。
- 访问限制和结构错误仍停止 Run。
- 请求、Snapshot、品牌 Work Item 和 Run 终态可对账。

## Comments

- 2026-09-02：工作区已有局部隔离补丁和测试，尚未形成 Git 交付。
- 2026-09-02：Provider 测试确认首个品牌持续 404 只产生两次 Request Attempt，保存 `not_found` 后继续第二品牌并完成其两个型号；结构绑定和访问限制停止门保持原行为。ZOL 聚焦 13/13、全量 226/226 通过。
