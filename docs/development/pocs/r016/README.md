# R-016 第二品类零分支迁移 POC

状态：历史 POC；旧阶段 1D 通过结论已撤销，等待三品类/多站点新 contract 复核
目标阶段：1D
调查日期：2026-08-14

> 本文件只保留当时“电视 fixture 可复用候选 Schema/Runtime”的证据。它没有验证未知 DOM 的最小证据，也依赖已被取代的整页采集链，因此不能继续证明阶段 1D 或全阶段 1 通过。

## 简单说明

把第一版从冰箱换成电视时，只允许增加“去哪采、电视关心什么、官方资料说了什么”三类数据，不允许给采集器、知识 Schema、数据库或 Runtime 加电视专用判断。

## 真实官方样本

- TCL 官方产品页：https://www.tcl.com/cn/zh/tvs/65-inch-t7g
- 同一 R-001 公共网页 Provider 新增数据项 `S07` 后真实采集成功：HTTP 200、`loaded`、标题/正文包含 `65T7G`、公开快照，无需登录。
- 文本 SHA-256：`674917f9b94e0739ccbd70577a87c3f47da9ea23d6e43ba5ae5e0eaad5feecfd`；HTML SHA-256：`f032d89b260663ea01c09d2628d7cab657f49010e871e1303eea45157f05ecc4`。
- 官方页覆盖 65 英寸身份、144Hz、1000 nit、96% DCI-P3、分区控光机制、Q 画质引擎、HDMI 2.1/VRR/ALLM 和体育/游戏场景。
- 页面标题是 `65T7G`，但 4K 144Hz 的一段正文写成 `T7E`。该异常保留为 `unknown`，没有为了让样本好看而自动纠正。

## 迁移输入

- `../r001/source-definitions.mjs`：只新增 S07 来源配置；采集实现不改。
- `../r008/television-category-definition.yaml`：用真实资料补齐规格、功能、机制和决策维度；仍由同一个 LinkML `CategoryKnowledgeDefinition` 校验。
- `tcl-65t7g-official-knowledge.json`：明确标为 fixture 的知识包输入，覆盖 identity/specification/function/mechanism/decision 五层和官方证据；不等同人工批准发布。

## 零分支证明

`baseline-manifest.json` 冻结以下品类中立文件的 SHA-256：

- R-001 公共网页采集实现；
- R-015 知识包 Zod Schema；
- R-015 SQLite＋FTS5 构建/通用 Runtime；
- R-015 原子切换/回滚。

测试不仅复核哈希，还拒绝这些文件出现 `television`、`65T7G` 或 `TCL`。电视知识随后用同一 Schema 建成只读 SQLite 包，并通过型号、中文全文、144Hz 数值筛选、五层知识、证据和 unknown 查询。

## 边界

一个 TCL 型号只证明迁移成本和 contract，不证明电视市场覆盖已完成，也不代表这些 fixture claim 已获人工发布许可。1D 的目标是发现系统是否偷偷绑定冰箱；品牌/型号总体覆盖属于后续正式建设。

## 结果

- LinkML 1.11.1 对电视 `CategoryKnowledgeDefinition` 校验通过；
- R-016 测试 2/2 通过，通用文件哈希与品类词禁入检查通过；
- 同一 SQLite＋FTS5 Runtime 通过型号、中文全文、144Hz 数值、五层知识、证据和 `unknown` 查询；
- R-001、R-014、R-015、R-016 合计 20/20 通过；根工程测试 12 文件/52 项、typecheck 和 build 通过。

历史结果说明旧 fixture 没有修改当时冻结文件；按当前 R-026/ADR-0011，这不足以通过 1D。必须用新 EvidenceRequest/EvidenceItem 和真实多站点样本重新验证。
