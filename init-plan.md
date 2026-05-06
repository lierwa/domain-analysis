PRD：低成本 Social Intelligence Dashboard

1. 产品定位

本系统是一个面向垂直行业、品牌、内容团队的 低成本社媒趋势分析与内容洞察平台。

系统通过配置关键词、主题、竞品、账号和数据源，自动采集公开网络内容，并完成清洗、归类、分析、聚合和报告生成。

产品不定位为“爬虫工具”，而定位为：

一个轻量级的 Social Listening / Social Intelligence 平台。

核心输出不是原始帖子，而是：

趋势洞察
话题变化
用户需求
内容机会
竞品声量
高价值内容样本
可执行选题
周期性报告

⸻

2. 对标产品与能力抽象

本系统对标的不是 Apify，而是以下类型的平台：

Brandwatch
Meltwater
Talkwalker
Sprout Social Listening
Mention
Awario
Brand24

这些平台的共性能力可以抽象为 6 个模块：

能力	专业平台常见表现	本系统实现目标
Query / Topic Setup	关键词、品牌词、竞品词、布尔查询	主题项目 + 关键词组 + 排除词
Data Collection	社媒、新闻、论坛、博客多源采集	Crawlee 自研采集 + 可扩展数据源
Monitoring Dashboard	声量、趋势、情绪、来源分布	主题仪表盘
Content Intelligence	热门内容、情绪、话题聚类	AI 标签、聚类、洞察
Alerts	声量异常、负面情绪、关键词爆发	第二阶段实现预警
Reporting	自动报告、导出、分享	Markdown / PDF / Dashboard 报告

Meltwater 明确区分 social monitoring 和 social listening：前者关注“发生了什么”，后者进一步分析主题、情绪、叙事和 share of voice；这正好对应本系统的两阶段目标：第一阶段先监控和聚合，第二阶段再做洞察、预警和竞品分析。 ￼

⸻

3. 产品阶段规划

阶段 1：MVP Dashboard

目标：做出一个能用的 Web 面板，完成“采集 → 清洗 → 分析 → 看板 → 报告”的闭环。

阶段 1 不追求平台覆盖广度，而追求系统闭环完整。

阶段 1 核心能力

1. 项目 / Topic 管理
2. 关键词组管理
3. 数据源配置
4. 采集任务管理
5. 原始内容库
6. 清洗与过滤
7. AI 标签分析
8. 趋势 Dashboard
9. 高价值内容列表
10. 报告生成

⸻

阶段 2：专业化增强版

目标：向专业 social intelligence 平台靠近，增加竞品分析、预警、自动报告、可视化洞察、协作能力。

阶段 2 核心能力

1. 竞品 / 对比对象管理
2. Share of Voice 分析
3. 情绪趋势分析
4. 话题聚类与趋势上升检测
5. 异常预警
6. 周期性自动报告
7. 内容机会库
8. 多数据源扩展
9. 用户与权限
10. 报告导出与分享

⸻

4. 目标用户

4.1 第一阶段目标用户

个人创业者
内容运营
小型品牌团队
垂直行业研究者
选题策划
跨境内容团队
小红书 / TikTok / Instagram 运营者

4.2 第二阶段目标用户

品牌市场团队
PR 团队
竞品研究团队
MCN / 内容机构
垂直行业数据分析团队
产品经理 / 用户研究团队

⸻

5. 核心使用流程

5.1 阶段 1 使用流程

创建 Topic 项目
    ↓
配置关键词组和排除词
    ↓
选择数据源
    ↓
启动采集任务
    ↓
系统采集公开内容
    ↓
自动去重、过滤、评分
    ↓
AI 打标签与摘要
    ↓
Dashboard 展示趋势
    ↓
生成报告

⸻

5.2 阶段 2 使用流程

创建 Topic / Brand / Competitor 项目
    ↓
配置品牌词、竞品词、行业词、排除词
    ↓
配置监控频率与预警规则
    ↓
系统持续采集和分析
    ↓
Dashboard 显示声量、情绪、来源、话题变化
    ↓
触发异常预警
    ↓
