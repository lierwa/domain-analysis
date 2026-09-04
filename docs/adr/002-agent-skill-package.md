# ADR-002：知识产线发布标准 Agent Skill

状态：已接受
日期：2026-09-04

## 简单说明

知识产线发布的成品是一个标准 Skill 文件夹及其 ZIP。Agent 先读取简短的 `SKILL.md`，需要具体事实时运行查询脚本或读取结构化数据；资料来源和合格图片随版本一起交付。

## 背景

阶段 2 需要把标准商品资料交付给 Perfume、Tutor 一类 Agent 使用。`opencode-dev` 的真实实现表明，两类知识都由结构化数据和确定性查询接口承载：Perfume 使用 `notes.json`、分类数据和 search/list/summarize 工具；Tutor 使用关系数据与 evidence-candidates 聚合查询。仅提供资料文件清单无法表达 Agent 的触发方式、读取步骤和查询入口。

Agent Skills 规范定义了稳定的最小目录：必需 `SKILL.md`，可选 `scripts/`、`references/` 与 `assets/`，并采用按需加载。这个结构可以同时携带使用说明、查询代码、结构化事实、来源和图片，且不绑定具体 Agent 宿主。

## 决定

1. Knowledge Processing 新生成的版本使用 `agent-skill` 格式；ZIP 只有一个顶层 Skill 目录。
2. 顶层目录名、`SKILL.md` 的 `name` 和知识包 `skillName` 保持一致，遵守小写字母、数字与单连字符规则。
3. `SKILL.md` 只保存触发描述、范围边界与读取步骤；事实进入 `assets/data/catalog.json`，来源进入 `assets/data/provenance.json`，合格图片进入 `assets/images/`。
4. 包内提供无外部依赖的 `scripts/query.mjs` 与 `scripts/validate.mjs`。宿主可将查询能力映射为领域工具，本项目不预设宿主协议。
5. 建包只消费服务端准入结果。未决审核内容、原图、遮罩、加工缓存和内部审核记录不进入 Skill。
6. 每个版本保存文件清单、bytes 和 SHA-256；发布后下载已冻结 ZIP。历史版本按其原始格式与哈希继续保留。

## 后果

- Perfume 类目录知识可以使用枚举、过滤和聚合查询，Tutor 类关系知识可以按任务、模板和知识点关系聚合；两者共享 Skill 交付结构，不共享具体领域 schema。
- 产线与 Agent 宿主之间的稳定边界是版本化 Skill ZIP。宿主安装、启用、工具注册和版本切换继续属于跨工程工作。
- 新的领域数据形状通过 `catalog.json` 版本与查询脚本演进。退出标准 Skill 时，结构化数据和来源文件仍可独立迁移，不依赖运行服务。
