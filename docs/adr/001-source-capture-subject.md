# ADR-001：Source Capture Subject 归属 Source Dataset

状态：已接受
日期：2026-08-31

## 简单说明

Provider 抓取时已经知道“这是哪个品牌、哪个型号”。系统把这项源站事实随工作项保存，数据地图直接读取；前端不再从 URL、内部工作键或错误文案猜测。

## 背景

Source Dataset 当前保存不可变原始资源和运行血缘，但没有保存品牌、型号与资源之间的 typed 关联。Run/深度适合审计，不适合作为商品数据地图。把来源特有解析下放到 Web 会制造第二事实源，也无法可靠回填历史数据。

## 决定

1. Source Dataset 拥有批次内唯一的 Capture Subject，当前只有 `brand` 和 `product_model`。
2. ZOL Provider 通过现有 `ensureCaptureWorkItem` seam 提交 subject；Source Dataset 隐藏幂等、父子关系、外键和冲突处理。
3. Snapshot 关联真实 Capture Work Item；资源到型号的归属沿 `Snapshot -> Work Item -> Subject` 读取。
4. Capture Subject 只保存源站实体 ID 与显示名称，不建立跨来源标准商品，也不提取参数值。
5. Workbench 是 Batch 汇总、型号完成度和逻辑问题的唯一投影者；Web 只负责渐进展示。
6. 历史回填只能由来源 adapter 解释自身工作键，并且只新增派生关联；原始快照、哈希、Run 和已确认计划保持不变。

## 后果

- 商品数据地图可以稳定展示品牌、型号和资源组；运行审计继续保留 Run/记录组结构。
- 共享 contract 不包含 ZOL URL、DOM、工作键或品类常量。
- 新 Provider 只有在真实识别出标准商品身份时才提交 subject；无法识别的记录保持未归类。
- 后续阶段 2 必须另行设计标准化商品和参数模型，不得把 Capture Subject 当成知识实体继续扩张。
