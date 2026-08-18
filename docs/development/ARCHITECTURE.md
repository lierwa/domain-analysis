# 数据抓取与清洗平台架构基线

状态：2026-08-19 已收口到两阶段；当前只实施阶段 1 数据抓取

## 1. 简单说明

用户新建一个“抓取任务”，直接输入“抓冰箱”之类的需求。系统先像专业爬虫顾问一样调查这个门类应该关注什么、有哪些真实来源，只把必须由用户决定的取舍拿出来问。对话结束后得到一份可读的抓取任务草稿；用户确认后才成为正式抓取任务。范围不够时，无论草稿是否已经确认，都可以回到同一段对话继续补充；再次确认会形成同一任务的新版本，旧版本不被覆盖。

下一步，系统会根据不同来源决定原始捕获单元：网页可能保存 HTML 或源站 JSON，文档保存 PDF，表格保存 CSV/XLSX，图片和其他媒体保存原文件。阶段 1 不判断哪些字段最终有用，也不把所有来源硬塞进同一个参数模板。

用户当前只需要验收两件事：对话产出的任务是否正确，以及后续抓回来的原始数据是否真实、持久、可查看、可导出。清洗、Evidence、知识加工和知识包不在当前实现里。

## 2. 两阶段边界

### 阶段 1：数据抓取

负责：

- 通过对话形成抓取范围和候选来源；
- 用户确认正式抓取任务；
- 为每个真实来源制定可执行计划；
- 在许可、登录、频控和停止条件内访问来源；
- 以尽量接近源站的格式保存原始业务数据；
- 重启后继续存在，并在 Workbench 查看和导出。

不负责：字段标准化、去噪、实体合并、证据裁剪、知识判断或模型加工。

### 阶段 2：数据清洗

只在阶段 1 验收后设计。它将消费阶段 1 的不可变原始数据，不得反向改变或覆盖原始捕获。

## 3. 当前数据流

```text
用户首句
  -> Category Interview Module
  -> 本地 Codex App Server ephemeral 单轮调查/提问
  -> 版本化抓取任务草稿
  -> 用户确认
  -> Capture Task
  -> [范围需调整] 回到原 Interview 生成新草稿版本
  -> 用户再次确认，更新同一 Capture Task 的当前版本
  -> [下一验收] Crawl Plan
  -> [下一验收] Source Provider
  -> Source Dataset (raw)
  -> Workbench 查看 / JSONL、CSV 导出
```

确认抓取任务不会自动开始访问外部来源。计划确认和正式执行是后续独立通过门。

## 4. 单一事实源

| 事实 | 唯一拥有者 | 其他模块职责 |
| --- | --- | --- |
| 对话消息、当前状态、未决项 | Category Interview Module / PostgreSQL | UI 展示；Codex 每轮读取快照 |
| 用户确认的取舍 | Interview Decision | Skill 提建议；UI 通过同一 Composer 提交负责人原文回答 |
| 准备抓什么、从哪里抓 | 版本化抓取任务草稿 | 用户确认前不能执行；历史版本不可变 |
| 当前已确认抓取范围 | Capture Task | 指向最新确认版本；Crawl Planner 只读指定版本 |
| 每个来源怎样抓、抓多少、何时停止 | 经确认 Crawl Plan | Provider 只执行冻结计划 |
| 一次访问发生了什么 | Raw Source Observation | UI 与导出读取 |
| 来源当时返回的原始内容 | Source Snapshot / Source Asset | 后续清洗只读，不覆盖 |

Codex 不拥有产品 thread、任务或来源数据。每轮只创建 `ephemeral: true` 的内存 thread；Workbench 重放 PostgreSQL 中的 typed state。运行中的 commentary 通过官方 delta 协议展示，最终机器 JSON 只在进程边界由 Zod 校验，不作为用户配置面板。

## 5. 当前模块

### 5.1 Category Interview Module

