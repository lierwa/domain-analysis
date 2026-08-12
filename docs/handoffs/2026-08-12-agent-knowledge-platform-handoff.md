# Agent 知识生产平台接续开发交接

日期：2026-08-12
目标仓库：`/Users/guojunxi/Desktop/work/domain-analysis`
当前远程：`https://github.com/lierwa/domain-analysis.git`
接续方向：在现有 `domain-analysis` 项目上，将其从 Social Intelligence 半成品演进为《Agent 知识生产平台》MVP。

## 1. 最重要的用户决定

- **继续在现有 `domain-analysis` 仓库上修改。** 不新建代码项目、不新建仓库，也不要把旧项目仅仅当外部参考。
- 当前交接来自一条 Codex 无项目自由对话；这是 Codex 任务归属问题，不代表需要新建磁盘目录或新仓库。
- 本次只完成产品资料和交接入库、提交与推送；尚未授权或开始业务代码重构。
- 后续正式工作应从 Codex 左侧的 `domain-analysis` 项目中开启新任务，先读本交接和六份产品文档，再动代码。

## 2. 权威资料

六份产品基线位于：

`docs/product/agent-knowledge-platform/`

阅读顺序与冲突优先级：

1. `00-文档导航.md`
2. `01-产品需求文档-PRD.md`
3. `02-总体技术方案.md`
4. `03-Provider接口规范-产品级.md`
5. `04-知识包格式规范-产品级.md`
6. `05-MVP实施计划.md`

不要在本交接中寻找这些文档的替代副本；产品目标、范围、验收和实施停止门以原文为准。发生冲突时，以导航文档声明的权威顺序处理。

## 3. 产品究竟是什么

目标不是做一个京东爬虫，也不是继续做 Reddit/X 舆情报告，而是做一套面向 Agent 的通用知识生产平台：

```text
一个或多个数据搜集板块
  → 可追溯的原始资料
  → 通用知识库加工厂
  → 版本化知识包
  → 本地或远程 Runtime
  → 目标 Agent
```

首个纵向 MVP 是“购物引导 Agent－冰箱－京东”。京东和冰箱是首个来源/领域验证，不得扩散为平台通用层的固定概念。

关键产品约束：

- 采集、解析、模型处理、人工审核、评测和建包只在本地执行。
- 浏览器登录状态、Cookie 和未脱敏原始资料不得上传服务器或进入知识包。
- Provider 只理解来源访问和原始资料保真，不负责判断最终知识。
- 正式知识必须保留原始值、标准值、推断/确认状态、来源和证据位置。
- 模型输出不能直接成为已发布事实；需要校验、证据和必要的人工审核。
- Runtime 默认不调用模型，不依赖网络、embedding 或向量数据库。
- 知识包必须只读、版本化、可验证、可携带、可切换和可回滚。
- MVP 不是消费者聊天产品，也不做淘宝、Amazon、完整线上管理平台或多来源对齐。

核心验收门槛请以 PRD 第 10 节为准，包括：不少于 5 个品牌、50 个有效型号；可访问计划页面原始资料保存成功率不低于 90%；已发布结论来源可追溯率 100%；核心字段抽检准确率不低于 95%；Agent 任务集通过率不低于 90%；知识包能在另一台机器离线加载并切换/回滚。

## 4. 已核对的旧项目真实状态

本次只读审查时，仓库处于：

- 分支：`master`
- 审查前 HEAD：`414980f77dab83ce4bcc5c2dd686bf96506938d5`
- 审查前与 `origin/master` ahead/behind：`0 0`
- 审查前工作区：干净

工程结构：

- `apps/api`：Fastify API
- `apps/web`：React + Vite 工作台
- `packages/shared`：Zod 契约和领域状态
- `packages/db`：Drizzle + SQLite/libSQL
- `packages/worker`：Crawlee、`p-queue`、采集适配器和调度核心

已经存在、可作为底盘继续使用的能力：

- npm workspaces TypeScript monorepo；
- 项目、Analysis Run、Collection Plan、Crawl Task、Raw Content 的基本持久化；
- Fastify route/service/repository 分层；
- React Workspace、Library、Reports、Settings 基础页面；
- Reddit/X 采集 adapter 示例；
- 单机低并发队列、保守限速策略和调度核心；
- API、repository、schema、UI client 的一批测试。

尚未真实完成、不能误报为可复用成品的部分：

- 主业务和 DTO 多处硬编码 `reddit`，运行采集时语言甚至固定为 `en`。
- `clean`、`analyze`、worker `report` 仍是 placeholder；当前真实报告只是确定性帖子统计。
- Playwright 只有 `BrowserRuntimeConfig`，没有真正的浏览器启动、持久 Profile、人工登录接管或京东页面采集。
- schema 虽有 `rawHtmlPath`、`screenshotPath`，现有采集和 repository 没有保存 HTML/截图证据。
- scheduler 只有核心函数和测试，没有接入 API 进程启动；`maxRunsPerDay` 未形成执行约束。
- 当前按 `platform + externalId` 去重并丢弃后续采集，不适合保留价格、库存、上下架等时点快照。
- 没有领域范围规划、属性发现、单位/别名标准化、对象合并、冲突检测、低置信度审核或人工审核 UI。
- 没有产品定义的知识包构建、校验、版本生命周期、Runtime、离线查询、证据查询和 Agent 接入演示。
- 当前项目未初始化 CodeGraph。按照仓库 `AGENTS.md`，如后续要初始化，先问用户是否允许运行 `codegraph init -i`。

