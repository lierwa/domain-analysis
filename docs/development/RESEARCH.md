# 技术调研登记

> 2026-08-18 当前边界：项目只实施阶段 1 数据抓取。本文保留历史候选和淘汰依据，但其中 Evidence、Knowledge Factory、知识包、Runtime、Market Universe 及具体来源 Provider 均已退出当前生产组合根，不得按历史“接受”状态继续实现。当前继续复用的成熟组件只有 PostgreSQL/Drizzle、Fastify、assistant-ui、Codex CLI、Crawlee、p-queue 与 cockatiel；后续新增 Crawl Plan 或 Provider 必须在用户验收 1A 后重新进入调研和真实原型门。

状态：持续维护
更新日期：2026-08-19

本文件只记录技术问题、成熟候选、官方依据、原型结果、接受/拒绝/替代状态和退出成本。阶段进度看 `PROGRESS.md`，模块边界看 `ARCHITECTURE.md`，已删除 POC 的历史结论只通过本文件、ADR 与 Git 历史追溯。

## 1. 当前结论索引

| 编号 | 主题 | 当前状态 |
| --- | --- | --- |
| R-001/R-012 | 京东与官网浏览器访问 | 保留访问状态、风险页和停止条件证据；1A 后重新选生产 reader，不授权当前真实请求 |
| R-004/R-021 | Workbench 数据库/migration | 当前接受 PostgreSQL＋Drizzle；旧 DBOS schema 只保留本机历史结构，不是当前流程 |
| R-007 | 依赖复现/安全 | 当前持续维护 |
| R-027 | 死代码清算 | 使用 CodeGraph＋真实 entry；不新增 Knip |
| R-028 | 本地 Chat Timeline | 接受 `assistant-ui` ExternalStoreRuntime；单回合有序 parts、普通问题文案、Composer 自定义回答和刷新恢复已验证 |
| R-029 | Codex 交互运行时与 Pi 边界 | 接受：锁定官方 `codex app-server` `stdio`，每轮 `thread/start(ephemeral:true)`；commentary 用官方 delta，最终 JSON 由本地 Zod 校验；MVP 不引入 Pi |
| R-035 | Crawl Planning Agent 运行与版本化计划 | 接受复用 App Server/Skill/Zod/PostgreSQL；前台可见、断连中止；拒绝为短规划引入后台队列 |
| R-032 | 来源访问限速、取消与熔断 | 当前只保留 `p-queue`＋`cockatiel` 基础；具体 Crawl Plan、持久恢复和京东真实窗口在 1A 后重新验证 |
| 历史 R-002～R-026、R-030～R-034 | 旧知识生产与 POC | 只保留调研/失败证据；DBOS、Evidence、知识包、Runtime、Market Universe 和旧 Source Dataset contract 均由 ADR-0015 退出当前范围 |

## 2. 仍然有效的基础设施决定

### R-002/R-017 Durable Pipeline

状态：已接受；目标：阶段 2

问题：流水线要在进程崩溃、人工等待、取消和阶段重试后可恢复，不能自研状态机、重试或任务日志。

结论：使用 DBOS Transact `4.25.14`；业务状态使用 typed `start / command / get` seam，DBOS 类型不穿透领域。`workflowID` 来自冻结输入；失败 step 显式重试使用官方 `forkWorkflow(startStep)`，旧运行不可变。DBOS 建立在 PostgreSQL 上，服务启动前注册/启动，Fastify `onClose` 关闭。

验证：历史隔离验证覆盖三次自动重试、强杀 worker 后接续、人工消息、取消和失败 fork；当前接受决定见 ADR-0007。历史实验执行树已删除，不作为当前生产完成证明。

官方依据：https://docs.dbos.dev/typescript/programming-guide 、https://docs.dbos.dev/typescript/tutorials/workflow-tutorial 、https://docs.dbos.dev/typescript/reference/dbos-class

退出：领域 interface 不依赖 DBOS；替换必须先通过同一崩溃/人工/取消/fork 等价门，不允许降低 contract。

#### 2026-08-16 / 6.3 批量监管对账扩展调研

- CodeGraph 复核当前生产 adapter：`executePipeline` 逐阶段调用 `runStage`，而 `runStage` 把整个 `PipelineStageHandler` 包在一个 `DBOS.runStep` 中。因此在现有 `acquire` handler 内串行调用 537 个型号并不形成 537 个恢复点；任何中途失败都会至少重做整个 handler。该路径拒绝。
- DBOS 官方 Queue 可从父 workflow enqueue 子 workflow，并提供持久结果、并发、rate limit、timeout、deduplication 和 priority；只依赖现有 PostgreSQL，不增加 Redis/新服务。当前锁定的 `@dbos-inc/dbos-sdk@4.25.14` 运行时已验证导出 `registerQueue / startWorkflow / registerWorkflow / WorkflowQueue`：https://docs.dbos.dev/typescript/tutorials/workflow-tutorial 、https://docs.dbos.dev/typescript/reference/client 、https://github.com/dbos-inc/dbos-transact-ts
- 隔离临时 PostgreSQL 原型已验证父 workflow enqueue 3 个按型号子 workflow、队列并发 1、父级按输入顺序收齐 typed 结果，观测到 `maximumActive=1`。随后强杀首进程：已完成 M1 没有重做，执行中的 M2 按 DBOS 至少一次边界重做，M3 正常继续；最终执行序列为 `M1, M2, M2, M3`，三项结果完整。临时数据库、marker 和脚本均已删除。
- 候选接法：父 workflow 固定消费某一 Market Universe candidate 的品牌＋厂商型号；每个型号用稳定 workflow ID 进入 concurrency=1 的监管子 workflow，子 workflow 调用现有 `EnergyLabelRecordSource` 并返回 matched/not_found/failed/producer_conflict；外部写入必须继续以业务键幂等。父级只在收齐结果后调用 Workbench 形成新 candidate，不能从 DBOS 内部表反推业务事实。
- 生产处置已接受并落地为专用 `MarketUniverseRegulatoryPipelineModule`，没有改造通用 `PipelineStageHandlers`：父 workflow 冻结 candidate，稳定子 workflow ID 逐个进入 concurrency=1 的 Queue，公开 typed 开始/最近运行/按 ID 查询/取消与进度；结果收齐后以父运行 ID 作为 operation ID 调用 Workbench 一次生成新 candidate。真实 PostgreSQL 集成证明 3 个型号最大活跃数为 1、结果计数完整、重复开始不重复访问；取消时未开始型号不再访问且不生成半版候选；页面刷新能从当前 candidate 或输出 candidate ID 恢复运行。全仓 DBOS 强杀恢复门继续证明已完成子任务不重跑、在途任务按至少一次语义重做。该结论只接受监管按型号对账 seam，不授权万能 batch engine。

### R-003/R-015 知识包存储与全文

状态：SQLite＋FTS5 已接受；新 EvidenceItem、许可投影、第二品类和 Windows/Node 24 文件生命周期已复核，目标 Linux 门仍待补

问题：知识包需单文件、只读、离线、可复制，支持精确、结构化、中文全文、关系和证据查询，不要求模型/embedding。

结论：SQLite＋FTS5 满足 MVP；构建后 SHA-256 校验、只读打开并启用 `query_only`，新包校验成功后原子切换 stable 指针。生产本地 SQLite 和知识包读写统一使用 `better-sqlite3@12.11.1`：该 MIT 版本声明支持 Node 24，提供 Windows 预编译包，且 Drizzle 有官方 adapter。DuckDB/Orama 不进入当前依赖；它们不是查询能力的必要条件。

验证：历史隔离验证覆盖跨目录复制、无网络查询、损坏拒绝、版本切换/回滚和第二品类同结构；这些结果只证明技术候选，不代表正式产品数据。2026-08-18 Windows/Node 24.14 复现 `@libsql/client@0.17.4` 在 `close()` 后仍令初始化库删除和知识包 rename 返回 `EBUSY`；改用 `better-sqlite3` 显式 close 后，legacy SQLite、知识包原子 rename、长路径打开和清理通过。超过传统 Windows 路径上限时只在 native 驱动边界调用 Node 稳定的 `path.toNamespacedPath`，公开描述符仍保存普通绝对路径。当前接受决定见 ADR-0006；历史实验执行树已删除。

官方依据：https://sqlite.org/fts5.html 、https://sqlite.org/pragma.html#pragma_query_only 、https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.11.1 、https://orm.drizzle.team/docs/sqlite/get-started-sqlite 、https://github.com/tursodatabase/libsql-client-ts/issues/350 、https://nodejs.org/api/path.html#pathtonamespacedpathpath

### R-004/R-021 Workbench PostgreSQL 与 migration

状态：已接受；目标：阶段 2

问题：业务控制状态和 DBOS 运行历史需要持久化、事务和正式 migration，不能由手写 DDL 与 Schema 双重定义。

结论：业务表由 Drizzle PostgreSQL migration 管理在 `workbench` schema；DBOS 内部表只在 `domain_analysis_pipeline` schema。两者共用一个 PostgreSQL database，但禁止跨 schema 写表或读取 DBOS 内部表。旧 Social Intelligence SQLite 表不迁移；知识包 SQLite 不属于运行状态库。Drizzle runtime migrator 读取历史再执行 DDL，但本轮真实并发启动暴露首次建表竞争；用 PostgreSQL 官方 session-level advisory lock 对同一 schema 的官方 migrator 串行化。锁和 migrate 使用同一连接，连接销毁时数据库自动释放；不自建锁表、迁移器或重试器。

本地跨电脑处置：两台开发机的 PostgreSQL 数据互不迁移；提交只携带连接配置和 Drizzle migration。Node 24 官方 `--env-file` 已稳定，且进程外显式环境变量优先于文件值，因此 API/本地数据库准备脚本直接读取已提交的根 `.env.example`，仍允许临时环境覆盖。启动前的薄脚本复用现有 `pg`，只检查目标库并在缺失时创建一个空库；表和 schema 仍全部由官方 Drizzle migrator 管理，不在脚本中手写业务 DDL。

验证：临时 PostgreSQL 覆盖 migration 幂等、外键、JSONB、事务回滚和 DBOS 同库异 schema；2026-08-15 又以 4 个并发 migrator 和全测试文件并发启动验证 advisory lock 消除 `pg_type_typname_nsp_index` 竞争。见 ADR-0009。

官方依据：https://orm.drizzle.team/docs/migrations 、https://orm.drizzle.team/docs/drizzle-kit-migrate 、https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS 、https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS 、https://docs.dbos.dev/typescript/reference/configuration 、https://nodejs.org/docs/latest-v24.x/api/cli.html#--env-filefile

### R-006 最小证据内容寻址

状态：范围由 R-026/ADR-0011 收窄；实现继续接受 `cacache@19.0.1`

问题：EvidenceItem 字节需要不可变、内容去重、并发安全、读时完整性和公开/受限物理隔离，不能自研 CAS。

结论：`cacache@19.0.1` 保存已选最小证据字节和 evidence manifest；PostgreSQL 保存 identity、SRI、locator、状态与关系。整页 HTML、全页截图、完整无关文档和资源清单不进入永久 CAS。提交顺序为证据字节 → manifest → PostgreSQL 事务；新证据不覆盖旧证据。

验证：既有原型证明同内容去重、并发原子写、损坏拒绝和 privacy 目录隔离；2026-08-15 新 Evidence Module 集成测试又证明“精确上下文文本 → 内容 SRI → manifest SRI → PostgreSQL 目录 → 无网络重读”，且整页夹带、空内容、不可访问观察和弱图片关系失败关闭。图片字节/裁切真实性、PDF/XLSX 与临时完整资料清理仍未过 POC。见 ADR-0010。

官方依据：https://github.com/npm/cacache

退出：Evidence interface 只依赖 SRI/字节，不暴露 cacache API；替换存储无需改 EvidenceRequest 或 Knowledge Factory。

### R-019 稳定内容指纹

状态：已接受 `canonicalize@3.0.0`

问题：版本对象和幂等身份需要跨对象键序稳定的 RFC 8785 JSON 指纹，不能自己排序 JSON。

结论：用成熟 `canonicalize` 生成规范 JSON 后 SHA-256；只用于内容身份，不替代数据库唯一约束或业务版本。

官方依据：https://www.rfc-editor.org/rfc/rfc8785 、https://github.com/cyberphone/json-canonicalization

## 3. 产品/领域技术边界

### R-005 Codex SDK 与模型任务

状态：窄用途已接受；新用途待用户确认和 POC

已接受用途：一个候选批次最多一次，将未映射最小事实视图 `evidenceId / subjectKey / rawName / rawValue` 转成永远 `review_required` 的结构化候选。完整证据、主体和值由服务端按 evidence ID 恢复与校验；模型不能改写事实或发布。

历史实现边界：批次候选加工曾使用锁定的 `@openai/codex@0.147.0` 与 `codex exec --ephemeral`；该知识加工用途已退出当前阶段，不得借此恢复第二阶段代码。当前抓取采访的运行边界由 R-029 的 2026-08-18 真流式结论单独定义：官方 App Server `stdio`、`thread/start.ephemeral=true`、只读 sandbox、never approval，最终输出仍由领域 Zod contract 校验。

验证：正确 `gpt-5.3-codex-spark + low` 已对最小夹具和 R-034 电视真实证据返回严格候选；R-034 最终得到 22 条候选，其中 21 条来自模型、1 条确定性型号转换，并通过 foundational owner＋subject_ref 关系门。错误简称 `codex-5.3-spark` 的失败补丁已完全删除，不保留 alias/fallback。该事实不能证明模型适合网页语义寻找、图片关系、OCR 后推理或其他新用途。

硬门：任何新 Codex/模型用途先与用户讨论任务粒度、输入、输出、modelId、推理深度、批次、数据边界和人工门，再做版本化样本 POC。不得自动 fallback 或继承浮动默认模型。

官方依据：https://developers.openai.com/codex/cli/reference/ 、https://github.com/openai/codex 、https://openai.com/index/introducing-gpt-5-3-codex-spark/

### R-008 跨品类商品模型

状态：方向已接受；生产实现未通过

结论：所有商品共用稳定身份、变体/Offer、属性结论、专业结论、关系和证据语义；共享属性字典拥有属性代码、类型、单位、别名与标准映射；品类知识定义只选择/补充版本化数据。新增品类不得新增表列、类、Runtime API、流程或同来源知识解析器。

行业依据：Schema.org `additionalProperty`、Akeneo Family/attributes 与 Pimcore Classification Store 证明品类属性数据化有成熟实践，但不要求引入完整 PIM：https://schema.org/additionalProperty 、https://api.akeneo.com/concepts/catalog-structure.html 、https://docs.pimcore.com/platform/Pimcore/Objects/Object_Classes/Data_Types/Classification_Store/

当前缺口：旧 LinkML 与冰箱/电视 fixture 是隔离证据；当前品类定义仍内嵌属性列表，生产共享模型/字典和三品类迁移门尚未完成。见 ADR-0002。

### R-010 市场总体与覆盖

状态：产品 contract 已接受；首批官方目录已真实枚举，完整市场总体仍待补齐

结论：监管备案形成合规身份台账；品牌官网/说明书、官方自营和经核实旗舰店在同一观察窗口的并集形成官方在售总体；只有取得许可清晰的市场数据才报告销量加权覆盖。`MarketUniverseVersion` 在 frozen 前保留纳入/排除/未知和来源证据。

2026-08-16 真实来源验证（官方页面与其当前生产接口，不是 fixture）：

- 中国标准化研究院公告确认批量数据包含规格型号、生产者、能效等级和备案号并定期更新；冰箱附件观察窗为 2016-08 至 2024-12。该来源只能形成合规身份台账，不能证明 2026 年仍在售：https://www.cnis.ac.cn/tzgg/202412/t20241231_59316.html
- 海尔中国冰箱官方目录的当前生产接口按页面声明 `total=271`；逐页读取 271 行，按 `modelno` 去重后仍为 271，缺失 0、重复 0，且全部 `psale=0`。这证明“海尔官网当前目录候选总体”，不证明中国冰箱市场总体：https://www.haier.com/cooling/
- 美的官方商城冰箱目录当前声明 384 个 SKU；逐页读取后先以 `lCategoryId=1` 排除冷柜等非冰箱，再以“品牌＋`nModel`”去重，得到 284 个冰箱 SKU、222 个唯一厂商型号。62 个重复行来自颜色/SKU 变体；品牌唯一型号为美的 98、COLMO/科慕 58、东芝 32、小天鹅 32、华凌 2。`nInStock` 只表示观察时点库存，不能用来否定 `nOnSale=1` 的官方在售身份：https://www.midea.cn/s/search/search.html?category_id=10008
- TCL 中国官网冰箱目录当前公开声明 44 个结果；生产 adapter 实际读取 44 行，并按官方详情标识得到 44 个唯一厂商型号，缺失 0、重复 0。页面后半部分省略 `hideInProductList` 时按“未隐藏”处理，该边界已有回归测试；全程不从搜索结果或卖家标题猜型号：https://www.tcl.com/cn/zh/refrigerators
- 京东官方自营冰箱页当前可见至少 16 个品牌过滤项和 5 页结果，可作为官方自营来源与待补品牌发现入口；商品标题、颜色和 seller SKU 不能充当厂商型号，必须从商品规格确认后再并入：https://www.jd.com/brand/737a81dda3769f80aa8.html

京东停止门：公开品牌页可列出商品，但无登录的 Chrome/Playwright 访问商品详情时，规格接口 `pc_detailpage_wareBusiness` 返回 HTTP 403 并进入京东访问限制页。当前不得从标题正则猜型号，也不得自动绕过验证；该来源保持 unknown，待专用本机 Profile 的人工登录/验证路径在 Source Access 阶段按既定浏览器边界运行。

实现结论：阶段 1A 先生产一个 `candidate` 状态的 `MarketUniverseVersion`，保存观察窗口、来源声明总数、实际读取数、唯一型号数、品牌＋厂商型号去重规则、来源引用和未知品牌/渠道。当前三源真实纵切片合计枚举 699 行、接收 599 行，得到 537 个唯一型号（海尔 271＋美的系 222＋TCL 44）和 7 个品牌，只形成可审核候选分母；在监管台账、京东官方自营及其余品牌官网未完成同窗枚举前禁止标记 `confirmed/frozen`，也禁止报告“中国市场覆盖率”。

#### 2026-08-16 / 6.1 覆盖定义纠偏

状态：已接受并完成 6.2 contract 落地；完整品牌/监管/官方渠道总体仍待 6.3～6.5。

##### 官方依据

- 市场监管总局对现行 GB/T 8059—2025 的说明明确：标准按主要间室把家用制冷器具分为“非冷冻食品储藏箱、冷冻和非冷冻组合箱、冷冻食品储藏箱或冷冻箱、葡萄酒储藏柜”，并单独定义深冷间室。这是品类边界/标准适用分类，不是单门、对开门或嵌入式等销售筛选：https://www.samr.gov.cn/xw/sj/art/2025/art_5d2267b710d3450689e6ce11a6bd4eaa.html
- GB/T 8059—2025 与 GB 12021.2—2025 均于 2026-06-01 实施；后者适用范围还覆盖嵌入式制冷器具，说明“监管产品类别”和“安装形态”必须分轴表达，不能压成一个 `type` 枚举：https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=BF0FB970326D221A8E78987E22BB7F02 、https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=9BC022A3FF2B7F7D733C3962C986DF7A
- 《能源效率标识管理办法》规定能效标识记录生产者名称、产品规格型号、能效等级/指标和依据标准；生产者或进口商负责备案。CNIS 公告公开的数据也只有型号、生产者、能效等级和备案号。因此监管台账能证明合规 identity，不直接提供品牌 identity，也不能证明 2026 当前在售：https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_3fd2290ff58a40a8805f9d4af4af4e94.html 、https://www.cnis.ac.cn/tzgg/202412/t20241231_59316.html
- 2026-08-16 复核京东自营冰箱页：页面公开列出至少 48 个当前可见品牌标签并仍有“更多”，同时提供容量、门数量、预留宽度、是否嵌入式、制冷方式、开门方式、能效、变频/定频、控温和门款式等多个筛选轴。品牌页可作为渠道发现与市场形态候选来源，但这些筛选轴语义不同，且页面同时出现冷柜、冰吧和车载冰箱入口；不得把页面标签数直接当冰箱品牌分母：https://www.jd.com/brand/737a81dda3769f80aa8.html
- 同日从该品牌页打开三个自营商品详情均进入京东 risk handler；公开品牌页可发现商品，但不能据此声称规格采集成功。厂商型号、SKU/变体和店铺身份仍须由专用 Profile 下可定位的商品规格、能效标识或其他官方证据确认；访问受限保持 typed unknown，不从标题猜测。

