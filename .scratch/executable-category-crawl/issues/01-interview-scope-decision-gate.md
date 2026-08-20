# Issue 01：模糊品类需求不得跳过真实范围取舍直接生成草案

Status: ready-for-human

## 问题

2026-08-20 在生产 Workbench 新建采访并输入“我要抓取微波炉的数据”后，首轮完成搜索便直接生成 Markdown 草案，没有提出任何负责人问题。

当前真实会话 `interview-session-ce6a3268-55ef-4c43-8b08-dff1a73d1da6` 的 API 事实为：

- session：`task_ready / idle`；
- Interview Decision：0；
- 未决项：0；
- 当前草案：1 个 draft；
- 草案自行写入“中国家用市场、台式/嵌入式/台嵌两用、包含复合微烤机、商用只单独标记”等会改变商品集合的边界。

该结果不是前端漏展示问题。当前 Prompt 允许新品类首轮在调查后“提出负责人问题或生成草稿”；Workbench 只验证模型已经声明的 Decision、未决项和四类来源覆盖，无法判断模型是否漏报了本应交给负责人的语义取舍。现有测试又把“零 Decision＋完整来源凭证直接进入 `task_ready`”作为合法夹具，因而没有保护本次回归。

## 目标

修正采访 Agent 对“真实负责人取舍”的语义判断：模糊品类需求中，凡是会实质改变纳入商品集合、市场范围或观察时间范围，且既不是用户已明确/已确认内容、也不是项目既定系统默认、也不是纯客观调查事实的边界，都必须先作为一个 `proposedDecision` 交给负责人，不能被 Agent 自行写成“默认口径”。

这不是“每次至少问一题”。用户首句已经完整给出必要范围时，仍允许零问题完成调查并生成草案。

## 不扩大范围

- 不新增 `minimumQuestionCount` 或类似问题计数门；
- 不为微波炉、电视、冰箱等品类建立问题表、关键词表或条件分支；
- 不增加 `scopeAudit`、问题清单或其他 Interview JSON 字段；
- 不修改 shared schema、PostgreSQL 表、migration、HTTP/SSE contract 或 Web 状态模型；
- 不增加第二次模型审查、自动 repair、fallback、重试或新模型路径；
- 不修改 Capture Task、Crawl Plan、Provider、Source Dataset 或 Source Run；
- 不把品牌、标准、来源平台、京东范围或默认采集内容重新变成负责人问题。

## 复用边界

- 复用现有 `interview-product-category` Skill、App Server ephemeral turn、`proposedDecision`、`decisionResolution`、`unresolvedItems`、`draftMarkdown` 和四类来源覆盖门；
- Workbench/PostgreSQL 继续拥有消息、Decision、未决项和草案版本；Codex 只做当前回合语义判断；
- 产品特有改动仅限采访 Skill/Prompt 的范围依据纪律及其回归测试，不引入新的通用能力或第三方依赖。

## Baseline Impact

```text
Baseline Impact:
- touched modules: Interview Skill、Codex Category Interview Prompt、采访运行时/策略测试夹具、PROGRESS
- owning fact source: Category Interview / PostgreSQL，保持不变
- public interface changed: no
- new protocol/adapter/fallback: no
- compatibility or legacy path changed: no；历史消息、Decision 和草案不改写
- research update required: no；不引入新能力、依赖或模型路径
- architecture or ADR update required: no；模块职责、事实源和依赖方向不变
- tests and real-surface validation to run: Prompt 合同红绿测试、采访聚焦测试、全量 test/typecheck/build、模糊与完整微波炉真实对照流程
```

## Patch Disposition

```text
Patch Disposition:
- delete: 将模糊首句零 Decision 直接草案当作正确产品行为的测试语义；Prompt 中允许未经范围依据检查直接生成草案的宽松表述
- keep: 一次一问、只问真实负责人取舍、任意自然语言输入、四类来源覆盖门、Markdown 确认、确认后独立结构化
- rewrite: “没有必要取舍”的判断纪律、首轮 Prompt 和相关 fake runtime fixture
- reason: 根因是 Agent 把未经确认的范围选择误当系统默认，不是状态机、来源覆盖或 JSON schema 缺失
```

## 实施方案

### 1. 收紧 Skill 的范围依据纪律

在 `.agents/skills/interview-product-category/SKILL.md` 中明确：生成草案前，Agent 必须逐项检查所有会改变纳入对象集合、市场或时间范围的边界。某项边界只有满足下列任一依据时才可直接写入草案：

1. 来自用户当前或历史原文；
2. 来自已确认 Interview Decision；
3. 属于 Skill 已明确批准的系统默认；
4. 是调查得到且不包含负责人选择的客观事实。

其余边界必须选择影响最大的一个形成 `proposedDecision`。推荐答案只是 proposal，不得当作用户确认。仍有真实取舍时省略 `draftMarkdown`；没有时才生成草案。

Skill 只描述通用品类语义，不列微波炉固定问题。微波炉的产品形态、使用场景或型号生命周期只能作为验收样本，不进入生产条件分支。

### 2. 对齐生产 Prompt

在 `packages/workbench/src/codexCategoryInterviewRuntime.ts` 的首轮采访 Prompt 中复述同一条范围依据纪律，替换“调查后提问或生成草稿”的无条件放行语义。

不新增 final JSON 字段。语义判断仍由同一个采访 Agent 在本轮完成；Workbench 继续校验既有 typed delta，不解析 Markdown，也不尝试用字符串或问题数量推断业务状态。

### 3. 纠正测试语义

