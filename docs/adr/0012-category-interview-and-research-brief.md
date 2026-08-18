---
status: accepted
date: 2026-08-15
amended: 2026-08-18
---

# 新品类先经聊天采访形成已确认调研任务书

## 背景

用户开启冰箱、电视或洗衣机等新品类时，不可能预先填写品牌、型号、参数、部件、原理和来源的完整清单；这些本来就是系统需要主动调查的对象。既有完整 Product Project 表单把研究结果倒置为启动输入，也容易把聊天文案、模型建议和项目事实混为一体。

## 决定

- 新品类入口是本地 Workbench 的 Chat Timeline。用户用自然语言表达目标，系统一次只问一个必须由负责人决定的问题；可从项目资料、官方资料或公开研究得到的事实由系统主动调查，不反问用户枚举。
- 仓库提供专用 `interview-product-category` Skill，沿用 grill-with-docs 的采访纪律，但内容和完成门针对本产品。Skill 只定义采访行为，不拥有会话、决定、任务书或数据库。
- Workbench 拥有 Interview Session、规范化 Message、append-only Interview Decision、未决项和版本化 Category Research Brief，并在每轮向执行器提供完整 typed state。不存在第二份 Codex thread 产品事实。
- 用户显式确认 Interview Decision 后，Workbench UI 立即以 `decision_confirmed` typed turn action 推进下一分支；该 action 不写成用户消息，也不要求用户再发送“继续”。正常用户回答与系统推进必须在 HTTP、Workbench 和 Codex adapter 边界保持可区分。
- 模型建议不能直接写入 confirmed brief。只有用户明确确认的决定进入已确认任务书；任务书随后生成 Product Project 草稿和阶段 1A 的冻结研究输入。
- Category Research Brief 必须包含真实公开调查形成的品牌、型号、参数、部件、机制和来源入口样本，每项绑定本轮实际访问的官方或监管来源。空来源或缺少任一调查类别的输出不是任务书，只能保持未决或失败；少量前置样本也不得冒充市场总体。
- 现有 ProductProjectForm 改为任务书/项目草稿的检查修改面，不再保留另一套从零创建入口。
- DBOS 从任务书确认后的正式研究 Pipeline 开始承担 durable workflow；不为每条聊天消息启动 workflow。

## 技术候选边界

- Chat Timeline 使用已通过 R-028 并接入生产的 `assistant-ui` primitives＋ExternalStoreRuntime，不使用 Assistant Cloud；消息和业务状态仍完全归 Workbench。
- Codex 执行使用锁定版本的官方 App Server `stdio`；每轮只启动 `thread/start(ephemeral:true)`，不 resume、不持久化产品 thread。浏览器只连接项目 typed streaming HTTP；adapter 将官方 commentary delta 投影为 `assistant.delta`，final answer 在服务端通过领域 Zod contract 后才持久化。
- MVP 不引入 Pi Agent、agent registry、多 Provider 或自动 fallback。`opencode-dev` 的 Host 事实源/私有 Agent adapter 边界作为架构参照，但其多 Provider、工具循环和 compaction 需求不属于本项目当前职责，因此不复制整套 Pi runtime。
- 采访 modelId 和 reasoning effort 必须用真实采访样本评测；不能继承 ADR-0001 的批次 `gpt-5.3-codex-spark + low`。

## 后果

- ROADMAP 在来源访问前新增阶段 0I；阶段 1A 只接受 confirmed Category Research Brief 生成的冻结输入。
- UI、HTTP adapter 和 Codex adapter 只能读取、投影或适配 Workbench 事实，不得从消息文案重新推导采访状态。
- 当前接受产品流程、事实归属、`assistant-ui` Chat 投影和无持久 Session 的 ephemeral App Server adapter；采访 Skill 行为与真实 Workbench 端到端仍须分别通过后续停止门。
- 第一条真实纵切片必须从“开启冰箱品类”开始，覆盖一次一问、主动调查、中断恢复、决定确认后自动推进、任务书确认、项目草稿和 PC 浏览器验收。
- App Server 的 `webSearch` item 只证明 Agent 本轮实际使用了搜索能力；最终任务书仍须由领域 contract 校验调查事实与真实来源引用，二者缺一不可。
