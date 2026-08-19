---
status: accepted
date: 2026-08-15
amended: 2026-08-19
---

# 标准商品先经专业采访形成已确认抓取任务

## 背景

用户提出“抓冰箱”“抓电视机”时，不可能也不应该预先枚举标准、品牌、型号、参数和来源；这些是专业抓取任务顾问应主动调查的事实。用户不是专业抓取工程师，但需要通过问答理解为什么这样划定范围、为什么选择这些来源，以及真正的取舍会怎样影响覆盖、成本和时点。

2026-08-18 产品已从知识生产平台收口为“数据抓取、数据清洗”两阶段，原 Category Research Brief、Product Project、Evidence 和知识包链路退出当前产品。采访的正式产物改为版本化 Capture Task Draft，用户整体确认后成为 Capture Task。

## 决定

- 当前采访只服务能够由品牌、型号、规格、分类或标准稳定识别的标准商品；手工制品、孤品和定制品等非标准商品不在范围内。
- 仓库提供专用 `interview-product-category` Skill，沿用 `grill-with-docs` 的一次一问和推荐纪律，但服务于专业数据抓取。Skill 只定义调查、解释、提问和草稿综合行为，不拥有消息、决定、任务或数据库。
- 可调查的标准/监管、品牌、型号、参数、部件、原理、来源平台、网站和具体入口由系统主动调查。只有无法由调查代替、会实质改变抓取结果且必须由负责人承担的取舍才形成 Interview Decision。
- 每个问题必须解释背景，给出有依据的专业推荐和主要代价。推荐项是当前证据下的默认正确方向，不得为了凑 2–3 个互斥选项制造没有业务意义的问题。
- 主要平台覆盖属于系统主动规划的数据资源。对冰箱等家电，京东是必须覆盖的核心平台，淘宝是后续同级多平台来源；不把“是否纳入京东/淘宝”或“去哪个网站”作为负责人采访问题。当前没有淘宝 crawler/Provider；候选平台必须覆盖不等于已经接入或获准访问，真实执行仍受 Crawl Plan、许可、登录、验证码、风控和频控停止门约束。
- Workbench 拥有 Interview Session、规范化 Message、append-only Interview Decision、未决项、版本化 Capture Task Draft 和全部继续上下文。消息、调查活动、用户原文、决定、未决项和草稿版本共同组成采访工作资料；Codex 不拥有产品 thread 或任务事实。
- Agent 的问题和建议不能自行成为 confirmed，也不能把 Composer 变成选项表单。Workbench 先保存负责人原文并把它交给下一轮 Codex；Codex 结合当前 proposal 和全部工作资料解释回答、纠正、补充、否定问题前提或追问。明确回答可解决当前问题；成立的前提否定必须撤回问题，不能被强行解释成选择或继续遗留为负责人未决项。
- Codex final answer 是本轮理解增量，不重报完整会话状态；可以包含助手说明、当前决定解释或撤回、下一问题、未决项变化和完整草稿候选。用户同一句话里的选择与附加事实必须同时进入记录和下一版草稿；若本轮只是解释且范围未变，应明确表达“当前范围不变”，不伪造决定或草稿修订。
- 任意新输入都会先让上一版草稿离开当前可确认态。只有最新回合已经结束、会话空闲、最新完整草稿处于待确认态且没有负责人未决项时，Workbench 才允许确认；模型生成草稿或说明范围未变都不是确认。用户显式确认后才创建或推进同一 Capture Task revision，确认不触发真实抓取。
- `web_search` 只用于发现候选入口，不能自动证明页面已打开、内容已读取、来源已授权或已有 crawler/Provider；采访草稿按实际已知状态保守记录。
- 首次调查一个品类以及把既有采访切换到另一品类时，必须至少完成一个 `web_search` item，只有 started/failed 事件不满足调查门。后续纯解释或范围未变回合不强制重复搜索。
- 来源观察时间由 Workbench 掌握：模型给出的 `observedAt` 不具权威性，Workbench 在草稿提交时写入当前时间。
- 失败或中断后的用户重试只允许重放最近一条失败/中断的原始用户消息，且该消息之后不能已有完成的 assistant 回复；更早历史消息不能被伪装成 retry target。

## 技术边界

- Chat Timeline 使用 `assistant-ui` ExternalStoreRuntime；消息和业务状态仍完全归 Workbench/PostgreSQL。
- Codex 使用锁定版本的 App Server `stdio`，每轮只启动 `thread/start(ephemeral:true)`；不 resume、不持久化产品 thread。
- commentary 使用官方 delta，final answer 在服务端通过领域 Zod contract 后才持久化。结构化机器 contract 属于 runtime/Workbench 边界，采访 Skill 只定义行为，不复制 JSON 字段或传输协议。
- MVP 不引入 Pi Agent、agent registry、多模型 Provider 或自动 fallback。

## 后果

- Roadmap 1A 的完成门是：真实用户认可 Agent 的专业调查、解释、推荐、问答颗粒度和最终 Capture Task Draft，而不是仅证明 Chat/流式/UI 可运行。
- 采访 Skill 的行为和确定性领域校验必须分别验证；提示词中的“不得编造”不能替代 Workbench 对未决项、来源观察和草稿状态的不变量保护。
- 1A 未通过时默认不冻结后续实现；用户已于 2026-08-19 明确授权独立实现 1B 最小 Crawl Plan 纵切片。该例外只覆盖计划生成、修订和确认，不覆盖 Provider、Source Run 或真实来源访问。
