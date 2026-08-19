# ADR-0014：跨品类来源数据事实层

状态：旧 Product Project / Evidence contract 由 ADR-0015 取代；只保留“跨品类原始来源事实不能按站点复制”的历史设计依据

日期：2026-08-17

## 背景

现有 `OfficialCatalogSnapshot` 只表达品牌和厂家型号，无法保存官网完整详情、标准/技术文档、销售平台分类和评价样本；`EvidenceItem` 又是围绕已确认知识问题选择的最小证明，不能反向承担来源发现阶段的原始结构。若为京东、官网、监管和每个商品品类分别建表或 DTO，会把站点与冰箱字段写进公共架构。

## 决定

- 新增唯一 `SourceDatasetModule` 公共 seam：`startRun / commitSnapshot / commitAsset / finishRun / getRun / listProject / exportRun`。API、PC、Provider 和测试均通过该 seam，不直接读写来源表。
- Workbench PostgreSQL 独占 `SourceCollectionRun / SourceObject / SourceSnapshot / SourceAsset` 事实。DBOS 只拥有持久工作项、尝试、恢复、取消和执行生命周期；两者不得互相推导状态。
- `SourceCollectionRun` 从 confirmed Product Project 自行冻结 Category Definition、Scope、Collection Board、来源 lane、Provider 和访问政策版本。调用方不能重复提交另一套品类事实。
- `SourceSnapshot` 使用运行内幂等键逐条事务提交；相同键和相同内容返回原记录，相同键不同内容拒绝。同一 SourceObject 的后续观察必须追加新快照，历史不可覆盖；失败/停止运行中已经提交的快照继续可读和可导出。
- 公共内容只允许四种严格校验的 discriminated kind：`ordered_record / document / catalog / experience_collection`。有序字段允许重复原始名称；文档保留有序章节；目录保留原始分类/筛选和对象引用；体验集合保留汇总、采样计划和去个人化样本。
- 公共 contract 不出现京东、冰箱、SKU、价格、压缩机或其他品类固定字段。外部对象使用 `objectKind + externalKey`，来源可证明范围使用 `claimScope`，品类差异作为数据表达。
- 来源 authority 与使用许可分离。每个快照独立记录本地读取、模型输入、Evidence 保存、派生知识发布和原文再分发许可；权威来源不能自动获得内容使用权。
- 允许持久化的附件字节写入现有 `cacache`。相同字节复用内容地址，但每个 snapshot/assetKey 的来源 URL、用途、区块、顺序和关系独立保留。
- JSONL 是完整保真导出；`ordered_record / catalog / experience_collection` 提供 CSV 表格投影并防止公式注入。`document` 必须使用 JSONL，不伪造扁平 CSV。
- Source Dataset 只保存来源事实并支持发现/重跑，不是 Evidence 或知识。Market Universe、Knowledge Need、EvidenceRequest 和知识候选必须显式从快照投影，不能回写或让 Provider 直接发布知识。
- 来源采集执行使用稳定 DBOS 父/子 workflow：每个对象的外部访问是无自动重试 step，完成结果再以工作项 ID 幂等提交 Source Dataset；频控等待使用 durable sleep。DBOS 事件只投影执行进度，不成为来源事实。
- 监管与来源采集 workflow 必须在单一 `ProductKnowledgePipelineRuntime` launch 前注册；该组合根拥有 DBOS 进程生命周期，各业务 module 只拥有自己的 typed 执行接口。
- confirmed brief 必须用 `sourceAssignments` 显式声明“来源入口＋路线＋Knowledge Need＋可选通用资源选择”；服务端 `SourceCollectionPlannerModule` 是将其展开为持久化 plan/batch/work item 的唯一入口，客户端不得提交工作项。Planner 不得按同 lane 或知识层交集猜测一个来源能证明哪些问题。
- 通用资源选择只允许 `full_resource / document_excerpt / structured_record_lookup`。具体 PDF 定位和监管字段协议由薄 Provider 在外部 seam 校验收窄，不向 Runtime contract 暴露品类、品牌、型号、SKU 或站点字段。
- `SourceEvidenceModule` 是 Source Dataset 到 Evidence 的唯一桥：它校验 project/lane/target/knowledge need/许可绑定，从有序字段或操作员显式选择的 TextQuote 形成最小不可变 EvidenceItem。Provider locator 只是候选，Workbench 仍重新验证；没有 locator 的长正文必须由操作员选择原文片段，不能把整页当证据。

## 被拒绝的方案

- 逐站点、逐品类专用表/DTO：切换品类需要迁移、公共接口变更和条件分支。
- 单一 `jsonb metadata: unknown`：无法在边界校验内容、关系、许可、查看和导出。
- 整页/整文件默认进入 CAS：会扩大隐私、许可和无关内容边界，且不能直接提供结构化事实。
- 来源内容直接成为 EvidenceItem：混淆“发现阶段取得了什么”和“某个已确认问题由什么最小证据支持”。

## 后果

- 官网、监管、权威技术资料、京东以及电视等第二品类使用同一数据库结构和公共接口；新增来源 adapter 只隔离真实协议/访问差异。
- 第一条 PostgreSQL 纵切片已证明冰箱和电视可用同一 interface 提交、重启读取、幂等追加、失败保留、附件内容去重和 JSONL/CSV 导出；PC 已在同一来源数据页展示两品类记录与 typed 失败。
- 本地真实 60 秒窗口、DBOS 持久工作项强杀恢复和生产 DBOS 组合入口已通过；京东真实访问并未因此获准。JD reader 接线和受控 1+3 探针仍须通过 `JD-COLLECTION-DESIGN.md` 9.1 硬门；旧冰箱专用 Market Universe 京东路径不得冒充通用能力。
- R-034 已证明同一 Source Dataset/Planner/DBOS/Provider/Evidence seam 可在电视品类保存政府网页、PDF 页与 Socrata 监管记录，并继续进入 Factory、Review 和知识包；没有新增电视或冰箱专用公共 contract。它不代表历史 737 identity 已补采，也不代表京东真实采集已获准或完成。
