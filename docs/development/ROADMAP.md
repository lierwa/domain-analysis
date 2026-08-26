# 数据抓取与清洗平台路线图

状态：1C 持久原始抓取闭环已通过；1E `public.web-resource@2.0.0` 多路由与内容验收已进入真实系统，当前等待新 v4 Plan 的 Workbench 验收与人工确认

## 1. 简单说明

项目只有两个阶段：先把真实原始数据按可核对范围抓回来，再讨论怎么清洗。对电视等标准商品，AI 在规划阶段深搜品类品牌版图，把每个品牌对账到官网，并同时寻找参数/说明书、标准/监管和技术原理来源；Workbench 将官网种子组装为有界站内发现、将正文/附件组装为精确路由。用户确认后，执行层保存全部原始响应，但只有内容验收通过的数据计入有效完成。JD 现阶段不进入正式计划，也不作为覆盖分母。

## 2. 阶段 1：数据抓取

### 1A 对话生成抓取任务

产物：标准商品的版本化 Markdown 采访范围草案，以及用户确认后单独结构化生成的正式抓取任务。

通过门：

- 首句门类直接生效；
- 系统先判断标准商品边界，主动调查标准、品牌、型号、参数和来源，不让用户枚举可查事实；
- 固定服务专业导购 Agent：任务必须覆盖多品牌多型号市场数据、品牌官方配置/说明书、标准/监管和技术原理；四类具体来源未齐或系统调查未决项仍开放时不得形成可确认任务；
- 每个负责人问题都是真实取舍，在普通消息中给出专业推荐、依据和主要代价；不得为了凑选项制造问题，Composer 同时接受建议之外的回答；
- 平台和品牌事实由系统调查，不要求用户先枚举；当前正式规划排除需要登录或已触发风控的 JD，品牌官网承担型号、参数和说明书来源；
- 草稿用可读 Markdown 明确标准商品边界、抓什么、平台/官方来源事实、排除项和系统待核实项；采访回合不输出正式 Capture Task schema；
- 用户确认 Markdown 后才做一次不搜索、不加事实的正式 Capture Task 结构化；
- 确认不触发真实抓取。

### 1B 真实来源 Crawl Plan

用户已于 2026-08-19 授权按 `CRAWL-PLANNING-DESIGN.md` 开发。针对一个已确认 Capture Task revision，先用可见 Planning Run 形成版本化计划草稿；计划必须回答：

- 来源角色、真实入口和访问状态；
- 捕获 HTML、JSON、PDF、CSV/XLSX、图片或其他哪种源站单元；
- 抓取对象、覆盖分母、数量、分页/遍历终止；
- 覆盖分母的原始证据和漂移处置；不能只保存一段不可验证的说明文字；
- 唯一键、遍历方式和停止条件；
- 已注册 Provider 的 typed 配置、访问频率、请求预算、原始输出和强制停止条件；
- Capture Task 的非 JD 来源候选恰好一次、每个原文 topic 至少一次；说明书、PDF 和附件表格必须有正文 target，不能只列入口页。
- Planning Agent 必须通过 `brand_landscape`、`official_source_mapping`、`parameters_and_manuals`、`standards_and_principles` 四类网页搜索形成 Research Audit 策略 v3；version 4 执行清单要求七个品牌发现镜头、至少四个独立非 JD 证据源、逐轮新增品牌账、两个不同查询连续零新增，以及逐品牌官网与参数/说明书核查门。
- 每个发现品牌必须映射到 `brand_official` 来源，或明确记为 `unresolved`；每个 task topic 必须对账到实际 source/target。当前 version 4 只允许 `public.web-resource@2.0.0` 的 `exact/site` 显式路由，禁止 `*.jd.com` 和 JD Provider。

