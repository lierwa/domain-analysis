# ADR 0018：以 AI 深度来源调查驱动品牌官网抓取计划

- 状态：Accepted；单轮巨型输出已由 R-045 的分阶段独立上下文实现替代，前台内存执行边界已由 ADR 0020 替代
- 日期：2026-08-24
- 影响阶段：ROADMAP 1A、1B、1D、1E
- 替代：ADR 0017 的“京东目录承担市场品牌发现”部分

## 背景

项目需要为一个标准商品品类尽可能完整地取得品牌、型号、官方参数、说明书、标准监管和底层原理资料。真实批次证明 `jd.catalog-market@1.0.0` 只访问一个静态电视目录页，得到 30 个 SKU、0 个品牌和未知覆盖分母，却错误标记为计划范围完成；负责人手工对照还证明 VPN 搜索会进入错误页、无痕搜索会进入登录页。继续把京东作为必须市场分母既不可执行，也会让规划完成门依赖一个已被真实证据否决的来源。

现有 Crawl Planning 已经复用锁定的 Codex App Server、真实 `web_search`、显式 Skill、ephemeral thread、官方 `outputSchema` 和本地 Zod 校验。缺口是规划结果没有保存可审核的研究账，也没有验证“发现了哪些品牌、每个品牌是否映射官网、参数和原理来源是否齐备”。

## 决定

1. 当前正式 Crawl Plan 不包含京东或其他需要登录、风控对抗的市场来源；历史 JD Plan、Run 和 Snapshot 只读保留。
2. Capture Task 只冻结用户确认的品类、市场、时间、内容方向和排除项；采访得到的 URL 是调查线索，不再负责预先列全品牌和来源。
3. Planning Agent 必须在单次可见 Planning Run 中完成四类深度调查：品类品牌发现、逐品牌官网映射、官方型号/参数/说明书入口、标准监管与技术原理来源。
4. 新执行清单 contract version 3 保存结构化 Research Audit：调查范围、分方向搜索记录、规范品牌清单、每品牌官网 source key 或显式 unresolved、topic 到 source 的覆盖映射和停止理由。
5. 每个已发现品牌必须恰好落入“已规划官方来源”或“尚未解决”之一；未解决品牌不会被隐藏。计划整体可标记 `complete` 或 `partial`，但两种状态都必须逐品牌对账，不能用搜索次数或一段总结冒充覆盖。
6. 当前生产执行只使用已经存在的 `public.web-resource@1.0.0` 精确公开 URL/受控同源链接能力。AI 负责规划，Provider 只按确认计划访问；Planning Run 不抓批量页面，Source Run 不边抓边搜索或自动扩展来源。
7. 用户仍需显式确认每个 Plan version 后才能 Start。后续真实官网目录遍历能力仍须通过 R-043 的三站 POC；本 ADR 不把 sitemap 候选冒充已实现 Provider。

## 2026-08-24 实施验证修订

真实 Workbench v8-v10 证明“一个 turn 同时搜索并重写完整 Research Audit 与全部执行 source/target”的实现不稳定：v8 的索尼品牌状态与保留官网来源冲突；v9/v10 在 102-123 个搜索 URL 后仍于一次有界修复中产生悬空 source key。因此本 ADR 接受的 AI 深搜职责、JD 排除、v3 最终 contract 和人工确认门继续有效，但单轮巨型输出不再视为可交付实现。

采用 R-045 的分阶段独立上下文工作流：六镜头品牌发现、每次一个独立饱和查询、每个小批品牌的官网/参数映射、标准/原理分别使用新的 ephemeral thread 和小 schema。Workbench 按品牌规范名称和别名确定性计算新增品牌，两个不同查询连续零新增即停止；官网批次发现的新增品牌以原查询/证据增量并入既有品牌账，再继续饱和查询和新增品牌批次，不让模型重写旧品牌整表。同阶段校验失败只在原 thread 复用原错误，最多两个 repair turn。Workbench 从已验证事实确定性生成 key、Provider policy 与 topic coverage，再组装和校验当前 Plan。批次大小可配置为 1-10，默认 3；中间结果只驻留本轮内存，不新增产品事实源。

2026-08-25 真实 Workbench 完整运行已经通过规划可审查门：批次 10、25 个品牌、24 个来源、42 个精确 target，20 planned、5 unresolved；最后两个饱和查询不同且均零新增，全部当前非 JD 候选和 10 个 task topic 均闭合，JD URL/Provider 为零。系统保存实际 v9 draft，但未确认或启动，也没有新增 Batch/Source Run。

## 理由