##### 候选覆盖模型

1. `Market Universe` 的唯一成员集合仍是商品型号；型号 identity 保持“规范化品牌身份＋厂商型号”。监管生产者、来源对象、商品变体和销售要约分别关联，不并入型号 identity。
2. 品牌分母不是人工维护的品牌清单，而是型号总体投影出的品牌集合；是否“品牌抓完”另外由品牌发现来源账判断。监管、品牌独立官网/说明书、京东官方自营和核实旗舰店任一必需来源未完成时，品牌集合只是 `observed`，不是 `complete`。
3. 类型不建立第二套对象总体，而是对同一型号集合做分维度覆盖。首个必须维度是 `regulatory_product_class`；候选市场形态维度为 `installation_form` 与 `door_layout`。`cooling_method` 是技术配置/比较属性，可参与分层验收，但不属于型号 identity 或监管产品类别；容量段由规范总容积确定性派生，不保存为另一条外部事实。
4. 每个覆盖维度独立报告 `classified / unknown / not_applicable` 型号及分组计数。一个型号可以同时属于“冷冻和非冷冻组合箱”“嵌入式”“十字门”“风冷”，这些值不能拼成单一 `type` 字符串。
5. 当前冰箱项目范围候选为纳入“非冷冻食品储藏箱”和“冷冻和非冷冻组合箱”，排除独立冷冻箱/冷柜与葡萄酒储藏柜；这是根据现有 `household_refrigerator` 和官网冰箱目录形成的系统推荐，仍需负责人确认，不能由代码静默决定。
6. 确认总体不要求世界上不存在任何 unknown，但必须没有 coverage-blocking unknown。数值完成阈值在真实原型前不写死；品牌发现来源未完成、型号 identity 未确认、必需监管类别缺失、观察窗口不一致和京东官方渠道不可访问默认为 blocking 候选。

##### 当前 contract 缺口

| 现有表面 | 缺口与后果 | 6.2 候选处置 |
| --- | --- | --- |
| `brand: string` | 没有规范品牌 identity、别名或品牌/监管生产者区分；大小写归一化不能合并中英文/子品牌别名 | 引入有来源的 brand identity/reference；producer/importer 单列关联 |
| `manufacturerModel` | 只能记录型号文字，不能表达 identity 是否由规格/监管证据确认 | 记录 identity 状态与支持来源；未确认不得进入 confirmed 总体 |
| `variantCount` | 当前每遇到同 identity 的目录行或跨来源引用就加一；它统计重复观察，不证明真实 SKU/颜色变体 | 改成真实来源引用/重复观察计数；只有官方区分的规格才建立 Product Variant |
| `sources[]` 汇总计数 | 只有全来源总数，没有逐品牌发现完成度、观察窗口一致性、拒绝项或来源运行状态 | 增加版本化 source/brand coverage ledger 与 typed completion |
| `models[]` | 没有监管类别、安装形态、门体布局或逐维度 unknown | 增加版本化分类观察/覆盖投影，不把站点筛选标签写成通用枚举 |
| `unknowns[]` 自由描述 | 不能指出影响哪个品牌/型号/维度/来源，也不能确定是否阻断 confirm | 增加 scope、dimension、reason code、blocking 和所需来源 |
| `basis = official_active_assortment_candidate` | lifecycle 已另有 status，但 basis 名称仍写死 candidate；confirmed 版本语义矛盾 | basis 表达总体口径，candidate/confirmed 只由 lifecycle status 表达 |
| 只有 `refreshCandidate/latest` | 没有人工审核/确认命令，Schema 虽允许 confirmed 但生产路径不能到达 | 增加带 expected version/hash 的显式 confirm；保留历史并 supersede 旧版本 |

##### 来源矩阵

| 来源 | 能证明 | 不能证明 | 在总体中的职责 |
| --- | --- | --- | --- |
| GB/T 8059、GB 12021.2 | 标准范围、监管类别、测试/能效适用边界 | 品牌、当前在售型号 | taxonomy version 与分类依据 |
| CNIS/能效备案 | 生产者/进口商、规格型号、备案号、能效和依据标准 | 市场品牌、当前在售、官方渠道 | 合规 identity 台账与交叉核对 |
| 品牌独立官网/说明书 | 品牌呈现、厂商型号、官方规格/分类、目录时点 | 中国市场其他品牌是否遗漏 | 品牌内官方在售与类型观察 |
| 京东官方自营/核实旗舰店 | 渠道在售、Offer/SKU、平台筛选和时点状态 | 监管生产者、跨市场完整品牌分母；标题不能单独确认型号 | 官方渠道发现、在售并集和差异核对 |

##### 最小原型计划

原型不引入新依赖、模型、Provider registry 或站点字段 projector；继续复用已经接受的 Zod、Workbench PostgreSQL、Crawlee＋Patchright 和人工登录边界。

1. 从至少两个品牌独立官网、CNIS 和京东自营选择 12～20 个真实型号，覆盖两个拟纳入监管类别、两个拟排除类别、嵌入式/非嵌入式、至少三种门体布局、同型号跨来源、同型号多销售行和一个详情访问受限样本。
2. 用隔离 prototype contract 表达 brand identity、producer、model identity、source refs、coverage dimensions、Offer/Variant 区分和 scoped unknown；不迁移生产数据库。
3. 验证同型号跨来源只增加引用、不增加变体；品牌别名必须通过显式证据映射；无法确认监管类别/厂商型号时保持 blocking unknown；不同观察窗口不得合并成 confirmed 候选。
4. 输出品牌发现账、逐覆盖维度 `classified/unknown/not_applicable` 对账和 candidate confirm 报告；用实际样本决定哪些维度必须进入 Market Universe、哪些留在后续 Knowledge Need。
5. 原型和 contract diff 经人工确认后才进入 6.2，一次修改共享 Schema、migration、Workbench、API、Web 和测试；若原型无法稳定从官方来源得到必需分类，则停止实现并保留该维度 unknown，不自造分类器或用模型补事实。

##### 2026-08-16 / 6.2 原型与实现结论

- 隔离原型使用 20 条真实型号观察，得到 19 个唯一 identity、16 个拟纳入型号、2 个冷柜和 1 个酒柜；`BCD-501WSPM(Q)` 的官网/CNIS 两条观察归为同一型号并保留两个 source ref，未产生 Product Variant。13 个只从京东发现页得到的型号保持 identity blocking unknown。
- 正式 contract 采用结构化品牌 identity、独立监管生产者、型号 identity 状态、来源 completeness、`regulatory_product_class / installation_form / door_layout` 三个覆盖维度，以及带 kind/scope/blocking 的 unknown。`basis=official_active_assortment` 与 lifecycle status 分离。
- Workbench 是唯一聚合与确认事实源；API 新增 expected version/hash confirm，PC 只投影同一版本。确认门拒绝 blocking unknown、未核验 identity 和必填分类 unknown；跨来源分类冲突会收窄为 blocking unknown，不做隐式择一。
- 当前表的内容本来就是 JSONB，status/confirmed_at 字段也已存在；实际开发库 Market Universe 行数为 0，所以无 DDL 可迁移。本轮不生成空 migration；若发现其他机器存在旧形状，Schema 明确拒绝，等待单独迁移决定。
- Node 24.12.0 arm64 下 6.2 首次全仓门为 104 项通过、30 项条件跳过；临时 PostgreSQL Market Universe 集成 2/2、六 workspace typecheck、production build 与 1440×900 PC 表面通过。PC 验收显示 4 个隔离代表型号、2 个品牌、3/4 identity 已核验、京东 partial source 和三类冻结阻塞；横向溢出与浏览器错误均为 0。临时数据库和服务已清除，真实开发库未写入候选。

##### 2026-08-16 / 6.3 监管同窗生产验证（已完成监管部分）

- 能效标识公开查询用已知 `BCD-501WSPM(Q)` 返回唯一记录，`productTypeCode=81`、生产者“合肥美的电冰箱有限公司”和备案号可用，说明既有按型号两步 list/detail 路径能提供生产者＋规格型号交叉证据。
- 用 `productType=81 / isOld=0` 枚举时，接口 `data.total` 固定报告 500，但 pageSize 100 的第 6 页仍返回 100 条不同记录；因此 `total` 不是可信完整分母，禁止按 500 宣称监管型号抓完，也不能用它驱动停止条件。
- 监管记录把冷柜 `BD/BC-*` 和冰箱 `BCD-*` 放在同一“家用电冰箱 2015版”产品类型下，不能直接提供 GB/T 8059—2025 四类 `regulatory_product_class`。6.3 应把能效备案用于“已从品牌官网发现的型号”的生产者/备案交叉，而不是反向把整个备案列表冒充当前在售市场总体。
- `EnergyLabelRecordSource` 已把“同型号多条备案”从异常改为 typed registration list；真实海尔 `BCD-500WGHFDB5XAU1` 返回两条备案但生产者均为“海尔智家股份有限公司”，这是可保留的多记录，不应触发两次无意义重试。列表/详情 Zod 校验移到 crawler 结果外，使 Crawlee 只重试网络和运行时失败，确定性业务结果不重试。
- 薄 `EnergyLabelRegulatoryCatalogSource` 已完成三型号纵切片：`BCD-501WSPM(Q)`、`BCD-500WGHFDB5XAU1`、`R555Q10-SS` 均 matched，共保留 4 条备案与 3 个唯一型号；输入重复型号只查询一次，not_found/failed/producer_conflict 都有 typed outcome。它只负责来源交叉，不拥有 Market Universe 或最终知识。
- `OfficialCatalogSnapshot` 来源账明确增加 `coverageKind / coverageStatus / observedBrandKeys`。海尔/TCL 标为 `independent_brand_catalog`；美的商城标为 `multi_brand_official_catalog`，其五个品牌标签不能各算一个独立官网；能效备案标为 `regulatory_registry_lookup`。来源完整度由 adapter 明确报告，不再从行数相等自动推导。
- 该 adapter 没有接到同步 refresh route，而是经已接受的专用 DBOS 父/子 workflow 执行。隔离业务库真实运行 537/537：274 matched、251 not_found、12 producer_conflict、0 failed，生成 v2 candidate；286 个型号带至少一个监管生产者。not_found/conflict 均转为逐型号 blocking unknown，监管结果没有被冒充成完整在售分母。页面刷新恢复和取消传播的缺口随后修复：父级逐项入队、至多一个在途子任务，父运行 ID 作为输出 candidate operation ID，API/Web 从服务端读取最近运行。监管部分已完成，6.3 仍因其余品牌独立官网未完成而保持进行中。

##### 2026-08-16 / 其余品牌独立官网入口复核

当前品牌发现缺口矩阵（同一日重新读取京东自营冰箱页当前首屏品牌列表；页面仍显示“更多”，所以这是已观察集合，不是中国市场品牌总数）：

| 已观察品牌标签 | 当前可审计来源 | 独立官网完整目录 | 处置 |
| --- | --- | --- | --- |
| 海尔 | 海尔中国目录 271 个唯一型号 | complete | 已接生产 |
| 统帅 | Leader 中国目录 49 个唯一型号 | complete | 已接生产 |
| TCL | TCL 中国目录 44 个唯一型号 | complete | 已接生产 |
| 美菱 | 美菱商城 93 SKU / 85 个唯一型号 | complete | 已接生产 |
| 美的、华凌、COLMO/科慕、东芝、小天鹅 | 同一美的官方商城多品牌目录 | missing | 保留各品牌独立覆盖缺口，不能拆成五个官网完成 |
| 海信、容声 | 同一海信集团目录 16 个唯一 identity，且 1 页型号未确认 | partial/missing | 集团来源已接生产；容声独立官网访问仍失败 |
| 康佳、新飞 | 康佳集团官网冰箱总类目 7 个当前商品 | complete multi-brand only | 详情参数明确品牌和型号；排除 1 个冷柜后接入 6 个冰箱 identity，不能拆成两个独立官网完成 |
| 西门子 | 西门子中国官网“商城在售”46 项 | complete | 排除 2 个酒柜和 1 个独立冷冻箱后，43 个冰箱型号已接生产 |
| 米家、小米 | 小米商城冰箱搜索与详情 API | missing | 搜索有 19 项但混有系列聚合页和配件，详情有参数却没有厂家型号；暂不进入型号总体 |
| 荣事达 | 荣事达集团官网“冰洗护”当前产品中心 | partial | 页面声明当前 1 项且明确 `BCD-271WGP`；可作官方渠道发现，不能冒充独立冰箱完整目录 |
| 志高 | 志高集团官网声明经营冰箱，但产品访问标准 TLS 失败 | missing | 不关闭证书验证；保留来源访问 unknown |
| 奥克斯 | 奥克斯集团官网当前产业与产品导航 | missing | 当前官方范围为暖通、用配电、新能源和医疗，未发现冰箱目录；京东标签不能反推品牌完整目录 |

这 19 个已观察标签中，当前海尔、TCL、美菱、统帅、西门子 5 个具有独立品牌完整目录；美的系 5 个品牌和康佳/新飞 2 个品牌只有完整的多品牌官方目录；海信/容声 2 个品牌只有集团 partial 目录；荣事达只有官方渠道 partial；米家/小米、志高、奥克斯 5 个仍缺少可生产使用的厂家型号完整目录。该计数用于暴露来源缺口，不是市场份额、品牌总数或完成率。京东当前页还显示“更多”，6.4 的渠道枚举仍可能发现新增品牌：https://www.jd.com/brand/737a81dda3769f80aa8.html

- Leader 独立官网产品页公开搜索参数连接官方 `leader_product/getProduct` JSON 目录。按 `channelId=41824` 与 `psale=0` 实测声明 49、读取 49、缺失型号 0、唯一型号 49；详情 URL 和 `modelno` 均由同一官方响应给出。该 typed snapshot 已接生产并标记 `independent_brand_catalog/complete`：https://www.leader.com.cn/cooling/
- 九个生产来源在同一轮只读访问中的当前并集是 737 个唯一“品牌＋厂商型号”，目录内实际观察 15 个品牌：海尔 271、统帅 49、美的系 222、TCL 44、海信集团 16、美菱 85、康佳集团 6、西门子 43、荣事达 1。相对旧 537 型号监管批次新增 200 个 identity，未继承旧结论。

- 海信集团官网冰箱类目当前公开声明 21 个产品，并在同一页面分别列“海信冰箱”和“容声冰箱”；它能作为海信集团官方目录观察，但不能冒充海信、容声两个独立品牌官网都已完整枚举：https://www.hisense.com/productcat/54.html
- 海信集团 typed snapshot 已通过并接生产组合：Crawlee/Cheerio concurrency=1 对声明 21 个产品发现并读取 21 个详情，20 页在 title/meta/主标题给出显式厂商型号，按品牌＋厂商型号去重为 16 个 identity（海信、容声）；产品 1340 只有图片文件名出现 `BCD-222WTDGS`，故拒绝推断。来源固定为 `multi_brand_official_catalog/partial`，不得计作两个独立官网完成。
- 容声独立官网公开冰箱产品列表与详情入口，但标准 TLS 客户端访问 `www.ronshen.cn` 当前证书域名不匹配；Source adapter 必须保留 `source_access` unknown，不得通过关闭证书校验绕过。搜索索引能看到产品不等于生产访问已通过：https://www.ronshen.cn/product/list/42.html
- 长虹美菱官网跳转到正式商城域，官方 `getProductColumnList` 返回冰箱父类 `721` 及对开门/多门/三门/两门/单门子类。对 `getSkuListByColumnCondition` 使用 `columnId=721` 后总数稳定为 93，pageSize 20 共 5 页、实际读取 93/93 个在线 SKU，得到 85 个唯一厂商型号；重复行是颜色/SKU，不新增型号 identity。`skuname` 中明确出现但没有 `BCD-` 前缀的型号保持官网原文。该 typed snapshot 已接生产并标记 `independent_brand_catalog/complete`：https://www.meiling.com/meiling/pages/index.html 、https://mlmall.meiling.com/mall/column/getProductColumnList.do
- 美菱接口的响应体是 JSON，但响应头使用非标准 `text/json`。Crawlee `HttpCrawler` 默认拒绝该 MIME，生产 adapter 按官方公开的 `additionalMimeTypes` 选项显式追加 `text/json`，继续复用其请求、超时和重试能力，没有另写 HTTP client：https://crawlee.dev/js/api/http-crawler/interface/HttpCrawlerOptions
- 小米商城官方搜索 API 对“冰箱”返回 19 项和冰箱类目，但包含系列聚合页与制冰机配件；`product/view` 详情能提供能效、制冷方式、尺寸、容积、噪音等参数，却只给商城 `product_id / commodity_id / sku`，没有厂家型号。当前 `manufacturerModel` contract 不允许把商城内部 ID 冒充厂家型号，故米家/小米只登记为后续参数知识候选来源，不进入 Market Universe 型号 identity：https://www.mi.com/shop/search?keyword=%E5%86%B0%E7%AE%B1
- 康佳集团官网冰箱总类目当前列出 7 个商品；7 个详情均在同一官方参数块明确品牌和型号，排除 `BD/BC-211DGLCEX` 冷柜后得到康佳 3 个、新飞 3 个冰箱 identity。该来源已接生产并标记 `multi_brand_official_catalog/complete`，只能证明康佳集团当前总类目完整读取，不能替代康佳/新飞两个独立品牌官网完成：https://www.konka.com/list.html?cat_id=28
- 西门子中国官网产品页实际入口为 `product-frist-level.html?name=冰箱&groupId=26`，其前端直接调用官方 `getProductOfficialList`。设置官网同款“商城在售”过滤后，API 声明并返回 46/46 个唯一 `vib` 型号；排除 group 6 的 2 个 wine cooler 和名称明确为“冷冻箱”的 1 项后，剩余 43 个冰箱型号。该来源具备官方总数、明确型号字段和同窗完整读取，已接生产并标记 `independent_brand_catalog/complete`：https://www.siemens-home.bsh-group.cn/productlist/product-frist-level.html?name=%E5%86%B0%E7%AE%B1&groupId=26
- 荣事达集团官网产品中心的“冰洗护”类目当前声明 1 项并明确列出 `BCD-271WGP`，详情页再次确认同一型号；另一方面，惠而浦冰洗品牌站的荣事达 `brandId=5` 当前 JSON 目录为空，历史详情不能混进当前在售同窗。故只把 `BCD-271WGP` 接成 `official_channel_discovery/partial`，不把更广的“冰洗护”类目冒充独立冰箱完整目录：https://www.rsdgroup.com.cn/product_list.asp?keyno=319&p_id=231
- 荣事达官网正文实际使用 GB18030 但响应头没有 charset。实测 Crawlee 的 `suggestResponseEncoding/forceResponseEncoding` 在该 `HttpCrawler` Buffer 路径均未正确保留中文，而原始 Buffer 经 Node 标准 `TextDecoder("gb18030")` 可无替换字符恢复正文。生产 adapter 因此继续复用 Crawlee 的访问、重试、超时和内存队列，只在已知站点边界做确定性标准解码；不自研编码探测，也不放宽 TLS。Crawlee 编码选项边界见：https://crawlee.dev/js/api/http-crawler/interface/HttpCrawlerOptions
- 奥克斯集团官网当前集团产业只列空调、用配电、新能源和医疗，全球产品站也只提供暖通产品；未发现可核验的冰箱厂家型号目录。志高集团官网说明业务包含冰箱，但当前标准 TLS 访问无法建立可信连接。两者都保持 typed missing/source_access，而不是从京东品牌标签或第三方页面推断目录：https://www.auxgroup.com/about.html 、https://www.china-chigo.com/cn/jituangaikuang/index.html
- 重复真实枚举发现既有 Crawlee 配置 `purgeOnStart=false` 会复用项目默认持久请求队列：同一 URL 首次完成后，后续刷新可能零请求直接结束。禁止通过清空全局 `storage/` 修复；选用 Crawlee 官方 `MemoryStorage`，每次 Source 访问注入独立 storage client、`persistStorage=false`，从根上避免跨刷新误去重且不触碰用户已有队列。官方 API 明确 `MemoryStorage` 实现 dataset/KV/request queue storage，`Configuration.useStorageClient` 允许注入该 client：https://crawlee.dev/js/api/memory-storage/class/MemoryStorage 、https://crawlee.dev/js/api/core/class/Configuration#useStorageClient
- 稳定九源候选已在全新隔离 PostgreSQL 运行生产 DBOS 监管对账：737/737 完成，381 matched、338 not_found、18 producer_conflict、0 failed；最终一次业务写生成 v2，保持 737 个型号，399 个型号带至少一个监管生产者，358 个 blocking unknown 被保留。隔离数据库、临时证据目录和一次性运行脚本均已精确删除，开发库未写入。该结果完成 6.3 的监管同窗门，但不消除品牌独立官网缺口，也不能替代 6.4 京东渠道枚举。

