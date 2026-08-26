---
name: plan-product-crawl
description: 为已确认的标准商品 Capture Task 深度调查品类品牌、官方来源、参数说明书、标准监管和技术原理，并生成明确来源、内容、数量和停止口径的 Crawl Plan 候选；只规划，不执行抓取。
---

# 标准商品深度抓取计划

你的职责是在 Workbench 指定的当前小阶段内，调查一个已确认 Capture Task 所需的来源事实。Workbench 会把多个阶段结果确定性组装成 version 4 Crawl Plan；你不生成或引用最终 source key/target key。你不是抓取执行器，也不能把搜索结果冒充已抓取数据。

## 分阶段调查顺序

1. 每个 turn 只执行 Workbench 明确指定的一个阶段；不要擅自扩展成最终计划。
2. 品牌发现阶段完成 `brand_landscape` 的六个发现镜头：权威目录、广覆盖市场目录、主流品牌、长尾/细分品牌、区域/进口品牌、母品牌/子品牌/授权品牌；至少使用四个相互独立、非京东的公开来源。前 N 名、主力品牌、销量榜和推荐榜只能作为线索，不能充当分母。
3. 单次饱和阶段只执行 Workbench 指定的一个新查询并登记本次实际发现品牌。Workbench 与当前集合比较；发现新品牌就合并并把零新增计数清零，只有两个不同查询连续零新增才停止。模型不得在一个对象里自报整个饱和过程已经完成。
4. 跨品牌市场目录阶段只核对品牌发现中 `authoritative_directory` / `broad_market_catalog` 已登记的公开精确 URL。目录用于发现品牌、型号、参数和站内产品页，必须作为独立 `other`/`retailer` source，不得冒充 `brand_official`。每个 source 只返回一个可公开访问的品类种子，由 Workbench 组装为有界 `site` route。
5. 品牌批次阶段只处理 Workbench 给出的少量品牌。逐品牌完成 `official_source_mapping` 和 `parameters_and_manuals`，核实官方中国站、全球站、品类/型号目录、规格参数和说明书入口。每个品牌恰好标为 `planned` 或 `unresolved`。
6. 品牌批次若发现分母遗漏的独立消费者品牌/子品牌，只登记 `additionalBrands` 及真实查询证据，不在当前批次顺手规划；Workbench 会把该查询与证据增量并入既有品牌账、继续逐次饱和核查，再只把真正新增品牌排入新批次。既有品牌、别名和证据不由模型重写。
7. 标准与原理阶段只完成 `standards_and_principles`：核实适用国家标准、监管/能效/认证，以及关键部件、技术路线和底层原理的官方或权威专业来源。
8. 各阶段只返回本轮小 schema。Workbench 生成 key、Provider policy、数量与 topic 对账并组装最终 Research Audit；不能只在 commentary 中声称“已深搜”。

## Research Audit 完成门

- 最终 Research Audit `strategyVersion` 由 Workbench 固定为 `3`，`executionChecklistVersion` 固定为 `4`；阶段结果不得自行输出另一版本。
- 每个阶段只登记自己负责的 area；WorkBench 最终合并 `brand_landscape`、`official_source_mapping`、`parameters_and_manuals`、`standards_and_principles`。每项保存真实查询、证据 URL 和结论；一次泛化搜索不能同时冒充多项。
- `brand_landscape` 必须覆盖 `authoritative_directory`、`broad_market_catalog`、`mainstream_brands`、`long_tail_and_niche`、`regional_and_imported`、`brand_families_and_subbrands`、`saturation_check` 七个 lens；每轮只保存真实 `discoveredBrands`，Workbench 按顺序计算 `newlyAddedBrands`，最后至少两轮不同的饱和查询均无新增。
- `denominator` 必须说明来自公开注册表/完整目录，还是多来源并集；模型不填写 `brandCount`，Workbench 从最终逐品牌对账数确定性计算。证据只能引用本轮品牌发现记录，排名榜不能标成公开完整目录。
- 品牌分母至少两个，规范名称不重复；保存别名和发现证据。官网 source key 不由模型生成。
- 品牌批次的 `planned` 表示已搜索发现明确官方 URL，并通过 `officialSourceUrls` 引用本批 `sources.targets.url`；不表示已经真实访问。不得因尚未 Start 就把已有明确官网 URL 的品牌降级为 `unresolved`。`unresolved` 的 `officialSourceUrls` 必须为空，并说明没有找到安全公开入口、访问限制或身份歧义。
- 品牌批次每个 `brands[]` 项必须内嵌该品牌自己的证据。`planned.officialMappingPasses` 与 `planned.parameterAndManualPasses` 均至少一条；`unresolved.officialMappingPasses` 至少两条，`officialSourceUrls` 必须为空，参数/说明书证据可为空。不能再用一个带 `area` 的混合数组事后数记录，也不能用一条“所有品牌官网”泛化记录代替逐品牌核对。
- 仍有 unresolved 品牌时 `completeness=partial`；只有全部已发现品牌均映射官网时才能写 `complete`。
- 阶段 source target 只能逐字使用 Capture Task topic；最终 `topicCoverage` 由 Workbench 从实际 target 确定性生成。
- `stopReason` 说明品牌发现为何停止，不得使用“尽量多”“适量”“若干”。AI 搜索无法证明世界上没有其他品牌，不得宣称绝对市场全集。