自动生成日报 / 周报 / 专题报告

⸻

6. 阶段 1 功能设计

6.1 首页 Dashboard

页面目标

让用户一进入系统就知道：

最近采集了多少内容
哪些 Topic 正在增长
哪些内容最值得看
哪些任务失败了
本周有什么趋势

核心模块

1. 数据概览卡片
   - 今日新增内容数
   - 本周新增内容数
   - 有效内容数
   - 高价值内容数
   - 运行中任务数
   - 失败任务数
2. Topic 趋势列表
   - Topic 名称
   - 内容量
   - 环比变化
   - 平均互动分
   - 高价值内容数
3. 高价值内容流
   - 标题 / 摘要
   - 来源平台
   - 互动数据
   - AI 标签
   - 选题价值分
4. 最近报告
   - 报告标题
   - 生成时间
   - 数据范围
   - 查看 / 导出

⸻

6.2 Topic 项目管理

页面目标

Topic 是系统的核心分析单元。

一个 Topic 可以是：

某个行业
某个品牌
某类产品
某个消费趋势
某个内容方向
某个竞品集合

字段

Topic 名称
描述
语言
目标市场
默认数据源
默认采集频率
启用状态
创建时间
更新时间

核心操作

创建 Topic
编辑 Topic
暂停 Topic
查看 Topic Dashboard
查看 Topic 报告

⸻

6.3 关键词与查询配置

页面目标

让用户配置一个 Topic 下的查询规则。

不只是单个关键词，而是专业 social listening 平台里的 query builder 的简化版。

阶段 1 查询能力

包含关键词
排除关键词
平台限制
语言限制
时间范围
单次采集数量
采集频率

示例结构

{
  "includeKeywords": ["keyword A", "keyword B"],
  "excludeKeywords": ["spam word", "irrelevant word"],
  "platforms": ["reddit", "x", "youtube"],
  "language": "en",
  "limitPerRun": 100,
  "frequency": "manual"
}

阶段 2 增强

AND / OR / NOT 布尔查询
品牌词组
竞品词组
行业词组
敏感词组
高级排除规则

⸻

6.4 数据源配置

页面目标

管理系统当前支持的数据来源。

阶段 1 数据源

Reddit
X / Twitter
Pinterest
YouTube
普通网页 / 搜索结果页

每个数据源配置

启用 / 禁用
是否需要登录态
采集方式
默认频率
默认单次数量
失败重试次数
限速策略

登录态策略

对于需要登录态的平台：

手动登录
本地 profile 保存
登录失效提示
不自动绕过验证码
不自动处理二次验证

⸻

6.5 采集任务中心

页面目标

让用户知道系统正在抓什么、抓得怎么样、哪里失败了。

任务状态

待执行
运行中
成功
失败
暂停
需要登录
被限流
解析失败

页面字段

任务 ID
Topic
数据源
关键词 / 查询
状态
目标数量
实际采集数量
有效内容数量
重复数量
失败原因
开始时间
结束时间
操作

操作

启动
暂停
重试
查看日志
查看结果
查看异常截图

⸻

6.6 内容库

页面目标

展示采集到的内容，并让用户从原始数据进入分析数据。

内容列表字段

内容摘要
来源平台
原文链接
作者
发布时间
采集时间
互动数
AI 标签
情绪
价值分
是否广告
是否重复
是否已分析

筛选能力

按 Topic
按平台
按关键词
按时间
按互动分
按价值分
按内容类型
按情绪
按是否广告
按是否重复

内容详情页

原文内容
原文链接
媒体信息
互动数据
原始 JSON
清洗结果
AI 分析结果
关联 Topic
相似内容
可生成选题

⸻

6.7 数据清洗与质量控制

页面目标

让系统不是只堆原始数据，而是将内容变成可分析数据。

自动处理

去重
广告识别
无关内容识别
低质量内容识别
语言识别
文本标准化
互动分计算
内容价值分计算

质量指标

原始内容数
有效内容数
重复内容数
广告内容数
无关内容数
待分析内容数
AI 分析成功率

⸻

6.8 AI 分析配置