##### 2026-08-16 / 6.4 京东官方渠道生产候选

- 2026-08-17 重新核对当前《京东用户服务协议》（2026-01-20 生效）：第九条第六款规定，除法律强制规定外，未经京东特别书面同意，不得全部或部分复制、转载、引用、链接、抓取或以其他方式使用站内信息内容；同条也明确站内文字、图表、图片、视频、数据编辑和软件受京东或内容提供者权利保护：https://help.jd.com/user/issue/945-4583.html 。当前项目没有京东书面许可，也没有经过负责人/法律确认的法定例外，因此 `localRead / evidenceStorage / modelInput / derivedKnowledgePublication / sourceRedistribution` 不能由工程自行写成 allowed。正式 Planner 必须把京东路线保持 `planning_rule_missing` 或权限 waiting；频控和 reader 通过也不能越过这一许可门。fixture/parser/队列/熔断开发可继续，但真实探针和批量访问暂停。该结论不会自动改成“永久拒绝京东”：若未来取得书面许可、经负责方确认适用的法律依据，或明确重开官方授权 API，再按授权字段、速率、保存和发布边界新增版本化规则。

- 2026-08-17 在 Codex 内置 Browser 的已登录独立会话做监督式真实枚举：品牌目录 5/5 页各返回 60 张卡，共 300 个唯一 SKU；其中 299 个带自营标记，另 1 个国美商品为非自营。该结果证伪“目录页出现任一非自营卡片就整页作废”，正确边界是在目录观察层只投影自营卡片，同时保留分页/数量一致性检查。
- 同一轮详情读取到第 17 个请求时触发京东真实 `risk_handler`，按约束暂停且等待用户手动验证，没有自动绕过。暂停前 15 个详情完整可读，1 个康佳详情能确认品牌、冰箱面包屑和 25 项参数但缺少 `能效网规格型号`，因此保持 `source_abnormal`，不从营销标题 `AR-183G2` 猜型号。另有 TCL、海尔详情缺少“类型”参数但官方面包屑明确为冰箱；详情接纳规则已改为“类型或官方分类路径确认冰箱，并显式排除冷柜/冰柜/酒柜/冰吧”，品牌与厂家型号仍是 identity 必填。Codex Browser 仍只承担监督式可达性和真实页面契约验证，不因此升级为 Workbench 生产 Provider。
- 用户在同一 Codex Browser 会话完成京东扫码验证后，页面没有恢复商品详情，而是跳转到 `https://pc-frequent-pro.pf.jd.com/?from=pc_item&reason=403`，正文明确“暂时无法展示该商品的信息，请稍后重试”。随后只做一次返回原 SKU 的正常重试，仍进入同一 403 频控页；没有循环刷新、切换入口或换浏览器规避。故本轮恢复门结论是“人工验证后仍被 rate limited”，不能把扫码写成已验证恢复方案。
- 真实普通浏览器复核：京东自营冰箱入口当前为 5 页、首屏每页 60 个商品卡，卡片均带“自营”；一个米家详情即使页面仍显示未登录提示，DOM 仍公开给出 26 项规格，其中品牌、商品编号、类型与 `能效网规格型号=MC-186DMD` 均可读取。故“登录”不是详情规格的业务前置，标题仍只作发现文本，只有详情参数的型号字段才进入 identity。
- “更多品牌”展开后 DOM 返回 500 个标签，混入出版社、工具、清洁品等明显非冰箱品牌；因此品牌筛选只能说明平台 facet 污染，不能作为品牌分母。6.4 必须从 5 页实际自营商品投影品牌，并逐商品详情确认型号。
- 历史依赖候选：`patchright@1.61.1` 为 Apache-2.0、Node >=18、近期发布且官方 Node 包仍活跃；Crawlee `BasicCrawler` 的 request queue、并发/重试/取消与每次枚举独立 `MemoryStorage` 仍是可复用资产。但 Patchright 在当前旧/新/无 Profile 的同 SKU 原型均进入 `risk_handler`，故撤销其“优先生产浏览器候选”地位；它只保留历史访问证据、当前 typed failure 与详情 parser 验证，不再把持久 Profile 或人工登录写成确定修复：https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs 、https://www.npmjs.com/package/patchright
- 专用 Profile 默认位于 Git 已忽略的 `data/`，配置可覆盖；Cookie、认证 Header、密码、验证码信息和 Profile 内容不得输出、进入证据或提交。页面状态沿用共享 `SourceObservation` 既有 `login_required / verification_required / access_denied / rate_limited / source_abnormal` vocabulary；真实登录/验证只暂停京东来源并保留 Market Universe blocking unknown，不自动绕过。
- 京东 typed 边界已接到 Market Universe 刷新：Crawlee `BasicCrawler` 负责独立内存队列、重试和并发 1；5 页目录卡只承担发现并过滤非自营卡片，详情以“品牌＋能效网规格型号”为 identity，并以类型或官方分类路径确认冰箱、显式排除相邻冷柜等品类，营销标题永不进入型号 identity。京东成功时作为第十个来源并入候选；typed 访问失败时九个官网快照仍保存，京东单独形成 blocking `source_access` unknown。Patchright 被当前真实门淘汰后，其自动浏览器生命周期、生产 Profile 配置和生产依赖已删除；生产 bootstrap 没有注入已通过的 `JdPageReader` 时立即返回 `source_abnormal`，不会再访问京东或启动浏览器。
- 2026-08-16 新建专用 Profile 的真实生产运行在品牌页被京东转入安全验证，最终返回 `verification_required`；没有生成京东快照、没有自动验证、没有读取或复制日常 Chrome Cookie，也没有把 Profile 内容写入 Git/日志。运行同时发现 `domcontentloaded` 后二次跳转会短暂销毁执行上下文，旧检测已重写为将该瞬间视作页面状态变化，再由 URL/正文归类 typed 状态，而不是另造 fallback。三商品与五页完整枚举门仍未通过，所以 Patchright 组合和京东 adapter 保持生产候选，不能写成已完成来源。
- 同日最小差分诊断推翻了“只需复用已登录 Profile”的假设：历史 R-001 成功的旧专用 Profile、生产新 Profile 以及无 Profile 的 Patchright 都被送入 `risk_handler`；官方 Playwright＋系统 Chrome 只得到空骨架，Puppeteer＋系统 Chrome进入频控页，普通 Chrome临时专用 Profile经官方 CDP连接则进入登录页。相同时间的 Codex普通浏览器会话无需登录即可读取上述 26 项规格。因此根因边界是当前本机自动化启动/连接表面与京东页面状态的组合，不是型号页必须登录，也不是单个旧 Profile 丢失。禁止通过复刻 `h5st`、伪造指纹、修改 UA/headers 或复制受信任会话 Cookie 来弥合差异。
- 当前不存在通过产品关键门的生产浏览器候选：Codex普通浏览器会话只证明公开规格可达，尚不是 Workbench 可调用、可恢复、可审计的 Source Provider。京东 adapter 仅保留 typed 失败、注入式分页/详情解析和九源隔离，不能描述为已完成京东采集。R-012 的当前候选处置如下：

- 2026-08-17 产品范围纠偏：此前 R-012/6.4 把京东产物过度收窄为自营目录中的“品牌＋厂家型号”，也把 EvidenceRequest 最小证据边界错误前置到第一轮来源发现。用户明确京东的首要价值是其分类/筛选体系、国内外品牌官方旗舰店聚合、每款商品完整详情图文，以及评价汇总和每款前 50/100 条样本。后续研发必须先形成可查看、可导出、可恢复的来源数据集，再投影 Market Universe、属性/比较候选和 Evidence；浏览器可达性与频控候选状态仍按本节失败关闭，不因范围纠偏自动恢复批量访问。详细方案见 `JD-COLLECTION-DESIGN.md`。

| 候选 | 成熟度、许可证与 Node/本地边界 | 当前真实门 | 处置 |
|---|---|---|---|
| Patchright 1.61.1＋Crawlee | Apache-2.0；Node/TS、本机运行；队列与恢复资产已验证 | 旧、新、无 Profile 均进入京东 `risk_handler` | **淘汰为当前生产访问候选**；保留 parser、typed failure 和九源隔离 |
| 官方 Playwright / Puppeteer＋系统 Chrome | Apache-2.0；活跃 Node/TS；部署和退出成本低 | 同一 SKU 分别得到空骨架与频控页 | **淘汰为当前生产访问候选** |
| Chrome DevTools MCP 1.7.0 | Apache-2.0；Node `^20.19 || ^22.12 || >=23`；2026-08-10 更新；默认专用 Profile，本地 MCP 不向 Google 发送浏览器数据 | 专用临时 Profile 的等价 Chrome＋CDP 原型进入登录页；连接现有 Chrome 的 `--autoConnect` 需要 Chrome 144+、用户先开启远程调试并在 UI 点 Allow，且会暴露所选 Profile 的全部标签页、Cookie 和存储 | **不满足无人值守/最小权限生产门**；不得连接日常 Profile。若未来 Chrome 提供可预授权、专用且可审计的连接边界，再重新原型：https://github.com/ChromeDevTools/chrome-devtools-mcp 、https://developer.chrome.com/docs/devtools/agents/use-cases/auto-connect |
| Codex 内置 Browser / Chrome 插件 | OpenAI 官方维护；内置 Browser 使用独立 Profile、站点权限和敏感操作确认 | 同一 SKU 匿名读取 26 项规格，但官方明确 Browser 只在 ChatGPT/Codex 桌面会话可用，不在 Codex CLI/IDE；调用方式是会话内 `@Browser`，没有供任意本地 Worker 调用的稳定 Provider API | **只作可达性证据，不接生产 Worker**：https://learn.chatgpt.com/docs/browser?surface=app 、https://help.openai.com/en/articles/20001256-plugins-in-codex/ |
| 京东官方 API / 商务接口 | 官方授权通道；部署、配额、字段与许可范围需另做真实 POC | 现有 ADR-0004 与用户决定明确不走该路线 | **未授权，不调研后接线**；只有用户明确重开决定才进入候选 |
| 复制 Cookie/Profile、复刻 `h5st`、伪造指纹/headers | 自研绕过且泄露凭证边界，无可接受维护和退出路径 | 与安全、不绕过验证和本地秘密边界冲突 | **永久拒绝** |

- 简单说明：京东页面本身无需登录，问题在于“普通可信浏览器能读，当前可编程浏览器会被区别对待”。能复用普通 Chrome 状态的成熟工具又要求用户当场授权，并会拿到整个 Profile，不适合后台批量任务；所以当前正确结果是京东保持 typed unknown，而不是抓四份样本或用标题猜型号。
- 上述复核不新增商品字段 DOM projector 或通用 Provider。每个已接来源只用薄 adapter 隔离外部目录差异；未通过安全访问门或缺少厂家型号 identity 的来源继续保持 typed unknown。

### R-011 质量与人工频次

状态：contract 已接受；数值待阶段 1A/1B

结论：结构、证据、身份一致性、知识层完整性、时效和冲突为硬门；Runtime/下游能力使用版本化任务集；模型评分只补充。没有证据时保持 unknown。

新增纠偏门：报告每 100 个 EvidenceRequest/候选的人工例外数量、typed 原因、可批量比例和处理耗时。用户不逐字段排版；队列按 request/reason/source/evidence/category version 确定性筛选，不调用 LLM 判断“同类”。在真实数据前不承诺固定人工次数。

## 4. 来源访问与旧 contract 处置

### R-001/R-012 浏览器与官方来源访问

状态：队列、状态分类和最小证据边界保留；京东生产浏览器候选已重开且当前无通过项

候选比较：用户选择的教育研究网页路线、并发 1、遇验证码/风控失败关闭、不自研反检测/验证码/账号切换仍有效。2026-08-16 的同 SKU 差分已证明登录不是公开规格的业务前置，同时推翻“Patchright＋持久 Profile＋人工登录即可形成生产 Provider”的实现假设；当前候选矩阵和处置以 6.4 小节为准，不得再引用历史 R-001 成功样本宣布生产可达。

验证：历史真实样本只证明 Patchright 曾接入本机 Chrome、Crawlee 可恢复队列、系统可区分 loaded/login/challenge/discontinued；当前样本证明所有本机程序化启动/连接候选未通过，而 Codex 内置 Browser 的成功只证明公开页面可达。旧实验曾保存 HTML/文本/截图/资源清单，但该范围已由 ADR-0011 撤销；实验执行树已删除，当前边界见 ADR-0004。

官方依据：https://crawlee.dev/js/ 、https://github.com/apify/crawlee 、https://github.com/Kaliiiiiiiiii-Vinyzu/patchright 、https://playwright.dev/docs/auth 、https://github.com/ChromeDevTools/chrome-devtools-mcp 、https://developer.chrome.com/docs/devtools/agents/use-cases/auto-connect 、https://learn.chatgpt.com/docs/browser?surface=app

### R-013 受限快照白名单投影

状态：已替代；见 R-026/ADR-0011

历史决定把登录态整页永久留在受限快照，再按来源 DOM 白名单投影。该设计扩大敏感数据并要求逐站字段 projector，不能满足未知 DOM/跨品类，ADR-0005 已 superseded。严格 Schema、外部内容不直接进模型、privacy 物理隔离三个不变量继续保留。

### R-014 文档/表格/单位与候选

状态：局部组件保留；旧输入 contract 已替代

可复用资产：

- `unpdf@1.7.0`（MIT）在当前 Node 21 读取历史 16 页 PDF；最新版 1.8.1 当时要求 Node 22，未升级；
- `read-excel-file@9.3.10`（MIT）精确读取 XLSX 行/单元格；
- `mathjs@15.2.0`（Apache-2.0）只对明确声明单位/规范单位的十进制值作确定性换算；
- Zod 为候选唯一作者态 Schema，模型/规则结果必须引用 evidence ID；
- 近似型号、冲突、图片解释和缺证据不得自动合并/发布。

旧 Cheerio 官网/JD projector、整页输入、`sanitized projection` 和图片模型实验不再是目标 contract。对应执行树已删除；格式 adapter 不能自行定义商品字段。

官方依据：https://github.com/unjs/unpdf 、https://github.com/catamphetamine/read-excel-file 、https://mathjs.org/docs/datatypes/units.html

### R-023/R-024/R-025 旧 Acquisition/Raw Material contract

状态：已替代；局部基础设施保留

保留：Crawlee RequestQueue、SitemapRequestList、FileDownload、`file-type`、`get-stream`、RFC 9110 条件请求、typed 来源状态/人工恢复。撤销：Provider 提交整页 capture、Raw Material snapshot/manifest、以 snapshot 存在计算覆盖、可重放整页文件和按 provider/media 选择 projector。

HTTP validator 只属于 SourceObservation：`304` 说明服务端表示未变化，不自动证明旧证据仍充分；`200` 也必须重新满足 EvidenceRequest 才提交 EvidenceItem。不得自研 cache/scheduler/transport。

官方依据：https://crawlee.dev/js/api/core/class/RequestQueue 、https://crawlee.dev/js/api/core/class/SitemapRequestList 、https://crawlee.dev/js/api/http-crawler/class/FileDownload 、https://www.rfc-editor.org/rfc/rfc9110.html#section-13

## 5. 当前关键调研

### R-026 目的驱动采集、最小证据与媒体证据

状态：产品方向已确认；locator、公开静态网页、PDF 单页、XLSX 最小区域和整图字节真实性门已接受；完整 1A 矩阵、动态页面、图片正式投影、模型抽取/OCR/图片语义候选待 POC
目标阶段：重新打开的 1A、1B

#### 问题与不可取消约束

外部 DOM、文档排版和品类结构无法预先枚举。采集输入必须是已确认知识需求、对象范围和证据要求；站点/URL/DOM 只是执行线索。永久保存内容必须是支持明确问题的最小不可变 EvidenceItem；整页 HTML、全页截图、完整无关文档、HAR、Cookie、Header 和 Profile 默认不得持久化。

完整页面/文件可在本机受控临时区读取；证据提交、失败、取消后必须清理未选内容。以后出现新问题而旧证据不足时重新采集，不声称能从最小证据恢复整页。

图片是否保存由知识需求决定，不由 `<img>` 数量、文件名、尺寸或 DOM 邻近单独决定。无法证明图片与对象/知识点关系时保持 unknown/人工审核。规则、OCR、模型都只产 ExtractionCandidate。

#### 官方标准与成熟候选（核查 2026-08-15）

- W3C Web Annotation Recommendation 已定义 TextQuote(exact/prefix/suffix)、TextPosition、Fragment、Range、DataPosition、SVG selectors；Media Fragments 定义图片 `xywh`。接受这些语义作为 locator 词汇，不引入完整 JSON-LD/RDF 注解平台：https://www.w3.org/TR/annotation-model/ 、https://www.w3.org/TR/selectors-states/ 、https://www.w3.org/TR/media-frags/
- Playwright 已在项目中，官方支持 locator/element screenshot、clip 和 buffer。接受定点截图；`fullPage` 不是默认产物：https://playwright.dev/docs/screenshots 、https://playwright.dev/docs/api/class-page
- Schema.org `Product.image`/`ImageObject` 可提供对象/图片关系、caption、代表页等提示，但来源不保证存在且仍需核验，只是关系候选：https://schema.org/Product 、https://schema.org/ImageObject
- Stagehand v3（MIT、TypeScript/Python、活跃）支持本地浏览器、Playwright Page、自然语言与 Zod/JSON Schema 抽取；AI 方法仍需要模型，页面上下文进入所选模型，本地 Ollama 准确性被官方标为有限。结果不自带本项目的不可变 EvidenceItem/locator，因此只做未知 DOM 候选寻找 POC：https://github.com/browserbase/stagehand 、https://docs.stagehand.dev/v3/basics/extract 、https://docs.stagehand.dev/v3/references/extract 、https://docs.stagehand.dev/v2/configuration/models
- Firecrawl 核心 AGPL-3.0；自托管基线需要 Docker Compose、多服务和 PostgreSQL 队列，默认自托管不含 screenshot，LLM extraction 需额外 provider，Cloud 结果/活动记录有远程边界。许可证、部署、全量 crawl/Markdown 和退出成本不适合当前最小本地证据，拒绝作为 Workbench 基础设施：https://github.com/firecrawl/firecrawl 、https://docs.firecrawl.dev/contributing/self-host 、https://docs.firecrawl.dev/features/extract
- Tesseract.js（Apache-2.0、Node/浏览器 WASM、100+语言、2025 有 release）可本地 OCR 图片；官方明确不支持 PDF 且不改进模型准确率。保留中文印刷图片 POC，不用于语义关系：https://github.com/naptha/tesseract.js/ 、https://github.com/naptha/tesseract.js/blob/master/docs/faq.md
- PaddleOCR（Apache-2.0、Python/Paddle、PDF/图片/版面/表格、100+语言）能力更全但部署重；仅当 Tesseract.js 真实质量失败且产品确需本地 OCR 时比较：https://github.com/PaddlePaddle/PaddleOCR
- sharp（Apache-2.0、Node/libvips）可做 metadata、方向和确定性 crop；原生依赖进入生产前必须补 macOS 与 Linux 安装/运行 POC：https://sharp.pixelplumbing.com/api-input/ 、https://sharp.pixelplumbing.com/api-resize/

