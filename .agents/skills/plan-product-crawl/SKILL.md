---
name: plan-product-crawl
description: 为已确认的标准商品 Capture Task 调查具体来源，并生成明确来源、内容、数量和停止口径的 Crawl Plan 候选；只规划，不执行抓取。
---

# 标准商品抓取计划

你的职责是把一个已确认的 Capture Task 转成可审核的抓取计划候选。你不是抓取执行器。

## 工作方式

1. 读取 Workbench 提供的 Capture Task、任务 topics、历史计划和本轮补充要求。
2. 使用网页搜索核实具体发布者与入口；优先标准/监管、品牌官方、主要平台和可靠专业来源。
3. 解释为什么需要每个来源，以及它负责补足哪一类原始数据。
4. 为每个来源拆出一个或多个 Capture Target，逐项写明捕获单元、原始格式、唯一键、遍历方式、数量和停止条件。
5. 发现许可、登录、验证码、风控或频控时，写入运行时停止条件；只有连第一次安全匿名请求都不能发出的人工/配置前置条件才写执行阻塞。
6. 只有全部任务 topic 已覆盖、每项数量可审核时，才返回完整候选。

这里的“完整”不是把 topic 文本随便挂到某个 target 上。必须同时满足：

- `executionChecklistVersion` 固定为 `2`。
- Capture Task 中每个 `sourceCandidates[].id` 恰好被一个 source 的 `sourceCandidateIds` 引用；保留候选的原始 `entryUrl` 和 `sourceKind`。
- 每个采访候选入口都必须成为实际抓取 target，而不是只列在 `entryUrls` 里装作覆盖。
- 每个 task topic 必须由确实可能含有该原始事实的 target 覆盖。品牌官网不能代替国家标准，京东目录不能代替底层原理资料。
- 对标准商品，按 Capture Task 的已调查事实，完整列出适用的品牌官网/产品页/说明书、标准与监管原文、底层原理与配置参数资料；京东适用且任务标为 included 时还必须列出京东。
- 搜索发现了比采访候选更精确的官方页面、文档或 PDF 时，应增加 source/target；`sourceCandidateIds` 可以为空，但发布者、入口和来源类型仍须真实。

## 数量规则

- `all_available`：适用于存在清楚、有限、可判断结束的总体；必须说明覆盖分母。
- `target_count`：适用于只需要达到明确数量目标的对象；必须给正整数。
- `sample`：适用于评价、内容样本等抽样对象；必须给正整数和抽样分母。
- 禁止“尽量多”“适量”“若干”等无法验收的口径。

## 边界

- 当前来源观察等级只能是 `search_discovered`，初步访问状态只能是 `unknown`；Workbench 会覆盖真实发现时间。搜索到 URL 不等于页面已由 Provider 验证。
- 不批量翻页、不枚举商品、不登录、不下载文件、不读取 Cookie/Profile、不绕过验证码或风控。
- 当前只有两个生产 Provider：`jd.catalog-product@2.0.0` 与 `public.web-resource@1.0.0`。不得编造其他 Provider。
- 京东 v2 计划使用显式 HTTP、每分钟最多 1 个 hop、请求间隔至少 60 秒和有界总请求预算；每个 redirect hop 都必须先进入 PostgreSQL 准入。首次登录、验证码、401/403/429、风险/频控正文、未知跨源跳转或异常响应立即停止且零重试。计划保留 HTML/源站 JSON，图片只保存已取得响应中观察到的 URL，不下载图片字节。
- 每个京东采访候选必须拆成独立 source；一个 source 只能引用一个京东 `sourceCandidateId`、保留一个对应的 `entryUrl`，不得把多个候选入口合并后只访问首项。
- 京东 source 的 Provider 配置固定为 `mode=explicit_http`、`include_text=任务品类词`、`exclude_text=用 | 分隔的排除词`。`entryUrls` 必须是搜索核实到的、无凭证的 `www.jd.com` HTTPS 品类目录入口。必须恰好包含五个 `quantity=all_available` target，operation 各出现一次：
  - `catalog_pages`：目录/分页原始 HTML；
  - `store_catalogs`：动态发现的店铺目录原始 HTML；
  - `product_details`：去重商品详情原始 HTML，图片保存 URL 引用；
  - `review_summaries`：逐商品评价汇总源站 JSON；
  - `review_samples`：逐商品评价样本源站 JSON，另配置 `samples_per_product=100`。
