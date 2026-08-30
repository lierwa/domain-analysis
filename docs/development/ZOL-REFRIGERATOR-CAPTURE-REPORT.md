# ZOL 冰箱正式抓取结论

日期：2026-08-31
状态：Source Run 已进入终态

## 简单说明

系统已经完成从门类采访、Capture Task 确认、ZOL 官方品牌榜核验、Crawl Plan 确认到 Source Execution 的正式链路运行。本次计划正确冻结排行榜中综合评分大于 `0` 的前 `20` 个品牌，并按每批 `3` 个品牌、每品牌每轮 `10` 个型号、每品牌最多 `20` 个型号执行。

本次 Source Run 完成首批海尔、美的、容声各 `10` 个型号后，第二轮图片请求遇到可信 DNS SERVFAIL；每个失败请求完成一次有界重试后，运行按计划收口。原始页面、图片、请求账本、工作项和血缘均保存在本机 Source Dataset。

## 权威对象

- Capture Task：`capture-task-acf59990-8c0d-422f-8a67-4ceb020adf87`，revision `1`
- Planning Run：`crawl-planning-run-56a1c76c-ca08-4555-93c4-4f31711f6408`
- Confirmed Crawl Plan：`crawl-plan-41c7bca7-4fc5-46ba-a364-de0be0114332`，version `5`
- Source Batch：`source-batch-5219dbea-2d69-42a8-b85f-0206d308308a`
- Source Run：`source-run-48f29f4d-187a-4313-a9f7-07f0efdd0e5b`
- Provider：`zol.catalog-gallery@1.2.0`
- 官方品牌榜：`https://top.zol.com.cn/compositor/359/manu_attention.html`

## 计划范围

- 官方榜单行数：`50`
- 执行品牌：综合评分严格大于 `0` 的前 `20` 个
- 品牌批次：每批 `3` 个
- 型号节奏：每品牌每轮 `10` 个
- 品牌上限：每品牌最多 `20` 个
- 计划最大容量：`400` 个型号
- 请求预算：`10000`

| 排名 | 品牌 | 本次完成型号 | 本次状态 |
| ---: | --- | ---: | --- |
| 1 | 海尔 | 10 | 完成第一轮，第二轮随 Source Run 终态收口 |
| 2 | 美的 | 10 | 完成第一轮，第二轮随 Source Run 终态收口 |
| 3 | 容声 | 10 | 完成第一轮，第二轮随 Source Run 终态收口 |
| 4 | 卡萨帝 | 0 | 尚未进入下一品牌组 |
| 5 | 西门子 | 0 | 尚未进入下一品牌组 |
| 6 | 美菱 | 0 | 尚未进入下一品牌组 |
| 7 | TCL | 0 | 尚未进入下一品牌组 |
| 8 | 海信 | 0 | 尚未进入下一品牌组 |
| 9 | 东芝 | 0 | 尚未进入下一品牌组 |
| 10 | 米家 | 0 | 尚未进入下一品牌组 |
| 11 | 松下 | 0 | 尚未进入下一品牌组 |
| 12 | COLMO | 0 | 尚未进入下一品牌组 |
| 13 | 统帅 | 0 | 尚未进入下一品牌组 |
| 14 | 华凌 | 0 | 尚未进入下一品牌组 |
| 15 | 新飞 | 0 | 尚未进入下一品牌组 |
| 16 | 康佳 | 0 | 尚未进入下一品牌组 |
| 17 | 三星 | 0 | 尚未进入下一品牌组 |
| 18 | 荣事达 | 0 | 尚未进入下一品牌组 |
| 19 | 博世 | 0 | 尚未进入下一品牌组 |
| 20 | 创维 | 0 | 尚未进入下一品牌组 |

没有品牌达到每品牌 `20` 个型号上限，也没有品牌以来源目录穷尽结束。本次最终完成型号数为 `30`。

## Source Dataset 对账

运行时间：2026-08-30 23:34:55 至 2026-08-31 00:00:32（Asia/Shanghai），约 25 分 38 秒。

| 项目 | 数量 |
| --- | ---: |
| 不可变原始快照 | 835 |
| `accessible` 快照 | 835 |
| 内容验收 `accepted` | 834 |
| 支撑性 robots 原文 | 1 |
| HTML 快照 | 131 |
| 文本快照 | 1 |
| 图片资产 | 703 |
| 其中 JPEG | 698 |
| 其中 GIF | 5 |
| 请求尝试 | 848 |
| 完成请求 | 841 |
| 失败请求尝试 | 7 |
| Capture Work Item | 882 |
| 完成 Work Item | 871 |
| 失败 Work Item | 11 |
| 完成型号 | 30 |

失败 Work Item 包含 `8` 个第二轮型号和 `3` 个在途图片项。终止前的两个图片请求各执行了两次请求尝试；运行终止后，其余在途型号和图片统一进入终态。没有观察到登录、验证码、401、403、429 或来源风控限制。

## 终态与运行稳定性

- Source Run 终态：`failed`
- 终止原因：`可信 DoH 查询失败：DNS status 2`
- Source Batch 终态：`failed`，`0/1` 个来源完成
- 观测到的 Node 私有内存最高约 `388 MB`，没有 OOM 或 Node 进程异常退出
- 本次历史 Run 已保存的 `failureCategory` 为 `contract_fault`；当前实现将同类可信 DNS SERVFAIL 与 502/503/504 归入 `transient_transport`，一次有界重试耗尽后结束对应品牌或型号 Work Item 并继续计划范围
- 当前访问限制熔断只响应登录、验证与拒绝访问；普通资源不存在或源站错误保留快照与 Work Item 原因，不结束整个 Source Run
- 本次终态后没有自动 Resume；保留当前不可变数据和恢复链事实

## 结论

1. ZOL 官方门类链、品牌榜核验和前 20 个执行品牌选择通过真实页面验证。
2. Confirm / Prepare / Start、Graphile Worker、请求准入、HTML 与图片独立节奏、一次有界重试和 Source Dataset 落库均在正式链路生效。
3. 首批三个品牌完成第一轮各 10 个型号，证明同一计划内的品牌分组与交错推进生效。
4. 本次数据范围是原始 Source Dataset，不是阶段 2 的标准化商品库。
5. 本次运行没有完成 20 个品牌各最多 20 个型号的全部计划范围；继续覆盖应从当前 Confirmed Crawl Plan 和 Source Run 恢复事实发起新的明确执行动作。

## 交付验证

- 两个项目 Skill：`quick_validate.py` 通过
- `npm run typecheck`：6 个 workspace 全部通过
- `npm test`：43 个测试文件通过、2 个跳过；195 个测试通过、7 个跳过
- `npm run build`：通过；Web 构建 2483 个模块，只有现有大 chunk 提示
- `git diff --check`：提交前执行并要求通过

原始页面、图片、数据库、Cookie、Profile、凭证和本机代理配置不进入 Git；远程提交只包含代码、测试、迁移、Skills、权威文档和本报告。
