---
name: plan-product-crawl
description: 为已确认的标准商品门类 Capture Task 制定可审核 Crawl Plan Draft。调查 ZOL 当前门类的可验证品牌排行榜和入选品牌目录，按已确认规则选择执行品牌并计算批次、预算和停止条件；无可验证榜单时生成受阻草稿，只规划，不确认或抓取。
---

# 标准商品门类抓取规划

## 目标

针对一个已确认 Capture Task revision，调查当前获准且可执行的来源，形成一份可审核的 Crawl Plan Draft。当前产品阶段只规划 ZOL；其他候选来源保留在 Capture Task 中，等待相应来源能力进入正式范围。

Planning Run 核验当前门类的 ZOL 品牌排行榜，再按 Capture Task 中已确认的规则选择执行品牌并验证其品牌目录。品牌批次只切分已经入选的执行品牌集合。

## 输入与事实源

Workbench 必须提供：

- 已确认 Capture Task 及 revision；
- 当前获准的来源和 Provider 能力；
- 已确认计划、执行中计划与 Source Dataset 覆盖投影；
- 当前来源中已完成、执行中和受阻的覆盖事实；
- 当前容量与安全限制。

事实归属：

- Capture Task 拥有门类、市场、内容、排除项、品牌筛选策略、品牌批次、每轮型号量和每品牌型号上限；
- Planning Run 调查来源门类、排行榜、入选品牌目录及其可验证性；
- Confirmed Crawl Plan 拥有排行榜快照、按任务策略选择的执行品牌清单、数量、预算和停止条件；
- Source Dataset 拥有实际完成型号、覆盖缺口和运行终态。

不得从 UI 文案、错误字符串或模型历史自行重建覆盖状态。

## ZOL 门类与品牌目录

- 从 Capture Task 的门类调查对应的 ZOL 详情门类入口、稳定门类 slug 和当前 Provider 所需的来源门类标识；不得把冰箱路径或数字 ID 当作其他门类默认值。
- 品牌目录只用于验证榜单入选品牌的规范名称、品牌 key、准确目录 URL 和当前门类归属，不枚举或持久化整个门类品牌池。
- 入选品牌名称冲突、目录归属不明、重复品牌 key 或入口不可公开核实时，标记为受阻并说明依据。

Planning Run 不批量枚举型号、不下载图片。可以打开数量有界的代表性品牌目录、型号页或参数页，只用于验证门类 slug、Provider 路由和来源数字标识；这些页面不能计入已抓取型号。

## ZOL 品牌排行榜与执行集合

- 必须找到并实际打开当前门类对应的 ZOL 品牌排行榜；排行榜页面必须同时能验证品牌顺序和“综合评分”数值。
- 保存排行榜 URL、观察时间、每一行的名次、品牌名称、综合评分和可核实的品牌目录映射。
- 默认只选择综合评分严格大于 `0` 的品牌，保持榜单顺序，最多 `20` 个；具体阈值和数量上限从已确认 Capture Task 原值投影。
- 排行榜之外的品牌不进入本计划或用户界面。
- 榜单品牌无法映射到唯一门类品牌目录时，保留为受阻榜单项，不能静默替换或猜测 URL。
- 如果没有找到当前门类的榜单、页面无法公开访问、没有可验证的综合评分列，或榜单与门类归属无法核实，必须生成带计划级阻塞的 Crawl Plan Draft；执行来源为空，负责人不能确认或启动。禁止回退为全品牌执行、热门品牌猜测或固定品牌列表。

## 计划内批次参数

Planning Run 从 Capture Task 原值投影以下参数，并结合执行品牌数计算预算：

- `brandBatchSize`：同一份 Crawl Plan 执行时每批推进的品牌数，默认 `3`；
- `modelsPerBrandPerRound`：执行期间每轮为每个品牌推进的不同 ZOL 产品 ID 数，默认 `10`；
- `maxModelsPerBrand`：每品牌任务完成边界，默认 `20`；
- HTML 与图片请求预算、最长运行时间、节奏、并发和存储估算。

参数约束：

- `modelsPerBrandPerRound` 不能大于 `maxModelsPerBrand`；
- 计划总型号容量由“执行品牌数 × 每品牌型号上限”推导，用于预算，不形成另一份业务上限；
- 品牌按计划中稳定顺序切分为 `brandBatchSize` 大小的分组；最后一组可以少于该值；
- 每轮推进后继续处理同一计划中的品牌，直到每个品牌达到任务上限或来源目录已经穷尽；
- 品牌目录实际型号不足时，保存全部可识别型号并记录来源穷尽，不从其他品牌补足该品牌；
- 一个品牌达到任务上限或来源穷尽后，才在覆盖投影中记为本来源已完成；
- 具体数值必须进入 Crawl Plan Draft 并由负责人确认，不能作为隐藏默认值或在 Planning Run 中重新改写。

旧 Capture Task 没有显式品牌筛选或批次策略时，Planning Run 必须停下并要求通过采访形成新 revision，不能用运行时常量静默补齐。

## Crawl Plan Draft

草案必须让负责人直接判断整份计划将做什么，至少包含：

- Capture Task revision；
- ZOL 门类入口、排行榜 URL、观察时间和排行榜可验证状态；
- 排行榜实际展示的行、入选品牌目录和受阻入选品牌；
- 榜单行、综合评分、筛选规则，以及最终执行品牌名称、品牌 key 和准确目录 URL；
- `brandBatchSize`、预计品牌分组，以及 `modelsPerBrandPerRound` 和从 Capture Task 投影的 `maxModelsPerBrand`；
- 每品牌与整份计划的型号容量；
- 参数页、图集页和来源原图的捕获单元；
- 请求、时长、内存和存储预算；
- 恢复策略、访问限制和停止条件；
- 计划执行后的剩余覆盖预期；
- 当前阻塞；没有可验证排行榜时明确说明停在计划确认门且没有执行品牌。

Workbench 负责生成稳定 key、校验 typed contract、保存 draft version 和执行确定性预算检查。Planning Run 只记录已核验的来源事实，不伪造已抓取结果。

## 计划内连续覆盖

一个没有计划级阻塞的 Confirmed Crawl Plan 启动后：

1. Provider 按稳定顺序取得第一组 `brandBatchSize` 个品牌；
2. 每组内按 `modelsPerBrandPerRound` 交错推进，直到各品牌达到 `maxModelsPerBrand` 或来源穷尽；
3. 当前品牌组完成后，自动取得同一计划中的下一组品牌；
4. 最后一组允许少于 `brandBatchSize`；
5. 全部执行品牌完成后，Source Dataset 对账执行品牌集合、型号、原始页面、图片和阻塞，计划进入对应终态。

批次之间不重新采访、不生成新计划、不再次请求确认。Resume 继续同一 Confirmed Crawl Plan；只有 Capture Task revision、榜单快照或来源能力发生需要替换计划的变化时，才发起新的 Planning Run。

## 权限与安全边界

- 只调查 Workbench 明确允许的来源；当前阶段为 ZOL。
- 只使用公开、可审计、当前 Provider 能执行的入口。
- 不登录、不读取 Cookie/Profile、不处理验证码、不绕过风控。
- 不修改 Capture Task，不自动确认计划，不创建 Source Run，不开始抓取。
- 过程使用正常中文 commentary；最终结果服从 Workbench 提供的 JSON Schema。
