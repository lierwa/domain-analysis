# domain-analysis 跨电脑开发交接

状态：Windows 新电脑启动门已通过；保留为后续接续入口
更新日期：2026-08-18
目标分支：`master`

本文件只负责让另一台电脑上的 AI 恢复环境并找到下一项工作。当前进度只以 `PROGRESS.md` 为准，阶段顺序只以 `ROADMAP.md` 为准，架构与选型分别只以 `ARCHITECTURE.md`、`RESEARCH.md` 和已接受 ADR 为准。

## 1. 给接手 AI 的第一条指令

先不要改代码，也不要访问京东。直接完成以下只读恢复：

1. 核对仓库、`master`、本地 HEAD、`origin/master`、ahead/behind 和工作区；禁止用 `reset`、`clean` 或 `restore` 处理未知改动。
2. 按第 2 节顺序读完权威文档，报告当前阶段、已通过项、未通过项、下一条可执行动作和停止门。
3. 按第 3 节恢复 Node、PostgreSQL 和 Codex 登录；数据库、Evidence、知识包和浏览器状态均从该电脑的本地空环境开始，不从另一台电脑复制。
4. 跑第 4 节启动门。只有 Git、依赖、数据库迁移、API 和 Web 都正常后，才进入开发。
5. 当前开发工作仍停留在 `ROADMAP.md` 阶段 1A“冰箱纵向执行顺序”第 6 步。Windows 上 NIST/USDA/能效标识隔离小批次已通过；下一动作不是重跑这些来源，而是取得或选择一条明确允许本地读取、最小证据保存、模型输入和派生发布的品牌型号详情/说明书来源，再经既有 `Planner → DBOS → Provider → Source Dataset → Evidence` 落盘。不得重新造冰箱专用流程；许可或外部状态变化前不得重试开发库 USDA 403。

## 2. 权威阅读顺序

1. `AGENTS.md`
2. `docs/development/README.md`
3. `docs/development/AGENT-SCORECARD.md`
4. `docs/development/PROGRESS.md`
5. `CONTEXT.md`
6. 与当前步骤相关的 `docs/product/agent-knowledge-platform/` 产品原文
7. `docs/development/ARCHITECTURE.md`
8. `docs/development/ROADMAP.md`
9. `docs/development/RESEARCH.md` 的 R-030～R-034
10. `docs/development/JD-COLLECTION-DESIGN.md`
11. 当前任务涉及的 ADR

读取后先输出项目规定的 `Baseline Impact`；若修复失败补丁，再先输出 `Patch Disposition`。本交接不是新的 roadmap、progress 或架构事实源。

## 3. 新电脑环境恢复

仓库已经存在时：

```bash
git switch master
git pull --ff-only
git fetch origin master
git rev-list --left-right --count origin/master...HEAD
git status --short --branch
nvm install 24.12.0
nvm use
node --version
npm --version
npm ci
```

Git 门必须是 `origin/master...HEAD = 0 0`，工作区在开始新修改前必须干净。Node 必须满足根 `engines` 的 `>=24 <25`，npm 必须是 11.x；`.nvmrc` 的 24.12.0 是推荐复现版本，不是 Node 24 内唯一可运行小版本。本轮 Windows Node 24.14.1/npm 11.11.0 已通过全部运行时门。

本地 PostgreSQL 必须已经安装并运行。先只读核对：

```bash
psql -d postgres -Atqc 'select current_user'
```

根 `.env.example` 提供默认本地连接。`npm run dev` 会先检查目标库；不存在时只创建该电脑的空 `domain_analysis`，随后由 Drizzle migration 建表或升级。它不会复制、覆盖或合并另一台电脑的数据。Windows 当前使用用户级、未提交的 `POSTGRES_DATABASE_URL` 覆盖默认角色，PostgreSQL 14 只按项目需要以用户态监听 `127.0.0.1:5432`，不要求系统自启动；不要为一台电脑改写共享领域代码，也不要打印连接串中的认证信息。

采访和知识候选模型沿用该电脑自己的 Codex 登录，不提交登录材料：

```bash
npm exec -- codex login status
```

未登录时在该电脑执行 `npm exec -- codex login`。不得复制另一台电脑的 `~/.codex`、Cookie、Profile、认证 Header 或 Token。

## 4. 启动门

```bash
npm run db:ensure-local
npm run typecheck
npm run build
npm run dev
```

启动后核对：

```bash
curl --noproxy '*' http://127.0.0.1:4000/health
curl --noproxy '*' -I http://127.0.0.1:6173/
```