## 5. 本轮验证边界

本轮没有安装依赖，也没有修改业务代码。

尝试复跑验证时发现：

- 仓库没有 `node_modules`；
- 当前 shell 默认 npm 为 6.14.6，不支持该仓库使用的 npm workspaces；
- `npm test` 因找不到 Vitest 失败；
- `npm run typecheck` 因 npm 6 不支持 `--workspace` 失败。

旧实施计划记录过“12 test files / 52 tests、typecheck、build 通过”，但这只是历史记录，不是 2026-08-12 本轮现验。新上下文不得把本轮失败描述成代码回归，也不得把历史记录描述成当前验证。先确认项目要求的 Node/npm 版本并安装锁定依赖后再重跑。

## 6. 已确定的复用策略

继续使用同一仓库，但采用“保留工程底盘、替换产品核心”的演进方式：

### 可优先保留

- monorepo、Fastify、React、Zod、Drizzle、SQLite 的工程基础；
- Project / Run / Task 的控制面思想；
- Collection Plan 的长期采集意图与批次 Run 分离；
- Crawlee、低并发队列、失败状态和 repository 测试方式；
- run-scoped 数据隔离和基础工作台布局。

### 必须重新设计

- Social Intelligence 的 Project/Run 语义到 Knowledge Project/Pipeline Run；
- 关键词式 Collection Plan 到“数据搜集板块＋已确认研究范围矩阵”；
- `CollectionAdapter.collect(query)` 到产品要求的 Source Provider interface；
- 帖子型 `RawContent` 到不可变、可重放、可定位字段证据的原始资料模型；
- 去重规则到“稳定来源对象＋多次不可变采集快照”；
- 加工候选、审核决定、知识结论、证据和处理版本的数据模型；
- 知识包物理格式、校验、Runtime interface 和领域能力描述。

### 不应进入新主流程

- Reddit/X 专属字段和 Social Intelligence 文案；
- 当前确定性帖子报告；
- 将商品、SKU、价格等概念写入 Runtime 通用 interface；
- 在真实纵向验证前先建设万能插件系统、大规模 UI 或完整平台。

## 7. 建议的新上下文工作顺序

严格遵守《05-MVP实施计划》的停止门，不要一上来全面重构。

1. 完整阅读本交接、六份产品文档和仓库 `AGENTS.md`。
2. 重新核对 `master`/HEAD/上游/工作区，以及本交接提交后的远程一致性。
3. 确认本机 Node/npm 版本策略，安装锁定依赖，复跑现有 test/typecheck/build，建立可比较基线。
4. 做一份“产品对象 → 旧代码对象”的逐项映射及处置表，标为保留、重命名、重构、删除、新增；先让用户确认，不立即大改代码。
5. 冻结阶段 0 验收范围：至少 5 个品牌、50 个型号及异常样本；不要由工程师擅自宣称完整范围。
6. 只为阶段 1 的三项可行性验证设计最小纵向原型：
   - 京东真实页面与人工登录/验证接管；
   - 混乱资料的规则＋模型＋审核闭环；
   - 无模型、无网络的知识包查询和证据返回。
7. 三项验证全部通过后，才冻结 Provider 技术 interface、原始资料格式、知识 Schema、Runtime interface 和正式技术栈。

第一轮正式任务建议只做到第 4 步：恢复工程基线并提交映射/改造方案，先与用户对齐；不要在同一轮直接实施全平台。

## 8. 需要特别避免的误解

- 不要再次建议新建 `agent-knowledge-platform` 仓库。
- 不要把 Codex 左侧项目分组与磁盘项目目录混为一谈。
- 不要把“采集信息相通”理解为旧 `RawContent`/Reddit adapter 可以直接支撑京东。
- 不要把表或接口里预留的字段当成已运行能力。
- 不要用历史自动化测试替代京东真实页面、离线知识包和 Agent 查询的产品验收。
- 不要为了实现方便取消本地执行、证据追溯、领域中立、知识包可携带或无强制 embedding。
- 不要在可行性验证前冻结详细 schema、Provider 插件机制或完整 UI。

## 9. 建议使用的技能

- `codebase-design`：设计 Provider、原始资料、加工厂、知识包和 Runtime 的深模块 interface 与 seam。
- `domain-modeling`：统一 Knowledge Project、Collection Board、Provider、Raw Material、Candidate Knowledge、Review Decision、Knowledge Package、Runtime 等术语。
- `diagnosing-bugs`：恢复依赖、运行现有基线或真实京东采集出现故障时使用。
- `tdd`：开始实现经确认的纵向原型时，通过 interface 写契约和集成测试。
- `browser:control-in-app-browser` 或 `chrome:control-chrome`：用户授权后用于真实京东页面和人工登录接管验证；不得尝试绕过验证码或风控。
- `code-review`：完成一批明确变更后，按仓库标准与产品文档双轴审查。

## 10. 本次交接的完成定义

本交接与六份产品文档应以一个独立 docs 提交存在于 `origin/master`。新上下文开始时先核对该提交和远程 SHA，再继续后续工作。
