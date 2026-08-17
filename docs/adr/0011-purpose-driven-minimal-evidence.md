---
status: accepted
date: 2026-08-15
---

# 采集以知识需求驱动，只持久化最小证据

采集不再以“为一个网站写通用解析器”或“保存页面以备以后处理”为目标。确认后的知识需求产生 `EvidenceRequest`；Source Access 负责寻找和访问可能回答该请求的来源；Evidence Module 只持久化能够支持请求的最小 `EvidenceItem`；规则、OCR 或模型只能基于 EvidenceItem 产生候选。

EvidenceItem 必须同时保存来源身份、URL、采集时间、内容哈希、标准 locator、与请求/对象的关系和隐私等级。文本使用 exact 与必要 prefix/suffix，PDF 使用页/章节与原文片段，表格使用 sheet/表头/唯一行或单元格范围，图片使用资源身份和必要的 `xywh` 区域。只有视觉本身就是事实时才保存全图。

## 考虑过的方案

- 拒绝每个官网维护 DOM projector。未知站点和跨品类 DOM 无法预先枚举，一个真实页面成功不能证明通用能力。
- 拒绝永久保存整页 HTML、全页截图或完整无关文件后再做白名单投影。它扩大敏感数据、存储、版权、模型输入和清理边界，也让“访问成功”被误当成“证据充分”。
- 拒绝只保存 URL。外部内容会变化，URL 本身不能证明当时看到了什么。
- 接受目的驱动的最小证据。它保留当前事实的可审核性，代价是以后出现新问题且旧证据不足时必须重新采集；产品明确接受这个代价。

## 结果

- ADR-0005 被取代；`Capture Snapshot`、`Restricted Capture Snapshot` 和 `Processable Material Projection` 不再作为目标领域 contract。
- ADR-0010 的 `cacache` 内容寻址和公开/受限物理隔离继续复用，但存储对象收窄为最小证据字节和 manifest。
- Provider/Source Access 不形成最终事实，也不拥有站点专用知识字段；EvidenceRequest 拥有“为什么采”，EvidenceItem 拥有“当时看到了什么”，Knowledge Factory 只解释证据。
- 页面/文件完整内容只允许在受控临时空间存在，证据提交或失败结束后清除未选内容。认证资料永远不得进入临时加工、证据区、模型、日志、Git 或知识包。
- 旧 EvidenceItem 只能重跑它所支持的问题；不能恢复整页或回答未保存上下文的新问题。
- 图片、OCR 和模型语义判断仍须通过 R-026 的真实原型；无法证明图片与对象/知识点关系时保持 unknown 或进入人工审核。