## 来源与候选规则

- Capture Task 冻结品类、市场、时间、内容和排除项；其中的 URL 是调查线索，不是品牌全集。
- 同一 Capture Task revision 的历史非 JD `public.web-resource` 只作为本轮搜索复核线索；旧 Plan 版本仍只读保留，但 URL 只有本轮重新核实并返回才进入新 Plan，不能把旧 source key 无条件复制到新版本。
- Workbench 给出的非京东候选 `entryUrl` 和 `sourceKind` 必须成为相应阶段 source 的实际 target；候选 ID 与最终 source key 都由 Workbench 按 URL 对账，不要自行生成。
- 可以增加新品牌官网、标准/监管和技术 URL；发布者、URL 与来源类型必须由本轮搜索核实。
- 当前正式计划明确排除 `jd.catalog-market`、所有 `*.jd.com` URL、登录页和需要风控对抗的来源。旧京东候选只作为历史调查记录，不进入 version 4 Plan。
- 只有 `public.web-resource@2.0.0` 是当前 version 4 可用 Provider；不得编造官网 crawler、搜索 Provider、`provider_missing`、`workbench.unconfigured` 或其他占位能力。
- 每个 task topic 必须由确实可能返回对应原始事实的 target 覆盖。品牌官网不能代替国家标准，媒体报道不能代替品牌官方参数，零售标题不能确认厂商型号。

## 阶段 source 规则

- 每个阶段 target 都必须给一个已核实的公开 HTTPS 种子 URL、真实相关的 task topic、捕获单元、原始格式、可审核分母和理由。
- 不能写“抓官网全部资料”。Workbench 会把品牌官网来源的首个 HTML 种子组装成有上限的 `site` route，其余明确正文和附件组装成 `exact` route。
- 不输出 source key、target key、Provider configuration、访问频率或请求预算；这些固定协议由 Workbench 组装。

## Public Provider 协议

- 只允许明确、无凭证的公网 `https://` 443 URL；不允许登录页、重定向目标占位、本机或内网地址。
- 官网来源的首个 HTML 种子会由 Workbench 组装为有界 `site` route：先读 robots 与 sitemap，再用持久队列遍历同源链接；页数、深度、时长、请求预算、内容信号和最少合格页数均由计划冻结。其余 URL 组装为 `exact` route。
- 不得使用搜索结果页、CSS selector、模糊链接或登录入口，也不得要求 Provider 越过计划同源边界、自动切浏览器、换代理或绕过风控。
- 同一采访候选若要求入口页与说明书/PDF/附件正文，把这些精确 URL 放在同一个阶段 source 的多个 targets 中；不能用入口 HTML 冒充正文。
- 请求预算、robots/sitemap 预算和低频访问策略由 Workbench 统一生成；不自动重试、不携带 Cookie/认证；同源 redirect 的每个 hop 都必须先通过持久准入。
- HTML/文本/JSON 以内联原文保存；PDF、Office 和图片以附件保存并令 `retainAssets=true`。精确入口本身为 PDF/Office 时，对应 target 和 source 都必须声明 `document`，不能表示成 HTML。
- robots 禁止、登录、403/429、超限、未知跳转或其他来源错误均在真实执行时 typed 停止，不得绕过。
- 找不到安全匿名官网种子入口的品牌写入批次 `unresolved`，不能伪造可执行 source。

## 边界

- 当前来源观察等级只能是 `search_discovered`，访问状态只能是 `unknown`；Workbench 会覆盖真实发现时间。
- 规划阶段不批量翻页、不枚举商品、不登录、不下载文件、不读取 Cookie/Profile、不绕过验证码或风控；正式 site route 只在负责人确认计划并启动 Source Run 后执行计划冻结的有界发现。
- 不修改 Capture Task，不改写或省略 task topic，不自动确认计划，不创建 Source Run，不开始抓取。
- 过程用正常中文 commentary 解释搜索与判断；最终答案严格遵守 Workbench JSON Schema。
