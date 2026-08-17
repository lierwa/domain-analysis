# R-034 电视第二品类真实纵切片

状态：2026-08-17 通过（macOS arm64、Node 24、本机隔离 PostgreSQL）

## 目的

证明系统不是冰箱专用：只增加电视任务书和来源规则，不修改公共数据库结构、Factory/Review/Package/Runtime interface 或通用流程，即可贯通底层概念、品类知识和真实型号。

## 链路

`Category Interview → confirmed brief → Product Project → Source Planner → DBOS → DOE/EPA Providers → Source Dataset → Evidence → Factory → Review → SQLite Package → copied offline Runtime`

真实来源：

- DOE Television Sets 定义页；
- DOE Purchasing Energy-Efficient Televisions；
- DOE Solid-State Lighting R&D Opportunities 报告第 8 页；
- EPA ENERGY STAR Model Index Socrata 数据集 `8wj2-sec8`，精确记录 `pd_id=2399940`。

## 运行

```bash
POSTGRES_DATABASE_URL=<isolated-postgres-url> \
  npx tsx docs/development/pocs/r034/run-real-television-chain.ts
```

默认使用新的临时 Evidence/Package 目录并在成功、失败或取消后删除。只有为了本地 PC 验收时才显式设置 `R034_ARTIFACT_ROOT=/tmp/<exact-isolated-dir>` 保留产物；验收结束必须删除该精确目录。

## 最新结果

- project：`project-5c09536c-d58d-4197-8aa8-194b5a8d0c6e`
- plan：`plan-3965b11d-5dff-4432-ac1e-7741f13f54a3`
- Source Dataset：4 条真实记录（DOE HTML×2、DOE PDF 页×1、EPA ordered record×1）
- Evidence：4 条最小证据；PC 又成功提交一条 349-byte TextQuote
- Factory：22 候选，其中模型 21、确定性 1；0 conflict、0 unknown、3 条关系
- Package：22 状态、4 证据、180224 bytes；version `b2bb867cdb10cc9be71a6cddbc30b2645c961b80a7a0037702318e85940e0442`
- DB SHA-256：`c5e7379e0c61c2197f23de7c83dd4a415987b7999f5b6e14916330fa1e6552f4`
- 相同输入重建版本一致；复制单文件后离线搜索 `LE-32T1`、关系和证据查询通过
- Workbench 页面显示 3 个 foundational concept、1 个型号、3 条来源路线、最小证据选择、22 条已审核知识和激活包

## 边界

- Factory 固定 `gpt-5.3-codex-spark + low`，无 Web search、无 fallback，输出只形成 `review_required` 候选。
- DOE 证据因再分发许可 unknown，只把 locator/hash 放入知识包；EPA 公共数据最小记录可携带内容。
- 本 POC 没有访问京东，不代表 ROADMAP 1A 的完整市场总体、动态页、图片、Linux/Windows 或 JD 频控探针完成。