1B 保持计划生成、审查、修订和确认；计划确认不创建 Source Run。2026-08-24 的多次真实电视运行否决单轮巨型输出。R-045 已实现“六镜头品牌发现 → 逐查询饱和核查 → 可配置小批官网/参数映射 → 标准/原理 → Workbench 确定性组装”：批次为 1-10，默认 3，每个阶段使用独立 ephemeral thread，同阶段最多两个 repair turn。2026-08-25 真实页面用批次 10 生成 v9：25 个品牌、24 个来源、42 个 target，20 planned、5 unresolved，最后两个饱和查询连续零新增。用户随后明确要求以“稳定跑通链路，完整度持续增量”为目标，v9 已在 Workbench 确认并进入真实执行；该事实不把 5 个 unresolved 或未成功来源改写为已覆盖。

用户确认计划前不得发真实批量请求。

### 1C 单一真实来源闭环

从一个真实来源抓取一批未清洗数据，写入正式本地数据区；重启 API/Web 后仍可查看；JSONL/CSV 或原文件可以导出；数据库计数、导出记录和来源标识一致。

Start/Resume 已改为 PostgreSQL 持久后台派发：HTTP 202 后页面关闭、刷新或离开不影响服务端 Batch，Workbench 只读取持久进度。未领取 job 的 runner 重启恢复和断连完成已通过真实本地 PostgreSQL/随机端口门；执行中 Batch 现在持有 PostgreSQL session lease，API 启动时在 Graphile runner 之前收口已失去 lease 的 `running` Batch/Run/Target/Work/Request，保留已提交 Snapshot 且不自动重抓。三个真实 v9 批次均进入终态，最终批次 13/24 完成、11 个按源站状态失败，无遗留 `running`；这仍不声称网络副作用 exactly-once。

历史 JD 运行和快照只读保留用于审计，但全部 JD Provider 已从生产组合根移除；version 2 及更早计划不能启动，也不静默迁移。开始执行后每个 redirect hop 必须先写入持久准入账本，访问受限形成 truthful stopped/failed run，不能冒充完整通过。

### 1D AI 品类版图与官网规划

Planning Agent 使用现有 Codex App Server web search 深搜品类品牌版图、跨品牌市场目录、品牌官网、参数/说明书、标准/监管和技术原理。Research Audit 是计划可执行门的一部分：搜索证据不足、品牌仍未对账、官网 source 双向引用不闭合或 topic 没有实际 target 时，不能通过确认后执行门。此前失败运行证明单次最终 JSON、整表品牌复核和整轮内存执行都不稳定；当前由独立 ephemeral 阶段生成小结果，DBOS 用稳定阶段 ID 恢复已完成 typed result，Workbench 只幂等投影可见 Stage Checkpoint。官网批次发现的新品牌携带原查询/证据增量并入既有品牌账，再继续饱和查询和新增品牌批次，全部通过后 Workbench 才确定性组装 v4 Plan；DBOS 内部结果和 Stage Checkpoint 都不成为第二份 Plan 事实源。历史电视 v9 及四批执行只保留为 transport、访问限制和内容质量证据；当前下一门是从真实 Workbench 生成新的 v4 Draft，经负责人确认后再执行。JD 历史实验只保留为否决证据。

### 1E 品牌官网补齐、多来源和更新

阶段 1E 的完整抓取链按同一个系统事实链执行：AI 分阶段形成品牌分母与官网种子；Workbench 组装 v4 `exact/site` 路由、内容信号、数量和停止门；负责人确认计划；Prepare 只检查条件；Start 创建持久 Batch/Run/Target/Work；每个 HTTP hop 先过 PostgreSQL 准入；Provider 读取 robots/sitemap 并把同源候选放入 Crawlee 持久 RequestQueue；原始响应与附件不可变保存；内容 assessment 分为 accepted/rejected/supporting；只有 accepted 满足 target 数量；Batch 终态、页面和 JSONL/CSV 从 Source Dataset 投影；失败后由负责人显式 Resume，沿原队列和总预算继续。不得用浏览器成功、HTTP 2xx、Snapshot 数量或队列耗尽替代内容完成。

完整执行分段如下，任何一段都不能被“抓到了几个 URL”替代：

