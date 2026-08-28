# 技术调研登记

状态：ZOL 单来源方案已确认
更新日期：2026-08-28

## R-001 ZOL 门类品牌与型号采集

### 调研问题

验证 ZOL 是否能够支持“门类全部品牌发现、品牌优先级、品牌型号分页、型号参数配置、受控多品牌调度”这一完整链路。

### 页面证据

| 证据 | 结论 |
| --- | --- |
| [ZOL 产品分类](https://detail.zol.com.cn/subcategory.html) | 家电门类存在独立稳定入口，冰箱与相邻门类可区分 |
| [ZOL 冰箱门类](https://detail.zol.com.cn/icebox/) | 一页公开品牌入口、品牌产品数量、型号列表与分页 |
| [ZOL 冰箱品牌榜](https://top.zol.com.cn/compositor/359/manu_attention.html) | 提供品牌排名、关注占比、综合评分和产品数量，可用于抓取优先级 |
| [ZOL 海尔冰箱目录](https://detail.zol.com.cn/icebox/haier/) | 品牌页公开当前型号、产品链接、分页和数量 |
| [ZOL 型号参数页](https://detail.zol.com.cn/2115/2114771/param.shtml) | 完整参数按基本参数、技术参数、功能特点、其他和附件组织 |

结论：链路在公开 HTML 上成立，不需要浏览器自动化才能完成第一轮验证。

### 品牌优先级候选

| 方案 | 处置 | 原因 |
| --- | --- | --- |
| 模型根据品牌印象主观挑选 | 不采用 | 无法重算，不能解释小品牌为何降级 |
| 只按 ZOL 产品数量排序 | 不单独采用 | 历史型号多不等于当前市场关注高 |
| ZOL 关注占比累计约 80%，再核验活跃产品线 | 采用 | 来源直接、规则简单、可重算，同时排除失活或身份歧义品牌 |

### 抓取与控频候选

| 证据 | 结论 |
| --- | --- |
| [Crawlee BasicCrawlerOptions](https://crawlee.dev/js/api/3.16/basic-crawler/interface/BasicCrawlerOptions) | 官方支持 `maxConcurrency`、`maxRequestsPerMinute`、`sameDomainDelaySecs`、robots 和总请求上限 |
| [Scrapy AutoThrottle](https://docs.scrapy.org/en/latest/topics/autothrottle.html) | 成熟爬虫按域划分下载槽，并把并发与延迟同时纳入控频；错误响应不能用来提高速度 |
| [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) | 自动客户端应读取并遵守 robots 规则；robots 不是访问授权 |

采用结论：品牌任务可以并行排队，但同一 ZOL origin 共享一个持久访问门。初始验证沿用已证明可访问的每分钟 2 次、最小间隔 30 秒；任何放量都作为独立验证，不自动调整。

### 复用资产

当前仓库已经锁定并使用：

- Crawlee 3.18.1：持久 RequestQueue、去重和抓取生命周期；
- `p-queue`：进程内任务排队；
- Cockatiel：熔断；
- `robots-parser`：robots 解析；
- Playwright `APIRequestContext`：显式 HTTP 访问；
- PostgreSQL Source Access Gate：跨进程频率、预算和熔断事实；
- Source Dataset：不可变原始响应、请求记录和采集血缘。

本方案不新增依赖、运行服务或语言栈。Node/TypeScript、本地 PostgreSQL 和现有测试工具保持不变。ZOL 页面规则封装在 source adapter 内，退出时可替换该 adapter，不改变共享 Capture Task 或 Source Dataset contract。

### 安全与部署边界

- 只访问计划确认的公开 ZOL 页面；
- 不使用 Cookie、登录账号、代理轮换或验证码绕过；
- 不跟随到电商、论坛或其他计划外 origin；
- 开发验证仅保存所需 HTML，不下载图片；
- 403、429、登录或验证立即熔断并等待人工决定；
- 保持本地运行，不新增外部队列或云服务。

### 原型门

1. V0：7 个页面验证单品牌纵向链路。
2. V1：6 个请求验证双品牌交错调度和共享访问门。
3. V2：V1 通过后才允许设计小规模放量验证。

V0/V1 的真实 Source Dataset、请求时间线和页面内容是选型证据；单元测试或 HTTP 200 不能替代。