#### 2026-08-16 Crawlee 公开网页真实冰箱纵切片

- 复核 Crawlee 官方文档：`CheerioCrawler` 是 Node/TypeScript 的 HTTP＋Cheerio 成熟实现，提供 HTTP/2、队列、重试和 HTML parser；`Configuration.persistStorage:false` 可关闭本地存储写出。当前仓库使用同版本 `@crawlee/cheerio/http/core@3.18.1`，不自写 HTTP 重试或 HTML parser：https://crawlee.dev/js/docs/introduction/first-crawler 、https://crawlee.dev/js/api/cheerio-crawler 、https://crawlee.dev/js/api/3.12/core/class/Configuration
- 接受范围仅为 `PublicWebTextSource.capture` 薄 adapter：输入 HTTPS URL、显式允许的 origin、一次性 CSS 访问线索和必要对象文本；初始/重定向 origin 都校验。selector 不进入知识模型，也不映射品牌/品类字段。
- 真实海尔官网样本 `BCD-500WGHFDB5XAU1` 返回 HTTP 200。adapter 选中包含该型号的 Schema.org Product JSON-LD 原始块，3,997 bytes，SHA-256 `c4819d551a766ed09955c115205af4472f5de367127b8800b9571a26d47e529d`；没有解析属性、清洗或生成候选。
- 第二个真实美的官网样本 `BCD-501WSPM(Q)` 同样返回 HTTP 200，但页面是 HTML 规格表而非 JSON-LD。未改动 Schema/API/adapter，仅使用该请求的 `#product_spec` 访问线索，选中 5,873-byte 原始文本，SHA-256 `3c11f72f24589a90d49c4806fad715b1f297ea742079945f6359c127e8970b06`；仍不做属性解析或清洗。
- 监管来源核对：市场监管总局/国家发改委 2026 规则确认家用电冰箱属能效标识管理产品；中国能效标识网的“产品备案查询”公开系统可用。其前端公开声明 `/admin-api/gateway/productRegistration/productRegistrationList` 与 `productDetailById` 两步 POST JSON 协议；未使用登录、Cookie 或认证材料。官方规则：https://www.samr.gov.cn/xw/zj/art/2026/art_622696c3b0d24421b782e1ffd657dbeb.html ；查询网站：https://www.energylabel.com.cn/
- 真实备案列表对 `BCD-501WSPM(Q)` 返回唯一结果：备案号 `20241017-471100-92391729144470006`、生产者“合肥美的电冰箱有限公司”、能效等级 1。Crawlee `HttpCrawler` POST 详情 POC 保留 1,079-byte 原始 JSON，SHA-256 `9d7b01b670d89bdc0d40f83ff90c4832b1b6caca8722afc3016d0ce049494cc3`，包含 `GB 12021.2-2015`、标准/综合耗电量与间室容积。
- 监管 POC 的首次实现错误假设 `PlainResponse.rawBody`，失败后删除该假设；按 Crawlee 官方 `HttpCrawlingContext.body: string | Buffer` 取得原始内容后通过。因两步列表/详情是官方特有协议，只接受隔离它的薄 Source Access adapter；不冻结到通用 Evidence interface，不自写 HTTP、重试或 JSON parser。Crawlee body contract：https://crawlee.dev/js/api/3.14/http-crawler/interface/HttpCrawlingContext
- 缺失型号样本由 Crawlee 完成既定重试后返回 typed `evidence_not_found`，没有把 URL/HTTP 200/空内容视为成功。Crawlee 磁盘持久化关闭，完整响应只在本次内存访问中存在。
- 历史组合验证曾生成 EvidenceRequest、SourceObservation、最小 EvidenceItem 与 CAS manifest，并在 API/Workbench 重读。该结果不证明当前抓取产品闭环；对应实验执行树已删除。
- PDF 候选复核：`unpdf@1.8.1` 为 MIT、Node >=22 的 TypeScript/JavaScript PDF.js 封装，可用 `mergePages:false` 返回逐页文本；Crawlee `HttpCrawler@3.18.1` 可用已验证的自定义 `Configuration` 下载二进制响应并沿用成熟重试/超时。拒绝生产使用 `FileDownload`：其 3.18.1 公开 TypeScript 构造签名不接受自定义 Configuration，不能满足本轮“不落盘”证明门。
- 真实美的官方 16 页说明书为 1,154,097 bytes，源文件 SHA-256 `bd173c352c759dea6a4128dcc4dda079b1a8102dec7a01f40f96846036ca2478`。型号 `MR-457WUSPZE` 出现在 5 页，不能以“型号唯一页”定位；使用本次知识问题的“型号＋年综合耗电量＋外形尺寸”线索唯一定位第 14 页，保留 3,768-byte 原始页文本，SHA-256 `97c17f2d1bbea79422a82854bb5153503d157f1b9a5f467cbc38cc6fec6dbc96`。完整 PDF 只在内存中，成功和缺失路径后均无永久完整文件。
- `DocumentExcerptSource.capture` 生产薄 adapter、typed API 与自动化已转绿，但真实项目冻结的 Collection Board 尚无 `official_manual` 路线，因此本轮不把 POC 冒充正式 EvidenceItem，也不把说明书错误归类为普通官网页面。
- `libarchive-wasm@1.2.0`（MIT、Node 18+、WASM、RAR4/5）与 `read-excel-file@9.3.10`（MIT、Node 18+、2026-08-10 更新）通过监管压缩表格 POC。CNIS 服务器把 RAR 错标为 `text/plain`，HttpCrawler 只负责取得 buffer，实际格式由 libarchive 验证；完整 RAR/XLSX 只在内存。真实 RAR 2,301,639 bytes、14 个条目/13 个 XLSX，唯一 2023 工作簿 307,787 bytes；sheet `结果` 的 `A2:G2` 表头与 `MR-457WUSPZE` 唯一 `A479:G479` 行形成 261-byte JSON，缺失型号失败关闭。
- `CnisRegistryTableSource.captureByModel` 是隔离 CNIS 公开归档布局的薄 adapter，不把 RAR 路径、sheet 或列号写入通用 Evidence contract。正式组合根复用已冻结 `regulatory_check` 路线，提交 EvidenceItem `evidence-3c60c601-cb59-4c99-8fbd-fda7ca6223f6`，内容 SRI `sha256-fdq+uI0tnZSy2qVIXwoarYfaXtq+SsbOH1grUEAEEJM=`。
- `sharp@0.35.3`（Apache-2.0、Node >=20.9、macOS/Linux/Windows 预编译）通过 macOS arm64 真实图片解码与 Linux x64 glibc 隔离安装门。海尔产品页直接图片首次无 Referer 为 403；加入来源页 Referer 和普通 Accept 后返回 88,486-byte、1200×1200、单帧 WebP，SHA-256 `90a96450d6c91ba5225cb78145fb3415630fff339f99be6e049d8c7a6f474ff6`。URL 的 `.png` 后缀不可信，真实 MIME/格式必须由响应与 sharp 共同验证：https://sharp.pixelplumbing.com/install/ 、https://www.npmjs.com/package/sharp
- Evidence 核心只接受请求允许、关系方法可接受、全图 locator、SHA-256/实际格式/尺寸/帧数均与字节一致的整图。裁片仍因无法从永久最小内容独立复核原图 hash 而拒绝。现有 API 读取投影只有 `contentText`，不能诚实表达二进制；在人工确认 UTF-8/base64 判别联合的公共 contract 前，不接正式图片 source/API/UI，也不把 POC 写成 EvidenceItem。

结论：Crawlee 3.18.1 通过静态 HTML/JSON、PDF、RAR/XLSX 与图片二进制的来源访问约束；unpdf、libarchive-wasm、read-excel-file 和 sharp 各自只承担成熟格式能力。HTML/JSON、能效详情与 XLSX 最小行已经形成正式 EvidenceItem，PDF 因冻结路线缺失未正式写入，图片因公共读取投影待确认未正式写入。动态页面、异常状态和三品类矩阵仍未证明，因此完整阶段 1A 未通过，也不引入 Provider registry、站点字段 projector 或图片语义模型。

#### 最小 contract

- `EvidenceRequest`：目标对象/集合、问题/属性、允许来源、证据类型、时效、停止条件。
- `SourceObservation`：URL、时间、访问状态和失败分类；不是证据充分性。
- `EvidenceItem`：最小内容、URL、时间、hash、locator、请求/对象关系、隐私、证据政策版本。
- `ExtractionCandidate`：规则/结构化数据/OCR/模型对 EvidenceItem 的解释，必须引用 evidence ID。

文本保存 exact＋必要 context；PDF 保存页/章节＋片段；表格保存 sheet＋表头＋唯一行/范围；图片保存资源 identity 与必要 crop，只有视觉本身构成事实才保存全图。

#### 验证矩阵与停止门

1. 三个品类、每类至少两个布局不同官方站点，共用一个 contract，不增加站点/品牌/品类 DOM 分支。
2. HTML、动态页面、PDF、XLSX、图片各有真实纵切片；locator 能在保存的最小内容上复核。
3. 图片覆盖明确关系、同页多图歧义、图中文字、装饰图；关系不明必须拒绝自动入证据。
4. Stagehand/OCR/sharp/模型分别测准确率、漏检、错误关联、数据边界、成本、部署和退出；新模型用途先获用户确认。
5. 成功/失败/取消临时清理、公开/受限隔离、敏感阻断和生产入口可达全部通过。

结论：接受 Knowledge Need → EvidenceRequest → SourceObservation/EvidenceItem → Candidate → Review 方向、W3C locator、Playwright 定点截图和 cacache CAS。其余工具在 POC 前保持候选。

### R-027 错误与死代码清算

状态：当前方法已确定；目标：阶段 0R

现有 CodeGraph 是 AST 调用/影响图，结合真实 API/worker/package entry、package exports、CLI/migration/config、动态入口和测试不变量完成清算。不可达只是删除候选；每项必须分类 delete/keep/rewrite。

Knip（ISC、活跃）能从 entry 图报告未使用文件/export/dependency，但官方明确 entry 缺失会级联误报；当前仓库多 workspace 且本机 Node 21.7.3，Knip 当前仓库 engine 要求 Node 22。此次不新增/降级 Knip，也不自研扫描器：https://knip.dev/explanations/how-knip-works 、https://knip.dev/guides/handling-issues 、https://github.com/webpro-nl/knip

删除后必须通过 CodeGraph impact、全 workspace typecheck/test/build、真实生产入口、临时清理和离线包验证；只保护旧 snapshot/projector 的同构测试一并删除，不改测试去保护错误行为。

### R-028 本地 Chat Timeline

状态：接受 `@assistant-ui/react`＋ExternalStoreRuntime；锁定 Node 24，已知包体成本进入实现预算
目标阶段：0I

#### 问题与不可取消约束

新品类必须从可恢复的聊天采访开始，而不是要求用户先填一张完整大表。界面需在现有 React 18、Vite、Tailwind 和本地 Workbench 内工作，支持流式消息、取消、重试、中文输入法、自动滚动、桌面与 390px 宽度，并从项目自己的持久化状态恢复；不得把 Assistant Cloud、第三方远程消息存储或模型后端变成运行依赖。

Workbench 拥有 Interview Session、规范化 Message、append-only Interview Decision、未决项和版本化 Capture Task Draft。Chat Timeline 只投影这些事实，不从模型文案推导业务状态，也不保存第二份权威抓取任务。

#### 成熟候选与官方资料（核查 2026-08-15）

- `assistant-ui`：MIT、React/TypeScript、持续维护；提供 thread/message/composer 等可访问 UI primitives，`ExternalStoreRuntime` 可接项目自己的消息、状态和动作，不要求使用 Assistant Cloud。首选 POC 只使用 `@assistant-ui/react` primitives 与现有样式系统：https://github.com/assistant-ui/assistant-ui 、https://www.assistant-ui.com/docs/runtimes/custom/external-store
- Vercel AI SDK UI：Apache-2.0、TypeScript、持续维护；`useChat` 与 custom transport 可连接自有后端，状态/传输 seam 清楚，但相较 `assistant-ui` 仍需自行组装更多消息列表、composer 和交互细节，作为第二候选：https://github.com/vercel/ai 、https://ai-sdk.dev/docs/ai-sdk-ui 、https://ai-sdk.dev/docs/ai-sdk-ui/transport
- 从零编写通用 Chat Timeline：当前拒绝。只有两个成熟候选都无法满足本地事实源、可恢复状态或交互验收时，才允许登记最小自研缺口并等待用户确认。

#### 隔离 POC 与停止门

1. 在当前 macOS/Node/React/Vite/Tailwind 组合中安装并构建；进入生产前补目标 Linux 安装与 build，若 Windows 仍在产品支持范围再补 Windows。
2. 用项目自有内存/测试存储驱动 ExternalStoreRuntime，验证历史恢复、流式增量、取消、重试、错误、输入锁、中文输入法、自动滚动和 390px 布局。
3. 网络检查证明除项目自己的 HTTP API 外不依赖 Assistant Cloud 或第三方消息后端；退出路径不泄漏消息或 Codex 原始事件。
4. 比较实现代码、包体、可访问性、升级 seam 和移除成本。只有通过真实浏览器验收后，才能把依赖写入生产 `package.json` 并冻结 UI adapter。

#### 2026-08-16 隔离 POC 结果

- `@assistant-ui/react@0.15.14`＋ExternalStoreRuntime 的历史验证覆盖恢复、流式、取消、错误、重试、刷新、中文输入、自动滚动和无外部消息后端。实验执行树已删除；当前是否满足“爬虫专家制定抓取计划”的产品目标，必须由生产面板重新验收。
- 构建通过但成本不达门：673 modules，主 JS 424.28 kB / gzip 127.82 kB；`@assistant-ui/react` 发布包 unpacked 2,305,255 bytes，并直接依赖 `assistant-cloud@^0.1.40` 和整包 `radix-ui`。POC 没有云网络请求，但安装图仍携带未使用的云包。
- 当前 Node 21.7.3 下每次安装均警告 `nanoid@6.0.1` 要求 `^22 || ^24 || >=26`；该依赖来自 `@assistant-ui/core`/`assistant-stream`，属于 production graph。不能把“npm 允许警告后构建”写成兼容通过。
- Vercel 当前 `@ai-sdk/react@4.0.69`/`ai@7.0.66` 都要求 Node `>=22`；Node 18 兼容的是上一主版本 3.x，而且还需项目自行组装消息、composer、滚动和 a11y，因此不是当前基线下更低风险的替代。
- axe 首跑因默认 30 秒预算超时；没有删规则或改期望，只将该用例预算提高到 90 秒后全量通过。初次 npm 在线安装还曾被代理 `ECONNRESET` 中断，最终用官方 registry 缓存补全；两项均按工具/环境失败记录。

#### 2026-08-16 Node 24 复跑与选型结论

- 用户已确认 Node 24 LTS 基线和推荐方案。使用隔离的 Node `24.19.0` 原样重跑安装、typecheck、Vitest、Vite build 和 Playwright；安装不再出现 `EBADENGINE`，类型、`2/2` 单测、build、桌面与 390px `2/2` 浏览器全部通过。
- 包体没有因 Node 升级变化：673 modules，主 JS 仍为 424.28 kB / gzip 127.82 kB；直接 `assistant-cloud`、整包 `radix-ui` 和 0.x 升级成本仍是真实负担，不得在交付时省略。
- 项目级运行门采用 npm 官方 `engines / devEngines`、`.npmrc engine-strict` 和 `.nvmrc`；但反向实测 npm 10.5.0 会忽略 `devEngines` 并继续执行脚本，因此它不能单独保护仍以旧 npm 启动的本机 shell。补充成熟跨平台 `check-node-version@4.2.1`（Unlicense、直接读取 package engines、npm 周下载约 20 万）作为根 dev/test/typecheck/build 入口门，不自写 semver/version parser：https://docs.npmjs.com/files/package.json/ 、https://www.npmjs.com/package/check-node-version
- 当前根版本范围为 Node `>=24 <25`、npm `>=11 <12`，`.nvmrc=24.12.0`。反向门证明 Node 21.7.3/npm 10.5.0 下安装以 `EBADENGINE` 失败，typecheck 在 `tsc` 前被版本检查器拒绝；正向 Node 24.12.0 arm64/npm 11.6.2 下 106 tests 通过、30 条件跳过，六 workspace typecheck、production build 与 `git diff --check` 通过。硬编码 darwin-x64 Rollup direct dependency 已删除，lockfile 由 arm64 Node 24 原生重装生成。
- 选型接受 `@assistant-ui/react@0.15.14`＋ExternalStoreRuntime，条件是生产消息/决定/brief 仍归 Workbench、依赖锁版本、Chat UI adapter 保持薄且可整体移除、不使用 Assistant Cloud，并在后续实现中把 gzip 增量作为已知预算持续复核。Vercel AI SDK UI 不承担 UI primitives，当前没有更低的总实现/退出成本。

结论：R-028 通过选型门；生产 `CategoryInterviewTimeline` 已直接使用 ExternalStoreRuntime，消息、Decision 和 Capture Task Draft 仍归 Workbench。2026-08-17 删除不会被根 workspace、测试或构建调用的隔离应用、构建配置和独立 lockfile，只保留压缩选型记录；以后升级在当前生产页面上重新验证，不复活平行应用。

#### 2026-08-18 生产 Chat 回归与修复

- 用户真实页面证明此前“生产接线已验收”结论不成立：提交后出现空白 Agent 块，固定 `min/max-height` 令 Chat 无法占满剩余高度，ScrollToBottom 使用文字按钮，Send/Cancel 同时出现，长消息又会把 composer 顶出视口。
- 没有更换或自写 Chat 框架。继续使用已接受的 `assistant-ui` ExternalStoreRuntime/Thread/Composer primitives，按其 `isRunning` 状态只渲染 Send 或 Cancel；ScrollToBottom 改为可访问的图标按钮；桌面页限定剩余视口高度，消息 Viewport 独立滚动，composer 留在底部，移动端仍保留页面自然滚动。
- `assistant-ui` 会为运行中但尚无文本的 assistant message 合成 Empty part；生产页面已使用其 `AuiIf` state seam 隐藏该空消息块，把等待反馈统一交给真实活动面板，避免再次出现只有 Agent 标题和圆点的假气泡：https://www.assistant-ui.com/docs/api-reference/primitives/assistant-if 、https://www.assistant-ui.com/docs/api-reference/runtimes/message-part-runtime
- 该轮采用的独立结构化选项卡已被 2026-08-19 的真实使用验收否定；其“点击选项确认”只作为历史实现记录，不再是当前交互契约。草稿修订仍回到 Workbench 持有的原 Interview，后续确认推进同一 Capture Task revision，不复制第二份任务事实。
- 真实浏览器 RED/绿色证据：修复前 720px 视口中聊天区仅 404px、composer 距视口底部 157px，且空闲 Stop 可见；最终长消息状态下 document scrollHeight=720、聊天区高 487px、composer bottom=646px，空闲只见 Send、运行只见 Stop。该证据只验 UI/运行状态，不代表用户已认可采访问题内容。

#### 2026-08-19 单回合顺序、普通问题与滚动语义纠错

- 用户真实截图证明第二轮 UI 仍不成立：独立活动面板位于全部消息之后，导致先出现工具失败、后到 commentary 却渲染到其上方；独立 Decision Card 把建议误做成封闭单选题；固定 `bottom-[84px]` 的滚动按钮覆盖内容且没有服从 live edge 状态。
- 继续复用锁定的 `@assistant-ui/react@0.15.14`，不自写 Chat runtime 或滚动 reducer。ExternalStoreRuntime 的 `ThreadMessageLike.content` 原生支持有序 message parts 和 `data-*` 应用 part；Message primitive 按 content 顺序渲染，Thread viewport 负责“用户停留底部时自动跟随、用户向上阅读时暂停”，ScrollToBottom 在 live edge 由 primitive 置为 disabled：https://www.assistant-ui.com/docs/runtimes/custom/external-store 、https://www.assistant-ui.com/docs/primitives/message 、https://www.assistant-ui.com/docs/primitives/thread
- 当前投影把同一回合的 commentary 与 activity 放进同一个 assistant message：新事件只追加；同一 item ID 的 started/completed/failed 原位更新，不改变位置。完整命令和工具输出不进入浏览器。
- 负责人问题的 typed Decision 事实仍由 Workbench 保存，但 Web 只显示普通消息；Composer 发送建议项或自定义答案时，服务端在同一事务中追加用户消息、supersede proposal、写入 confirmed Decision，再自动推进下一轮。ScrollToBottom 位于 Composer footer 正常布局中，`disabled:hidden`，不使用固定高度或覆盖卡片。
- 自动验证已覆盖文字/活动交错顺序、同 item 原位更新、刷新后的 live parts 保留、建议外回答入库与安全命令失败摘要；真实浏览器表面仍待本轮完成后复验，不能把 typecheck/build 代替用户验收。