预期 API health 和 Web 都返回 200。全仓测试涉及 PostgreSQL；开发任务交付前应由 AI 建立并清理独立测试数据库运行，不能把测试夹具当作真实来源数据。

## 5. 当前真实边界

- 这是跨品类商品知识生产系统，不是冰箱爬虫。知识资产包含商品底层知识、品类知识以及品牌/系列/型号市场实例；来源页面不能单独证明压缩机、制冷、换热、控温或保鲜原理。
- M0～M7 的最小真实纵切片已通过：电视第二品类使用同一公共链路完成真实 DOE/EPA 来源、最小 Evidence、Factory/Review、SQLite Package、复制后离线 Runtime 和 PC Workbench 验收。
- R-033 又在 Windows 隔离库形成 NIST、USDA、能效标识各 1 条最小 Evidence，美的说明书因许可不足零请求；这仍不等于获许可品牌详情/说明书或阶段 1A 第 6 步完成。开发库 USDA 当前两次 403 已 typed 持久化，Evidence 为 0。
- 这只证明跨品类和 Windows 最小链路，不等于阶段 1A 完整矩阵、三品类、多站点、动态页、图片、目标 Linux 或完整市场总体已经通过。
- 历史 737 个“品牌＋厂家型号”只是在隔离环境跑过的目录 identity；没有保存完整商品详情、参数、图片、说明书、评价或原始 JSON/HTML，也不在当前开发库中，不能称为已完成商品知识。
- 京东工程前置门已通过：逐条持久化、DBOS 恢复、显式节奏、熔断、取消、PC 查看和导出均有本地证据；但真实 JD reader、书面访问许可、连续三个冷却窗口和每窗口 `1 个目录＋3 个详情` 探针未通过。
- 因此接手后禁止访问京东、禁止绕过验证、禁止复制 Cookie/Profile、禁止自研签名或反检测；不依赖京东的阶段 1A 第 6 步继续推进。

## 6. 本地数据与 Git 边界

必须留在每台电脑本地、不得进入 Git：

- PostgreSQL 数据；
- `data/evidence/` Evidence CAS；
- `data/knowledge-packages/` 构建包和激活指针；
- `.env`、浏览器 Profile、Cookie、认证 Header、Codex 登录和受限来源内容。

必须通过 Git 跨电脑同步：代码、测试、Drizzle SQL/迁移快照、根 lockfile、公开 POC 证据、权威文档、`.nvmrc`、`.npmrc` 和 `.env.example`。

## 7. 最近验证基线

2026-08-18 Windows 当前工作区验证：

- 当前 lockfile 的 `npm ci --dry-run --ignore-scripts` 通过，`better-sqlite3@12.11.1` Windows 预编译实际安装与加载通过；正式交付前仍应在无运行中进程的全新源码副本再跑一次完整 `npm ci`；
- 七个 workspace typecheck 通过；
- production build 通过；
- 全新 PostgreSQL 上 `63 files passed / 2 skipped`、`225 passed / 2 skipped`；
- API `/health` 与 Web 均为 200；
- 注入本机未提交连接后 `npm run db:ensure-local` 通过，开发库存在；
- 隔离测试数据库已精确删除，复核残留数为 0；没有访问京东。R-033 允许来源的真实访问与开发库 USDA typed 403 记录见 `PROGRESS.md`。

已知非阻塞项：Web 主 chunk 超过 500 kB；当前配置的 `npmmirror` 没有实现 npm audit endpoint，本轮审计状态为 blocked，不能沿用旧机器计数，也未执行可能破坏依赖的 `npm audit fix`。

## 8. 建议使用的 Skills

- `codebase-design`：修改来源数据、Evidence、Factory、Package 或 Runtime seam 前，先核对深模块职责和单一事实源。
- `domain-modeling`：只有领域词汇、知识层级或对象关系需要澄清时使用。
- `tdd`：来源状态、恢复、幂等、熔断、Evidence 和 Runtime contract 的实现先建立失败测试。
- `diagnosing-bugs`：新电脑启动、数据库、真实页面或性能门失败时，先复现和归因，不在旧补丁上叠 fallback。
- `code-review`：下一批非平凡实现结束后，按 Standards 与 Spec 两轴审查完整 diff。

## 9. 结束要求

每个可验证节点更新 `PROGRESS.md`；新调研只写 `RESEARCH.md`；阶段顺序变化才改 `ROADMAP.md`；模块职责、事实源、依赖方向或公共 contract 变化才改 `ARCHITECTURE.md` 和必要 ADR。任何“可以在另一台电脑继续”的交付，都必须再次提交、推送并验证本地/远程 SHA 一致。