页面目标

配置 AI 如何给内容打标签。

阶段 1 AI 任务

内容类型识别
主题摘要
用户意图识别
情绪判断
关键词抽取
价值评分
选题建议

输出要求

AI 分析结果必须结构化保存，不能只保存自然语言。

基础字段

content_type
summary
topics
entities
intent
sentiment
insight_score
content_opportunity
reason

⸻

6.9 趋势分析 Dashboard

页面目标

这是阶段 1 的核心输出页面。

它不是展示“抓了多少条”，而是展示“发生了什么变化”。

核心图表

1. 内容声量趋势
   - 按天 / 周展示内容数量变化
2. 来源平台分布
   - 不同平台内容占比
3. 热门主题排行
   - AI 聚合后的主题 Top N
4. 情绪分布
   - positive / neutral / negative / mixed
5. 高价值内容排行
   - 按 insight_score + engagement_score 排序
6. 关键词表现
   - 每个关键词带来的有效内容数和平均价值分
7. 内容类型分布
   - 提问、经验、吐槽、推荐、展示、新闻等类型

⸻

6.10 报告中心

页面目标

把 Dashboard 的分析结果转成可读报告。

阶段 1 报告类型

Topic 趋势报告
关键词分析报告
平台内容报告
高价值内容精选
选题机会报告

报告内容

数据范围
样本数量
核心发现
趋势变化
热门主题
高价值内容案例
用户需求摘要
内容机会
建议下一步追踪方向

输出形式

Web 页面
Markdown
PDF
复制为富文本

⸻

7. 阶段 2 功能设计

7.1 竞品与对比对象管理

页面目标

支持用户配置多个品牌、竞品、产品线或内容方向，并进行横向对比。

功能

创建品牌 / 竞品对象
配置品牌关键词
配置竞品关键词
配置排除词
绑定 Topic
查看对比 Dashboard

⸻

7.2 Share of Voice 分析

专业平台通常会提供 share of voice，用于对比品牌、竞品或话题在整体讨论中的占比。Meltwater 也明确提到其 social listening 支持竞品 benchmark、share of voice tracking、sentiment comparisons 和 narrative analysis。 ￼

页面指标

品牌 / 竞品内容量占比
平台内声量占比
趋势变化
高互动内容占比
正负面内容占比

⸻

7.3 情绪趋势分析

功能

按时间展示情绪变化
按平台展示情绪差异
按品牌 / 竞品展示情绪差异
识别负面情绪上升
识别正面口碑内容

用途

品牌感知分析
危机早期发现
用户反馈监控
竞品口碑对比

⸻

7.4 话题聚类与趋势上升检测

功能

自动聚类相似内容
识别新出现的话题
识别增长最快的话题
识别下降话题
识别异常爆发内容

输出

话题名称
代表内容
内容数量
增长率
主要平台
相关关键词
情绪分布
建议动作

Talkwalker 的产品资料强调趋势识别、social benchmarking、media monitoring，并提到 Trending Score、情绪分析和图像识别等能力；本系统第二阶段可借鉴其“趋势上升检测 + 代表内容 + 建议动作”的输出方式。 ￼

⸻

7.5 预警中心

预警类型

关键词声量异常上升
负面情绪比例上升
竞品声量突然增加
高价值内容出现
指定关键词出现
采集任务连续失败
登录态失效

通知方式

站内通知
邮件
Webhook
飞书 / Slack / 企业微信，后续可选

预警规则字段

规则名称
绑定 Topic
触发条件
阈值
时间窗口
通知方式
启用状态

Meltwater 的社媒监控能力包含实时 tracking、AI-powered sentiment analysis、trend detection 和 custom alerts；这些能力可以作为第二阶段预警中心的对标方向。 ￼

⸻

7.6 自动报告

功能

日报
周报
月报
竞品报告
危机复盘报告
内容机会报告

报告自动生成流程

选择 Topic / 对比对象
选择时间范围
选择报告模板
系统聚合数据
AI 生成报告草稿
用户编辑
导出 / 分享

