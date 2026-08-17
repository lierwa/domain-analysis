# R-001 阶段 1A 有界真实样本清单

状态：历史 POC；阶段 1A 通过结论已于 2026-08-15 撤销
调查日期：2026-08-14

> 本文件保留当时的样本、访问状态和失败证据。整页 HTML/截图/资源清单保存、受限快照白名单 projector 和“阶段 1A 通过”均已由 R-026/ADR-0011 取代，不得继续作为生产 contract。可复用的只有来源访问、状态识别、文件读取、哈希和中断恢复等局部组件证据。

## 1. 目的

用尽可能少的真实官方页面验证浏览器、队列、原始资料、敏感数据隔离和异常分类。它不是全量冰箱目录，也不是正式采集配置。京东按 ADR-0004 执行用户已确认的教育研究网页采集；淘宝不在本 POC 中，待京东闭环后沿同一 Provider contract 单独调研。

页面状态会变化。以下“调查时观察”只用于选择样本；浏览器原型必须按实际访问重新记录状态，不能为了保持预期而更换页面或伪造成功。

## 2. 来源核验依据

- 京东帮助中心说明商品页标注“自营”即为京东销售商品：https://help.jd.com/user/issue/44-75.html
- 京东冰箱自营入口在调查时展示自营标识、品牌和型号：https://www.jd.com/brand/737bcac238ba1cc2973.html
- 京东 2026-01-20 生效的用户协议调研作为风险依据保留：https://help.jd.com/user/issue/945-4583.html
- R-012 已对比官方 API 与 Patchright、fingerprint-suite、rebrowser、Camoufox 等开源候选；用户明确不走官方 API，当前选择与既有 Crawlee/Playwright 边界改动最小的 Patchright。
- 美的样本位于品牌官方域名，页面展示“美的集团官方商城”、产品型号、规格、库存和说明书。
- 海尔样本位于品牌官方域名，页面展示型号、规格、功能说明、图片和官方说明书。
- 本轮不纳入普通第三方商家，也不纳入尚未取得品牌反链或资质证据的“官方旗舰店”。
- 海尔 `robots.txt` 明确声明中国站 sitemap，根 sitemap 再公开指向产品 sitemap：https://www.haier.com/robots.txt 、https://www.haier.com/cn/sitemap.xml
- Crawlee 官方 `SitemapRequestList` 直接处理 sitemap、嵌套 sitemap、过滤和去重；`FileDownload` 直接处理流式文件下载，不自写 XML 解析器或下载器：https://crawlee.dev/js/api/core/class/SitemapRequestList 、https://crawlee.dev/js/docs/3.13/examples/file-download-stream
- `file-type` 用文件签名校验实际内容，避免相信扩展名或服务器 MIME；当前精确锁定 22.0.1：https://github.com/sindresorhus/file-type

## 3. 真实页面样本