#### 2026-08-19 工具详情、分段空白与生命周期纠错

- 用户真实页面证明上一版仍有四个投影错误：工具详情被默认关闭的 `<details>` 隐藏；工具后的新 text part 原样保留 commentary 前导换行，形成不一致的大块空白；每个 ephemeral turn 的连接、thread 启动和 turn 启动被错误保留为三条历史步骤；最后 `final_answer` 生成期间没有及时出现可理解的等待状态。
- 修复不新增 Timeline 状态机。连接、`thread.started` 与 `turn.started` 复用同一个 lifecycle ID 原位推进；工具 activity 按既有 `kind` 投影为与普通状态行不同的紧凑边框块，`webSearch.query/action` 和安全命令目的直接显示；text/tool part 交界只去除多余首尾空行，段内换行保持不变。
- 官方 App Server 文档确认 `agentMessage.phase` 使用 `commentary | final_answer`，且所有 item 都有 `item/started`/`item/completed` 生命周期。Workbench 因而在 `final_answer` 的 `item/started` 到达时显示“整理并校验本轮结果”，同 ID 完成时原位收口；这使用现有协议字段，不通过计时器猜测模型状态：https://learn.chatgpt.com/docs/app-server

#### 2026-08-19 Web Search 折叠与 URL 保留纠错

- 用户真实截图否定了上一节“每个 `webSearch` 都显示独立边框块并直接展示 query”的交互：多次搜索属于同一轮 Web Search，应默认折叠为一条网页计数，展开后才显示实际 URL；所有状态行、搜索行和工具标题的 icon/text 必须垂直居中。
- 本机锁定的 `@openai/codex@0.147.0` 用官方 `codex app-server generate-json-schema --experimental` / `generate-ts --experimental` 生成的协议确认：高层 `WebSearchThreadItem` 含 `action` 与可空 `results`；`results` 被官方明确标为可演进的 opaque JSON；`rawResponseItem/completed` 还会交付 Responses API `web_search_call.action`，其中 `open_page` / `find_in_page` 才携带部分实际 URL。仅消费 `query` 或只看高层 `action.url` 都会丢页面。
- 接受的薄 adapter 同时读取高层 `action/results` 和官方 raw web-search action，只在外部 seam 有界遍历 opaque results，最多保留 50 个去重的 http(s) URL、移除 URL credentials，并立即收窄进既有 typed activity；不从最终助手文案、站点名或搜索 query 反推 URL，不新增 parser 库、Provider、fallback 或第二事实源。
- Web 继续复用 assistant-ui ordered parts 和原生 `<details>`：同一 assistant turn 的多个 `web_search` part 聚合到首次出现的位置，闭合摘要只显示唯一网页数，展开显示完整 URL。真实“抓烤箱”运行得到 41 个唯一 URL；闭合时 `open=false` 且链接不可见，展开后 41/41 可见并去重，搜索行和 finalizing 行的 icon/text 中心线实测差值均为 0px。

#### 2026-08-19 刷新恢复与任务记录生命周期纠错

- 用户真实刷新证明 PostgreSQL 中的未完成 Interview Session 和消息仍完整，但顶层工作区固定初始化为正式任务模式，导致读取 localStorage 导航指针的 `CategoryInterviewTimeline` 根本没有挂载；这属于生产恢复入口不可达，不是 assistant-ui 或消息持久化失败。
- 继续复用 Workbench/PostgreSQL 事实源和 React Query。顶层只从 localStorage 读取可丢弃的当前会话指针来决定初始投影；`GET /api/category-interviews` 直接列出尚未关联正式 Capture Task 的未完成采访，指针丢失时仍可从任务记录继续。已确认任务的修订会话由 Capture Task 入口代表，避免同一任务重复显示。
- 删除未完成采访使用 PostgreSQL 事务按外键顺序清理该会话私有的 Decision、Unresolved Item、Draft 和 Message；运行中或已关联正式任务的采访失败关闭。正式任务复用已有 `archived` 状态，`DELETE /api/capture-tasks/:id` 只归档并从活动 list/get 隐藏，不物理删除版本历史或 Source Dataset。该实现只使用现有 Drizzle、Fastify 和浏览器原生确认框，不新增删除框架、恢复协议或第二事实源。
- 定向红灯原先稳定得到“刷新仍显示任务列表”和两个 DELETE 404；修复后页面刷新恢复电视机的 2 条规范化消息及负责人问题，任务记录显示 4 个未完成采访和 1 个正式任务，新增任务行的选择/箭头/删除图标中心线差均为 0px，console error/warn 为 0。真实临时未完成采访 DELETE 返回 204、再次读取为 404；临时正式任务 DELETE 返回 204、底层状态为 `archived`、活动读取为 404，随后精确清理测试记录。

#### 2026-08-16 PC Workbench 信息架构复核

问题：首版项目页把新品类采访、项目概览、市场总体和证据面纵向叠在同一页面，视觉上会把采访误解成冰箱项目的一部分，也无法表达用户当前是在“创建品类”还是“推进既有项目”。

官方参考：Codex App 把独立 thread 组织到 project 下，而不是把所有工作流堆在同一 thread 表面；Linear 的 Project Overview 与不同项目视图分层；GitHub Projects 将不同 view 表达为同一项目内的独立 tab。参考：https://openai.com/index/introducing-the-codex-app/ 、https://linear.app/docs/project-overview 、https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/managing-your-views

结论：接受“左侧工作对象导航＋右侧单一工作模式＋项目内阶段 tab”的 PC 信息架构。新品类采访和项目详情互斥；确认任务书并创建项目后回到该项目概览；市场总体和原始证据只在相应前置状态满足时可进入。该调整只改变 Web 投影与导航，不改变 Interview、Project、Market Universe、Evidence 的事实归属或公共 contract。

### R-029 Codex 交互运行时与 Pi 边界

状态：接受版本锁定的 `codex app-server` `stdio` 薄 adapter与 `thread/start(ephemeral:true)`；不使用 resume、持久 Codex thread、Pi 或自动 fallback
目标阶段：0I

#### 问题与不可取消约束

品类采访需要多轮、可继续、可取消、可观察的 Codex 执行，但浏览器不能直接连接 CLI，Codex thread 也不能成为项目事实源。必须复用官方运行协议或成熟库，不自写 CLI 生命周期、JSONL parser、重试、超时或多模型 fallback。

#### 官方能力与候选处置（核查 2026-08-15）

- Codex App Server 是官方面向富客户端集成的运行协议，提供 thread/turn/item、历史继续、流式 delta、中断、审批与 skill 输入；`stdio` 是默认本地 transport，WebSocket 是实验 transport。官方当前同时把 App Server 命令本身和 WebSocket 标为 experimental、unsupported for production workloads，因此“默认 `stdio`”不能被写成“App Server 已稳定可生产”：https://learn.chatgpt.com/docs/app-server
- `@openai/codex-sdk` 可在 TypeScript 中开始、继续和恢复 Codex thread，适合自动化/批次任务；它继续承担 R-005 Knowledge Factory 的一次批次候选加工候选。阶段 0I POC 要实测它与 App Server 在富事件、取消和显式 skill 上的能力，不凭文档印象重复接两套：https://learn.chatgpt.com/docs/codex-sdk
- `pi-agent-core` 为 MIT 的通用 agent loop/runtime，自己拥有工具调用、消息与会话状态。当前同时引入会与 App Server 重复管理 agent loop、模型、工具、事件和继续语义，增加双事实源与退出成本，因此 MVP 拒绝引入，也不作为 App Server 失败时的自动 fallback：https://github.com/badlogic/pi-mono

#### 历史候选边界（已被 2026-08-16 Session 持久化纠错覆盖）

```text
Browser
  → 项目 typed streaming HTTP
  → Category Interview Module
  → 薄 Codex App Server adapter
  → 本机 codex app-server stdio
```

- 每个采访 turn 显式提供仓库专用品类采访 Skill；Skill 只定义采访行为，不保存会话、决定或任务书。
- Workbench 数据库存规范化消息、Interview Decision 与 confirmed brief；Codex thread ID 只用于继续执行，可丢弃、重建或替换。
- adapter 只做官方协议到项目 typed event 的校验和归一化。若官方提供版本化 schema 或生成类型则直接复用；确需 JSON-RPC 库时另调研成熟实现，不手写 parser/进程管理器。
- 浏览器看不到 Codex 登录材料、工作目录、原始工具事件或内部审批数据；Codex 在限定工作目录、工具和权限下运行，进程退出必须清理。

#### 隔离 POC 与停止门

1. 记录真实 Codex CLI/App Server 版本；只验证可用登录状态，不读取认证文件。
2. 通过 `stdio` 实测 initialize、thread start/resume、turn、item/delta、interrupt、错误、进程异常、重启继续和显式 skill input。
3. 证明所有外部 `unknown` 在 adapter 边界完成 schema 校验并投影为少量项目 typed event；断开或取消后无孤儿进程。
4. 比较官方 SDK 是否已经完整覆盖阶段 0I 的富交互需求；只保留一个交互执行入口，批次与交互用途不得共享含混 adapter。
5. 用真实品类采访样本分别评测 modelId 和 reasoning effort。R-005 的 `gpt-5.3-codex-spark + low` 只适用于历史批次映射，不自动继承到采访。
6. 复核 POC 时的官方成熟度。只要 App Server 仍明确不支持 production workloads，就不得仅凭功能 POC 接入正式入口；必须优先证明稳定 SDK 可覆盖，否则向用户提交缺口、风险、退出方案和最小例外范围，取得知情确认。

历史结论（现已作废）：曾接受“浏览器 → 项目后端 → 本机 Codex”的候选边界，并把 App Server `stdio` 作为首选实验候选。后续 Session 持久化核查证明关键门失败；当前处置以后文“Session 持久化纠错与候选重开”为准。

#### 2026-08-16 POC 纠错与清理

- 实际验证的稳定候选是官方 `@openai/codex-sdk@0.147.0` TypeScript SDK，不是其他同名或相邻用途 SDK。最小真实探针已跑通 `startThread`、`runStreamed`、thread ID 和 `resumeThread`。
- 首个样本明确要求“不调用工具”，只观察到少量事件类型。这个样本只能证明该次运行实际产生了什么，**不能证明 TypeScript SDK 缺少 Codex CLI 中可见的丰富调用信息**；此前由“未观察到”外推“不支持”的判断作废。
- 当前类型表面可确认的具体缺口只限于：`Thread` 没有暴露低层 `turn()`/可直接调用 `interrupt()` 的 handle；结构化 `ThreadInput` 不接受显式 `{ type: "skill" }` item。`run`/`runStreamed` 接受 `AbortSignal`，但尚未用代表样本证明其语义等价于 App Server `turn/interrupt`。
- 未授权引入 Python SDK，因此 Python 虚拟环境、探针、requirements 和 Python 专用 fixture 已清理；R-029 后续只能先在 TypeScript 路径完成代表性事件、取消、错误、恢复和显式 Skill 矩阵，除非用户另行批准新增语言栈。
- `codex app-server generate-ts --experimental` 与 `generate-json-schema --experimental` 曾直接写入仓库 POC，产生 1,008 个文件、133,534 行、3,536,891 字节。该全量生成物不属于最小证据，已清理；若后续确需核对版本化协议，必须先生成到临时目录、统计规模，只保留命令、版本、校验摘要和实现真正消费的最小产物。

历史阶段结论（已由后文 Session 纠错与 ephemeral exec 接受结论覆盖）：当时 R-029 未完成，且尚未证明 TypeScript SDK 不满足富交互需求。

#### 2026-08-16 TypeScript SDK 代表性矩阵

- 当前官方最新版 `@openai/codex-sdk@0.147.0`（Apache-2.0、Node `>=18`）在 Node `24.19.0`、版本化样本 `r029-interaction-v1`、`gpt-5.6-terra + medium`、无 fallback 下真实执行。
- SDK 确实交付丰富调用信息：样本观察到 `command_execution` 的 `item.started/in_progress` 与 `item.completed/completed`、完整命令、thread ID、turn 完成；用新的 `Codex` 实例 `resumeThread` 后得到 `R029_RESUME_OK`。此前“SDK 看不到 CLI 丰富调用信息”的说法确认错误。
- 显式 `$r029-poc-skill` 成功返回 `R029_SKILL_OK`。SDK 类型仍不接受结构化 `skill` input item，但在仓库 Skill 路径固定、Skill 经校验且实现记录内容哈希的前提下，用户已接受 `$skill-name` 作为最小兼容输入。
- 稳定 SDK 的事件 union 和真实运行都没有 `item/agentMessage/delta`；agent message 只在 `item.completed` 出现。它能流式交付生命周期事件，但不能满足 Chat Timeline 的文字增量输出。
- 对活动 `node -e "setTimeout(() => {}, 60000)" r029-cancel-probe` 调用 `AbortSignal` 后，SDK 报 `The operation was aborted`，但子进程 PID `64633` 仍存活；POC 随后只终止该精确进程并确认无匹配残留。因而 AbortSignal 不能视为已证明等价于 `turn/interrupt`，也不满足取消后的进程清理门。
- 非法工作目录和缺失 Codex 可执行文件分别得到明确错误；没有 fallback。

历史结论（后续步骤已作废）：稳定 TypeScript SDK 的能力/缺口证据保留，但“下一步验证 App Server `stdio`”已经执行且最终因持久 Session 失败；当前不得重跑该路径。

#### 2026-08-16 App Server `stdio` 最小例外 POC

- 官方 `@openai/codex@0.147.0` 通过 `stdio` 完成 initialize、thread start/resume、turn、66 个 `item/agentMessage/delta`、typed Skill input、`turn/interrupt`、初始化错误、正常进程退出和 SIGKILL 异常表面；中断后的长命令无残留，新进程可恢复原 thread。
- 只在隔离 POC 使用 `execa@10.0.1`、`ndjson@2.0.0`、`json-rpc-2.0@1.7.1` 和 Zod，分别承担进程生命周期、JSONL、请求关联/timeout 和边界校验；没有自写这些通用能力，也没有生产依赖变更。
- 版本化 TypeScript/JSON Schema 生成器只写入临时目录：642 文件/6,923 行和 285 文件/117,312 行；统计后全部清理，零生成物入库。
- 当前 0.147.0 历史样本显示 `thread/start.sandbox` 使用 kebab-case，官方页面示例仍展示 camelCase，证明实验协议存在漂移风险。对应实验执行树已删除；该记录不构成生产接受。

历史结论（现已作废）：曾接受本机 Workbench 专用、版本锁定的 App Server `stdio` 薄 adapter 例外；当时漏验全局 Session 持久化，故该接受结论撤销。POC 只保留为能力与失败审计证据。

#### 2026-08-16 正式 adapter 与真实采访样本

- 正式 adapter 版本锁定 `@openai/codex@0.147.0`，复用已验证的 `execa@10.0.1`、`ndjson@2.0.0`、`json-rpc-2.0@1.7.1` 和 Zod。新增 `zod-to-json-schema@3.25.2`（ISC）将唯一 Zod contract 转为 OpenAI strict schema；新增 `stream-json@1.9.1`（BSD-3-Clause）只从结构化 delta 中投影 `assistantText`，没有自写 JSON/JSONL parser。
- 官方 0.147.0 JSON Schema 再次只生成到临时目录，用于确认 `TurnStartParams.outputSchema` 和 `ItemCompletedNotification.item`；临时目录随即移入废纸篓，未提交生成物。
- 版本化真实样本 `fridge-interview-v1` 固定 `gpt-5.6-terra + medium`、显式 typed Skill、只读 sandbox、无 fallback。最终返回 55 个可见文字 delta、一个 owner question、一个 `proposedDecision`，并明确要求显式确认；没有自动生成 confirmed decision 或 brief。
- 两次真实兼容失败均已收窄到 schema seam：OpenAI strict schema 要求所有 property 都进入 `required`，故使用成熟转换器的 `target: openAi`；response format 不接受 `format: uri`，故领域 URL 继续由同一 Zod schema 的自定义校验保护，模型 schema 只接收 string。strict 输出中的 `null` 在 runtime seam 归一化为领域 `undefined`/空数组。
- 真实样本结束后 `production-interview-runtime-sample` 和 `codex app-server --stdio` 均无残留。当前样本证明启动轮的一次一问、真实 delta、结构化候选和进程退出；中断、resume 和异常仍由前述 App Server 代表矩阵覆盖。
- HTTP streaming 复核：官方 `@fastify/sse@0.6.0` 要求 Fastify `^5.x`，与当前 Fastify 4 不兼容；未借本任务升级框架。采用 `fastify-sse-v2@4.2.2`（MIT、peer Fastify `>=4`）只承担 SSE framing/backpressure，typed event 仍由共享 Zod contract 拥有。退出时可随未来 Fastify 5 升级替换该单一 HTTP adapter，不影响 Workbench contract。

历史参数证据：`gpt-5.6-terra + medium` 曾通过该启动轮样本，但依赖的运行时已因持久 Session 被拒绝；不得据此继续阶段 0I 纵切片。新运行边界确认后必须重新验证，不能沿用此样本宣布通过。

#### 2026-08-16 Session 持久化纠错、遗漏候选补查与接受结论

用户在真实 Codex 全局目录发现采访开发产生的大量 Session。只验证进程退出和无孤儿进程，没有验证 Session 是否进入全局列表/`sessions` 目录，是此前验收门的实质遗漏。以下结论覆盖本节更早的“接受最小 App Server 例外”和“参数可继续纵切片”结论；历史 POC 证据保留用于解释能力边界，但不得继续作为正式运行时接受依据。

官方资料复核：

- App Server `thread/start` 的响应示例明确返回 `ephemeral: false`；`thread/resume` 继续已存储 Session。`serviceName` 只用于标记 thread 级指标，不提供存储目录、命名空间或不落盘隔离：https://learn.chatgpt.com/docs/app-server
- App Server `thread/fork` 支持 `ephemeral: true`，该 fork 只存在于内存且不进入已存储 thread 列表；但它必须从一个已存储 source thread 派生，且进程退出后不能承担跨进程继续。它无法满足“采访运行时不在全局 Codex 目录留下任何产品 Session”的完整约束：https://learn.chatgpt.com/docs/app-server
- 官方 TypeScript SDK 文档只公开 `startThread()` 和 `resumeThread(threadId)`；未公开不持久化的 start 或项目专属 Session 存储位置。现有真实 SDK/App Server POC 已产生可见全局 Session，因此不能把“文档未说明”解释成隔离已成立：https://learn.chatgpt.com/docs/codex-sdk
- App Server 命令和 WebSocket transport 仍被官方标为 experimental/unsupported for production workloads；即使 `ephemeral fork` 能覆盖部分交互，也不能消除生产成熟度风险：https://learn.chatgpt.com/docs/app-server
- 官方稳定 CLI 的 `codex exec --ephemeral` 明确承诺本轮不把 Session rollout 文件持久化到磁盘；同一命令还提供 `--json`、`--output-schema`、`--output-last-message`、`--model`、`--sandbox` 与配置覆盖，足以承载本项目的无状态单轮 Skill 执行：https://developers.openai.com/codex/cli/reference
- 本项目此前只比较了 App Server、ephemeral fork 和 TypeScript SDK start/resume，遗漏了稳定 `codex exec --ephemeral`。这是调研不完整，不是官方能力缺失。
- 对照 `/Users/guojunxi/Desktop/work/opencode-dev` 当前架构：Host/平台拥有 canonical conversation 和 accepted state，Agent runtime 只持有私有继续语义。该原则直接复用；但对方使用 Pi 是为了多 Provider、工具循环和 compaction，本项目只有一个采访 Agent，复制 Pi/registry 会违反最小复杂度与已接受的“不引入 Pi”边界。

