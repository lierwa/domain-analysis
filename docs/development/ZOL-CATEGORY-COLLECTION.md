# ZOL 品牌目录、型号参数与图集采集设计

状态：当前来源设计
更新日期：2026-08-31

## 1. 目标

针对 Confirmed Crawl Plan 中按 ZOL 门类品牌排行榜规则选出的品牌目录，保存每品牌前 N 个不同型号的参数页、图集页和全部产品绑定来源原图：

```text
confirmed ranked brand catalog list
  -> catalog order
  -> first N distinct product IDs per brand
  -> parameter HTML
  -> gallery HTML and product-bound picture metadata
  -> all distinct source-declared original images
  -> immutable Source Dataset
```

评论、报价、商城跳转和站外推荐不属于当前捕获单元。

## 2. 来源表面

| 作用 | URL 形状 | 当前用途 |
| --- | --- | --- |
| 门类注册表 | `https://detail.zol.com.cn/subcategory.html` | 确认门类身份 |
| 门类详情 | `https://detail.zol.com.cn/{categorySlug}/` | 核验门类 slug 和入选品牌目录归属 |
| 门类品牌排行榜 | `https://top.zol.com.cn/compositor/{rankingId}/manu_*.html` | 核验名次、品牌综合评分和执行品牌顺序 |
| 品牌目录 | `https://detail.zol.com.cn/{categorySlug}/{brand}/` | 按页面顺序枚举型号和分页 |
| 型号参数 | `https://detail.zol.com.cn/{productGroupId}/{productId}/param.shtml` | 保存来源参数区块和图集入口 |
| 型号图集 | `https://detail.zol.com.cn/{productGroupId}/{productId}/pic.shtml` | 绑定当前产品 ID 的图集与图片详情 |

`productGroupId = ceil(productId / 1000)`，它是产品 URL 分片，不是门类 ID。Planning Run 调查排行榜并核验入选品牌目录，按 Capture Task 的评分阈值与品牌上限生成执行品牌集合；没有可验证排行榜时生成空来源受阻草稿。

## 3. 执行步骤

### E0 品牌目录输入

计划只保存排行榜证据和实际执行品牌目录。每个执行入口需要归属于当前 `categorySlug` 并产生唯一品牌 key；榜单入选品牌无法映射到唯一目录时停在计划确认门。

### E1 型号分母

每个品牌：

1. 保存品牌目录每一页的原始 HTML；
2. 提取型号名称、产品 URL 和 ZOL 产品 ID；
3. 按产品 ID 去重；
4. 按页面顺序保留前 `target_models_per_brand` 个型号；
5. 目录不足目标数时记录来源穷尽，以实际可识别型号数完成该品牌，不跨品牌补配额。

`target_models_per_brand` 是 Capture Task 中每品牌型号上限的执行投影，默认 `20`。`brand_batch_size` 默认 `3`，`model_batch_size` 默认 `10`；两者在采访草案中显式确认，由 Planning Run 原值投影。当前品牌组完成后自动进入下一组，直到计划列出的全部执行品牌达到上限或来源目录穷尽。

### E2 参数页

每个型号保存完整参数页 HTML。页面必须属于当前产品 ID，并能识别至少一个来源参数区块。

### E3 图集与图片

每个型号：

1. 保存图集入口 HTML；
2. 枚举图集区域中与当前产品 ID 绑定的图片详情；
3. 接受图片详情 `picList` 中同时声明的产品 ID、图片 ID、hash、扩展名和 `sizeInfo.source`；
4. 保存全部不同原图，按来源 URL 与内容哈希去重；
5. 保留 MIME、字节数、哈希、来源 ordinal 和父页面血缘；
6. 以产品绑定的实际图片集合认定型号图片完成。

如果 ZOL 图集页明确显示“暂无图片”，Provider 保存该原始页面并以零图片完成型号；只有既没有可验证图集入口、也没有来源无图声明时，才按结构异常隔离当前型号。

### E4 多品牌交错与完成

品牌内保持目录顺序，同一型号 ordinal 轮转品牌。每个型号使用 `zol_model_bundle` work item；参数、图集和全部排队图片完成，或来源明确声明零图片后，才增加业务完成数。

品牌目录或型号内的暂时性传输失败在一次有界重试耗尽后写入对应 Work Item；当前品牌或型号结束，执行器继续计划中的下一个品牌或型号。单张图片不存在、非成功响应或格式不合格时保留请求/响应事实并把当前型号记为失败，不影响其他型号推进。

## 4. 请求策略

| 通道 | 当前策略 |
| --- | --- |
| HTML | 每分钟最多 12 次；最小启动间隔 5 秒 |
| 图片 | `p-queue` 并发 2、容量 100；每分钟最多 30 次；最小启动间隔 2 秒 |

所有真实请求绑定 run、target、work item、requested URL 和 gate key，并记录开始时间、最终 URL、状态、字节数和结束结果。

立即停止条件：

- robots 不允许；
- HTTP 401、403、429；
- 登录、验证码或风险正文；
- 跳转到计划外 origin；
- 页面无法绑定门类、品牌或产品 ID；
- 图集无法绑定当前产品 ID；
- 请求预算、最长运行时间或人工停止触发。

其中图片不存在、非成功响应或格式不合格属于型号级失败，不进入全局立即停止条件。暂时性传输错误、HTTP 502/503/504 和可信 DNS SERVFAIL 最多执行一次有界重试；每次尝试重新经过 gate 并写请求账本，重试耗尽后按品牌或型号工作项隔离。

运行级停止只包括：robots/401/403/429/登录/验证/风险限制、计划入口与页面身份或结构无法绑定、Provider/typed contract/存储不变量破坏、预算或最长运行时间耗尽、人工停止。`not_found` 与普通 `source_error` 快照本身不触发访问限制熔断。

## 5. 后台执行与恢复

- Prepare 检查计划、Provider 和环境。
- Start/Resume 返回 `202`，Graphile Worker 单并发、`maxAttempts=1` 消费命令。
- Resume 只跳过恢复链中已完成的 `zol_model_bundle`；未完成型号重新执行。
- 队列关闭等待真实在途图片任务退出。
- Run 进入终态时，请求和 work item 全部处于终态。

## 6. 已验证执行基础

- 正式 Plan：`crawl-plan-ee5da34b-d490-419e-b8bb-e78d830dadb4`
- 正式 Batch：`source-batch-19aefb3e-405b-4851-ad9b-78c4273bc68d`
- 最终 Run：`source-run-b6258718-8f4d-4e40-9066-55d95bce78be`
- 业务结果：海尔 10、美的 10；20/20 个型号完成
- 完成型号图片：502 张
- 恢复链：5 个 Run、708 个不可变快照、563 个资产
- 终态：`completed/plan_scope_completed`
- 请求终态：0 个未结束、0 个受限
- 最终增量运行：4 分 26 秒，134 个快照、114 张图片，进程约 275 MB

每个完成型号都有参数页、图集页和完整本地图片引用；图片 URL、资产 URL、ordinal、哈希与 MIME 已完成对账。

## 7. 下一验收门

1. 已确认 Capture Task 启动 Planning Run；
2. Crawl Plan Draft 展示榜单 URL、名次、综合评分、执行品牌、每批 3 个、每品牌每轮 10 个和每品牌最多 20 个；
3. 无可验证排行榜的草稿保持在计划确认门；
4. 负责人独立确认无阻塞计划并明确 Start；
5. 全部执行品牌完成参数页、图集页、原图和 Source Dataset 对账，内存、节奏和存储量保持在计划预算内。
