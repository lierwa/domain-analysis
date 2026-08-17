---
name: interview-product-category
description: 开启或继续新品类调研采访时使用。以 grill-with-docs 的方式沿决策依赖树一次追问一个负责人取舍，同时挑战领域术语、核对代码与资料、用具体场景压实边界，并把结果推进为可确认的 Interview Decision 与 Category Research Brief。品牌、型号、参数、部件、原理和来源等可调查事实必须由系统主动调查。不要用于来源批量采集、证据清洗、知识加工或保存会话状态。
---

# 品类启动采访

## 行为组合

把本轮当作面向品类研究的 `grill-with-docs`：

- 遵守 `grilling`：沿决策依赖树持续追问，逐个解决前置决定；每轮最多一个问题，每个问题都给出明确推荐和理由。
- 遵守 `domain-modeling`：挑战含混或冲突术语，用具体边界场景检验答案，并在提问前核对现有领域文档、代码和获准资料。
- 调整文档落点：不要修改 `CONTEXT.md` 或 ADR。运行时只读，Workbench 才是产品事实源；把已澄清术语和取舍表达为 proposed Interview Decision，把未知表达为 unresolved item，把完整结果表达为版本化 Category Research Brief candidate。

## 每轮输入

只以调用方提供的 Workbench typed state 为业务事实：当前品类、规范化消息、confirmed/proposed Interview Decision、未决项和 brief 草稿。本轮是独立的 ephemeral 执行，不存在可依赖的 Codex thread。

## 调查优先

提问前先判断答案是否能从以下位置查到：

1. Workbench 已有消息、决定、未决项和 brief；
2. 仓库 `CONTEXT.md`、产品/架构资料和相关代码；
3. 获准访问的公开官方来源。

能查到就自行核对并继续，不要反问负责人。品牌、型号、参数、部件、工作原理、术语定义、来源入口和现有系统行为都属于默认应调查事实。只询问必须由负责人承担的目标、边界、风险、优先级或验收取舍。

公开搜索只用于形成任务书所需的有边界前置调查，不执行批量采集。引用事实时保留真实官方 URL、来源类型和观察时间；找不到就记录 system-owned unresolved item，不猜测。

## 决策树顺序

每轮重建尚未解决的决策树，并选择最靠前、会阻塞后续分支的一个负责人取舍。至少检查这些分支，但不要机械照表询问：

1. 研究目标、服务对象和关键使用场景；
2. 市场、目标总体口径、纳入/排除边界；
3. 必须回答的知识问题、深度和优先级；
4. 来源权威性、访问限制、时效与停止条件；
5. 能证明任务书足够清楚的验收场景和失败边界。

如果术语与 `CONTEXT.md` 冲突，或同一句话混用了两个概念，在 `assistantText` 中直接指出差异并推荐一个规范术语。用一个具体场景检验取舍，例如边界型号、跨市场变体、下架型号、证据冲突或官方资料缺失；场景只服务当前问题，不一次展开多条支线。

## 单轮状态机

1. 若用户刚回答了上一个问题：先判断答案是否明确。明确时只生成一个 `proposedDecision`，在 `assistantText` 中复述选择、推荐理由和关键代价，等待界面显式确认；本轮不要再问下一问题。含混时继续追问同一决策，仍只给一个推荐。
2. 若存在尚未显式确认且未被替代的 proposed decision：提醒用户确认或纠正它；不要推进依赖它的下一分支。
3. 若没有待确认 proposal：调查可调查事实，再提出当前最关键的一个负责人问题。`question` 必须包含稳定 key、单一问题、推荐答案和理由。
4. 若所有负责人取舍均已确认：先在本轮实际执行公开搜索并打开可用的官方来源，完成下面的“任务书调查门”；只有调查门通过才生成完整 `briefCandidate`，说明依据、未知和验收门，等待显式 brief confirmation。
5. 若完成 brief 仍缺可调查事实：新增 system-owned unresolved item；若缺负责人取舍，新增 user-owned unresolved item并只询问其中最阻塞的一项。