| ID | 页面与来源 | 调查时观察 | 选择理由 | 浏览器必须保存 |
| --- | --- | --- | --- | --- |
| S01 | 京东自营美的 BCD-182M：https://item.jd.com/100133046493.html | 商品标题和“美的京东自营旗舰店”可见；匿名状态提示登录后查看更多图片 | 正常自营详情和匿名受限内容基线 | 最终 URL、状态分类、HTML、截图、标题、型号、自营证据、资源清单、可见图片和响应摘要 |
| S02 | 美的官方 MR-457WUSPZE 流苏白：https://www.midea.cn/1/1000000000400692547080.html | 官方页面展示流苏白、型号、规格、库存和 PDF 说明书入口 | 与 S03 组成同型号不同颜色，验证型号与销售规格不能混为一层 | HTML、截图、图片、规格区、颜色、型号、库存时点、说明书链接和下载结果 |
| S03 | 美的官方 MR-457WUSPZE 苍穹灰：https://www.midea.cn/1/1000000000400692547081.html | 官方页面展示苍穹灰；型号和主要规格与 S02 相同 | 验证同型号多规格合并，不把颜色或页面当成新型号 | 与 S02 相同，并记录两页相同项和差异项 |
| S04 | 海尔官方 BCD-502WGHFDC9JWU1：https://www.haier.com/cooling/20260104_284765.shtml | 页面展示型号、规格、功能、测试条件、图片和 H5 说明书 | 验证文字、结构化规格、图片、功能解释和说明书多种证据载体 | HTML、截图、图片、规格、功能及限制说明、说明书入口和资源清单 |
| S05 | 京东自营美的 MR-531WSPZE：https://item.jd.com/100062957294.html | 调查访问被重定向到京东风险验证页面 | 验证挑战识别和停止行为，禁止绕过 | 原始 URL、跳转链、最终 URL、挑战分类和不含认证材料的截图；不得标记商品采集成功 |
| S06 | 京东自营海尔 BCD-505WGHTD14S8U1：https://item.jd.com/100044587428.html | 调查结果显示“海尔京东自营旗舰店”和“该商品已下柜” | 验证下架不是网络错误，也不能被记录为在售 | 最终 URL、HTML、截图、店铺/自营证据、型号和下柜状态；缺失资源必须明确记录 |

## 4. 执行场景

| 场景 | 使用样本 | 要验证的事实 | 通过条件 |
| --- | --- | --- | --- |
| E01 匿名正常访问 | S01、S02、S04 | 未登录时能看到什么，哪些资源被限制 | 可见内容完整保存；受限内容明确标记，不伪造为空或成功 |
| E02 人工登录接管 | S01 | 专用浏览器由用户登录后能否继续原任务 | 不读取密码；登录后恢复同一任务；Profile/Cookie 不进入产物 |
| E03 登录缺失或过期 | S01 | 新专用 Profile 或自然过期后能否识别并等待人工 | 状态为等待用户，不反复重试、不破坏用户日常浏览器登录 |
| E04 同型号多规格 | S02、S03 | 两个页面是否归到同一型号，并保留颜色差异 | 型号身份相同，销售规格和页面证据分别保留 |
| E05 多种证据载体 | S02、S04 | HTML、图片、规格和说明书能否共同留证 | 资源有清单、哈希和来源位置；下载失败可解释 |
| E06 风险验证 | S05 | 风险页是否被识别为人工事项 | 成熟 Patchright 能力正常使用；验证码不自动解，风险页不当商品页 |
| E07 下架 | S06 | 下架是否与失败、缺货和在售分开 | 保留可见证据并明确分类为下架 |
| E08 中断恢复 | E01～E07 | 进程中止后能否从未完成任务继续 | 已提交快照不覆盖；未完成任务可恢复；同一尝试不重复提交 |

## 5. 覆盖说明

这 6 个页面、8 个执行场景已覆盖当前 contract 要求的两类官方来源、正常/受限/挑战/下架状态、单页/同型号多规格身份、文字/结构化规格/图片/说明书载体，以及匿名/人工登录访问。

R-008 的组合覆盖结果证明成熟工具可以生成 pairwise 场景，但页面状态和登录状态会在真实访问时变化。本轮先用上述最小真实集合验证因素是否可观察；首轮结果稳定后，才把真实观察值交给现成组合工具扩展场景，不手写组合算法，也不把理论组合强行映射成虚假页面。

## 6. 立即停止条件

- 页面不再能证明官方来源，且找不到同一来源的可复核证据；
- 需要自研反检测、自动验证码、账号切换或未公开接口；
- Cookie、认证 Header、浏览器 Profile 或个人信息将逃出受限原始区，或进入 Codex/知识包；
- HTML、图片、说明书等资源无法以不可变方式保存和定位；
- Patchright＋Crawlee 在受控单请求下仍稳定失败，且无更合适的成熟开源方案可证明。

触发停止条件时保留失败记录并回到调研，不临时换页面掩盖问题。

## 7. 隔离运行环境

