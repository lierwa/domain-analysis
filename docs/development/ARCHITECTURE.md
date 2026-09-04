# 数据抓取平台架构基线

状态：来源采集与知识加工接入基线
更新日期：2026-09-04

## 简单说明

用户先在 Workbench 说明要调查哪个标准商品门类。系统通过采访确认业务范围和覆盖策略，再在同一个 Planning Run 中调查商品目录、标准监管、专业技术和品牌公开资料，形成一份可审核的多来源计划。负责人确认计划并明确 Start 后，后台 Worker 按来源执行抓取，Source Dataset 保存原始页面、PDF、附件、失败记录和完整血缘。统一覆盖模块随后按最低门计算全部资料缺口；未达标时 Planning 只补缺口，达标后才允许进入下一阶段设计。

## 目标数据流

```text
Workbench Chat Timeline
  -> Category Interview
  -> confirmed Markdown Capture Task Draft
  -> Capture Task materialization
  -> Planning Run
       -> official category chain and brand ranking verification
       -> category topic decomposition and public source discovery
       -> Crawl Plan Draft
  -> human plan confirmation
  -> Confirmed Crawl Plan
  -> Prepare
  -> Start / Resume command (HTTP 202)
  -> PostgreSQL Graphile Worker
  -> Source Execution
  -> Source Provider
  -> Request Ledger + Snapshot + Asset + Lineage
  -> Source Dataset
  -> Source Coverage Assessment
       -> gap-only Planning，或阶段 1 通过
```

## 模块职责

| 模块 | 职责 | 不负责 |
| --- | --- | --- |
| Category Interview | 保存消息、负责人取舍、采访范围草案和继续上下文 | 决定来源 URL 或执行节奏 |
| Capture Task | 拥有负责人确认的门类、内容范围、品牌筛选规则、品牌批次、每轮型号量和每品牌型号上限 | 具体品牌、榜单快照、来源分页、频率和 Provider 配置 |
| Crawl Planning | 核验商品目录，拆解品类专业主题，调查公开资料直达入口，并按 Provider 能力形成一份多来源计划 | 执行来源请求、清洗原文或改写任务策略 |
| Crawl Plan | 拥有版本化计划草案、商品目录审计、规划前覆盖快照、公开来源调查、执行来源清单和预算 | 运行生命周期、响应解释或专业内容结论 |
| PostgreSQL Background Command Queue | 持久派发 Start/Resume、自动恢复扫描与命令去重 | 拥有 Source Run 终态 |
| Source Execution | 拥有 Batch、Run、target、work item 与恢复生命周期 | 决定计划范围 |
| Source Access Gate | 持久准入 HTML 与图片请求，执行节奏、预算和访问限制熔断 | 选择品牌或型号 |
| ZOL Catalog + Gallery Provider | 按计划识别品牌目录、型号、参数页、图集和图片关系 | 扩大计划范围或清洗商品参数 |
| Public Web Resource Provider | 按计划内 exact/site 入口保存公开 HTML、PDF、文本和附件 | 选择研究主题、扩展计划范围或形成专业结论 |
| Public Resource Transport | 固定公网地址、限制重定向、执行字节上限并返回原始响应 | 控频、业务重试或范围选择 |
| Source Dataset | 保存请求、原始响应、图片资产、引用、血缘、Capture Subject、型号完成数和终态 | 标准化商品或覆盖原始内容 |
| Source Coverage | 从 Source Dataset 投影商品目录、来源族、主题、独立站点、已尝试 URL 和执行终态的最低覆盖 | 抓取、清洗、判断专业事实正确性或声明足以支撑最终导购 |
| Knowledge Processing | 拥有知识包、固定选料和配置、加工运行与逐件结果、自动判断、人工审核决定、候选版本、发布与导出 | 覆盖原始 Snapshot/Asset、改变采集计划、让模型创造或改写来源事实、管理 Agent 宿主 |
| Web | 读取 typed 商品投影与运行审计投影，渐进展示 Source Dataset | 从 URL、工作键、错误文案推导领域状态，或直连来源资产 |

