# 数据抓取与清洗平台开发文档导航

状态：开发入口
更新日期：2026-08-26

## 1. 用途

本目录把产品资料转换为可持续开发所需的架构基线、阶段路线图、技术调研登记和当前进度。

- `REQUIREMENTS-ALIGNMENT.md`：记录当前有效的用户确认决定和被替代的旧产品方向。

这些文档用于跨 Codex 上下文继续开发。任何新上下文都不应只依赖聊天摘要或历史 handoff，而应从本导航和 `PROGRESS.md` 恢复真实状态。

## 2. 权威顺序

发生冲突时按以下顺序处理：

1. `docs/product/agent-knowledge-platform/01-产品需求文档-PRD.md` 的产品目标、范围与验收；
2. `docs/product/agent-knowledge-platform/02-总体技术方案.md` 的系统约束；
3. `docs/product/agent-knowledge-platform/05-MVP实施计划.md` 的阶段与停止门；
4. `REQUIREMENTS-ALIGNMENT.md` 的当前用户确认决定；
5. 根目录 `CONTEXT.md` 的统一领域语言；
6. 本目录 `ARCHITECTURE.md` 的工程架构基线；
7. `RESEARCH.md` 中当前仍适用的技术调研结论；
8. `docs/adr/` 中当前仍接受的难以反转决策；
9. `ROADMAP.md` 的阶段实施顺序；
10. `PROGRESS.md` 的当前执行状态。

`03-Provider接口规范-产品级.md` 与 `04-知识包格式规范-产品级.md` 已明确标记为历史资料，不在当前权威链中。低优先级文档不得取消高优先级文档规定的标准商品范围、本地执行、原始数据不可变、多来源规划和访问停止门。

## 3. 文档地图

| 文档 | 唯一职责 | 不负责 |
| --- | --- | --- |
| `CONTEXT.md` | 领域词汇和对象关系 | 技术设计、任务状态 |
| `REQUIREMENTS-ALIGNMENT.md` | 当前有效产品决定和被替代方向 | 技术选型和实现进度 |
| `ARCHITECTURE.md` | 目标模块、依赖方向、数据分区、现有资产处置 | 当前完成度、具体排期 |
| `ROADMAP.md` | 阶段、阶段产物和停止门 | 当前进度、选型结论 |
| `RESEARCH.md` | 技术问题、候选开源方案、证据与处置状态 | 产品需求、实施进度 |
| `CRAWL-PLANNING-DESIGN.md` | Capture Task 到版本化 Crawl Plan 的产品流程、contract、UI 和验收门 | Provider 实现、真实来源抓取和阶段进度 |
| `JD-COLLECTION-DESIGN.md` | 2026-08-21 的历史京东详情/评价方案，仅保留失败路径与既有资产证据 | 当前实现依据；其中详情、登录、旗舰店和评价承诺已被替代 |
| `JD-COLLECTION-ITERATION.md` | 已被 ADR 0018 替代的京东目录历史迭代记录 | 当前 AI 深搜规划实现依据或完成证明 |
| `PROGRESS.md` | 当前阶段、已验证事实、阻塞项、下一步和验证记录 | 详细架构和重复产品资料 |
| `HANDOFF.md` | 跨电脑环境恢复、启动门和下一工作入口 | 充当进度、路线图或架构事实源 |
| `AGENT-SCORECARD.md` | 用户明确加减分、原因、纠正和当前积分 | 项目开发进度和技术决策 |
| 实验代码 | 不进入仓库；临时验证结束后删除，只把候选、证据和处置写入 `RESEARCH.md`，高影响决定写入 ADR | 独立 package、lockfile、平行应用或生产完成证明 |
| 历史 handoff | 指向上述权威文档的接续入口 | 充当当前进度或架构事实源 |

不得新建平行的 roadmap、TODO、progress 或 architecture 文件。确需拆分时，先更新本导航并声明新的唯一职责。

## 4. 新上下文启动顺序

