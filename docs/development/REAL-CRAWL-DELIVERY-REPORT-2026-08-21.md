# 真实抓取系统故障修复交付报告（2026-08-21）

> 状态：代码修复与自动化门已完成；正式 Web 验收未发生，分类为 blocked/untested。本报告只把已有证据写成结论，不用测试或原型冒充真实抓取成功。

## 明早先看这里

2026-08-20 的同一 confirmed plan 创建了 18 个失败来源运行：3 个京东来源因 Prepare、Start preflight、目录、详情和跨 source 各自重置低频节奏，在详情页进入 `pc-frequent-pro`；15 个公共来源因本机 Mihomo TUN 把系统 DNS 映射到 `198.18.0.x`，被现有 SSRF 正确拒绝。

本轮已经完成两个系统性处置：

1. 京东所有真实 `page.goto` 现在由一次 confirmed plan 的同一个 Provider execution gate 调度。2 次/分钟、10 秒同域最小间隔和零重试不放宽；Prepare、最终 preflight、目录、详情、下一 source 都不会重置时钟。
2. 用户明确允许本次关闭 TUN。Mihomo 官方本地 controller 已把运行时 `tun.enable` 从 true 切为 false；`198.18.*` 路由消失，公共域名恢复真实公网 DNS 与 TLS。项目没有把 `198.18.*` 加白，没有关闭 SSRF，也没有加入临时 DoH 依赖。

真实验收门仍未完成：服务启动后连续三轮等待，正式日志只有页面 GET，没有用户 Prepare/Start POST；该动作不能由内部 API、测试或 Codex 代替。按用户“无论结果都提交远端并关机”的指令，本次按 blocked/untested 交付，不宣称已经产生新快照。

## 修复范围与代码事实

### 京东共享访问面

- `SourceProvider` 增加可选 `beginExecution/endExecution` 生命周期；execution key 由 task、plan identity 和 plan version 组成。
- Source Execution 在任何浏览器副作用前校验全部 source 并按 Provider 分组；Prepare 与 Start 重读同一 confirmed plan 后复用同一 execution。
- `jd.catalog-product@1.0.0` 在 execution 开始时只创建一个现有 `PacedAccessGate`。总最长窗口按 JD source 的计划窗口合计，只延长整个运行寿命；每分钟预算、最小间隔、批次和零重试不变。
- `login_required`、`verification_required`、`access_denied`、`rate_limited` 触发后，不再导航剩余同 Provider source；仍为剩余 source/target 写 `stopped` 审计。公共 Provider 等其他访问面继续执行。
- `pc-frequent-pro` 与 HTTP 429 保存为 Raw Source Observation 的 `rate_limited`；历史 `access_denied` 记录不重写。
- 继续复用 Git 忽略的 `data/jd-cdp-profile` 和 loopback CDP；没有复制或读取 Cookie/Profile 内容，没有绕过登录、验证码或风控。

### 公共来源与 SSRF

- 现有 `public.web-resource@1.0.0` 代码保持不变：Node 系统解析返回的全部地址先经过 BlockList；连接使用同一次解析选中的地址，避免 DNS rebinding。
- loopback、link-local、private、multicast、documentation、reserved、fake-IP、非 HTTPS 443、凭证 URL、redirect、Unix socket、自动重试和超字节仍失败关闭。
- 现场确认 TUN 开启时 NIST、海尔、SAMR、CNIS 均被解析为 `198.18.0.x`；关闭后恢复真实 A/AAAA，NIST HTTPS 返回 200 且 TLS authorized。
- `dns-over-http-resolver@3.0.16` 只做过 `--no-save` 最小原型；生产 package/lockfile 没有变化。Clash Verge 重启后可能恢复 TUN，项目不会暗中持久化用户代理配置。

## 自动化证据

| 门 | 结果 |
| --- | --- |
| JD/Source Execution/typed observation/paced gate 定向回归 | 4 files，13 tests passed |
| 全量 `npm test` | 32 files passed，124 tests passed，1 个既有 realtime acceptance skipped |
| `npm run typecheck` | shared/db/workbench/worker/api/web 六个 workspace 通过 |
| `npm run build` | 通过；Web 2301 modules，596.41 kB / gzip 176.27 kB；仅既有大 chunk warning |
| `git diff --check` | 通过 |
| package/lockfile | 无变化，无 DoH 生产依赖 |

