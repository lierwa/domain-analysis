# Issue 03：京东商品覆盖量与任务分母对齐

Status: ready-for-human

## 问题

真实电视 Crawl Plan 虽有 16 个来源、25 个 target，但 4 个京东入口各只规划 `first_matching_product`，最终只有 4 个商品详情。Capture Task 已确认“主流品牌全系在售、不同在售尺寸分别纳入”，当前 `jd.catalog-product@1.0.0` 无法兑现该覆盖分母。

## 归因

- `plan-product-crawl` Skill 把京东来源固定为 `catalog + first_matching_product`、请求预算 2；
- `jdCatalogProvider.ts` 的 validate 和 collect 实现同样只接受并执行这两个 target；
- 因此这不是再补 Prompt 或 JSON 校验能解决的问题，也不能用来源/target 总数冒充商品覆盖量。

## 下一步边界

进入开发前先调研并原型验证 JD 目录的可稳定枚举分母、分页/滚动行为、去重键、频控和登录/风控停止门，再决定是扩展现有 Provider 还是新增版本。计划必须用 `all_available` 或经用户确认的 `target_count/sample` 诚实表达数量，Provider 必须能执行同一语义。

该项会改变 Provider 能力与计划约束，不能混入 Issue 02 的同线程 repair；当前仅登记，不实施、不确认现有计划、不 Start。

2026-08-21 频控审计补充：该 Issue 还不能进入目录枚举原型。旧 JD Provider 把一次 `page.goto` 当一个请求，Prepare/Preflight 又各自绕过 gate 访问页面，浏览器子请求、redirect 和重启后的冷却均未受控。当前 Provider 已失败关闭；先完成 R-032 登记的持久准入、工作项恢复、逐请求 observation 与本地强杀门，或证明 JOS 官方 API 覆盖本期字段并取得权限，之后才能继续本 Issue。登录和真实京东探针均保持禁止。

## 证据

- Capture Task：`capture-task-3a404f9e-4ede-414d-9eaa-bc834303a5a5`，revision 1；
- Planning Run：`crawl-planning-run-288a0f9f-9c5b-4769-994c-488543a1c090`；
- Draft Plan：`crawl-plan-0401714f-e534-40fe-88f6-31a43b4d1335`；
- API 对账：16 sources、25 targets、4 `jd.catalog-product` sources，每个仅 1 个商品详情 target。
