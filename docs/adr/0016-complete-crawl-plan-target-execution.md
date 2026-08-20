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
- 公共访问复用 Got stream、robots-parser、Node DNS/net；产品 adapter 只增加私网/保留地址拒绝、robots 预算、频控、最大字节、零自动重试和访问限制状态映射。HTML 唯一链接解析复用 Cheerio，不自研 HTML parser。
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