## 单一事实源

| 事实 | 拥有者 |
| --- | --- |
| 采访消息、负责人取舍与范围草案 | Category Interview |
| 抓取门类、内容范围、品牌筛选规则、品牌批次、每轮型号量与每品牌型号上限 | Capture Task |
| 规划活动与计划草案版本 | Planning Run / Crawl Plan Draft |
| 品牌排行榜快照、专业主题、公开资料入口、执行来源、访问预算和停止条件 | Confirmed Crawl Plan |
| Start/Resume 命令交付与去重 | PostgreSQL Background Command Queue |
| 实际工作项与执行终态 | Source Execution |
| 请求准入、节奏、冷却和熔断 | Source Access Gate |
| 实际请求和响应 | Source Request Attempt / Raw Snapshot |
| 批次内品牌、来源型号身份及父子关系 | Source Dataset Capture Subject |
| 页面与资源发现关系 | Source Dataset lineage |
| 图片 bytes、MIME、哈希和来源关系 | Source Asset / Resource Reference |
| 阶段 1 最低覆盖规则 | Shared Source Coverage contract |
| 当前任务的最低覆盖结果 | Source Coverage 对 Source Dataset 的 typed 投影 |
| 知识范围、加工输入修订、问题指纹、AI 建议、内容处置、版本及发布决定 | Knowledge Processing |

## 知识加工接入（2026-09-04）

简单说明：用户选择一个抓取任务的完整采集批次，系统处理批次中的全部已准入原件，把失败项交回加工，批量判断内容归属、OCR 和图片，只有来源冲突进入人工审核，最后发布标准 Agent Skill。每轮冻结输入和规则；已发布版本持续保留，新的加工或审核不会改写旧成品。

- Source Dataset 通过只读批次 seam 提供该批次每个计划来源的最新执行结果。批次只有在来源齐全且最新 Run 全部完成时才能进入加工；恢复链中的旧 Run 保留审计，但不重复进入输入。Knowledge Processing 保存 `{taskId,batchId}` 与运行时冻结的原件引用，不复制或覆盖原始事实。
- Knowledge Processing 在同一 Workbench PostgreSQL 内持久保存包、批次选择、加工运行、逐件结果、审核决定、候选版本、发布与导出；Graphile Worker 只交付加工命令。包修订用于并发控制，选料修订单独记录，只有批次选择变化才使当前加工过期；工序、运行状态、内容处置和尝试次数分开表达，Web 只读取已校验的服务端投影。
- 来源结构明确的 HTML 字段经校验后自动准入。加工失败和空内容回到加工队列；非结构化内容、OCR 与图片进入自动判断。只有高置信且能从当前原件定位的候选进入准入，其余候选自动隔离；已知字段冲突必须人工决定。运行未完成或没有可用内容时关闭建包门。
- 自动判断复用锁定的 Codex App Server `stdio`，每次使用 ephemeral thread、Zod output schema、只读 sandbox、关闭 web search，并只接收当前问题的候选、OCR 置信度/坐标、来源定位及所需原图。问题按最多 32 个问题、16 份原件有界分组，累计写入同一审核记录。只有与当前加工代次、审核修订及问题指纹一致的完成结果才能驱动确定性准入；旧结果失效。协议与实测边界见 RESEARCH R-019 和 ADR-003。
- 图片首轮自动产生三种结果：清晰无水印原图转为标准 PNG；可安全定位的水印按 OCR 四边形生成遮罩并用 OpenCV Telea 修补；其余整图隔离。处理限制遮罩面积并校验遮罩外像素不变，随后由视觉模型对照原图与副本检查内容完整性、修补痕迹和水印残留；未通过时自动隔离并保留原件审计。PDF 保留原件与版面审核边界，自动正文准入须另行通过成熟组件的真实版面门。
- 复用 cacache 的内容完整性与缓存存储，键包含输入哈希、工具版本和相关设置；加工缓存、审核材料、原始 Asset 与版本成品分别保存。单份原件预算独立计算，不截断整个批次。
- 新版本输出标准 Agent Skill ZIP：`SKILL.md`、`scripts/`、`assets/data/`、`assets/images/` 和 `references/`。包内查询与校验脚本使用 Node 标准库；fflate 负责确定性 ZIP。格式与边界依据 RESEARCH R-018 及 ADR-002。历史资料包按原始 bytes/hash 只读保留。
- 人工审核和发布命令携带预期修订；内容变化使旧自动结果与人工决定失效。候选版本的输入摘要绑定原料哈希、自动建议、人工决定和图片副本哈希，任一结果变化必须重新建版。发布须满足机器终态、最低可用内容和成品完整性，记录确定版本及 SHA-256；下载读取冻结成品，不重新生成。
- 正式验证覆盖 Web/API/Worker/PostgreSQL 链路、重复命令、停止继续、逐件错误、过期审核/发布、同输入重建、缩减输入、合格图片、问题隔离、旧版本保留、标准 Skill 校验及来源回查。支持环境与全批次扩量按 ROADMAP 建设 D 推进，宿主接入属于后续工程。