候选处置：

| 候选 | 隔离结果 | 处置 | 退出/改造成本 |
|---|---|---|---|
| 现有 App Server `thread/start/resume` | 持久写入全局 Codex Session | **拒绝** | 重写 runtime；移除 PostgreSQL 中 `codexThreadId` 作为继续机制；保留 Workbench 消息/Decision/Brief |
| App Server `ephemeral thread/fork` | fork 本身不进列表，但依赖已存储 source thread，且不能跨进程恢复 | **拒绝作为完整方案** | 仍需全局 seed、常驻进程或每轮重建；同时保留 experimental 风险 |
| 现有 `@openai/codex-sdk` start/resume | 官方未提供无持久 Session start；现有 POC 已出现全局记录 | **拒绝直接替换** | 无法只换 adapter 解决；重新跑矩阵只会继续制造 Session |
| Workbench 持有全部上下文＋官方 `codex exec --ephemeral` 无状态单轮执行 | 官方明示不持久化 rollout；真实验收前后 `~/.codex/sessions` 文件差分为空 | **接受** | 复用现有 Codex 登录；每轮重放 typed state；无 Codex thread resume；通过 `execa`/`ndjson`/Zod 薄适配 |
| 直接接稳定模型 API | 可无状态，但新增 Provider/API 凭证和另一条调用边界 | **当前拒绝** | `exec --ephemeral` 已满足约束，无需扩大鉴权与 Provider 范围 |

最小原型结论：先用 fake Codex 建立红灯，旧 App Server 路径会在模拟全局目录写入 `rollout-pollution.jsonl`；改为 `exec --ephemeral` 后完成与取消路径均保持目录为空。随后仅运行一次真实 `gpt-5.6-terra / medium` acceptance，完成一轮结构化采访输出，测试断言 `~/.codex/sessions` 前后新增文件为 `[]`。临时 schema/最终输出在成功、失败和取消的 `finally` 中删除。

主动调查验收补充（2026-08-16）：官方 non-interactive 文档说明 `codex exec --json` 会输出包含 `item.*` 的 JSONL，item 类型明确包括 `web_search`；`--output-schema` 只约束最终结构化消息，不能单独证明搜索实际发生：https://developers.openai.com/codex/noninteractive 。因此 adapter 继续用已选 `ndjson` 解码官方事件，不新增 parser；只有生成 brief 的同一轮观察到 `web_search` item 才允许进入结构化 brief 校验。最终事实真实性仍由非空来源、六类 `investigatedFacts`、引用闭包和真实用户表面复核共同保护，不能把事件名当作事实证据。

2026-08-16 阶段结论（已由 2026-08-18 真流式重验推翻）：当时接受“Workbench 持有全部业务上下文＋`codex exec --ephemeral` 无状态单轮执行”，它解决了 Session 隔离，却没有提供 assistant 文字 token delta。当前生产结论以下方“真流式纠错与 App Server ephemeral 重验”为准；仍拒绝 `serviceName` 伪隔离、持久 App Server/SDK thread、Pi/第二 Provider和自动 fallback。

#### 2026-08-18 生产事件、错误与 strict schema 回归

- 用户真实页面证明 adapter 虽用 `ndjson` 读到了 `thread.started`、`turn.started`、`item.*`，却只把事件名累计进 Set，直到进程退出才返回；这不是实时 Agent。当前改为直接迭代成熟 parser 的 JSONL stream，并在 Workbench seam 映射为带稳定 id、`kind/label/detail/status` 的追加式产品活动；同一个 item 只更新状态，已经发生的搜索不会被后续 reasoning 覆盖成泛化“分析中”。
- 官方 non-interactive 文档明确说明普通 `codex exec` 把进度写到 stderr、最终消息写到 stdout，而 `--json` 才提供 JSONL 事件；item 类型包含 command execution、MCP tool call 和 web search。生产 adapter 因而只投影经过脱敏和长度限制的搜索 query、工具名与只读命令摘要，不传原始结果、完整参数、凭证或 stderr：https://developers.openai.com/codex/noninteractive
- 当时确认 `codex exec --json --output-schema` 不提供最终结构化消息的 token delta，于是临时只流式展示活动、最终消息一次性落库；该处置已被下方 2026-08-18 App Server 真流式实现替换，生产代码不得恢复这一旧行为。
- 原实现把完整 stderr、ANSI 和重复的 `rmcp::transport::worker HTTP 502` 拼入 `Error.message`。当前 `codex exec --ignore-user-config` 保留 ChatGPT auth 但不加载用户 `config.toml`，从产品采访链隔离无关 MCP；失败只向 UI 返回受控的服务不可用、登录失效或执行失败文案，原始诊断留在本地 adapter 错误对象。
- 隔离用户 MCP 后真实请求暴露第二根因：模型 schema 的 `taskCandidate.sourceCandidates[].entryUrl` 仍含 `format: uri`，Codex 返回 `invalid_json_schema` 400。虽然 2026-08-16 调研已记录这一限制，生产回归未保护它。当前使用 `zod-to-json-schema` 已有 `postProcess` seam 去除全部模型侧 `format`；模型最终输出仍由原始 Zod URL/日期规则校验。新增 fake Codex 回归会读取实际临时 schema，发现任何 `format` 即失败。
- 真实浏览器又证明 output schema 允许仅返回 `question`，而旧持久化只消费 `proposedDecision`，导致“文案在问、界面没有建议”。Workbench 继续在唯一事实边界把合法 `question` 归一化为 proposed Decision；该轮“点击 option label 确认”的历史 UI 已由 2026-08-19 普通消息＋Composer 回答替代，推荐项只作为建议，不限制 confirmed selection。
- `zod-to-json-schema@3.25.2` 官方仓库已于 2026-06-30 归档并建议迁移 Zod v4 原生 JSON Schema；当前 bugfix 不擅自升级全仓 Zod 或增加 OpenAI SDK helper，继续锁定已存在版本并保持 adapter 可替换。后续若扩展采访 schema，必须先比较 Zod v4 原生转换与 OpenAI 官方 `zodTextFormat`，完成严格 schema 原型后才能选型：https://github.com/StefanTerdell/zod-to-json-schema 、https://github.com/openai/openai-node/blob/main/docs/structured-outputs.md
- 真实 `gpt-5.6-terra + medium` 手工同链和 Workbench 页面均完成“抓冰箱”首轮，观察到启动、分析和多次 `web_search`，最终返回三项京东范围选项；没有自动 fallback。该结果恢复 R-029 生产运行门，但采访内容仍由用户验收。
- 开发端口清理的旧结论已由 Windows 真机复现推翻：`kill-port-process@4.0.2` 能终止端口监听子进程，但根启动链中的嵌套 npm batch 与 API `node --watch` 父进程仍可能残留，下一次启动因 4000 被重新监听而报 `EADDRINUSE`；当 6173 已空闲时，该包的 `--silent` CLI 仍会把“找不到 PID”打印为错误堆栈。根 `dev` 现复用已锁定的 `concurrently@9.2.1` 程序化 API，以各 workspace `cwd` 直接启动无 watcher 的 API 与 Vite，并保留 API ready 后再启动 Web；独立 `dev:api` 继续提供热重载。根 `dev:stop` 先用已锁定的 `wait-on@9.0.5` 确认实际监听端口，只把活动端口交给 `kill-port-process`，因此空闲端口是成功状态。两轮完整“启动→API/HTML/CSS/TSX 200→停止”后 4000/6173 监听和仓库开发进程均为 0，第二轮未再出现端口冲突；停止导致的子进程非零仍保留，但不会再把含环境变量的 Command 对象作为未处理异常打印。组件依据：https://github.com/open-cli-tools/concurrently 、https://www.npmjs.com/package/kill-port-process
- 默认测试命令不能把 PostgreSQL 修订链静默跳过。项目已锁定 Node 24，因此先复用现有 `db:ensure-local`，再由同一个 Node 进程用官方稳定 `--env-file=.env.example` 直接启动 lockfile 声明的 Vitest CLI；不引入 `cross-env` 或自研环境加载器。原先尝试的 `node --env-file --run test:vitest` 已由真实回归证明没有把变量传给当前 Vitest 子进程，故已删除而不是继续叠 fallback。Node 官方文档确认 `--env-file` 会在进程启动时加载键值文件：https://nodejs.org/download/release/v24.15.0/docs/api/cli.html#--env-filefile

#### 2026-08-18 真流式纠错与 App Server ephemeral 重验

- 用户指出“Codex 不可能不支持流式”是正确的。旧结论把三个事实混在了一起：`codex exec --json` 提供的是 JSONL 生命周期事件；`--output-schema` 约束最终助手消息；旧 adapter 又主动丢弃 `agent_message` 并等待 `--output-last-message` 文件。因此页面只能看到活动，不能看到文字 token delta。
- 重新核对官方 App Server 文档与本机锁定的 `@openai/codex@0.147.0` 生成协议：稳定 schema 同时包含 `ThreadStartParams.ephemeral`、`item/agentMessage/delta`、`MessagePhase = commentary | final_answer`。此前“只有 thread/fork 支持 ephemeral”的结论来自不完整文档阅读，现已推翻。协议只生成到两个 `/tmp` 目录，核对后删除，没有把生成物写回仓库：https://developers.openai.com/codex/app-server
- 真实协议探针证明：设置 `turn/start.outputSchema` 时，commentary 也会被模型约束成 JSON token；去掉该参数后，commentary 是正常中文 delta，final_answer 仍可按提示只返回 JSON。正式 adapter 因而不再设置 `outputSchema`，而是在 prompt 中附最终 JSON Schema，并对完整 final_answer 执行既有 Zod 校验。失败即公开报错，不做宽松 parser、修复模型或自动重试。
- 当前接受边界为：每个注入式 runtime 启动并初始化一次官方 App Server `stdio` 连接，每个业务轮次在同一连接上重新调用 `thread/start`，强制 `ephemeral:true`、只读 sandbox、never approval，并使用不继承工程仓库 `AGENTS.md` 的隔离空目录；只把 `phase=commentary` 的 delta 投影为 `assistant.delta`，把 `phase=final_answer` 留在服务端解析。Workbench/PostgreSQL 仍拥有全部消息、决定、未决项和任务草稿，没有 `resume` 或可持久化的产品 Codex thread。
- 为避免本机工程规则、通用插件、hooks 和 memories 介入产品采访，启动参数显式关闭后三项稳定 feature。每轮由 Workbench 把仓库内权威 Skill 覆盖同步到隔离 cwd 的标准 `.agents/skills/interview-product-category/SKILL.md`，再按官方推荐在 `turn/start.input` 同时提供 `$interview-product-category` 与该绝对路径 `skill` item；模型不需要也不能执行本地命令寻找文件。官方配置参考同时确认 `features.shell_tool` 和 `features.unified_exec` 都可关闭；采访 App Server 进程因此直接 `--disable` 两项能力，只保留 web search，adapter 对异常/旧 `commandExecution` 继续不投影：https://developers.openai.com/codex/app-server 、https://developers.openai.com/codex/config-reference
- 历史样本曾同时观察到中文逐 token commentary、多次 `web_search` item 和最终通过当时 schema 的京东负责人问题；该样本只证明流式协议，问题内容已由 2026-08-19 的默认京东策略修复取代，不再是生产接受行为。
- App Server 命令在 0.147.0 CLI 帮助中仍标记 experimental，因此 adapter 必须继续锁版本、保持单文件薄边界并由 fake 协议回归保护；不引入动态 tools、SDK thread、Pi、第二 Provider 或自动 fallback。若未来版本移除 `thread/start.ephemeral` 或 message phase，直接失败并重新进入调研门，不退回假流式。
- 官方 App Server 协议声明 `commandExecution` 完成项可带 `status / aggregatedOutput / exitCode / durationMs`，且 `item/completed` 是该 item 的权威最终状态。旧 adapter 先后显示过完整命令和“安全目的摘要”，但两种投影都把工程 Agent 的内部执行误当成抓取产品活动；当前删除整个 `commandExecution` 产品投影，不再显示命令、退出码或目的文案。未来工程诊断只能留在服务端受控边界，不能进入采访 Timeline：https://learn.chatgpt.com/docs/app-server
- 截图中的命令内容证明旧运行时继承了仓库工程约束，读取采访 Skill、开发基准、进度/积分账本并核对 Git 状态；这不是商品来源调查，也不该成为用户可见步骤。当前运行时把 Skill 同步进隔离 cwd 后显式注入，关闭 shell/unified exec 能力，并在产品 prompt 中禁止寻找 Skill、`AGENTS.md`、开发文档或 Git 状态。首次调查或品类发生变化的回合必须观察到已完成的 `web_search` item，否则失败关闭；只有 started/failed 事件不能充当已完成调查。
- 旧 assistant 消息只保存最终 `text`，运行中的 ordered parts 只存在于 React 内存；因此完整刷新必然丢失搜索和工具历史，旧 Web 测试却把刷新后的“服务端消息”错误地复用了同一份 live parts。当前 `category_interview_messages.timeline_parts_json` 保存有序文字/活动 union，Workbench 与 Web 复用同一组 append/complete/fail 规则，刷新直接重放数据库事实；没有 timeline 的历史消息继续只显示最终文本，不伪造旧工具调用。

#### 2026-08-19 App Server 连接生命周期与京东策略纠错

- 官方 App Server 文档把 `initialize` 定义为每条连接的第一次调用；初始化后，同一连接可重复 `thread/start`，运行中的 turn 可用 `turn/interrupt` 取消。因此每次用户回复都重启 `codex app-server` 不是协议要求，只会重复支付进程与握手成本：https://learn.chatgpt.com/docs/app-server
- 当前 `CodexAppServerClient` 隔离 transport、通知投影和产品 runtime：连接初始化一次，同一 client 的两个 `run` 分别收到新的 `thread/started`；成功轮不重启进程，Workbench 关闭时统一释放。`thread/start(ephemeral:true)` 仍是每轮边界，不引入持久 thread、resume、后台队列或第二个产品 Session。
- 京东覆盖是标准商品的平台来源策略，不是负责人取舍。Skill、prompt 和共享 runtime schema 现在共同禁止 `jd.scope` question/proposal/unresolved item；Workbench 在草稿持久化前强制应用完整默认范围。迁移只把历史 open `jd.scope` 状态变成 resolved/superseded，不删除或改写历史消息。
- 真实新会话先生成并确认默认覆盖京东的冰箱 v1，再在同一会话补充两个淘宝受限入口并确认 v2；两轮均没有负责人 Decision，正式任务 revision=2，Source Run=0。历史失败会话页面只有一个 error alert。自动证据包括两轮同连接协议、序号归一化、字段路径错误、DB 迁移/集成、44 passed / 1 skipped 全量测试、类型检查与生产构建。

#### 2026-08-19 任意采访输入与本轮理解增量纠错

- 上述“序号归一化”只修复裸 `1`，没有覆盖采访的真实输入语义。代码复核证明 Web 在存在 proposed Decision 时先调用独立确认接口并提前返回，Codex 看不到本轮原文，因而无法同时理解“1，另外不含二手”、纠正、否定问题前提或追问；随后再启动 `decision_confirmed` 回合还制造了额外状态转换和一次无意义等待。
- 接受的新边界是 input-first：Workbench 先保存任意 Composer 原文，再把原文、当前 proposal、历史消息/活动、决定、未决项和草稿版本一并交给 ephemeral Codex 回合。Codex final answer 只提交本轮理解增量；明确回答使用 `decisionResolution` 引用当前 proposal，成立的前提否定使用 `decisionWithdrawal` 撤回问题，附加事实同时写入说明和下一版草稿，含糊或追问则不确认。Workbench 校验引用并原子持久化，不再提供独立 Decision confirm HTTP 路径或 `decision_confirmed` trigger。
- `grill-with-docs` 只组合自然语言 `grilling` 和随会话维护记录的 `domain-modeling`，不定义 JSON 传输。项目 Skill 因此只定义理解、调查、提问和记录纪律；机器字段继续由 runtime schema 独占。最终 JSON 仍是 App Server seam 下本轮 typed delta，因为 Workbench 必须在无状态回合后校验状态变化；它不再同时维护 `question`/`proposedDecision` 两种问题结构，也不要求模型重报完整会话。
- 平台和网站是系统应调查的来源事实，不是负责人选择题。京东对家电保持默认核心覆盖；淘宝是后续同级平台候选，但当前没有淘宝 crawler/Provider，任何草稿都不能把搜索发现误写成已接入能力。
- 任意新输入都会使旧草稿离开当前可确认态，避免用户在本轮仍运行或失败时确认过期范围。只有最新回合结束、session 为 `idle + task_ready` 且最新草稿通过完整性校验时，确认入口和后端命令才开放；用户显式确认才创建或推进 Capture Task。
- 纯解释回合只返回普通说明，不生成决定或草稿修订。
- 来源 `observedAt` 不是模型权威字段。Workbench 忽略模型给出的时间，在草稿提交时统一写入当前时间。
- 用户触发的 retry 不是自动模型修复：只允许重放当前 session 最近一条 failed/interrupted 用户原文，而且该消息之后不能已有 completed assistant 消息。更早历史消息、任意改写文本或正常已完成回合都不能成为 retry target。
- 本次不引入 dynamic tools、第二次模型抽取、宽松 parser、自动模型重试或新依赖。继续沿用 R-029 已验证的 prompt JSON Schema＋本地 Zod 边界；若该边界仍出现非确定性无效输出，必须用真实失败样本重新进入协议调研，不能把用户原文预先降级成字符串分支作为兜底。

### R-030 商品底层知识来源与质量门

状态：调研中；代表性来源的证明范围与许可门已形成候选，生产来源白名单、共享 contract 和真实纵切片仍未冻结
目标阶段：阶段 1A/1B

问题：现有九个官网与京东采集只支持目录 identity、商品声明和市场资料，不能单独产出压缩机、制冷循环、换热、控温、除霜、保鲜等商品底层知识。正式知识必须同时包含商品底层知识和商品品类知识；品牌、系列、型号和变体属于品类知识的市场实例层。

不可取消约束：

- 底层结论必须表达原理链、部件、输入/输出、适用条件、边界、取舍和常见失效，并绑定可定位证据；
- 京东卖点、品牌营销声明和用户评价不能单独证明通用技术原理；
- 某型号采用某机制必须同时有“该机制为何成立”的权威证据和“该型号确实采用”的型号证据；
- 普通营销媒体、SEO 内容和无出处转载不进入正式知识；
- 来源许可、可携带范围、本地处理、安全边界、时效、冲突和退出成本必须逐类登记；
- 不在调研前新增通用 Provider、知识 schema、模型调用或来源评分器。

#### 代表性来源与官方资料

下表只冻结“来源类别怎样被判定”，不把冰箱来源写成所有商品品类的固定白名单。新品类必须针对自己的 Knowledge Need 重新生成来源候选并通过同一许可和证明范围门。