- 接受用户首句，不重复确认已经明确的门类；
- 保存消息、带 2–3 个建议和唯一推荐项的负责人问题、决定和未决项；
- 将结构化问题统一保存为 proposed Decision，但在 Timeline 中投影为普通助手消息；用户通过 Composer 发送建议项或自定义方案就是显式回答，不再增加独立题板或第二个“确认”动作；
- confirmed Decision 保存负责人回答原文并指向对应用户消息；建议项仍只是 proposal 上下文，不限制输入；
- 接受 Codex 的 `taskCandidate`，形成版本化任务草稿；
- 只在用户显式确认后生成 Capture Task；确认后仍接受增量消息并形成后续草稿版本。

### 5.2 Capture Task Module

保存和读取已确认任务的当前版本：原始需求、门类、市场口径、内容范围、京东意向、候选来源、排除项和未决项。首次确认创建任务；后续确认保持任务 ID 不变并推进 revision，历史确认内容仍由不可变草稿版本保留。它不保存参数 schema、知识层或证据规则。

### 5.3 Source Dataset Module

保存来源运行、来源对象、不可变快照和附件。新数据只允许两种原始载荷：

- `inline_text`：HTML、JSON、CSV、纯文本等可安全内联的源站响应；
- `asset`：PDF、XLSX、图片、视频等原文件。

旧来源记录不删除，读取时明确标成 `legacy_structured_json`，不得冒充新原始捕获。

### 5.4 Source Access

当前只保留已验证的通用阶段 1 基础：Crawlee 临时存储配置，以及基于 `p-queue`、`cockatiel` 的频控、取消和熔断。具体来源 Provider 必须在 Crawl Plan 验收后逐个加入；当前没有注册京东或官网抓取规则。

## 6. 物理边界

- PostgreSQL `workbench` schema：对话、任务、计划元数据、运行、来源对象和快照索引；
- 原始附件内容存储：后续执行验收时确定正式本地路径/CAS；
- Cookie、Profile、密码、认证 Header 和验证码信息不得入库、日志、Git 或导出；
- 不使用结束即删除的隔离数据库冒充正式数据；
- 本地两台电脑的数据不通过 Git 同步。

## 7. 依赖方向

```text
shared contracts
  <- db
  <- workbench
  <- api
  <- web

shared contracts
  <- worker (仅阶段 1 来源访问基础)
```

Web 不推导任务状态；API 只适配 Workbench；Worker 不拥有任务事实。

## 8. 开源与产品代码边界

- 复用：PostgreSQL、Drizzle、Fastify、assistant-ui、Codex CLI App Server `stdio`、Crawlee、p-queue、cockatiel。
- 产品代码：抓取任务采访规则、任务确认、来源计划的业务约束、原始数据 Workbench 投影。
- 当前不自研队列、工作流引擎、浏览器自动化框架、重试器或结构化输出解析器。

## 9. 当前通过门

当前只验收“对话输出抓取任务草稿”：

1. 输入“抓冰箱”后不重复确认门类；
2. 系统主动调查品牌、型号、内容范围和候选来源；
3. 家电出现一次京东意向问题，提供 2–3 个选项和推荐项；
4. 草稿可读地展示范围和真实候选来源，不出现参数编辑器、Evidence 或知识加工；
5. 每个 assistant turn 按 SSE 到达顺序交错追加 commentary 与经过脱敏的搜索/工具活动；同一活动的 started/completed 只原位更新，后到文字不得插到既有活动之前；连接、thread 启动和 turn 启动只推进同一条生命周期状态，搜索/工具调用使用独立紧凑样式并直接显示安全 query/目的摘要，`final_answer` 生成期间必须显示可理解的整理校验状态；
6. 负责人问题作为普通消息展示建议，Composer 可发送建议项或自定义回答；发送即确认该回答并继续，不出现独立题板或第二个“显式确认”；
7. ScrollToBottom 只在用户离开 live edge 阅读历史时出现；回到底部后由 assistant-ui 恢复自动跟随，按钮不得覆盖消息或草稿卡；
8. 用户确认后生成正式 Capture Task，但不自动抓取；已确认任务可以继续原对话并生成同一任务的新版本。

未通过本门前，不实现 Crawl Plan 或真实 Provider。