## Source Dataset 投影与读取边界

- Capture Subject 是 Source Dataset 内的批次级来源身份，当前只表达品牌和来源型号；它保存源站实体 ID、显示名称和父子关系，不承担跨来源标准化。Provider 通过现有 Work Item seam 提交身份，幂等、外键和冲突处理由 Workbench 隐藏。
- 商品投影按当前 Batch 聚合品牌、型号、资源数、完成度和去重后的逻辑问题；运行审计投影按来源、Batch、Run 与记录组表达执行血缘。两种投影共享 Source Dataset 事实，但不互相推导。
- 单条资源读取必须同时携带 `subjectId` 与 `resourceKind` 并分页；图片 bytes 只通过受控 Asset 路由按需读取。展开一条资源不能加载整个 Run，也不能把整批图片送入审计详情。
- Web 只保存展示交互状态：活动展开行与当前详情选择分别建模。抽屉关闭后焦点返回首次地图触发器；这些状态不参与领域完成度、问题归属或执行生命周期判断。
- 历史 ZOL Subject 回填由 ZOL adapter 解释自身工作键，只新增 Snapshot、Work Item 与 Subject 的派生关联，不改写原始快照、哈希、Run 或已确认计划。
- API 默认从当前仓库的 `data/source-assets` 读取内容寻址资产；多个本地 checkout 共用数据库时，可通过 `SOURCE_ASSET_CACHE_PATH` 显式指向实际资产根目录。该配置只改变本地 bytes 的读取位置，不改变 Asset ID、哈希、血缘或 HTTP contract。
- `SourceCoverageModule` 只计算 `public.web-resource` 完成 Run 中 accessible、accepted、非空、带 URL 与 lineage 的 Snapshot，按规范化 exact URL 去重，并以 URL origin 计算独立站点。Planning 和 Source Dataset 页面读取同一个 interface，不各自推导覆盖。

## 规划与确认门