| 来源类别与代表样本 | 可以直接证明 | 不能直接证明 | 模型加工与知识包候选处置 |
| --- | --- | --- | --- |
| 当前国家标准身份与监管解释：国家标准全文公开系统、全国标准信息公共服务平台、市场监管总局 | 标准号、现行/废止、实施日期、适用范围、监管分类和官方解释 | 通用科学原理、品牌当前在售、具体型号实际结构 | 接受元数据、状态和可定位的最小监管证据；全文仍逐项核对版权/采标限制，不因“可在线预览”默认允许整篇保存、输入模型或进入知识包 |
| 政府科研技术系列：NIST Technical Series，例如 CYCLE_D-HX Technical Note 1974 | 蒸汽压缩循环的部件、热力过程、输入输出、比较条件和模型边界 | 中国标准适用性、家用型号实际采用、保鲜效果 | **首个制冷循环原理纵切片候选**；NIST 员工 Technical Series 在美国不受版权保护，NIST 同时授予境外再版/衍生许可并要求署名，但每份资料仍检查第三方作者、图片和数据例外 |
| 政府食品安全/农业资料：USDA FSIS、ARS/NAL | 温度、湿度、气流、微生物、冷冻速度等保存条件及其边界 | 某冰箱宣传技术有效、型号具备某功能、跨食材统一效果 | **首个保鲜条件纵切片候选**；USDA 职务作品通常为美国政府作品，仍逐页检查第三方材料、图片和单独版权标识并保留署名 |
| 国际组织技术资料：FAO 出版物 | 冷藏、冷冻、湿度和食品品质等机构性技术背景 | 当前家电标准、具体型号实现 | 只保留候选目录与 locator；FAO 默认开放政策限非商业用途，商业复用/再分发需要许可，未取得与本产品一致的授权前不得进入生产模型输入或可发布知识包 |
| 专业协会标准/手册：ASHRAE Handbook | 制冷与 HVAC 专业体系和行业参考 | 具体型号采用、当前在售 | **拒绝进入现有 AI 加工链**：官方许可页明确禁止将 ASHRAE 出版物/IP 输入 AI 或用 AI 形成衍生作品，除非书面许可；订阅/购买也不等于模型加工授权。只允许登记书目信息，不能抓正文做原型 |
| 核心部件厂商工程资料：以 Copeland Application Engineering 为代表 | 该厂商部件的结构、应用条件、工作包络和厂商声明 | 跨厂商通用原理、某整机型号实际采用该部件 | 作为 component/application claim 候选，不升级成独立通用原理；Copeland 官网条款将服务限定为个人非商业使用并限制复制分发，未另获授权前不进入生产模型或知识包 |
| 品牌官网、说明书、服务/技术资料 | 品牌或型号公开声明、规格、结构、使用/安装/维护边界 | 未披露实现、跨品牌原理、宣传效果真实性 | 作为品牌/型号 implementation claim；逐站核对许可，和独立底层原理证据建立双证据关系 |
| 原始论文、教材和专利 | 论文实验条件内的结论、教材定义、专利公开的技术方案 | 商业产品实际采用、方案真实效果、无限泛化 | 逐项核对原始发布者、版本、同行评议/实验条件及许可证；“公开可读”不等于允许批量模型加工或再发布，不设整类默认许可 |

官方依据：

- NIST CYCLE_D-HX Technical Note 1974 明确模拟由压缩机、冷凝器、膨胀装置和蒸发器等组成的蒸汽压缩循环，并声明模型输入和比较边界：https://www.nist.gov/publications/cycled-hx-nist-vapor-compression-cycle-model-accounting-refrigerant-thermodynamic-and
- NIST 对 Technical Series 的版权说明：NIST 员工职务作品在美国不受版权保护，并授予境外再版和衍生使用许可；第三方作品可能例外，需逐项检查并署名：https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications
- USDA FSIS 说明低温会减慢细菌生长、冷藏不能杀灭所有病原体、蔬菜与水果需要不同湿度条件；这些内容能证明保存条件和边界，不能证明某品牌营销技术：https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/refrigeration
- USDA 关于冷冻说明低温使微生物进入不活跃状态，解冻后可恢复活动，快速冻结可减少大冰晶造成的细胞损伤：https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/freezing-and-food-safety
- USDA/NAL 版权页说明多数政府信息为公有领域，但第三方图片、资料和单项限制仍须识别：https://www.nal.usda.gov/web-policies-and-important-links
- FAO 官方许可页只默认允许私人学习、研究、教学和非商业产品/服务使用；再发布、分发和商业使用需按具体许可申请：https://www.fao.org/publications/about-fao-publishing/permissions/
- ASHRAE 官方许可页明确禁止把其出版物或相关 IP 输入 AI 工具、以及未经书面许可用 AI 制作衍生作品：https://www.ashrae.org/permissions/permissions-and-licensing
- Copeland 官方 Terms of Use 将服务限定为个人信息与非商业用途，并禁止未经明确同意在其他网站或网络环境复制、再发布或分发材料：https://www.copeland.com/en-us/terms/terms-of-use

#### 当前标准版本纠错

- 截至 2026-08-17，`GB/T 8059-2025` 已于 2026-06-01 实施并全部替代 `GB/T 8059-2016`；官方状态页：https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=BF0FB970326D221A8E78987E22BB7F02
- `GB 12021.2-2025` 已于 2026-06-01 实施并全部替代 `GB 12021.2-2015`；官方状态页：https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=9BC022A3FF2B7F7D733C3962C986DF7A
- 既有监管 Evidence 中出现 `GB 12021.2-2015` 只能证明当时备案原文采用旧标准，不能继续充当当前品类标准基准。标准版本是时点事实，来源快照必须保留 `observedAt`、状态和“替代/被替代”关系，不得静态写死在冰箱代码中。
- 国家标准全文公开系统说明对采标推荐性标准按国际版权政策公开，平台同时声明版权所有；因此当前只确认标准身份、状态、范围和允许保存的最小证据，不推定全文可进入模型或知识包：https://openstd.samr.gov.cn/bzgk/std/std_list_ics_left

#### 质量门候选

不引入一个拍脑袋的“来源总分”。每条来源资料必须分别记录并验证以下事实：

1. `authority`：发布主体和资料类型；
2. `claimScope`：它能证明原理、标准边界、部件声明、品牌声明、型号事实还是用户体验；
3. `versionStatus`：版本、发布日期、现行/废止和观察时间；
4. `usagePermission`：允许本地读取、允许输入模型、允许保存最小证据、允许发布派生知识、允许携带原文分别判定；未知一律 fail closed；
5. `thirdPartyRisk`：第三方作者、图片、表格、数据、国际标准采标等例外；
6. `evidenceLocator`：URL/DOI、页、章节、表格区域或 exact/context，及内容 hash；
7. `generalizationBoundary`：实验条件、适用对象、不能推出的结论和冲突；
8. `freshnessPolicy`：稳定原理可以较长有效，标准、监管、品牌和型号事实必须按各自时效更新。

发布关系至少需要两条独立闭环：`foundational claim → authoritative evidence` 与 `model implementation claim → brand/model evidence`。二者同时存在才允许生成人工审核的“该型号采用/利用该机制”候选；任何一侧缺失都保持 `unknown`，不允许模型补造。

#### Node/TypeScript、本地/离线和部署边界

- 本轮来源访问不新增依赖：继续复用已验证的 Crawlee/HTTP 访问、`unpdf`、`read-excel-file`、`sharp`、PostgreSQL/Drizzle 与 `cacache`；它们只负责取得和保存允许处理的内容，不决定资料权威性或许可。
- 来源许可和 claim scope 是 Workbench 业务事实；Provider 只返回页面状态和观察，不能把站点域名直接升级成“权威”或“可进模型”。
- 公开可携带的最小证据与受限的本地资料物理隔离；Runtime 知识包不得包含付费、个人订阅、未授权全文或第三方受限图片。
- macOS 开发和 Linux Runtime 不增加新的原生部署依赖；Windows 仍待产品目标确认。抓取登录态、Cookie、Profile 和订阅凭据永不进入 Git、日志、模型输入或知识包。

#### 安全、测试、升级与退出

- 许可未知、条款禁止 AI、只允许个人/非商业用途、需要登录订阅或包含未识别第三方材料时，自动加工必须停止；不得用“只摘录一点”绕过明确禁止。
- 测试夹具只使用项目自有文本或已确认可复用的政府公开资料最小片段；不把 ASHRAE、Copeland、付费标准正文复制进仓库。
- 来源更换不能改变 Knowledge Need、EvidenceRequest 或知识关系 contract；新来源只通过同一 `claimScope + usagePermission + locator` 门接入。退出某来源时保留书目/URL、历史使用许可和受影响 claim 清单，撤下不可继续携带的内容而不改写历史审计。
- 标准状态需要定期重查；发现替代版本时追加新快照并把依赖旧版本的候选标为待复核，不能覆盖旧 Evidence。

#### 最小原型与当前结论

最小原型仍以制冷循环、压缩机、控温/除霜和保鲜各一个能力问题为目标，但首轮只允许使用通过许可门的资料：制冷循环优先 NIST Technical Series，保鲜条件优先 USDA 职务作品；现行标准身份使用 SAMR 元数据。ASHRAE、Copeland、FAO 和标准全文在相应许可未确认前只保留候选/书目，不进入模型输入或测试夹具。

原型必须形成“原理链＋条件＋边界＋权威证据”，再选择至少一个真实型号，用独立型号资料建立 `confirmed / candidate / conflicting / unknown` 关系；同时证明 Workbench 可查看、证据可复核、模型只产候选、缺失不补造，并与京东/官网来源数据在同一批次报告中联合验收。

当前结论：来源证明范围、许可门和首轮可用候选已形成；这不是生产白名单已完成。下一步先冻结跨品类来源数据 seam 并完成逐条持久化/查看/导出原型，再运行上述真实纵切片。统一补救与执行顺序见 `JD-COLLECTION-DESIGN.md`。

### R-033 公开技术网页正文提取

状态：macOS 与 Windows/Node 24 正式链路原型已通过；目标 Linux 安装/运行门仍待补，暂不宣称全平台生产接受
目标阶段：阶段 1A / M2 代表性底层知识来源小批次

问题：已确认任务书只应提供 Knowledge Need 和来源入口，不能要求调用者为每个未知技术网页手写 CSS selector。正文定位属于通用网页能力，必须复用成熟实现；站点权威性、许可和 claim scope 仍由 Workbench 规则决定，提取器不能替代这些业务判断。

候选与处置：

| 候选 | 结论 | 原因与退出成本 |
| --- | --- | --- |
| 继续使用现有 Cheerio `selector + requiredText` | 拒绝作为批量入口；保留定点 Evidence adapter | 它适合已知证据定位，不适合未知 DOM 的正文发现；要求 Planner/用户提前知道站点结构会把站点细节泄漏进领域计划 |
| `@mozilla/readability@0.6.0` + `jsdom@29.1.1` | 接受进入最小原型 | Readability 是 Firefox Reader View 使用的成熟 Apache-2.0 实现，并官方给出 Node＋jsdom 用法；jsdom 29.1.1 为 MIT，Node engine `^20.19 || ^22.13 || >=24`，兼容本仓库 Node 24.12；依赖只承担 DOM 和正文提取 |
| jsdom 30.x | 当前拒绝 | 官方 30.0.0 将 Node 24 最低版本提高到 24.15，本仓库固定 24.12；升级运行时不是本能力的必要范围 |
| Firecrawl/远程正文提取服务 | 继续拒绝 | R-026 已记录 AGPL、自托管多服务、云端内容边界和退出成本；当前本地成熟库已能验证需求，无需引入远程处理 |

官方依据：

- Mozilla Readability README 说明它被 Firefox Reader View 使用，Node 示例明确配合 jsdom，并要求传入来源 URL 解析相对链接；同时建议保持 jsdom 脚本和远程资源加载关闭：https://github.com/mozilla/readability
- Readability 0.6.0 包元数据声明 Apache-2.0、内置 TypeScript 类型和 Node `>=14`：https://raw.githubusercontent.com/mozilla/readability/main/package.json
- jsdom 29.1.1 包元数据声明 MIT、Node `^20.19.0 || ^22.13.0 || >=24.0.0`：https://raw.githubusercontent.com/jsdom/jsdom/v29.1.1/package.json
- jsdom 30.0.0 发布说明将最低版本提高到 `^22.22.2 || ^24.15.0 || >=26.0.0`，因此当前不能跟随最新版：https://github.com/jsdom/jsdom/releases/tag/30.0.0

安全与产品边界：

- jsdom 不启用 `runScripts`、不加载页面子资源；Crawlee 仍只访问 allowlist 中的 HTTPS origin，并限制响应体大小、超时和单次请求数。
- 永久保存的是 Readability 返回的纯文本正文和来源观察，不渲染其 HTML，因此本纵切片不引入 DOMPurify；未来若 UI 展示或保留 HTML，必须另过 sanitizer/CSP 调研门。
- Readability 是文章正文提取器，不用于商品目录、参数表、京东详情、标准表格或 PDF；这些继续走各自 typed Provider。
- 提取成功不代表可进入模型或知识包。`usagePermission.localRead` 与 `evidenceStorage` 必须为 allowed 才能执行和持久化；模型输入、派生发布和原文再分发分别 fail closed。

最小原型通过门：项目自有 HTML 夹具证明正文提取、导航/脚本排除、无远程子资源；本地 HTTPS fixture 证明 allowlist、响应上限和 typed failure；随后用 R-030 已允许的 NIST/USDA 各一条真实页面验证标题、正文、URL、时间、HTTP 元数据和 Knowledge Need/target 绑定。只有自动化、真实样本、Node 24.12 安装和目标 Linux 安装均通过，候选才改为已接受。

#### 2026-08-17 正式 Planner 与多来源原型结果

- `@mozilla/readability@0.6.0`、`jsdom@29.1.1` 已进入 worker 直接依赖；macOS arm64、Node 24.12 的正文夹具、Provider 路由、全 workspace typecheck 与真实正式链路通过。目标 Linux 尚未运行，因此依赖选型保持“当前开发环境接受、跨机器待验”。
- 正式链路不是手写 URL 脚本：Category Interview 形成 confirmed brief，`sourceAssignments` 显式把每个来源入口绑定到 collection lane 和 Knowledge Need，服务端 Planner 只接收 `projectId`，生成并持久化 plan/batch/work item，再由 DBOS、Provider 和 Source Dataset 执行。缺少分配的新任务书不能确认；历史任务书仍可读取但 Planner 失败关闭。
- 第一次真实链路暴露“同一 lane 的两个来源被同时绑定到两个知识需求”的错误。旧按知识层交集猜测的代码已重写为显式 `sourceAssignments`；重新验收后 NIST 只绑定 `need:refrigeration-cycle`，USDA 只绑定 `need:food-preservation`。
- 扩展后的隔离 PostgreSQL 原型保存 3 条真实快照：NIST、USDA 为 `document`，中国能效标识 `MR-457WUSPZE` 为保留官方 JSON 原文的 `ordered_record`；两个 DBOS 批次均 `succeeded`。美的说明书 lane 为 `waiting / local_read_not_allowed`，没有发起访问。隔离数据库和临时 Evidence 目录均已删除。
- `SourceCollectionWorkItem.request` 只新增三个 category/source-neutral 选择方式：`full_resource / document_excerpt / structured_record_lookup`。监管 Provider 在外部 seam 将通用字段码严格收窄为 `manufacturer_model`；PDF Provider 复用 Crawlee＋unpdf 并只保存唯一页摘录。未知查询字段、错误对象类型或许可不足均失败关闭。
- 当前美的法律声明明确：未经书面许可不得通过机器人/爬虫复制、下载或使用平台内容。因此历史 `MR-457WUSPZE` PDF 只能保留为历史 POC 证据，正式规则设置 `localRead/modelInput/evidenceStorage=denied`：https://www.midea.cn/act/help_center_new/transaction_terms?id=106&parentId=508
- 中国能效标识按型号公开查询继续复用 R-026 已接受的真实来源与两步官方协议；本轮只查询一个已知型号，不把监管库冒充当前在售总体，也不从监管结果生成知识。

#### 2026-08-18 Windows 冰箱纵切片结果

- Windows 11、Node 24.14.1、npm 11.11.0 和本机 PostgreSQL 14 上，confirmed brief → 服务端 Planner → DBOS → Provider → Source Dataset → Evidence 的隔离真实验收一次通过、零自动重试。NIST 制冷循环正文、USDA 冷藏保鲜正文和中国能效标识型号记录分别形成 1 条可访问快照和 1 条最小 Evidence；三个目标/Knowledge Need 没有串线。美的说明书保持 `waiting / local_read_not_allowed`，请求数为 0。
- 首次隔离运行暴露 Planner 的批次幂等键只含 Provider＋访问政策，同一 Provider 下两条不同 lane 会碰撞。生产键已改为同时绑定 `collectionLaneId + providerKey + accessPolicy + 完整 workItems`，并由“同 Provider/政策、不同路线必须产生不同键”的回归测试锁定；没有引入冰箱分支或第二套执行器。
- 本机开发库用于 PC 表面展示，不冒充完整验收：NIST 与能效标识运行完成；USDA 当前页面两次返回 HTTP 403，两个失败运行均持久化 typed `source_stop_signal/source_abnormal`，没有第三次重试或绕过。因为该项目批次不完整，Evidence 数为 0；PC Workbench 能同时显示已完成与失败来源。隔离验收中的 USDA 成功事实与开发库当前 403 都保留，不互相覆盖。
- 海尔、TCL、海信和康佳当前公开法律/使用条款没有给出本产品规则所需的明确机器采集、模型输入和派生发布许可，并包含复制、自动化或商业使用限制；因此官网/型号资料继续失败关闭，不以“公开可浏览”推定可采集。依据：https://www.haier.com/notice/legal/ 、https://www.tcl.com/cn/zh/legal/terms-of-use 、https://hiyouxin.hisense.com/zcms/ui/content/show?ID=16997 、https://www.konka.com/p-13.html
- 本轮没有访问京东。准确阶段结论是：R-033 的 Windows 通用技术/监管小批次和最小 Evidence 已通过；`ROADMAP.md` 冰箱纵向第 6 步仍缺获许可的品牌官网完整商品详情/说明书，且开发库 USDA 来源处于外部 403，不能宣布第 6 步或阶段 1A 完成。

### R-031 跨品类来源数据集 contract 与导出

状态：已接受；跨品类 TDD 实现与本地真实 PC 表面通过，尚未访问真实来源
目标阶段：阶段 1A / `JD-COLLECTION-DESIGN.md` 实施 A

问题：当前 `OfficialCatalogSnapshot` 只保存品牌和厂家型号，`EvidenceItem` 只保存围绕既定 Knowledge Need 选择出的最小证据；二者之间缺少“来源取得了什么”的不可变事实层。若直接给京东、官网、标准、论文各建一套表和 DTO，会把站点/冰箱结构写进公共 contract；若把内容塞进 `unknown metadata`，则失去校验、可查看和可重放能力。

#### 现有资产与成熟组件

- 继续使用已接受的 PostgreSQL＋Drizzle 保存 Workbench 结构化事实；DBOS 只保存执行与恢复，不充当来源事实；`cacache` 保存允许保留的图片/文件字节；Zod 在所有跨模块入口校验；RFC 8785 `canonicalize` 生成稳定内容 hash。
- JSONL 继续复用项目已声明的 `ndjson`/Node stream 能力，不另造流式协议解析器。
- CSV 候选使用 `csv-stringify`，不手写逗号、引号、换行和公式注入转义。官方项目为 MIT，支持 ESM、TypeScript 声明和 Node Transform stream，维护超过十年，当前 npm 版本 `6.8.1`、2026-07 仍有发布；无原生依赖，可在 macOS/Linux/Windows Node 运行：https://github.com/adaltas/node-csv 、https://csv.js.org/stringify/distributions/nodejs_esm/ 、https://csv.js.org/project/license/
- 当前 lockfile 已有 `csv-stringify` 的传递依赖记录，但生产代码若采用必须在直接使用它的 package 明确声明直接依赖并更新 lockfile；不得依赖偶然 hoist。

#### 候选比较

| 候选 | 结果 | 原因 |
| --- | --- | --- |
| 每个站点/品类建专用表和 DTO | 拒绝 | 京东/冰箱字段会成为公共 schema；切换电视、空调或其他来源需要迁移和代码分支 |
| 单表 `jsonb metadata: unknown` | 拒绝 | 不能在 seam 校验内容、关系、许可和导出；违反 typed contract 与单一解释器约束 |
| 只把整页/文件放 CAS | 拒绝 | 无业务边界、无法直接查看/导出/投影，且会携带广告、账号、无关内容和许可风险 |
| 直接把来源内容提交成 EvidenceItem | 拒绝 | 来源数据用于发现知识问题，Evidence 是围绕已确认问题选择的最小证明；合并会导致反向删除原始来源结构或把页面内容冒充充分证据 |
| 稳定 envelope＋少量 discriminated content kind＋独立 asset | **接受候选** | 保持 category/source 中立，同时让内容、关系、许可、幂等和导出在公共 seam 立即校验；后续新 kind 必须有真实来源和消费者，不能预建 registry |