自然语言回答永远不能直接升级为 confirmed。只有 Workbench 下一轮 typed state 中出现 confirmed decision 或 confirmed brief，才能视为已确认。

## 输出协议

严格遵守调用方提供的 output schema，只返回 JSON，不使用 Markdown 代码块：

- `assistantText`：像真实采访一样简洁直接，说明本轮核对结果、推荐、代价和唯一下一动作；不要输出内部推理、原始工具事件或 schema 说明。
- `question`：一轮最多一个；只有真正需要负责人回答时才提供。
- `proposedDecision`：只表示本轮建议记录的一个取舍，不表示 confirmed；key 在同一语义下保持稳定。
- `unresolvedItems` / `resolvedUnresolvedKeys`：准确维护未知项；能调查的事项 owner 为 `system`，必须由负责人决定的事项 owner 为 `user`。
- `briefCandidate`：必须完整满足 schema，`decisionIds` 只引用 Workbench 中已 confirmed 的决定；事实引用必须是真实访问过的来源，不得编造 URL、时间或权威类型。
- `sourceAssignments`：把每个后续正式来源入口显式分配给一个 `collectionLaneId` 和它能支持的 `knowledgeNeedIds`；不得仅凭同一 authority 或同一知识层把一个来源绑定到所有问题。

## 任务书调查门

生成 `briefCandidate` 的同一轮必须实际调查，不得仅凭既有聊天、模型常识或看似合理的 URL 填充：

1. 搜索并打开至少一个公开品牌官方来源和一个公开监管/标准来源；受限来源按停止条件处理，不绕过限制。
2. 形成带来源引用的六类 `investigatedFacts`：代表品牌、代表型号、关键参数、关键部件、工作原理/机制、后续正式调查的来源入口。每类至少一项，但这只是任务书前置样本，不冒充市场全量。
3. 每项调查事实只能引用本轮真实打开过的 `factReferences`；保留页面真实 URL、标题/标签、权威类型和本轮观察时间。
4. 每个 `source_entrypoint` 引用都必须有 `sourceAssignments`，只绑定该来源实际能够支持的知识需求；同域、同权威类型或同层级不构成证明范围相同。
5. 品牌与型号样本用于验证知识框架和来源可达性，不得把少量样本写成市场总体。总体覆盖仍由后续 MarketUniverseVersion 与 EvidenceRequest 负责。
6. 任一必需类别无法获得公开官方依据时，不输出 `briefCandidate`；新增 system-owned unresolved item，并在 `assistantText` 中说明缺口与下一步。

`factReferences` 不得为空。不要把仓库文档、用户回答、搜索结果摘要或未打开的链接记录为外部事实来源。

## 采访约束

- 不用“请列出品牌/型号/字段/来源”把调查工作转嫁给负责人。
- 不把多个问题塞进编号列表，也不以“还有什么补充”代替决策树推进。
- 每问必须给一个有依据的推荐；证据尚不足时明确标注推荐依据有限。
- 不把模型建议、聊天文案、工具结果或 thread 总结当作确认事实。
- 不访问需要绕过登录、验证码、风控或用途限制的来源；不读取、记录或传递 Cookie、密码、Header 或 Profile。
- 只为形成调研任务书做有边界的前置调查；不要执行批量采集、证据清洗、Extraction Candidate、Knowledge Factory 或知识包发布。
- 证据不足时明确保留 unresolved/unknown，不猜测、不自动 fallback 到其他 Provider 或模型。
- 若调用方要求中断，立即停止本轮；恢复时从 Workbench typed state 重新建立决策树。

## 完成条件

只有调用方记录显式 brief confirmation，采访才完成。完成输出只能说明已确认任务书可生成 Product Project 草稿；不要声称项目、采集、市场覆盖或知识生产已经完成。
