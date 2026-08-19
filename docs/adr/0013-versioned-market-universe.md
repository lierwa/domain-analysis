# ADR-0013：版本化市场总体与型号 identity

状态：由 ADR-0015 取代，仅保留为历史记录

日期：2026-08-16

## 背景

四份人工指定 URL/型号的 EvidenceItem 只能证明底层来源可访问，不能提供覆盖率分母。商品目录还会把颜色、库存、价格和 seller SKU 展开成多行；若直接按目录行或 URL 计数，会把同一厂商型号重复当成多个型号。

## 决定

- Workbench PostgreSQL 新增版本化 `MarketUniverseVersion`，状态分为 `candidate / confirmed / superseded`。
- 型号唯一 identity 是“规范化品牌身份＋厂商型号”；品牌 identity 与监管生产者分开保存。SKU、颜色、Offer、库存、重复目录行和同型号不同页面只形成来源引用，不产生 Product Variant，也不再保存误导性的 `variantCount`。
- 每版保存观察窗口、来源类型与 URL、声明/读取/接收行数、来源内唯一型号数、来源完整性、来源角色、实际观察品牌、型号引用和 scoped unknown。来源角色区分独立品牌目录、多品牌官方商城、监管按型号查询和官方渠道发现；同一多品牌商城中的品牌标签不能冒充多个独立官网完成。
- 产品类型是同一型号集合的分轴覆盖，不建立第二套总体。首版覆盖维度为监管产品类别、安装形态和门体布局；逐型号记录 `classified / unknown / not_applicable`，监管产品类别是确认必填。
- Source adapter 只交付官网目录或监管查询的 typed observation；Workbench Market Universe Module 负责跨来源去重并拥有最终候选总体。监管查询按官网已知型号交叉生产者/备案，不以不可信的分页 total 反向枚举当前在售市场。
- 监管批量对账冻结 candidate ID/version/content hash，以稳定业务 ID 逐型号执行；只在结果全部收齐后由 `MarketUniverseModule.applyRegulatoryReconciliation` 乐观锁生成一个新 candidate。父运行 ID 同时作为 operation ID 和输出 candidate ID，使服务端能在页面刷新后反查产生该版本的运行；重试同一 operation ID 返回同一版本，候选已变化则拒绝写入。运行进度留在 DBOS，不复制成第二套业务事实。
- 确认命令必须携带 expected version 与 content hash；存在 blocking unknown、未核验型号身份或必填分类未知时拒绝确认。确认新版会保留并 supersede 旧确认历史。
- 当前海尔 271、美的系 222 与 TCL 44 个唯一型号只形成 537 个候选分母。监管、京东官方自营和其余品牌官网未完成同窗枚举前禁止确认/冻结。

## 后果

- Acquisition Planning 以后只能从 confirmed `MarketUniverseVersion` 生成批量 EvidenceRequest，不能从队列 URL 或已有证据反推范围。
- 新目录刷新会 supersede 旧候选但保留已确认历史；用户能审核来源差额和 unknown。
- 京东详情遇 403/验证时保持 unknown，不从标题推测厂商型号，也不自动绕过访问限制。
- `content_json` 本来就是版本化 JSONB，且当前实际库没有旧 Market Universe 行；本次 contract 替换不需要伪造 DDL migration。若后续发现其他机器存在旧形状，读取 Schema 将明确拒绝，必须另做只读盘点和迁移决定。