1. 阅读根目录 `AGENTS.md`。
2. 阅读本文件。
3. 在仓库根目录执行 `nvm use`，并以 `node --version` 确认进入 `.nvmrc` 声明的 Node 24；`package.json#engines` 是版本范围事实源，`.nvmrc` 只负责本机选择，`.npmrc` 会拒绝错误版本安装，根脚本的 `check-node-version` 会在错误版本真正执行 dev/test/typecheck/build 前失败关闭。
4. 阅读 `AGENT-SCORECARD.md`，确认当前积分和最近一次加减分教训。
5. 阅读 `PROGRESS.md`，确认当前阶段、最后验证和下一步。
6. 阅读根目录 `CONTEXT.md`。
7. 阅读与当前阶段相关的产品原文，不通过二手摘要代替。
8. 阅读 `ARCHITECTURE.md` 和 `ROADMAP.md` 的相关章节。
9. 阅读 `RESEARCH.md` 中当前任务依赖的调研条目；如有 ADR，再读相关 ADR。
10. 核对 `git status --short --branch`、`git log -1`、上游和当前 diff。
11. 指出当前任务服务于 `ROADMAP.md` 的哪个阶段、`ARCHITECTURE.md` 的哪个目标或通过门；没有对应关系时先停止并澄清。
12. 确认当前请求授权是调研、设计、实现、验证还是交付，再开始工作。

如果 CodeGraph 未初始化，按 `AGENTS.md` 请求授权；在未获授权时使用受控的 `rg`、目标文件读取和 Git 证据。

## 5. 结束上下文前的强制更新

1. 把已完成且有证据的事项更新到 `PROGRESS.md`。
2. 把新候选、调研结果和淘汰原因更新到 `RESEARCH.md`。
3. 只有阶段定义发生变化时才更新 `ROADMAP.md`。
4. 只有模块职责、事实源或依赖方向发生变化时才更新 `ARCHITECTURE.md`。
5. 只有领域术语被确认或纠正时才更新 `CONTEXT.md`。
6. 记录实际运行的测试、构建、真实页面、原始数据集和 Agent 验收证据；不得只写“已验证”。
7. 在 `PROGRESS.md` 写明本轮架构影响是无变化、澄清还是改变；发生改变时同步更新 `ARCHITECTURE.md` 和必要 ADR，没有改变时不得为了形式改写架构正文。
8. 写出下一步的第一条可执行动作和明确停止门。

## 6. 跨电脑接续规则

- 新电脑上的 AI 先读取 `HANDOFF.md` 执行环境和 Git 启动门，再回到本文件规定的权威顺序；交接只提供入口，不覆盖 `PROGRESS.md` 的当前事实。
- 跨 Session 通过本目录权威文档恢复；跨电脑只能通过已经提交并推送的 Git 内容恢复，聊天记录、模型记忆和本机未跟踪文件都不能充当共同事实源。
- 切换电脑或正式交付前，必须把与实现一致的架构、调研、进度和验证记录一同纳入提交并推送，再验证本地与远程 SHA 一致。
- 当前请求没有提交或推送授权时，必须在 `PROGRESS.md` 和交付说明中标记“仅本机”，不得宣称已经可以跨电脑接续。
- Profile、Cookie、认证 Header、Codex 登录材料和受限原始内容不进入 Git；跨电脑同步只包含可公开的代码、配置、文档、测试和 contract。
- 两台开发机各自保留 PostgreSQL 和原始来源附件，不通过 Git 搬运或合并；新电脑允许从空库继续开发。
- 根 `.env.example` 是已获准提交的本地开发默认配置，API 和数据库准备脚本会直接读取它；同名外部环境变量优先。`npm run dev` 会先检查 `domain_analysis`，不存在时只创建当前电脑的空库，再由生产启动链运行 Drizzle migration，不复制另一台电脑的数据。

## 7. 当前开发入口

当前阶段和下一步以 `PROGRESS.md` 为准。项目已收口为“数据抓取、数据清洗”两个阶段。Workbench → Graphile → Batch/Run → 不可变 Snapshot → 页面/JSONL/CSV → 重启持久化的 1C 闭环已通过；历史电视 v9 只保留为失败与内容质量证据。当前入口是 1E 的 `public.web-resource@2.0.0`：新 v4 Plan 显式组合 exact/site 路由，Crawlee 持久队列执行同源发现，Source Dataset 分开保存原始快照和内容验收。新计划仍必须由负责人确认后才能 Start。

## 8. 历史文档处置

- 根目录 `init-plan.md`、`refactor-plan.md` 和 `docs/superpowers/` 是旧 Social Intelligence 产品阶段留下的历史设计或实施记录。
- 它们可作为现有实现动机和历史约束的证据，但不是当前标准商品数据抓取与清洗平台的 roadmap、progress 或架构权威来源。
- 在完成资产迁移审计前保留这些文件；不得按其旧任务清单继续开发，也不得未经授权直接删除。