- Planning Run 只接受已确认的 Capture Task revision。
- 品牌、型号、来源入口和 Provider 能力属于系统调查事实；负责人只决定会改变业务范围的真实取舍。
- 商品目录、标准监管、专业技术和品牌公开资料是同一 Planning 阶段内的同级来源；系统只生成一份 Crawl Plan Draft，不建立 ZOL 之后的第二条研究流程。
- Planning 从 Source Coverage 自动引用同一 Capture Task 已经完成的 ZOL Batch。覆盖模块必须核对 Batch 为完成态且存在 `zol.catalog-gallery` 的完成 Source Run，随后把引用写入 `multi_source_planning` audit；调用方不能手工指定完成引用，ZOL 不再进入增量计划的执行来源数组。已完成原文仍以原 Source Dataset Batch 为事实源。
- Planning Run 必须保存可验证品牌排行榜，并从 Capture Task 策略确定性生成执行品牌集合；门类品牌目录不能替代排行榜。
- ZOL Planning Runtime 从 Capture Task 的官方排行榜候选出发，沿“品牌榜 → 品牌目录门类 slug → 门类页 → 排行聚合页 → 品牌榜”反向核对同门类官方链路；GBK 解码、榜单行解析和目录映射由 ZOL adapter 确定性完成，不依赖通用 Agent 的网页工具输出。
- 公开资料规划复用锁定的 Codex App Server ephemeral 运行时和 web search：按当前品类生成通用 facet 下的原理词、部件词、安全、性能、使用维护与品类特有主题，再返回标准监管、专业技术和品牌公开资料的 HTTPS 直达入口或受阻记录。模型只调查计划输入，不执行原始抓取。
- 阶段 1 最低门要求 ZOL 商品目录有真实品牌、型号和全部型号完成关联；三个必需来源族各至少 3 条 accepted 原始资料、来自至少 2 个 origin；五个经确认计划标注的主题入口各至少 2 条、来自至少 2 个 origin。该门评估原始资料入口，不裁决正文语义。增量 Planning 排除全部已接受和已尝试 exact URL，并为每个缺口准备“缺少数量 + 2”个候选及至少 3 个新 origin。
- 默认执行品牌由 Capture Task 的规则确定：综合评分大于 `0`，按榜单顺序最多 `20` 个。没有可验证榜单时生成受阻草稿，停在计划确认门，不回退为全品牌或固定品牌。
- Crawl Plan Draft 必须展示来源依据、榜单行与评分、执行品牌、规划前覆盖、专业主题、公开资料入口、捕获单元、预算、恢复策略、停止条件和阻塞。当前有效协议为多来源检查清单 v7；v6 及更早计划只读保留，不能确认或恢复执行。
- 品牌批次只控制同一 Confirmed Crawl Plan 中已经选出的执行品牌分组；默认每批 `3` 个，当前组完成后自动推进下一组。
- 负责人确认生成新的 Confirmed Crawl Plan version；确认计划与 Start 保持为两个独立动作。
- Provider 只执行 Confirmed Crawl Plan，不在运行时增加品牌、型号或来源。

## 执行、恢复与安全边界

- HTML 与图片使用独立节奏槽，并共享 Provider 访问限制熔断。
- 401/403/429、登录、验证码、风险正文和计划外 origin 立即停止当前计划范围。
- 暂时性传输错误、HTTP 502/503/504 和可信 DNS SERVFAIL 最多执行一次有界重试；执行阶段每次尝试都重新经过 Source Access Gate 并写请求账本，规划阶段的只读榜单核验同样只重试一次。
- ZOL HTML 的同一 exact URL 已在 Windows 真实执行中出现首次 404、随后原样返回 200；因此 ZOL adapter 可以显式要求一次 404 有界复核。第二次仍为 404 时必须把最终响应交还 Provider 保存 `not_found` Snapshot；该策略不适用于通用公开来源或图片 Asset，也不改变 401/403/429、robots、预算、取消和运行时限停止门。
- 单个请求在重试耗尽后结束对应请求 Work Item；品牌目录或型号范围可以隔离时，记录终止原因并继续后续品牌或型号，不把局部失败升级为 Source Run 失败。
- Source Execution 为计划中的每个来源分别建立 Source Run；一个来源失败时 Batch 记为部分完成并继续后续来源，只有公共 contract、存储不变量或人工停止等批次级条件才阻断整批。
- Source Execution 只执行 Confirmed Crawl Plan 中仍需抓取的来源；Planning audit 中通过校验的 ZOL 完成引用不创建新的 Source Run，也不复制原 Snapshot 或 Asset。
- 只有访问限制、计划与来源结构无法绑定、Provider/typed contract/存储不变量破坏、预算与最长运行时间耗尽、人工停止等运行级条件才结束整个 Source Run。
- 每个型号使用独立 work item；参数页、图集页和全部排队图片完成，或来源明确声明零图片后，才增加型号完成数。
- `target_count` 表达计划允许的最大覆盖边界；来源穷尽或隔离失败可以低于该值，实际完成数和失败原因由 target 与 work item 分别保存，任何执行都不得超过计划上限。
- Resume 只跳过恢复链中已经完整完成的型号，未完成型号重新执行，已有快照保持不可变。
- Worker 完整消费 Start/Resume 后，Source Execution 只为 `transient_transport` 和满足安全条件的 `execution_process_lost` 生成自动 Resume 请求；请求先把 Batch 标记为 `pending`，再以 `source-auto-resume-{runId}` 作为确定性 job key 延迟投递。
- 自动 Resume 候选生成前必须重新通过当前 Confirmed Crawl Plan 的可执行性校验；旧规划协议、过期版本或已失效计划回到人工规划门，不进入自动恢复队列。
- API 启动时扫描未完成 Batch，Graphile cron 每分钟再次扫描；恢复仍进入同一 Resume 入口和 Source Run 恢复链，累计请求数受原 Confirmed Crawl Plan 的 request budget 约束。访问限制、计划/契约错误、预算耗尽和人工停止不会自动重试。
- 队列关闭等待真实在途任务退出；Run 终态要求请求和 work item 全部终态，局部失败不会留下 running 项。

