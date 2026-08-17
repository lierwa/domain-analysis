---
status: accepted
date: 2026-08-17
---

# MVP 批次知识加工使用项目锁定的 Codex ephemeral exec

本决定只约束 Knowledge Factory 的批次候选加工，不约束阶段 0I 的品类启动采访。Workbench 通过项目直接依赖并锁定的官方 `@openai/codex` 包运行 `codex exec --ephemeral`，复用用户本机已经登录的 Codex；不读取认证文件，不接通用模型 API，不创建或恢复 Codex thread，也不建设多 Provider 层。

R-029 已证明官方 TypeScript SDK 的 thread API 与本产品“每批无状态、全局 Session 零新增”的边界不一致；稳定 CLI 的 `--ephemeral --json --output-schema --output-last-message` 可以直接表达该边界。因此使用 `execa` 管理进程/超时/取消，`ndjson` 只解码官方事件流，Zod 与 JSON Schema 校验最终结果。这是官方 CLI 的薄 adapter，不自研会话、重试、结构化输出协议或认证。

## 后果

- Knowledge Factory 只依赖领域中立的 `KnowledgeCandidateModelPort`；CLI 参数、事件和临时文件停留在 `codexExecClient` adapter。
- 生产默认使用仓库锁定的 `@openai/codex@0.147.0`，不命中可能损坏或漂移的全局 CLI。
- 每个批次在空临时目录中运行，`read-only` sandbox、`never` approval、`--ephemeral`、无 Web search；schema、最终输出和工作目录无论成功、失败或取消都删除。
- 当前组合根只允许精确的 `gpt-5.3-codex-spark + low`；错误简称 `codex-5.3-spark` 已删除，不允许兼容别名、继承默认模型或静默 fallback。
- 模型只看 `usagePermission.modelInput=allowed` 的最小证据，并只能引用当前批次的 knowledge need、subject 和 evidence ID。输出永远是 `review_required`。
- 同一知识需求含 `foundational_concept` 与品类/型号对象时，模型输出必须同时包含“概念拥有的原理/条件/边界/取舍事实”和“品类/型号指向概念的关系”；缺任一项整批拒绝。
- Cookie、认证 Header、浏览器 Profile 和未获准内容不得进入模型。模型不能发布知识；Review Decision 仍是唯一人工门。
- 品类启动采访的 Skill、Chat Timeline、搜索完成门、modelId 与 reasoning effort 由 ADR-0012/R-029 单独约束，不继承本决定。
- 新增网页语义寻找、OCR/图片理解、聊天、模型 registry、其他 Provider 或 fallback，必须重新调研、POC 和确认。
