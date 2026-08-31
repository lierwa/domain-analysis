# 数据抓取平台路线图

状态：正式门类流程验收阶段
更新日期：2026-08-31

## 当前目标

从 Workbench 的自然语言门类目标开始，完成品类采访、Capture Task 确认、ZOL 品牌排行榜规划、Crawl Plan 确认、Prepare / Start 和 Source Dataset 对账。

## 门类规划链验收

状态：`in_progress`

通过门：

1. 采访草案显式记录品牌榜综合评分阈值、品牌上限、品牌批次、每轮型号量和每品牌型号上限；
2. 确认后的 Capture Task 原值保存上述策略；
3. Planning Run 调查 ZOL 门类入口、当前门类品牌排行榜和入选品牌目录；
4. Crawl Plan Draft 展示榜单行与综合评分、按规则选择的执行品牌集合和受阻项；
5. 没有可验证排行榜时，受阻草稿不能确认或启动；
6. 负责人可以独立确认无阻塞计划，Prepare 与 Start 保持两个独立动作。

## 排行榜品牌执行验收

状态：`pending`

开始条件：门类规划链通过自动化测试和 Workbench 真实表面确认。

通过门：

1. 默认选择 ZOL 品牌排行榜中综合评分大于 `0` 的品牌，按榜单顺序最多 `20` 个；
2. 同一计划按每批 `3` 个品牌推进，最后一批允许少于 `3` 个；
3. 每品牌每轮推进 `10` 个不同产品 ID，达到每品牌 `20` 个或公开目录穷尽；
4. 目录不足上限时保存全部可识别型号并以实际数量完成，不跨品牌补配额；
5. 参数页、图集页、来源原图、请求、work item、Run、内存和存储量与计划对账；
6. Resume 继续同一 Confirmed Crawl Plan，不在批次之间重新采访或重新确认。
7. 单个品牌、型号或图片的暂时性失败在有界重试后留痕并继续；访问限制、计划/结构/契约/存储错误和预算停止门仍结束整个运行。
8. Worker 或 API 重启后，已持久化的瞬时传输失败可以由确定性 Resume job 自动继续；恢复不会重新采访、改变 Confirmed Crawl Plan 或突破 request budget。

## 跨门类验证

状态：`in_progress`

通过门：

- 规划和 Provider contract 不包含冰箱固定 URL、品牌或数字分片；
- 至少使用两个 ZOL 门类验证 category slug、品牌目录和排行榜映射；
- 每个门类都独立核验排行榜；无榜单门类保持在计划确认门；
- ZOL 来源差异只存在于 Planning Runtime 与 Provider adapter。

## 数据处理阶段

状态：`blocked_by_source_collection`

Source Dataset 的原始采集范围通过验收后，重新进行采访、调研和架构设计，再确定标准化、跨来源合并和知识加工范围。