## 公共传输与内存边界

公共资源读取复用一个 Node 24 `https.Agent`。transport adapter 保留公网地址校验、可信 DNS/Fake-IP 失败关闭、同 origin 单次重定向、逐跳请求审计、流式最大字节限制和本机受信任 HTTPS 代理支持。

当前真实长批次在新增 134 个快照、114 张图片后约占 275 MB，并完成 20 个型号的剩余范围。该证据覆盖当前验收规模；后续品牌批次继续观测进程内存、请求节奏和存储预算。

## ZOL 来源边界

ZOL 路径、分页、DOM、`picList` 和图片 URL 协议只存在于 ZOL Provider。共享 Capture Task、Crawl Plan、Source Execution 和 Source Dataset contract 不包含具体品类、品牌、平台或型号假设。

ZOL Provider 接受 Confirmed Crawl Plan 中的门类 slug 与品牌目录数组，按榜单顺序和计划批次选择每品牌前 N 个不同产品 ID，并保存参数页、图集页和与当前产品绑定的来源原图。参数页的产品分片由每个产品 ID 确定性计算，不是门类 ID。

## 公开资料来源边界

`public.web-resource@2.0.0` 只消费 Confirmed Crawl Plan 中已经冻结的 HTTPS exact/site 入口。当前多来源规划为每个发现 URL 建立一个 exact 来源；一个 exact URL 只声明自身实际返回的一种格式，页面链接的附件必须以独立直达 URL 进入计划。Provider 保存原始 HTML、PDF、文本或附件及请求血缘，不继续搜索、不增加 URL、不清洗内容，也不判断资料是否足够。

登录、验证码、付费、许可限制、计划外 origin 或安全校验失败均如实留痕。单个公开来源失败只结束该 Source Run，后续计划来源继续执行。

## 架构通过门

1. 用户可以从 Workbench Chat Timeline 发起采集请求并确认采访范围草案。
2. 已确认 Capture Task 可以启动 Planning Run，并在同一产品表面查看商品目录、专业主题、公开来源和 Crawl Plan Draft。
3. 负责人可以独立确认计划，再执行 Prepare 和 Start。
4. 后台执行、瞬时传输自动恢复、访问限制和 Source Dataset 对账保持现有验证结果。
5. 正式门类计划按榜单规则选择商品目录，并同时包含可执行的标准监管、专业技术与品牌公开来源或对应失败记录；没有可验证商品榜单时保持在计划确认门。
6. 单个公开来源失败后，后续来源仍执行；Source Dataset 可以逐来源对账原始网页、PDF、附件、Request Attempt 和终态。
7. Source Coverage 对全部来源族与必需主题给出可追溯的最低覆盖结果；未达标时只补缺口，达标时全部计划执行已终态且没有剩余 gap。