- 固定 `Node 22.22.3 + Crawlee 3.18.1 + Patchright 1.61.1 + Playwright 1.62.1`，复用本机 Chrome 程序；Patchright 通过 Crawlee 已有 `launchContext.launcher` 注入，不改造队列和 crawler。
- 依赖只安装在本目录，不再为每个原型下载 Chromium；不修改根 `package.json`、根 lockfile、生产 workspace 或现有 Node 21 运行基线。
- `capture-source.mjs` 只负责把 Crawlee/Patchright 的真实页面、截图、资源清单、主响应和哈希写入被 Git 忽略的 `data/pocs/r001`；JD 写入单独 `restricted-attempts-patchright`，队列关闭启动清空并固定并发 1、零重试。
- 首次运行可设置 `R001_MAX_REQUESTS=2`，随后不设置再次运行，用于验证未完成任务能从同一成熟 RequestQueue 继续；已完成任务不会被重复接受。
- 人工登录和采集复用同一个京东专用 Profile；项目不读密码、Cookie 或 Header，也不复用用户日常 Chrome Profile。
- Crawlee 3.16 曾经由 `file-type 20.5.0` 带入中危拒绝服务公告，并在恢复测试中出现限额后锁定请求、浏览器退出计时器拖住进程等问题。官方 3.17/3.18 发布记录包含对应修复；本隔离目录升级到 3.18.1 后 `npm audit` 为 0，根项目版本仍未改动。

首次两页运行曾使用原型目录内的 Playwright 配套 Chromium；用户指出长期重复下载没有必要后，已按 Playwright 和 Crawlee 官方支持改为复用本机 Chrome 151。只复用浏览器程序，不复用用户日常 Profile；项目专用 Profile 仍位于被 Git 忽略的数据目录。

匿名首轮实际观察：S02/S03 美的和 S04 海尔官网正常；S01/S05 进入京东验证；S06 进入京东登录，匿名状态无法证明调查时的下柜结论。S06 的 v1 原始资料保存正确但被初始规则误标为 `loaded`；后续代码增加 `login_required` 分类并使用新请求 key，旧快照没有改写。

实际重跑时 S06 又从登录页变为京东验证，v2 因此正确记录为 `challenge`，说明页面状态不可预设。HTML 和截图文件重新计算的 SHA-256 与 metadata 全部一致；7 个请求记录均已完成且 `retryCount=0`。

## 8. Patchright 当前实测结果

- 离线同条件空白页对照：Playwright 报告 `navigator.webdriver=true`，Patchright 为 `false`；两者均使用有界面的本机 Chrome，均不含 `HeadlessChrome`。
- 同一已登录专用 Profile 下，历史 Playwright 诊断得到 `risk_controlled`；Patchright 诊断到达 S01 真实商品页，HTTP 200，型号文本存在。这是实测差异，不猜测京东完整判定规则。
- 第一次 Patchright 完整采集只保存了页面骨架，没有当作通过。加入型号就绪门和 Crawlee `infiniteScroll` 后，S01 的真实标题、型号、总容积、冷藏/冷冻容积、制冷和能效等文本已进入 HTML，原始文件哈希复核一致。
- 新建匿名 Profile 到达普通京东登录页，不是风险页。当前因此复用用户已登录专用 Profile；所有 JD 新产物标记 `privacyClass=restricted` 并写入受限目录，脱敏前不进入知识管道。
- S05 当次正常加载，S06 当次正确分类为 `discontinued`；两者均是 HTTP 200 且型号存在。两次产物哈希与 metadata 逐项一致，受限目录和 Profile 均被 Git 忽略。样本 URL 不固定代表某种状态，每次必须以页面证据分类。
- `project-restricted-snapshot.mjs` 只从 `.sku-title-name`、`.product-desc`、`.highlight-attrs` 和 `#spec-n1 .attribute` 投影允许商品字段，Zod 严格拒绝未知结构，并对已知账户/地址容器失败关闭。S05/S06 分别得到 34/26 个属性，输出标记 `privacyClass=sanitized`。
- Node 官方测试已覆盖投影不包含受限容器时通过、故意泄漏地址容器文本时失败关闭，2/2 通过。当前 package scripts 已提供 `login:jd`、`diagnose:jd`、`capture:jd`、`capture:public`、`project:jd`、`test:projection` 和离线对照入口。
- 中断恢复用公开页面实测：首次以 `R001_MAX_REQUESTS=1` 只完成 S02 并正常退出；同一持久队列重启后只补抓 S04、S03，累计恰好 3 条、当次结果恰好 2 条并正常退出。统计使用 Crawlee 官方 `statisticsOptions.id` 与队列版本对齐，不自建恢复状态。

