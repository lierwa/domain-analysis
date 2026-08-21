---
status: accepted
date: 2026-08-20
amends: ADR-0013-executable-crawl-plan-and-foreground-source-run
---

# 完整 Crawl Plan、目标级执行与公共原始资源 Provider

## 简单说明

Crawl Plan 是确认后可以直接开始的抓取清单，不是“已经写了一个京东爬虫”的演示。采访里调查出的电商入口、品牌官网、说明书、国家标准、监管附件、底层原理和配置参数来源都必须进入同一份清单；每一项都写清抓什么、抓几份、怎样定位、何时停止，并绑定真实 Provider。抓回来的内容先原样进入 Source Dataset，供负责人查看和导出；参数抽取、标准化和知识加工属于阶段 2，当前不会提前做。

## 背景

ADR-0013 建立了版本化计划、Provider preflight、显式 Start 和 Source Dataset 写入，但第一版只证明京东目录与首个商品详情两个 target。旧校验只检查 task topic 是否出现在任意 target 文本中，既不能证明全部采访来源被保留，也不能证明说明书、标准正文或监管附件会被实际请求。Source Run 又只按 source 汇总，无法对账计划中的具体 target。

## 决定

- active Crawl Plan 使用 `executionChecklistVersion=2`。每个 Capture Task `sourceCandidate` 必须恰好映射一次，每个原文 task topic 必须至少由一个会返回该类原始事实的 target 覆盖；二者任一遗漏都不保存计划。
- 每个 target 冻结捕获单元、原始格式、数量与覆盖分母、唯一键、遍历、停止条件、数量依据和 Provider-owned typed 配置。新计划只能绑定当前组合根真实注入的 Provider，且 `executionBlockers` 必须为空；旧纵切片保留只读历史，不能再次启动。
- `jd.catalog-product@1.0.0` 仍只承担一个京东 `www.jd.com` 入口的固定 `catalog` 与 `first_matching_product` 两步，不承担其他京东域名或通用网页。
- `public.web-resource@1.0.0` 只接受无凭证公网 HTTPS 443。target 要么声明一个精确 URL，要么在前序 HTML 上按完整规范化链接文字唯一匹配一次同源链接。它不接受 selector、模糊匹配、重定向、跨源跟进、递归发现、分页或登录自动化。
- 公共访问复用 Node 24 官方 HTTPS 代理 Agent、Google Public DNS DoH、robots-parser 与 Node DNS/net；产品 adapter 只增加 Fake-IP 检测、连接 IP 固定、私网/保留地址拒绝、robots 预算、持久请求准入、最大字节、零自动重试和访问限制状态映射。HTML 唯一链接解析复用 Cheerio，不自研 HTML parser。
- Source Execution 为每个计划 target 预建独立 attempt，并要求 Provider observation/event 携带 `targetKey`。未知、重复、遗漏 target 或数量不一致均失败关闭；source 汇总只能由这些 target 事实对账得出。
- Source Snapshot 保持不可变并冻结 `targetKey`。PDF、表格、图片等原文件通过 cacache 内容寻址保存，数据库只保存与 snapshot 独立关联的 asset 元数据；相同字节可以复用，来源关系不能合并。
- Crawl Planning 最终结果同时受 App Server `outputSchema` 和本地 Zod 校验；运行保留十分钟硬上限。结构化 commentary 只投影其中的人读说明，不把 JSON 外壳显示到 Timeline。

## 后果与验证门

- 通用 Crawl Plan、Provider event、Source Dataset contract 不出现冰箱、京东、淘宝、SKU 或价格固定字段；具体来源差异只在计划数据和 Provider adapter 中表达。
- 品牌说明书若是 H5，必须有独立 HTML target；PDF/附件表格必须有独立 document target、附件留存和可下载关系。入口页中“存在链接”不能代替正文 target。
- `public.web-resource` 是有界原始资源访问器，不是淘宝 crawler、官网全站 crawler 或标准正文解析器。真实访问仍可能因 robots、登录、验证码、拒绝、风控、动态渲染或用途限制而 truthful stopped/failed。
- 自动化必须覆盖候选/topic 完整性、链接 target 顺序与唯一文字、网络边界、目标级生命周期、CAS 去重和导出对账；真实页面必须证明完整计划可确认并显示独立 Start。
- 2026-08-20 真实家用冰箱任务已确认 v6：7 个采访候选各一次，另有 1 个 NIST 技术来源，共 8 个来源、12 个 target、13 个 topic 全覆盖。确认只完成 Provider preflight；没有点击 Start，也没有据此访问任何来源。
- 当前 macOS/Node 24 安装、类型、测试与构建必须通过；目标 Linux 安装行为仍需单独验证后才能声称跨平台执行完成。

## 2026-08-21 修订：动态工作、图片 URL 与逐请求对账

本修订替代 `jd.catalog-product@1.0.0` 固定两步 target 的当前决定；公共资源 Provider 与附件 CAS 决定保持不变。