#### 公共 seam 候选

Workbench 只新增一个深模块 `SourceDatasetModule`，不新增 manager/registry/engine：

```ts
interface SourceDatasetModule {
  startRun(input: StartSourceCollectionRun): Promise<SourceCollectionRun>;
  commitSnapshot(input: CommitSourceSnapshot): Promise<SourceSnapshotRecord>;
  commitAsset(input: CommitSourceAsset, content: Uint8Array): Promise<SourceAsset>;
  finishRun(input: FinishSourceCollectionRun): Promise<SourceCollectionRun>;
  getRun(runId: string): Promise<SourceCollectionRunView | null>;
  listProject(projectId: string): Promise<SourceCollectionRun[]>;
  exportRun(input: ExportSourceCollectionRun): AsyncIterable<string>;
}
```

- `startRun` 只接收 `projectId + collectionLaneId + providerKey + accessPolicySnapshot`；module 自己读取当前 confirmed Category Definition/Scope/Collection Board 并把版本 ID 冻结进运行，调用方不得重复提交另一套 category 事实。
- `commitSnapshot` 一次事务完成稳定 `SourceObject` upsert、不可变 `SourceSnapshot` 插入和关系插入。输入带 `idempotencyKey`；同一 run 重试同一 key 返回原 snapshot，不产生重复记录。相同对象的新观察必须使用新 key 并追加 snapshot，永不覆盖历史。
- `commitAsset` 只把与 snapshot 中 `assetKey` 对应且通过媒体/字节限制的内容写入 CAS；相同 bytes 由内容地址去重，但对象关系和来源 URL 仍各自保留。Cookie、Header、Profile、个人标识和未授权整页没有字段入口。
- `finishRun` 只关闭来源产物运行并写入统计/终止原因；DBOS 仍独占尝试、队列、取消和恢复事实。运行即使 `failed/stopped`，此前提交的 snapshots 仍可读、可导出。
- `exportRun` 首轮支持 JSONL；对 `ordered_record`、`catalog` 和 `experience_collection` 的可表格投影支持 CSV。CSV 单元格开头为 `= + - @` 时按导出安全策略转义，避免本地表格打开时执行公式。

#### 稳定 envelope 与 content kind 候选

公共结构只表达所有商品品类都需要的来源事实，不出现冰箱、京东、压缩机、SKU、价格等固定字段：

- `SourceCollectionRun`：项目/品类/范围/搜集板版本、lane、provider、访问政策快照、状态、开始/结束、统计和终止原因；
- `SourceObject`：`sourceIdentity + objectKind + externalKey` 稳定识别外部分类、机构、目录项、商品、文档、监管记录、报价或体验记录；具体外部 ID 只是数据；
- `SourceSnapshot`：URL、时间、typed 页面状态、内容 kind、canonical hash、解析版本、许可判定和对象关系；
- `SourceAsset`：snapshot/assetKey、来源 URL、媒体类型、尺寸、用途、区块/顺序、内容 hash、CAS integrity 和隐私级别；
- `SourceRelation`：只接受 `contains / describes / variant_of / offered_by / reviews / published_by / supersedes / references` 等来源可观察关系，并带 relationship proof；知识层的“型号采用某机制”不在这里生成。

首轮 discriminated `content.kind`：

1. `ordered_record`：有序 field group、允许重复原始字段名、文本/表格/asset reference block；覆盖官网商品页、监管记录、店铺/机构、Offer 等结构化来源；
2. `document`：标题、出版者、文档标识/版本/状态和有序章节 block；覆盖说明书、标准、政府技术资料、论文；
3. `catalog`：原始分类路径、筛选维度/选项/顺序和指向 SourceObject 的 entry relation；覆盖官网目录和销售平台分类，不把筛选词自动升级成品类属性；
4. `experience_collection`：公开汇总指标、采样计划、评分档、排序/页码和去个人化样本；只表达体验来源，不表达因果或技术事实。

字段和 block 都是 Zod strict object；来源原始名称和值作为有长度限制的字符串/数值进入有序数组，不允许任意 `metadata`。规范化属性、Market Universe、知识候选和 EvidenceItem 均从 snapshot 显式投影，不能回写原始内容。

R-030 所需来源 authority 只增加当前真实消费者需要的类别：`standards_body / government_research / intergovernmental_technical / primary_research / professional_association / component_official_technical`。同时新增独立的 `claimScope` 与 `usagePermission`；“权威”不再隐含“允许输入模型”或“可以发布”。用户已明确技术 interface、数据结构、依赖和测试策略由工程负责；本 seam 因此按调研证据和跨品类不变量冻结，不再把技术责任转交用户。

#### 第一条 TDD 纵切片与验收

测试 seam 就是上面的 `SourceDatasetModule` 公共 interface，不测试私有 SQL helper。确认后先写 PostgreSQL integration 红灯，再写最小实现：

1. 用完全相同的方法分别为 `household_refrigerator` 与 `television` confirmed project 创建运行并提交 `ordered_record`；不修改 schema、不增加品类分支；
2. 证明有序字段保留重复名和区块顺序，同一 idempotency key 不重复，不同观察追加不可变 snapshot；
3. 模拟中断并重新打开 Workbench，已提交内容和恢复点仍存在；失败运行仍可查看/导出；
4. JSONL 逐行可由共享 Schema 重读；CSV 正确处理逗号、双引号、换行和公式前缀；
5. 相同 asset bytes 复用 CAS content address，但两个来源关系不合并；
6. API 与 PC 最后只读取该 module；PC 同屏显示运行状态、已提交/失败/unknown、原始有序字段和导出入口；
7. 本切片不访问京东或真实官网，不增加模型调用，不改 Market Universe 投影。

验证结果：共享 Schema、四张 PostgreSQL/Drizzle 表与迁移、Workbench module、CAS 附件关系、JSONL/CSV、只读 API 和 PC 已接线。冰箱＋电视使用同一 seam；失败重启、幂等冲突/追加、失败计数、相同字节不同关系、导出重读均在干净临时 PostgreSQL 通过。PC 本地真实表面已显示冰箱与电视记录、原始有序字段、用途范围、许可、导出入口，以及电视 `rate_limited / HTTP 429` typed 失败。全仓 172 项通过、1 项真实模型 acceptance 按设计跳过，六 workspace typecheck 与 production build 通过。ADR-0014 记录公共决定；真实官网/监管/权威技术来源矩阵、Linux/Windows 和跨机器门仍未通过。

### R-032 来源访问限速、取消与熔断

状态：真实 60 秒窗口、DBOS 强杀恢复与生产组合已接受；第 9.1 京东 reader/探针未通过
目标阶段：阶段 1A / `JD-COLLECTION-DESIGN.md` 9.1 频控硬门

问题：Crawlee `maxConcurrency: 1` 只能限制同时执行数，不能单独证明一分钟滑动窗口、同域最小间隔、批次冷却、最长运行、取消和首次受限后的全来源熔断。手写队列、超时、取消或 circuit breaker 违反工程基准。

候选与官方资料：

- `p-queue` 9.3.3：MIT、原生 ESM、内建 TypeScript、Node >=20；官方支持 `concurrency`、`intervalCap + interval + strict` 滑动窗口、per-task `AbortSignal`、timeout、`pause/onPendingZero/onIdle` 和 backpressure。它只承担当前进程内访问调度，不冒充持久任务事实源：https://github.com/sindresorhus/p-queue
- Cockatiel 4.0.0：MIT、原生 ESM、Node >=22、零运行依赖、内建 TypeScript；官方提供 `circuitBreaker`、`ConsecutiveBreaker`、`isolate`、状态序列化和 AbortSignal。配置一次失败打开 circuit；本轮 gate 一旦打开即终止，只有新建恢复运行才能继续，不使用自动 retry：https://github.com/connor4312/cockatiel
- Crawlee `BasicCrawler.maxRequestsPerMinute` 仍保留为 crawler 自身护栏，但不承担同域抖动、批次冷却或跨调用熔断；来源适配继续复用 Crawlee，不自建 crawler：https://crawlee.dev/js/api/3.8/basic-crawler/interface/BasicCrawlerOptions
- DBOS TypeScript workflow 官方文档明确 workflow 会在进程重启后从 durable state 恢复，`DBOS.sleep(durationMS)` 是不占用进程的持久等待；本轮用它保存跨进程频控等待：https://docs.dbos.dev/typescript/tutorials/workflow-tutorial 、https://docs.dbos.dev/typescript/reference/methods
- 持久工作项、尝试、取消和恢复继续由已接受的 DBOS 承担；`SourceDatasetModule` 只持久化来源运行、政策快照和逐条产物。不能把 `p-queue` 的内存队列描述为恢复事实源。

最小原型边界：只启动本机随机端口 HTTP fixture，不访问京东或任何外部来源。测试真实请求时间戳、严格窗口、最小间隔、抖动边界、批次冷却、最大运行、AbortSignal 取消、429/验证类错误第一次即熔断、队列 idle 后零新增请求；随后把同一 gate 薄接到注入式 JD `pageReader`，生产 bootstrap 没有 reader 时仍失败关闭。

本地验证结果：`PacedAccessGate` 已使用 `p-queue` 严格窗口、单并发、同域“前次完成到下次开始”间隔、抖动与批次冷却；Cockatiel 首次 typed 受限即打开 circuit，不自动重试。随机端口 HTTP fixture 验证实际服务端时间戳、取消/最长运行 AbortSignal、429 后零继续派发、队列 idle 后零残留；该 gate 已薄接注入式 JD `pageReader`，没有生产 reader 或没有显式 `paced_http` policy 时失败关闭。除缩放窗口回归外，显式 acceptance 以真实 60,000ms 窗口、每分钟上限 2 连续派发 3 个请求，实际运行 `60.029s` 通过，第三个服务端时间戳与第一个相隔至少 60 秒。

`SourceCollectionPipelineModule` 使用稳定父/子 workflow ID、DBOS Queue 单并发、Provider 访问 step 不自动重试、逐条 `SourceDatasetModule.commitSnapshot` 幂等落库和 `DBOS.sleep` 持久等待。集成测试覆盖正常完成、typed 停止、取消；进程恢复验收在第一条快照已提交后对 Worker 执行 `SIGKILL`，新进程恢复后访问日志严格为 `item-A / item-B / item-C` 各一次，三条快照完成且 3 秒同域等待仍成立。DBOS 只拥有执行，来源事实仍只在 Workbench PostgreSQL。

生产组合结果：`ProductKnowledgePipelineRuntime` 在一次 DBOS launch 前同时注册监管与 Source Collection 父/子 workflow，两个单并发 Queue 在同一临时 PostgreSQL runtime 中同时执行成功；生产 API 已改用该组合根，真实进程 `/health` 与项目列表均返回 200。Source Dataset HTTP 继续只读；曾尝试让客户端提交 work item 的写接口因会把 UI 变成采集计划/许可事实源而在本轮审计中删除，后续只能由服务端 Planner 从 confirmed brief/board 生成并启动。新 `JdSourceCollectionProvider` 不含冰箱判断，同一 adapter fixture 已分别保存电视与冰箱详情；目录保留顺序、自营标记和对象引用。生产未注入已验证 `JdPageReader` 时只提交 typed `source_abnormal` 并停止，不访问京东。旧 Market Universe 京东枚举仍是冰箱专用兼容路径，不能作为跨品类完成证据。

剩余接受门：先完成真实 JD reader 的 R-012 验收并注入上述通用 Provider，再只允许 1 个目录＋3 个详情的真实验收探针；连续三个相互冷却窗口无受限才形成候选区间。旧冰箱专用 Market Universe 兼容路径还必须退出生产主流程。完成前第 9.1 节整体保持未通过，禁止京东数据抓取。

### R-034 电视第二品类真实纵切片与 Socrata 开放数据

状态：最小迁移门已接受；目标 Linux、动态页、图片和 JD 真实门不在本结论内
目标阶段：M3～M7 / ROADMAP 1A～1D 最小真实纵切片

问题：必须用非冰箱品类证明同一系统能取得底层知识、品类知识和真实型号，经过最小 Evidence、模型候选、人工审核、知识包与离线 Runtime；不能只换测试字符串，也不能为第二品类新增公共 Schema/流程分支。

来源与许可：

- DOE 电视定义页、节能采购指导和显示架构报告用于电视边界、LCD/OLED 结构与生命周期成本规则。DOE Web Policy 说明联邦政府材料通常为 public domain，但站点也可能含第三方材料；因此当前允许本地读取、模型输入、最小证据和派生知识，原文再分发保持 unknown，知识包只携带 locator：https://www.energy.gov/web-policies
- EPA ENERGY STAR Model Index 的 Socrata 数据集 `8wj2-sec8` 用 `pd_id=2399940` 精确取得 Sansui `LE-32T1`。EPA Data License 说明 EPA 生产的数据默认 public domain，因此该最小记录允许进入公开证据包：https://data.energystar.gov/Active-Specifications/ENERGY-STAR-Model-Index/8wj2-sec8 、https://edg.epa.gov/EPA_Data_License.html

Socrata 候选与边界：

- 复用 Socrata 官方 SODA `/resource/{dataset-id}.json` 查询协议，而不是抓页面表格；官方 endpoint/filter 文档：https://dev.socrata.com/docs/endpoints 、https://dev.socrata.com/docs/filtering.html
- 不引入 Socrata SDK、远程服务或新基础设施。已有 Crawlee HttpCrawler 负责 HTTPS、超时、取消和 JSON 响应，Zod 负责 scalar record；薄 adapter 只允许 allowlisted origin/dataset、一个合法字段的相等查询、`$limit=1`、最多一条记录、字节/字段上限和返回 identity 对照。
- 纯 Node/TypeScript，无新增原生依赖；Source Dataset 保存后可离线重放，Runtime 不访问 Socrata。退出该来源只需删除 planning rule/provider 注入，不改变 Evidence、Factory 或 Runtime contract。

真实结果：Category Interview → confirmed brief → Project → Planner → DBOS → DOE/EPA Provider → Source Dataset 保存 4 条真实记录；Evidence 形成 4 条最小证据。固定 `gpt-5.3-codex-spark + low` 加一条确定性型号转换产出 22 条候选、0 冲突、0 未知，包含 3 条品类到 foundational concept 的关系；人工接受后构建 22 状态/4 证据的 SQLite 包。相同内容重建版本哈希一致，复制单文件后精确、全文、关系和证据查询通过。PC Workbench 又从 DOE 长正文人工选择并提交一条 349-byte TextQuote，证据/审核/激活包页面均可见。

结论：第二品类最小迁移门通过；新增内容只有版本化电视数据、DOE/EPA planning rule 和隔离外部协议的 Socrata adapter。公共数据库结构、Knowledge Factory/Review/Package/Runtime interface 与流程无电视/冰箱分支。该结论不等于 1A 完整矩阵完成，不授权 JD 访问，也不证明 Linux/Windows 或图片/动态页。

## 6. 依赖与安全持续门

### R-035 Crawl Planning Agent 与后台运行边界

状态：已接受；真实 Workbench 规划表面已通过，计划内容仍待用户确认
目标阶段：1B

问题：Capture Task 确认后需要把业务范围转成直接决定来源、内容和数量的 Crawl Plan。规划过程需要网页搜索、可见进度、结构化结果和中断，但不能把 Codex thread、搜索文本或浏览器状态变成计划事实，也不能为了最多三分钟的单轮任务自研后台队列。

不可取消约束：用户显式启动；Planning Run 不批量抓取；计划必须绑定当前 task revision；只有 Workbench 可以版本化和确认计划；确认不创建 Source Run；正式抓取不得边运行边调用 Codex 无边界搜站。

候选与官方资料：

- 现有 Codex App Server `stdio`：官方把它定位为富客户端集成 interface，提供连接级 `initialize`、可重复的 `thread/start`、`turn/start`、`item/agentMessage/delta`、tool progress、`turn/completed`、`turn/interrupt` 和显式 skill input；当前仓库已经锁版本并验证“一条 runtime 连接、每次运行一个新 ephemeral thread”。接受复用。官方同时说明 App Server command/远程 WebSocket 仍属 experimental，因此继续使用本机锁版本薄 adapter，不扩大到远程服务：https://learn.chatgpt.com/docs/app-server
- Codex SDK：官方建议自动化 jobs/CI 使用 SDK，但当前生产产品需要显式 skill item、已验证网页搜索活动和同屏 commentary；为同一模型再接第二 transport 会增加协议与测试面，当前拒绝。
- DBOS TypeScript：MIT、Node >=20、活跃维护，官方提供 PostgreSQL durable workflow/queue 和崩溃恢复，适合真正的长任务后台执行：https://docs.dbos.dev/typescript/tutorials/workflow-tutorial 、https://github.com/dbos-inc/dbos-transact-ts 。当前规划只有单次三分钟上限，断连可安全重试且没有外部写副作用；重新引入 workflow/runtime/schema 的成本大于收益，暂缓而非否定其成熟度。
- 手写内存 Promise registry/queue：拒绝。进程重启无恢复、需要自行处理取消和孤儿任务，且重复已有成熟工作流能力。

许可证与维护状态：本轮不新增依赖；继续使用仓库已锁定和接受的 OpenAI Codex、PostgreSQL、Drizzle、Fastify、Zod 与 canonicalize。DBOS 仅作为被暂缓候选，不进入 package/lockfile。

Node/TypeScript、本地/离线和部署边界：纯 Node 24/TypeScript；App Server 与 PostgreSQL 均在本机，只有规划时的公开网页搜索需要网络。Skill 复制到隔离临时 cwd，关闭 shell/unified exec；Cookie、Profile、认证 Header 和验证码材料没有输入字段。

安全、测试、升级与退出：Planning Module 只依赖注入式 runtime interface；移除 Codex adapter 不改变 plan/domain contract。测试用确定性 runtime adapter覆盖状态、版本、topic 覆盖和计划确认；真实验收只做搜索/规划，不做批量来源访问。

最小原型与真实样本：不新建 POC package。直接在正式 Module seam 先写 contract/数据库/API/Web 测试，再运行一个真实标准商品 Planning Run；未通过前不注册 Provider 或开始 Source Run。

真实结果：在正式“家用冰箱抓取任务”上完成两个前台 Planning Run。v2 沿用并重新核实京东冰箱频道、国家标准全文阅读和美的官方说明书三类来源，明确目录/详情全量、每 SKU 30 条评价样本、相关标准题录全量和 20 份说明书样本，并逐项给出分母、遍历、停止条件和执行阻塞。v1 保留为 superseded，v2 保持 draft，刷新后仍可审查；所有来源只由 Workbench 记为 `search_discovered / unknown`，发现时间等于 v2 完成时间。Source Run 数量为 0，证明规划没有越权执行。全量 40 tests passed / 1 skipped，六 workspace typecheck 和生产构建通过。

结论与确认：复用现有 App Server seam，新建一个 CrawlPlanningModule 和一个专用短 Skill；该 runtime 在生命周期内复用一条已初始化连接，每次 Planning Run 新建 ephemeral thread，采用前台可见、断连中止、完成结果持久化的最小流程。若真实使用证明跨页面持续是必要需求，再以 DBOS 等成熟工作流重新进入调研/原型门。

### R-007 依赖复现与安全升级

状态：持续维护

- 新依赖先查官方文档/仓库、许可证、维护状态、Node/TS、local/offline、部署/原生依赖、安全、测试、升级与退出；再做隔离 POC。
- 修改 `package.json` 必须更新 lockfile，并验证当前 macOS 与目标 Linux install/typecheck/test/build；Windows 若仍为产品目标再补。
- 不扫描 `node_modules`；依赖信息只读 `package.json`、lockfile、包管理器摘要和官方资料。
- `npm audit fix/force`、Node 升级、依赖大版本升级和新服务都不是顺手操作，必须独立归因和授权。

## 7. 新调研条目模板

```text
### R-XXX 标题
状态：待调研 | 调研中 | 待确认 | 已接受 | 已拒绝 | 已替代
目标阶段：

问题：
不可取消约束：
候选与官方资料：
许可证与维护状态：
Node/TypeScript、本地/离线和部署边界：
安全、测试、升级与退出：
最小原型与真实样本：
验证结果：
结论与确认：
```