## 9. 官方目录、说明书与监管资料实测

- 海尔官方 `product.xml` 由 `SitemapRequestList` 完整加载；按 `/cooling/YYYYMMDD_ID.shtml` 过滤得到 1,341 个唯一冰箱产品 URL，已知样本 S04 在集合中。不可变目录快照为 `catalog-attempts/2026-08-14T09-45-05.236Z/catalog.json`，SHA-256 为 `fef40b76b00fffb9e6647100c99a91bd3daf902fcfb5a00bdc471e5995b4304d`。这证明官方目录可发现，不把 1,341 当作当前在售量或市场销量。
- 美的官方 S03 反链的 MR-457WUSPZE PDF 说明书用 Crawlee `FileDownload` 保存；HTTP 200、1,154,097 bytes、签名识别为 PDF，SHA-256 为 `bd173c352c759dea6a4128dcc4dda079b1a8102dec7a01f40f96846036ca2478`。Poppler 渲染检查 16 页正常，第 5 页可定位型号与尺寸/安装图。
- 中国标准化研究院公告的冰箱能效备案附件用同一路径保存；HTTP 200、2,301,639 bytes，服务器错误声明 `text/plain`，`file-type` 根据签名识别为 RAR，SHA-256 为 `d493ec919949a655c8d9dae9d0319ebaa5eacd257cfa2cf97dcefa618ac97f11`。系统 `bsdtar` 列出 13 个 XLSX；2024 年 12 月工作簿为 516 条数据、7 列，包含生产者、型号、备案号和能效等级。
- 两个成功文件位于 `file-attempts/2026-08-14T09-34-33.105Z/`。一次 Crawlee response API 用法错误和一次 RAR MIME 别名不符均保留为失败尝试，没有覆盖或伪装成成功；最终文件的独立 `shasum -a 256` 与 metadata 一致。
- 所有原始文件、目录快照、浏览器 Profile 和登录态资料均位于 Git 忽略区；代码、来源定义、通过门和哈希可提交，原始资料不借 Git 扩散。

## 10. 历史阶段 1A 通过矩阵（已撤销）

| 通过门 | 证据 | 结论 |
| --- | --- | --- |
| 官方候选可发现 | 海尔 sitemap 1,341 个唯一 URL，S04 可回链 | 通过；完整多品牌总体留到阶段 3 |
| 代表性官方资料不可变保存 | 品牌 HTML/截图/资源、PDF 说明书、监管 RAR/XLSX 均有来源、时点和哈希 | 通过 |
| 页面与商品状态不混淆 | 正常、匿名受限、登录、风险、下架按当次证据分类；HTTP 200 不直接等于成功 | 通过 |
| 型号、变体和来源对象可分离 | S02/S03 同型号不同颜色；页面、说明书和监管附件分别留证 | 通过 |
| 登录态敏感数据不进入加工 | JD 原始页为 `restricted`，Cheerio 白名单＋Zod 只输出 `sanitized` 商品字段，泄漏测试失败关闭 | 通过 |
| 失败和恢复可解释 | 零重试；公开队列重启只补未完成项；下载失败尝试保留 | 通过 |

该矩阵只能说明当时的整页快照方案做过哪些实验。当前必须按 `ROADMAP.md` 重新验证三品类/多站点 EvidenceRequest/EvidenceItem、最小证据、图片关系和临时资料清理后，才能重新判断 1A。