Talkwalker 提到自动报告创建与分发、定制 Dashboard 和集成 BI 工具；Meltwater 也强调可导出和分享报告，用于 stakeholder 或 executive-ready updates。 ￼

⸻

7.7 内容机会库

页面目标

将分析结果转成可执行内容资产。

字段

选题标题
来源 Topic
来源内容
内容角度
适合平台
目标受众
优先级
状态
负责人
备注

状态

待评估
已采纳
已创作
已发布
已归档

⸻

7.8 用户与权限

阶段 2 增加

用户登录
角色管理
项目权限
报告分享权限
数据源配置权限

角色

Owner
Admin
Analyst
Viewer

⸻

8. 信息架构

一级导航

Overview
Topics
Queries
Sources
Tasks
Content Library
Analytics
Reports
Alerts
Settings

阶段 1 导航

Overview
Topics
Queries
Sources
Tasks
Content Library
Analytics
Reports
Settings

阶段 2 增加

Competitors
Alerts
Opportunity Library
Users & Permissions

⸻

9. 技术架构

9.1 总体架构

Web Dashboard
    ↓
Backend API
    ↓
Task Queue
    ↓
Crawler Workers
    ↓
Raw Data Store
    ↓
Cleaner / Analyzer Workers
    ↓
Analytics Aggregation
    ↓
Report Generator

⸻

9.2 推荐技术栈

前端

React
Vite
TypeScript
MUI
TanStack Query
TanStack Table
Recharts / ECharts
Markdown Preview

后端

Node.js
TypeScript
Express 或 Fastify
Prisma
Zod

数据库

PostgreSQL

队列与任务

Redis
BullMQ

采集层

Crawlee
Playwright
Cheerio

AI 分析层

OpenAI-compatible API
Qwen / Doubao / OpenAI 可切换
Zod schema validation
批处理队列

文件与对象存储

本地文件系统，MVP
S3 / R2 / OSS，第二阶段

部署

Docker Compose

⸻

10. 后端模块划分

遵循四层结构：

routes
  ↓
services
  ↓
repositories
  ↓
infra

10.1 Routes

Topic Routes
Query Routes
Source Routes
Task Routes
Content Routes
Analytics Routes
Report Routes
Alert Routes
Settings Routes

10.2 Services

TopicService
QueryService
SourceService
CrawlTaskService
ContentService
CleaningService
AnalysisService
AggregationService
ReportService
AlertService

10.3 Repositories

TopicRepository
QueryRepository
SourceRepository
TaskRepository
RawContentRepository
AnalyzedContentRepository
ReportRepository
AlertRepository

10.4 Infra

CrawlerRuntime
PlaywrightProfileManager
LLMProvider
QueueProvider
StorageProvider
Logger
ConfigProvider

⸻

11. 核心数据模型

11.1 Topic

id
name
description
language
market
status
created_at
updated_at

11.2 Query

id
topic_id
name
include_keywords
exclude_keywords
platforms
language
frequency
limit_per_run
status
created_at
updated_at

11.3 Source

id
platform
name
enabled
requires_login
crawler_type
rate_limit_config
login_profile_id
created_at
updated_at

11.4 CrawlTask

id
topic_id
query_id
source_id
status
target_count
collected_count
valid_count
duplicate_count
error_message
started_at
finished_at
created_at
updated_at

11.5 RawContent

id
platform
source_id
query_id
topic_id
external_id
url
author_name
author_handle
text
media_urls
metrics_json
published_at
captured_at
raw_json
raw_html_path
screenshot_path
created_at

11.6 CleanedContent

id
raw_content_id
normalized_text
language
is_duplicate
is_ad
is_irrelevant
quality_score
engagement_score
clean_reason
created_at

11.7 AnalyzedContent

id
raw_content_id
summary
content_type
topics
entities
intent
sentiment
insight_score
opportunity_score
reason
model_name
created_at

11.8 TrendSnapshot

id
topic_id
date_range_start
date_range_end
volume_total
volume_by_platform
sentiment_distribution
top_topics
top_keywords
top_contents
created_at

11.9 Report

id
topic_id
title
type
date_range_start
date_range_end
content_markdown
content_json
status
created_at
updated_at