- 把可调查的品牌和来源事实放在 Planning Agent，而不是要求用户或采访阶段预先枚举；
- 复用当前已验证的 App Server 搜索能力，不新增搜索 API、凭证、外部服务、模型 Provider 或第二会话事实源；
- 结构化 Research Audit 让“深搜”可以审查和失败关闭，而不是依赖模型自述；
- 保持 Capture Task、Crawl Plan、Source Dataset 三个事实源的原有职责，不让执行器越权改计划；
- 即使部分品牌官网不可访问，也能明确显示 gap 并先执行已确认的公开来源。
- 独立阶段让一个品牌批次的材料和修复不会污染后续批次；模型不再承担大量 source/target 交叉引用维护。

## 代价与边界

- AI 搜索无法证明互联网上不存在未发现品牌，因此“尽可能全”定义为：多方向搜索形成的已观察品牌清单全部对账，并保存停止理由，不宣称绝对市场全集；
- 搜索结果仍只有 `search_discovered/unknown`，真实可访问性必须由 Start 后的 Provider 留痕；
- `public.web-resource` 当前只能抓精确页面，不能完成官网整站型号枚举；三站 POC 未通过前，官网目录覆盖仍可能是 `partial`；
- 旧 Capture Task 中的京东候选只作为历史调查输入，不进入 version 3 执行清单。
- 十分钟是单阶段上限，整轮时长随品牌数量和批次大小增长；该条原有前台运行边界已由 R-049 与 ADR 0020 的 DBOS 稳定阶段恢复替代。
- 完整电视真实 v9 已证明分阶段规划能够形成可审查 draft；它不证明官网 target 已访问、型号已遍历或原始数据已完整抓取。
- 前三轮分别证明自由文案 join、平行 `brandName`、混合 area pass 都会漏配；第四轮的 `status` 判别联合使 28 个品牌三批官网核对全部通过，但新增品牌分母复核仍因模型重复填写 `newlyAddedBrands` 而失败。这些运行均 truthful failed 且没有 Plan。错误补丁已删除：品牌证据由判别联合直接约束，`newlyAddedBrands` 由 Workbench 从有序 `discoveredBrands` 计算；最终 v3 公共 contract 不增加编排字段。后续确定性饱和循环和真实 v9 已完成该接受门。
- 第五轮完成 80 个品牌、增量新增 3 个品牌及标准/原理阶段，最终暴露“所有历史 source key 无条件复制到新 Plan”与本轮品牌关系冲突。该兼容规则已删除；历史版本和原始数据不删除，历史 URL 只作复核线索，本轮重新核实才进入新 Plan。后续把候选连续性、品牌新增与饱和停止分别移入所属阶段和 Workbench 确定性计算；名称/别名归一化与任务范围过滤避免产品线、相邻品类污染。Capture Task 当前 revision 的已确认非 JD 候选连续覆盖门不变。

## 验证门

- Planning 输出必须观察到真实 `web_search` item，并包含四类 Research Audit；
- Research Audit 策略 v3 覆盖权威目录、广覆盖目录、主流、长尾/细分、区域/进口、母品牌/子品牌/授权品牌和饱和核查七个镜头，至少四个独立非 JD 证据来源；
- 每轮保存发现品牌与首次新增品牌，最后两个不同查询必须连续无新增；前 N 名、销量榜和推荐榜不得充当品类分母；
- 每个品牌必须有专门官网检索；`unresolved` 至少两条不同查询，`planned` 还必须有专门参数/说明书检索并引用实际官网 source；
- 每个品牌要么引用存在的 `brand_official` source key，要么给出 unresolved 原因；每个计划中的 `brand_official` source 也必须反向归属至少一个 planned 品牌；
- 每个 Capture Task topic 必须引用确实存在的 source key；
- 新 Plan 不允许 `*.jd.com` URL 或 `jd.catalog-market` Provider；
- 新 Plan 确认不创建 Source Run；Start 仍需负责人显式操作；
- 每个 AI 阶段必须观察到真实 `web_search`；六镜头发现后每个饱和查询使用独立 thread，最多六次且必须以两个不同查询连续零新增停止；品牌批次输出必须与本次请求品牌集合完全一致，额外品牌必须携带真实查询/证据，由 Workbench 增量并入既有品牌账后继续饱和核查；
- 全部阶段通过前不保存 Plan；WorkBench 只能生成结构 key 和 policy，不能补造 URL、品牌或来源事实；
- 真实 Workbench 重新规划后，页面必须能直接审查品牌发现数、官网已规划数、未解决品牌和四类调查记录。
