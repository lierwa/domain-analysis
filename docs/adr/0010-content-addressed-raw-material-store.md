---
status: accepted
date: 2026-08-14
---

# 最小证据字节使用 cacache 内容寻址，PostgreSQL 保存可查询目录

本 ADR 的内容寻址决定继续有效，持久化范围由 ADR-0011 收窄：只把已选择的最小证据字节和规范化 evidence manifest 使用 `cacache@19.0.1` 按 SHA-256 SRI 保存。`public` 与 `restricted` 使用物理分离目录。Workbench PostgreSQL 只保存来源对象、访问观察、证据目录和完整性元数据，不保存大 Blob。整页 HTML、全页截图、完整无关文档和资源清单不再默认持久化。

## 调查与实证

- Crawlee Dataset 是追加数据集，但单对象大小和批量事务边界不适合作为不可变证据仓库。
- Crawlee KeyValueStore 的 key 可以覆盖，缺少本项目需要的内容寻址、同内容去重与读时完整性语义。
- `cacache` 是 npm 使用的成熟内容寻址实现，提供 SRI 校验、原子写、并发安全、去重和损坏检测；19.0.1 支持当前 Node 21，最新版 21 不支持，因此不为追新升级运行时。
- 既有测试已经验证公开/受限隔离、同内容去重、并发写和完整性读取；这些证明内容寻址实现可复用，不证明旧的整页保存范围正确。新 contract 必须补文本引文、文档片段、表格区域和图片 crop 的真实证据验证。

## 提交协议

1. Source Access adapter 只产生 typed observation 和待选证据，不写数据库或文件目录。
2. Evidence Module 校验 EvidenceRequest、locator、对象关系、隐私和最小化规则，只把获准证据写入相应 privacy class 的 CAS。
3. 规范化 evidence manifest 并写入同一 CAS。
4. 最后在一个 PostgreSQL 事务内提交来源对象、访问观察、EvidenceItem 和资源目录。
5. 稳定 attempt key 保证 DBOS/Crawlee 重试幂等；相同内容按 SRI 去重，新采集不覆盖历史。

## 来源变化事实

Source Access adapter 只提交标准 HTTP 条件检查观察；Source Observation 目录拥有“这次是否检查、外部表示是否变化”的事实。`304` 可以证明服务器表示未变化，但不能自动证明某个旧知识仍充分；`200` 只在重新完成 EvidenceRequest 后提交新的 EvidenceItem。内容哈希比较仅针对选中的证据字节，不能冒充整页变化检测或整页重放。

只保存 allowlist 后的 `ETag`、`Last-Modified`、检查/下次检查时间和判定方法，不保存 Cookie、`Set-Cookie` 或任意响应头集合。Crawlee FileDownload 与 Playwright 的条件请求兼容仅留在 Provider 外部协议 adapter；PostgreSQL 目录不依赖浏览器 cache，也不形成自研 HTTP cache 或 scheduler。具体版本缺口和退出条件见 R-025。

## 后果

- 数据库备份和内容目录备份必须作为同一证据备份集；阶段 6 再冻结恢复、配额和清理流程。
- 只有目录事务已提交的资源才属于正式 EvidenceItem。CAS 中可能存在崩溃留下的无引用内容，未来可按目录可达性安全清理，不能在写入路径自研分布式事务。
- 受限资料不能因为与公开资料内容相同而跨 privacy class 共用物理目录；认证 Profile、Cookie 和 Header 永远不进入 CAS、日志、Git 或知识包。
- 最小证据只能重跑它已经支持的候选加工。新知识问题需要旧证据之外的上下文时必须重新访问来源，不能声称可从 CAS 恢复整页。
- 覆盖投影必须按 EvidenceRequest 判断 `sufficient / insufficient / waiting / failed`，不能仅凭页面访问成功、旧快照存在或 HTTP 未变化判定 covered。
