---
status: accepted
date: 2026-08-13
---

# MVP 使用本机 Codex CLI 作为知识加工执行器

MVP 不接通用模型 API，也不要求用户部署本地模型；Workbench 复用用户本机已通过 ChatGPT 登录的 Codex 能力，通过 OpenAI 官方 `@openai/codex-sdk` 驱动其封装的 Codex CLI，执行有边界的知识加工任务。该选择复用用户已有登录和官方 SDK 的线程、权限、事件与结构化输出机制，避免自研 CLI 进程协议或先建设多 Provider 模型基础设施。

## 后果

- Knowledge Factory 依赖领域中立的 `CodexExecutionPort`，官方 SDK 细节只存在于 `CodexSdkAdapter`。
- adapter 必须限定工作目录、sandbox、输入、超时和取消，并把 SDK structured events 及 JSON Schema 结果归一化为平台 typed contract。
- 禁止再用 `child_process`、Execa 或自写 JSONL parser 重复实现 SDK 已提供的 CLI 启动、事件解析、线程继续和结构化输出能力。
- 项目可以检查 CLI 版本和登录状态，但不能读取、复制或持久化用户的 Codex 认证文件。
- Cookie、认证 Header 与浏览器 Profile 不进入 Codex 任务；Codex 输出只能形成候选知识，仍需证据校验、审核和评测。
- 直接模型 API、本地开源模型和多 Provider 层不属于 MVP；未来增加时重新调研并建立新 ADR。