1. 范围冻结：只接受已确认 Capture Task 的市场、内容方向、排除项和来源候选。
2. 品牌与来源调查：DBOS 按稳定 ID 执行六镜头发现、独立饱和查询、跨品牌市场目录、逐品牌官网/参数/说明书核对、标准/监管与技术原理核对；页面或进程中断后完成阶段不重做，未解决项保留为 `unresolved`。
3. 计划组装：Workbench 生成 version 4 草案，冻结来源、`exact/site` 路由、内容信号、数量、预算、频控和停止条件；旧计划不迁移、不兜底。
4. 人工确认：确认只冻结一个新 Plan version，不创建 Batch，不访问计划来源。
5. Prepare：核对计划版本、Provider 注册、执行 blocker、Source Dataset 和本地持久目录，只报告 readiness。
6. Start 与派发：创建持久 Command、Batch、Source Run、Target Run 和 Capture Work，再由 Graphile Worker 领取；页面关闭不改变服务端运行。
7. 请求准入：robots、sitemap、页面、附件及每个 redirect hop 都必须先写 PostgreSQL Gate/Attempt；按 origin 串行限速，登录、验证码、403/429、TLS、安全边界和跨源降级失败关闭。
8. 多路由执行：`exact` 保存计划冻结的精确正文或附件；`site` 先读 robots/sitemap，再把 seed、sitemap URL 和 HTML 同源链接放入 Crawlee 持久 RequestQueue，按深度、页数、时间和总预算有界遍历。
9. 不可变原始保存：每次观察追加 Snapshot/Asset，保留 requested/final URL、状态、响应头、原始正文或附件、字节数、哈希和 charset；不覆盖历史，不提前清洗。
10. 内容验收：sitemap 等派发材料记为 `supporting`；无关页记为 `rejected`；只有同时命中计划内容信号和产品结构/型号/相关链接的页面，或通过文件签名与非空检查的精确附件，才记为 `accepted`。
11. 数量与终态结算：只有 `accepted` 增加有效完成数；target、source 和 batch 分别按 frozen denominator、失败原因和停止条件结算，未知或缺失保持 `partial`，不得从 UI 文案反推状态。
12. 审查与导出：Workbench 展示原始记录、内容 assessment、matched signals 和失败原因；JSONL/CSV/原附件从 Source Dataset 导出并与数据库计数、哈希对账。
13. 恢复与持续增量：进程失联先收口，不自动重发网络副作用；负责人显式 Resume 时复用原持久队列与剩余预算。新增品牌、官网种子或修复路径必须进入新的 Planning Run 和 Plan version，再次确认后追加新 Snapshot。

浏览器只允许未来作为计划显式声明、经独立调研和真实原型验证的另一条 route；当前 v4 不自动从 HTTP 切浏览器。遇登录、验证码、403/429、TLS、安全边界或跨源跳转仍失败关闭，不换代理、不切账号、不反检测。

任何新官网来源、型号候选或缺口修复都必须形成新 Planning Run 和 plan version；Source Run 不能边搜边扩范围。任务完整度后续以已确认 Research Audit 的品牌分母和 Source Dataset 对账，任一未知、歧义、受限或缺失保持 `partial`。

## 3. 阶段 2：数据清洗

阶段 1 全部通过后另行访谈和设计。输入只能是阶段 1 的不可变原始数据；清洗结果必须与原始数据物理或逻辑分离。当前不建设 Evidence、知识候选、Review、知识包或 Runtime。

## 4. 停止规则

- 1A 的产品负责人质量验收仍独立保留；当前 1B 完整清单及 1C/1D 有界能力已有明确授权，任何新的真实多来源 Start、专站 crawler 或阶段 2 仍需单独授权；
- 非标准商品不进入当前采访和抓取流程；
- Crawl Plan 未确认，不访问真实来源；
- JD 登录、搜索和详情路径已被真实访问限制否决并从生产组合根移除；不得再次进入登录、刷新、切号、代理轮换或详情 canary；
- 不新建 POC package、隔离数据库或平行应用；
- 测试绿灯不能代替 Workbench 真实路径验收。
