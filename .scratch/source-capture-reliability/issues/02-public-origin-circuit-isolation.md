# 公开来源按 origin 隔离访问熔断

Status: ready-for-human
Priority: P0
Implementation: local implementation validated; real acceptance belongs to issue 04

## 问题

NDRC 来源进入 `access_denied` 后，持久 gate 曾把整个 `public.web-resource` Provider 打开熔断，随后 15 个不同来源在几十毫秒内以 0 Snapshot 失败。一个网站的限制污染了无关 origin。

## 采用方案

- `public.web-resource` 只打开当前 origin gate。
- ZOL 页面与图片仍按既有 Provider 身份共享站点级限制。
- 人工 Resume 公开来源时只解除前序 Run 实际请求过的 gate，不清除其他网站的真实限制。

## 验收

- origin A 的 403 不阻止 origin B。
- 同 origin 后续请求仍被持久 gate 阻止。
- Resume 不清除未属于前序 Run 的 gate。
- 真实结果保持 NDRC、北交大受限，其余 18/20 来源完成。

## Comments

- 2026-09-02：工作区已有最小补丁，必须先审计测试与 Resume 作用域，再标记完成。
- 2026-09-02：PostgreSQL 集成测试确认 origin A 的 403 不阻止 origin B；同 origin 保持开路；公开来源 Resume 只关闭前序 Run 实际请求过的 gate，不清除无关 origin 的真实限制。聚焦 4/4、全量 226/226 通过。