- 京东五类 target 只能承担实际响应可能提供的商品目录、详情、参数、媒体 URL 与评价 topic；不得把国家标准、底层原理等不存在于这些响应中的内容挂上去凑覆盖。`rawOutputPolicy.formats` 固定为 `html`＋`source_json`，`retainAssets=false`；请求预算至少为目录入口数＋4，并写出所有动态工作完成或首次受限的停止口径。
- `search.jd.com`、`mall.jd.com` 等不满足 `www.jd.com` 目录入口协议的采访候选必须按精确公网 URL 使用 `public.web-resource`，但一份通用搜索页/根页面快照不能兑现 Capture Task 已确认的京东商品覆盖。任务 `jd.applicable=true` 且 `disposition=included` 时，计划还必须通过网页搜索增加一个 `sourceCandidateIds=[]` 的 `jd.catalog-product@2.0.0` 精确目录来源；找不到可验证入口时不得返回伪完整计划。
- 对满足上述绑定、入口和固定限制的京东来源，`executionBlockers` 必须为空；Prepare 固定零请求，登录/验证码/风控属于 Start 后的 typed 停止条件。
- 除符合下述固定结构的京东来源外，其他公网 HTTPS 来源（包括其他零售入口、品牌官网、标准/监管、说明书、公开技术原理）统一使用 `public.web-resource@1.0.0`；不得输出 `provider_missing`、`workbench.unconfigured` 或任何占位 Provider：
  - 只允许明确的公网 `https://` 443 URL，不允许凭证、重定向目标、登录页、搜索结果页占位或本机/内网地址；
  - source 配置为 `mode=exact_https` 与正整数 `maximum_bytes`，网页通常用 `5000000`，较大 PDF 可提高但不得超过 `25000000`；
  - `entryUrls` 中每个 URL 恰好对应一个 exact target，反过来每个 exact target 的 `url` 也必须存在于同一个 source 的 `entryUrls`；exact target 配置只有 `url=<同一个精确 URL>`；不得把另一个采访候选的 URL 借到当前 source 里重复抓；
  - 若说明书或附件 URL 只有在入口 HTML 中才能解析，可在 exact target 后增加一个受控同源链接 target；配置必须且只能是 `from_target=<前序 target key>` 与 `link_text=<搜索已核实且在页面中应唯一出现的完整链接文字>`；不得使用 CSS selector、模糊匹配、跨源跳转或递归发现；
  - 每个 target 的数量固定为 `target_count=1`，分母是“计划冻结的该 URL”，停止条件是保存一份原始响应或遇到访问限制；
  - 请求预算至少等于 target 数量加唯一 origin 数量，因为每个 origin 先检查一次 `robots.txt`；不重试、不跟随重定向、不携带 Cookie/认证；
  - HTML/文本/JSON 以内联原文保存；PDF、Office 文档和图片以本地附件保存，后者必须令 `retainAssets=true` 并声明对应 `document`/`image` 原始输出；
  - 当 `entryUrls` 或采访候选的精确入口本身就是 PDF/Office 等二进制文档时，对应 exact target 的 `rawFormats` 必须包含 `document`，source 的 `rawOutputPolicy.formats` 也必须包含 `document` 且 `retainAssets=true`；绝不能把 `.pdf` URL 表达成 HTML target；
  - robots 禁止、登录、403/429、超限或其他来源错误均按 typed 状态停止，不得绕过。
- `public.web-resource` 只执行已冻结的精确 URL，或计划中显式声明的“一次同源唯一链接文字”关系，不会自由发现链接或遍历站点。需要多个页面/说明书/标准时，规划阶段必须逐项列成 target，不能写“抓官网全部资料”。
- 当采访候选的 `expectedContents` 或 `observedFormats` 明确包含说明书、PDF 或附件表格时，只抓入口 HTML 不算覆盖；必须增加精确正文 target，或增加上述受控同源链接 target。若精确入口本身是 PDF，则该 exact target 就是正文 target，必须按 `document` 保存。H5 说明书仍按 `html` 原文保存；只有 PDF/表格等二进制附件才令 `rawOutputPolicy.retainAssets=true` 并声明 `document` 原始输出。国家标准若只能公开取得元数据和编制说明，必须分别列出并明确“编制说明不是正式标准全文”。
- `executionBlockers` 只记录“连第一次安全、匿名请求都不能发出”的配置或人工前置条件。登录跳转、403/429、robots 拒绝和候选历史 `restricted` 都由真实运行 typed 停止并留痕，不重复写成确认 blocker；严禁为了清空 blocker 携带 Cookie、认证或绕过限制。
- 完整候选的每个 `executionBlockers` 必须为空；若无法找到能由上述两个 Provider 安全执行的精确目标，本轮不得返回伪完整候选。
- 不修改 Capture Task，不新增、改写或省略 Workbench 给出的 task topic。
- 不自动开始抓取。

过程用正常中文 commentary 帮助负责人理解；最终答案严格遵守 Workbench 提供的 JSON Schema。
