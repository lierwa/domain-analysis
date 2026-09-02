# ZOL HTML 一次有界 404 复核

Status: ready-for-human
Priority: P0
Implementation: local implementation validated; real acceptance belongs to issue 04

## 问题

真实 ZOL Run 把多个型号参数页、图集页或大图页保存为 HTTP 404；同一 Windows 主机随后经正式 HTTPS 代理路径复核，`100191` 参数页、`1228247` 参数页和 `1265066` 图集页均返回 200。当前公共请求重试只处理传输错误和 502/503/504，404 直接返回 Provider 并结束当前型号。

## 根因边界

- URL 分片公式不是本次已确认根因；失败记录中的 exact URL 随后可原样返回 200。
- HTTP 404 对一般公开来源仍默认为终态；只有 ZOL adapter 已由真实证据证明存在同 URL 的偶发 404。
- 必须复用现有 `p-retry`、Source Access Gate 和 Request Attempt，不新增第二套重试状态机。

## 采用方案

为 `requestPublicResourcePersistently` 增加调用方显式选择的 `retryNotFoundOnce`，只由 ZOL HTML 页面请求启用。第一次 404 结束并保存该次 Request Attempt，然后按现有最小间隔再请求一次；第二次仍为 404 时把最终响应返回 Provider，由 Provider 保存 `not_found` Snapshot 并隔离当前品牌或型号。

图片 Asset 请求不启用该策略；401、403、429、robots、计划外跳转、预算、取消与运行时限保持原行为。

## 验收

- ZOL HTML `404 -> 200`：两次 Request Attempt，最终保存 accepted Snapshot，型号可继续。
- ZOL HTML `404 -> 404`：只请求两次，最终保存 `not_found` Snapshot，隔离当前工作项并继续后续范围。
- `403`：不执行 404 复核，保持访问限制停止门。
- 每次请求重新进入 gate；不能突破 request budget 或取消信号。
- `public.web-resource` 的 404 行为不改变。

## Evidence

- Batch `source-batch-0d9674f0-f8b0-42d8-b851-f6474859c2e5`
- 问题样本：`https://detail.zol.com.cn/101/100191/param.shtml`
- 问题样本：`https://detail.zol.com.cn/1229/1228247/param.shtml`
- 问题样本：`https://detail.zol.com.cn/1266/1265066/pic.shtml`

## Comments

- 2026-09-02：三个样本使用 `DomainAnalysisBot/0.1` 经直连与正式代理路径复核均为 HTTP 200，确认需要来源特有的有界复核，而不是修改搜索方向。
- 2026-09-02：`publicResourceRetry.test.ts` 覆盖 `404 -> 200`、`404 -> 404`、通用来源不启用、403、预算和取消；ZOL Provider 测试确认持续 404 产生两次 Request Attempt 后保留 `not_found`。聚焦 19/19、全量 226/226 通过，等待 issue 04 的 Windows 真实运行验收。