- 调整 `packages/workbench/tests/codexCategoryInterviewRuntime.test.ts`：运输/流式测试若需要验证直接草案，使用已经完整表达范围的 initial request，不再用“抓冰箱”证明零问题草案正确；同时断言生产 Prompt 包含范围依据纪律。
- 调整 `packages/workbench/tests/categoryInterviewTurnPolicy.test.ts`：四类来源门夹具使用已经完成负责人取舍的 view，避免结构测试暗示 Workbench 能判断未声明的语义问题。
- 不新增一个伪造的纯代码测试来断言“模糊文本一定要问一题”，因为 production policy 不解析自然语言，也不允许以字符串或品类表硬编码这一判断。

### 4. 真实回归验收

只运行两个与本缺陷直接对应的新会话：

1. 模糊输入：“我要抓取微波炉的数据”。首轮必须完成真实搜索，只产生一个真正改变商品范围的问题；`proposedDecision` 为 1、`draftMarkdown` 不存在、session 为 `active / idle`。问题不能询问网站、京东、品牌/标准枚举或默认采集内容。
2. 完整输入：“抓中国大陆当前在售家用微波炉，包含台式、嵌入式和明确具备微波功能的复合机，排除商用、二手和停售型号”。完成调查与四类来源校验后允许零问题直接生成草案，用于证明没有加入强制问题数量。

第一个真实流程仍零问题直出草案，修复即失败，不得以单测、Prompt 文案存在或第二个流程通过代替。

## 验证命令与证据分类

- 聚焦 Interview Prompt/Turn Policy/Integration 测试；
- `npm test`；
- `npm run typecheck`；
- `npm run build`；
- `git diff --check`；
- 真实 Workbench/API 分别记录 session phase、Decision 数、草案数、搜索活动、页面错误和是否创建 Capture Task/Source Run。

自动化测试只证明协议和状态门没有回归；真实 Codex/Workbench 对照流程才证明语义修复有效。

## 停止条件

- 如果同一个采访 Agent 在收紧 Skill/Prompt 后仍不能稳定区分未确认范围与系统默认，停止本 Issue，不增加问题计数、品类硬编码、JSON audit 或第二模型；先报告真实失败证据，再由负责人决定是否另开涉及公共 contract 或模型审查路径的设计。
- 本 Issue 不确认 Capture Task、不生成 Crawl Plan、不点击 Start，也不访问真实抓取来源。
- 未经授权不提交、不推送；当前工作仍只在本机 dirty worktree 中增量进行。

## Comments

### 2026-08-20

用户指出“方案只写在聊天上下文中无法留迹和追踪”。本 Issue 将已经完成的真实根因诊断、最小修复方案、拒绝项、验证门和停止条件登记为后续实现的唯一详细入口；`PROGRESS.md` 只记录当前阻塞和本 Issue 链接，不复制完整方案。

### 2026-08-20 实施与验收

已按本 Issue 的最小边界实施，等待人工查看两条保留的真实 Workbench 会话：

- Skill 新增“范围依据纪律”：会改变商品集合、市场或观察时间的边界，只有来自用户原文、已确认 Decision、Skill 明确系统默认或不包含负责人选择的客观调查事实时，才可直接进入草案；推荐不等于确认。该规则明确不是最低问题数，也没有品类、关键词或固定问题表。
- 生产 Prompt 对齐同一纪律；没有新增 JSON 字段、schema、迁移、解析分支、第二模型、repair、fallback 或自动重试。
- fake runtime 直接草案夹具改用已经完整说明市场、在售状态、商品形态和排除条件的输入；四类来源门夹具补入已确认生命周期 Decision，不再暗示模糊首句零 Decision 草案是正确行为。

红绿证据：

- 红灯先建立并稳定复现两次：`codexCategoryInterviewRuntime.test.ts` 为 1 failed / 6 passed，唯一失败是生产 Prompt 缺少“逐项检查会改变纳入商品集合、市场范围或观察时间范围的边界依据”。
- 最小修改后 Prompt/Turn Policy 聚焦测试为 2 files / 13 passed；采访 policy、turn policy、input/revision integration 与 runtime 联合测试为 5 files / 27 passed。
- 全量 `npm test` 为 31 files passed、115 tests passed、1 个既有 realtime acceptance skipped；`npm run typecheck` 六个 workspace 通过；`npm run build` 通过，只有既有约 594.65 kB Vite chunk warning；`git diff --check` 通过。

真实 Workbench/API 对照：

- 模糊会话 `interview-session-a2c4c424-345e-4684-b33a-114340d94ef1`：完成 23 个网页搜索活动后，提出 1 个会改变商品集合的组合型微波炉范围问题；API 为 `active / idle`、1 个 `proposed` Decision、1 个 open unresolved item、0 个草案。问题没有询问网站、京东、品牌/标准枚举或默认采集内容。
- 完整会话 `interview-session-5f845c1d-9c61-4fae-9e18-11e401c9c0df`：完成 43 个网页搜索活动后，API 为 `task_ready / idle`、0 Decision、0 未决项、1 个未确认 draft；证明没有加入强制最低问题数。
- 页面控制台为 0 error / 0 warning。两条会话均保留供人工复核；没有点击“确认范围并生成正式任务”或 Start。Capture Task 列表前后保持 3 个相同 ID，因此没有为回归会话生成 Capture Task、Crawl Plan 或 Source Run，也没有执行真实来源抓取。

Patch 处置：删除的是误导性的 fixture 语义和 Prompt 无条件放行；保留四类来源覆盖、一次一问、Markdown 确认和确认后独立结构化；历史错误会话和草案未重写或清理。本轮架构影响为澄清，事实源、模块职责、公共 contract 与依赖方向均未改变。

全部修改与真实回归会话仍只在本机 dirty worktree / 本机数据库，未提交、未推送，不构成跨电脑接续点。
