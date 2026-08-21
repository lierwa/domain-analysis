# Issue 04：真实抓取共享节奏与安全公共网络路径

Status: ready-for-human

## 简单说明

同一份已确认抓取计划已经能从网页创建 Source Run，但最近一次真实运行的 18 个来源全部失败。京东的登录 Profile 和目录页曾经可用，问题是程序把每个京东 source 当成一段全新的访问：Prepare、Start 最终检查、目录、详情和下一 source 没有共享同一个低频时钟。公共来源则被本机代理/TUN 的 fake-IP DNS 映射到 `198.18.0.0/15`，现有 SSRF 检查正确拒绝了这些非公网地址。

本 Issue 只修两个系统性根因：让一次正式计划中的同一京东访问面共享实际导航节奏，并让公共 Provider 在不放松 SSRF 的前提下使用“安全校验与实际连接一致”的成熟 DNS/代理路径。最终必须由负责人在正式 Web 点击 Prepare/Start，得到可用不可变原始快照，并对账页面、API、PostgreSQL 和 Source Dataset。

## 真实失败证据

- confirmed plan：`crawl-plan-c8d3112d-c425-4e7b-8cd5-c62eba8945af` version 1；
- Capture Task：`capture-task-9befc37e-946b-4d65-a615-d362058fe792`；
- 2026-08-20T17:52:30Z 至 17:53:16Z 共 18 个 Source Run，18 个 failed；历史运行保持不变；
- 3 个 `jd.catalog-product` 目录均为 HTTP 200 / `accessible`，详情均进入 `pc-frequent-pro.pf.jd.com/?from=pc_item&reason=403`；
- 同 source 内目录到详情约 12 秒，但前一详情到下一 source 目录只有约 2.8～3.0 秒；
- 15 个 `public.web-resource` 均在约 0.14 秒内因解析到 `198.18.0.x` 被 SSRF 门拒绝，没有 snapshot；
- 用户已在项目专用 `data/jd-cdp-profile` 登录。后续若出现 `login_required`，必须先证明 Profile/Chrome/CDP 复用事实，不得默认要求重新登录。

## 服务的架构基线

- `ROADMAP.md`：1C 单一真实来源闭环、1D 京东访问门、1E 多来源原始数据执行；
- `ARCHITECTURE.md`：Crawl Plan 独占来源/目标/访问策略；Source Execution 编排一次显式运行；Provider 执行冻结计划；Source Dataset 独占运行、target、observation、snapshot/asset；
- 复用 `p-queue`、`cockatiel`、Playwright CDP、Got、Node DNS/net、PostgreSQL/Drizzle 和现有 typed contract；
- 不新增 manager/engine/registry，不复制 Cookie/Profile，不绕过验证码/风控，不关闭 SSRF，不把 `198.18.*` 加白，不增加自动重试。

## Baseline Impact

```text
Baseline Impact:
- touched modules: JD Provider、paced access 生命周期、Source Execution、Raw Source Observation typed contract/测试、RESEARCH/ARCHITECTURE/ADR/PROGRESS/总结报告；公共 Provider 代码保持
- owning fact source: Crawl Plan 拥有来源/策略；Source Execution 编排一次正式计划；Source Dataset 拥有运行/target/observation/snapshot
- public interface changed: yes；SourceProvider 增加可选 execution 生命周期，Raw Source Observation 增加 rate_limited；HTTP 路由/PostgreSQL schema 不变
- new protocol/adapter/fallback: 增加既有 Provider seam 的 plan execution 生命周期；不增加公共 DNS/代理 adapter 或 fallback
- compatibility or legacy path changed: 历史 failed runs 不改写；现有 Provider key/version 尽量保持
- research update required: yes，记录 fake-IP 与受控代理/DNS 方案、原型和退出成本
- architecture or ADR update required: yes；ARCHITECTURE/ADR-0013 记录 Provider execution gate 与逐来源 stopped 审计
- tests and real-surface validation to run: 聚焦回归、全量 test/typecheck/build、用户网页 Prepare/Start、页面/API/PostgreSQL/Source Dataset 对账
```

## Patch Disposition

```text
Patch Disposition:
- delete: 每个 JD source 内新建 gate 的错误生命周期；preflight 绕过 pacing 的导航；把 pc-frequent-pro 归为笼统 access_denied 的错误映射
- keep: p-queue/cockatiel、Playwright CDP、独立 data/jd-cdp-profile、零重试、SSRF 私网/redirect/HTTPS 门、历史运行事实
- rewrite: JD 访问 gate 由单 source 改为同一正式执行会话/访问面共享；公共网络保持现有“校验全部系统解析地址并连接已校验地址”，本次运行显式关闭冲突 TUN
- reason: 当前补丁把访问策略按 source 重置，并让系统解析与本机 fake-IP 代理表面冲突；继续叠 sleep/白名单会制造第二套节奏或降低 SSRF
```

## 调研与最小原型门