11.10 AlertRule，阶段 2

id
topic_id
name
condition_type
threshold
time_window
channels
enabled
created_at
updated_at

⸻

12. 采集层设计

12.1 Crawlee 的角色

Crawlee 负责：

任务队列
URL 去重
请求重试
失败处理
并发控制
Dataset / 中间存储
Playwright 集成
Cheerio 集成
Session 管理

12.2 Playwright 的角色

Playwright 负责：

动态页面访问
滚动加载
登录态复用
页面交互
截图
DOM 抽取

12.3 Cheerio 的角色

Cheerio 负责：

静态页面解析
搜索结果页解析
文章页解析
低成本 HTML 抽取

12.4 登录态管理

阶段 1 采用人工登录策略：

headful 浏览器
固定 userDataDir
用户手动登录
系统检测登录状态
登录失效时任务暂停
不自动绕过验证码

⸻

13. AI 分析层设计

13.1 处理原则

不把所有原始内容直接丢给大模型
先规则清洗
再批量分类
最后摘要聚合

13.2 AI 任务类型

内容摘要
内容类型分类
情绪判断
主题抽取
实体抽取
用户意图判断
洞察价值评分
选题机会判断
报告生成

13.3 输出校验

所有 AI 结构化输出必须经过 Zod 校验。

失败处理：

格式错误 → 自动修复一次
修复失败 → 标记 analysis_failed
不影响其他内容处理

⸻

14. Analytics 指标体系

14.1 基础指标

内容总量
有效内容数
平台分布
关键词分布
平均互动分
高价值内容数
AI 分析成功率
采集成功率

14.2 洞察指标

主题热度
主题增长率
情绪分布
内容类型分布
高价值内容占比
机会分数
异常增长

14.3 阶段 2 指标

Share of Voice
竞品声量对比
竞品情绪对比
话题重叠度
负面内容增长率
危机风险分

⸻

15. 页面清单

阶段 1 页面

1. Overview 首页
2. Topic 列表页
3. Topic 详情页
4. Query 配置页
5. Source 配置页
6. Task 中心
7. Content Library
8. Content Detail
9. Analytics Dashboard
10. Report Center
11. Report Detail
12. Settings

阶段 2 新增页面

1. Competitor Center
2. Share of Voice Dashboard
3. Alert Center
4. Opportunity Library
5. Auto Report Templates
6. User & Permission

⸻

16. 阶段验收标准

阶段 1 验收标准

1. 用户可以在 UI 创建 Topic
2. 用户可以配置关键词和数据源
3. 用户可以从 UI 启动采集任务
4. 用户可以看到任务状态和错误日志
5. 系统可以保存原始内容
6. 系统可以去重和过滤低质内容
7. 系统可以对内容做 AI 标签分析
8. Dashboard 可以展示趋势图表
9. 用户可以查看高价值内容
10. 用户可以生成一份 Web / Markdown 报告

阶段 2 验收标准

1. 支持竞品对象管理
2. 支持 share of voice 对比
3. 支持情绪趋势对比
4. 支持话题增长检测
5. 支持预警规则
6. 支持周期性自动报告
7. 支持内容机会库
8. 支持用户权限
9. 支持报告导出和分享

⸻

17. 明确输出目标

系统第一阶段最终输出：

1. 一个可操作的 Web Dashboard
2. 一个可管理的 Topic / Query / Source / Task 工作流
3. 一个可筛选的内容库
4. 一个趋势分析仪表盘
5. 一份自动生成的分析报告

系统第二阶段最终输出：

1. 一个接近专业 social listening 工具的轻量平台
2. 支持竞品对比和 share of voice
3. 支持异常预警和周期报告
4. 支持内容机会沉淀
5. 支持团队协作和权限管理

⸻

18. 一句话版本

这个系统的目标不是“低成本爬数据”，而是：

用 Crawlee + Playwright + AI 分析层，自研一个轻量版 Brandwatch / Meltwater / Talkwalker，用于垂直领域的社媒监听、趋势洞察、竞品分析和内容机会发现。