- JD v2 的计划仍用五个通用 target 表达目录、店铺目录、商品详情、评价汇总和评价样本，但实际分母由前序响应动态发现的 Capture Work Item 对账，不再把一个固定详情冒充全量。
- 同一规范化 GET URL 使用稳定 work key 去重；每个需要网络的发现对象先形成 Capture Work Item。图片 URL 是详情 Snapshot 的 Source Resource Reference，随 Snapshot 同事务提交，不形成网络 work。
- Source Request Attempt 逐 hop 记录预留、发送和结果；Source Access Gate 原子保护跨进程请求预算、最小间隔、窗口、冷却和首次受限熔断。401/403/429、登录、验证、风险/频控正文、未知跨源跳转与异常响应停止派发，自动重试为零。
- source 完成除原 target 对账外，还要求所有 Capture Work Item 终结；恢复 run 只能显式关联前序 stopped/failed run，并继承其请求预算与冷却事实。
- Workbench/API/Web 只投影同一 Source Dataset 事实：target、work、request、gate、Snapshot、Resource Reference 和恢复关系；不得从错误文案或队列空状态推导完成。

本地纵向 fixture 已用两页目录、一个店铺目录、三个商品、逐商品评价和每商品 25 个图片 URL 验证 12 个实际数据请求、75 条资源引用、图片服务器 0 请求；这仍不是京东真实站点验收。

## 2026-08-21 修订：一次 Start 一个可审计批次

简单说明：条件检查不再显示成“已经抓完”。每次真正开始先生成一个批次，本轮所有来源结果都挂在这个批次下；过去留下的记录统一标成“历史记录（无批次）”，不会再和新结果混在一起。旧计划如果缺京东商品 Provider，连批次都不能创建。

- 新增通用 `Source Collection Batch`，冻结 task revision、Crawl Plan ID/version、计划来源数、开始/结束时间和 completed/partial/failed/stopped 结果。它是一轮 Start 的事实源，不是用多个 Source Run 时间戳推导出的 UI 分组。
- Source Run 新增可空批次关系。新 Start 创建的运行必须引用当前批次；已有行不回填、不删除，UI 单独归入“历史记录（无批次）”。显式 Resume 继续由 `resumedFromRunId` 审计，不伪造成一次原始 Start。
- Prepare 只做零数据条件检查，返回文案必须明确“未创建批次、未访问来源”；准备成功后按钮写为“开始新批次抓取”。
- Source Execution 在创建批次前调用 Crawl Planning 的当前完整性门。Capture Task 纳入京东而旧 confirmed plan 没有 `jd.catalog-product@2.0.0` 时，Prepare/Start 都失败关闭，不能因计划曾在旧规则下确认而绕过。
- 真实页面按批次显示计划版本、时间、状态、来源运行数和快照数；中断/失败的新 Planning Run 必须说明未生成新计划，不能把保留的旧 confirmed plan 冒充本轮结果。

## 2026-08-21 修订：Fake-IP 出网与公共来源持久准入

公司网络的 Mihomo Fake-IP 会让系统 DNS 返回 `198.18.0.0/15` 占位地址。公共 Provider 不得直接放行该保留网段；仅在部署环境显式配置 HTTPS 代理时，使用可信 DoH 取得并校验全部候选公网 IP，再把选定 IP 固定为实际 CONNECT 目标，原域名只用于 Host 与 TLS SNI。普通 DNS 环境同样校验并固定实际连接 IP，避免 DNS rebinding。

公共 Provider 不再拥有每个 Source Run 独立的进程内 rate gate。每个 robots/target 请求先创建 Capture Work Item，再通过 Source Dataset/PostgreSQL 的 `SourceRequestAdmissionPort` 预留 Request Attempt；gate key 使用 Provider 版本＋规范化 origin，使同源跨运行共享预算、最小间隔、窗口、冷却和熔断。DoH 失败、NXDOMAIN、redirect、robots、401/403/429 与异常状态继续失败关闭，不新增代理池、身份轮换、自动 fallback、登录绕过或重试。

2026-08-21 真实微波炉任务验证 6 个公共来源中 4 个完成并各保存 1 个 Snapshot，美的商品页包含 8 个商品和图片 URL，JSONL/CSV 正式导出通过；京东 robots 302 和格兰仕 NXDOMAIN 保持真实 failed。该结果证明公共多来源出网与持久记账闭环，不代表京东 v2 真实抓取通过。

该真实失败同时暴露计划完整性漏洞：Capture Task 已确认纳入京东时，单个 `search.jd.com` 的 `public.web-resource` target 只能代表该候选网页，不能代表京东商品数据闭环。Crawl Planning 保存门因此必须另行要求至少一个 `jd.catalog-product@2.0.0` 五类动态来源；规划 Skill 与 runtime prompt 使用同一 v2 契约。若搜索不能核实可匿名执行的 `www.jd.com` 目录入口，规划失败关闭，不再生成“可开始但必然抓不到京东商品”的伪完整计划。