1. 现场核对系统 DNS、Node `dns.lookup`、代理/TUN 环境变量和目标域名是否稳定得到 `198.18.0.0/15`；不得读取 Cookie/Profile 内容。
2. 只评估成熟 Node/官方能力：Got 当前代理/lookup seam、Node DNS resolver、Mihomo 官方 controller；记录维护、许可证、Node 24、Windows/Linux、本地秘密、安全与退出成本。
3. 在仓库临时目录或现有测试 seam 做最小原型：安全解析必须得到真实公网地址；实际 TLS 请求必须走对应受控网络路径；redirect、私网、loopback、fake-IP 直连、非 HTTPS、零重试和字节上限继续失败关闭。
4. 若无法证明安全校验地址与实际连接路径一致，停止公共来源实现，不以白名单或禁用 SSRF 跑通。

## 最小实现目标

### 京东

- 一次 Prepare/Start 执行中的 JD preflight、目录、详情及跨 source 切换共享同一访问面 gate；所有真实 `page.goto` 都进入该 gate；
- gate 的所有权和关闭时机与一次正式执行会话一致，不在每个 `collect()` 内重建，不叠加第二套 timer；
- `rate_limited`、`verification_required`、`login_required`、`access_denied` 等现有 typed stop 触发后，停止本次计划剩余 JD source，不继续连打；
- `pc-frequent-pro` / HTTP 429 使用已有 `rate_limited` vocabulary；403 仍按页面事实分类；
- Prepare 优先复用既有 9222/`data/jd-cdp-profile`；只有页面事实证明登录失效才返回人工登录动作。

### 公共来源

- SSRF 仍拒绝 loopback、link-local、private、multicast、documentation、reserved、非 443、凭证 URL、redirect 和 Unix socket；
- 公网 DNS 校验与 Got 实际连接使用同一可解释的成熟网络路径；不得把 `198.18.0.0/15` 当公网或加入例外；
- 继续精确 URL/一次同源唯一链接、robots、零重试、最大字节和安全响应头边界。

## 自动化与真实验收

1. 测试证明 JD preflight/目录/详情/下一 source 共享顺序，实际开始间隔和每分钟预算成立；第一处访问限制后剩余 JD source 不再导航；
2. 测试证明已有 Profile/连接可用时 Prepare 直接 ready，登录失效才 action_required；
3. 公共网络验证覆盖 fake-IP 冲突关闭前后的系统解析、私网/redirect/零重试/字节上限和 DNS rebinding 边界；
4. 运行聚焦测试、`npm test`、`npm run typecheck`、`npm run build`、`git diff --check`；
5. 负责人在正式 Web 对同一 confirmed plan 点击 Prepare/Start；不得用内部 API 或 Codex 代替该点击；
6. 页面、正式 API、PostgreSQL 与 Source Dataset/导出对同一 run、target、observation、snapshot/asset 逐项一致；公共可访问来源产生 raw snapshot；京东至少目录与一个真实详情成功；
7. 未达到真实门时不得把 Goal 标成 complete，也不得用测试结论覆盖真实失败。

## 交付门

- 更新 `RESEARCH.md`、`PROGRESS.md` 与一份面向次日审阅的总结报告；
- 按用户本轮明确授权提交并推送全部本轮代码/文档，验证本地与远程 SHA 一致；
- 推送和报告完成后关闭开发服务、项目 Chrome/PostgreSQL，并执行系统关机。

## Comments

### 2026-08-21

Issue 根据正式 Web 真实运行的 18/18 同因失败建立。当前只完成只读基线与根因归属；尚未修改 Provider、网络或数据事实。

用户明确允许本次关闭代理软件 TUN。Mihomo 官方本地 controller 已把运行时 `tun.enable` 从 true 切到 false；虚拟 `198.18.*` 路由消失，Node 对 NIST/海尔/SAMR 恢复真实 A/AAAA，NIST HTTPS 为 200 且 TLS authorized。公共 Provider、SSRF BlockList、redirect/HTTPS/零重试约束均未修改；临时 DoH `--no-save` 原型不进入 package/lockfile。

JD 最小实现已完成：Source Execution 按 confirmed plan identity/version 建立 Provider execution；JD 的 Prepare、Start preflight、目录、详情和跨 source 共用一个 gate；访问面受限后同 Provider 后续来源只写 stopped 审计，其他 Provider 继续；`pc-frequent-pro`/429 记录为 `rate_limited`。定向 4 files / 13 tests 与六 workspace typecheck 已通过；全量 build/test 和真实 Web 验收待执行。

全量自动化随后通过：32 files / 124 tests passed、1 个既有 realtime acceptance skipped；六 workspace typecheck 与 build 通过，package/lockfile 无变化。正式 Web 已启动并连续三轮等待，但日志只有任务/plan/source-runs GET，没有用户 Prepare/Start POST；API 与 PostgreSQL 均为历史 54 条 run，latest `2026-08-20T17:53:16.251Z`。因此真实快照验收分类为 blocked/untested，Issue 转 `ready-for-human`；不得把自动化写成真实成功。