测试保护的实际不变量：同一个 JD execution 只创建一次 gate；Prepare/preflight/目录/详情/下一 source 都调度到它；一个 Provider 受限后其余同 Provider source 不再 collect，但其他 Provider 继续；`rate_limited` 可进入 Source Dataset typed contract。现有 PacedAccessGate 集成测试单独保护真实排队、间隔、熔断、取消与最长窗口。

## 正式 Web 真实验收

### 固定输入

- Capture Task：`capture-task-9befc37e-946b-4d65-a615-d362058fe792` revision 2
- confirmed plan：`crawl-plan-c8d3112d-c425-4e7b-8cd5-c62eba8945af` version 1
- 历史失败基线：54 条现有 Source Run；最新开始于 `2026-08-20T17:53:16.251Z`，不改写
- 正式页面：`http://127.0.0.1:6173/`

### 用户动作

- Prepare：未收到用户点击；正式 API 日志没有 Prepare POST
- Start：未收到用户点击；正式 API 日志没有 Start POST
- 若页面返回 `login_required`：先对账 9222、项目 Chrome、`data/jd-cdp-profile` 复用状态；不得默认要求重新登录

### 新运行结果

- execution 起止时间：没有新 execution
- 新 Source Run 数量与 ID：0；API 与 PostgreSQL 均保持历史 54 条
- completed / failed / stopped：历史累计 3 / 51 / 0；本次新增 0 / 0 / 0
- JD 目录 snapshot：未执行，untested
- JD 详情 snapshot：未执行，untested
- 公共来源 raw snapshot：未执行，untested
- 登录/验证/拒绝/限流事实：没有新 observation；不能据此判断当前 Profile 或来源状态
- 页面显示：Workbench 已读取任务、confirmed plan 和历史 Source Run；未收到按钮动作，未验收运行中 UI

## 页面、API、PostgreSQL 与导出对账

| 事实 | 页面 | 正式 API | PostgreSQL | JSONL/CSV | 结论 |
| --- | --- | --- | --- | --- | --- |
| run status / termination | 未启动 | 54 条历史 run，latest `2026-08-20T17:53:16.251Z` | 54 条；failed 51、completed 3、stopped 0；latest 同 API | n/a | API/DB 对账一致；没有本次 run |
| target status / count | 未启动 | 没有本次 run ID | 没有本次 run ID | n/a | blocked/untested |
| observation state / URL / time | 未启动 | 没有新 observation | 没有新 observation | n/a | blocked/untested |
| immutable payload / content hash | 未启动 | 没有新 snapshot | 没有新 snapshot | n/a | blocked/untested |
| asset count / CAS | 未启动 | 没有新 asset | 没有新 asset | n/a | blocked/untested |

这里的“一致”只证明正式 API 与 PostgreSQL 都没有新增运行；不证明修复后的真实抓取成功，也不能用历史 54 条运行拼成新的验收结果。

## Patch Disposition

- 删除：每个 JD source 内新建 gate；preflight 绕过 pacing；把 `pc-frequent-pro` 归成笼统 `access_denied`。
- 保留：p-queue/cockatiel、Playwright CDP、独立 Profile、零重试、公共 SSRF/redirect/HTTPS/同址连接、历史运行事实。
- 重写：Provider execution 生命周期贯穿 Prepare/Start；同访问面受限后其余来源只写 stopped 审计。
- 未引入：第二套 timer、DoH fallback、代理配置持久化、验证码/风控绕过、Cookie/Profile 复制、动态插件/manager/engine。

## 交付与关机

待真实验收后填写：

- 实现与首版报告 commit：待提交后填写
- 远端 branch/SHA：`master`，待推送后填写
- 本地与远端一致：待验证
- 工作区 clean：待验证
- API/Web/项目 Chrome：待停止
- PostgreSQL：系统关机时停止
- Windows 关机：待提交推送和最终核对后执行
