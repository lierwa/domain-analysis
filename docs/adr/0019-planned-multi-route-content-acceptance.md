# ADR 0019：计划显式多路由与内容验收

状态：接受
日期：2026-08-26
服务阶段：ROADMAP 1E
替代：ADR 0018 中 `public.web-resource@1.0.0` 精确 URL/一次链接的生产执行边界；ADR 0018 的 AI 深搜、Research Audit v3、JD 排除和人工确认门继续有效

## 背景

真实电视 v9 四批已经证明传输成功、HTTP 2xx、浏览器渲染和 Snapshot 数量都不能回答“抓到的是不是计划需要的内容”。旧 Provider 只请求计划 URL，无法稳定覆盖官网目录；Sony 和酷开又证明错误入口即使可访问也会产生低价值原文。继续给手写传输增加特判会重复实现 sitemap、队列和恢复能力。

## 决定

1. 当前可执行清单升级为 version 4，只绑定 `public.web-resource@2.0.0`；v2/v3 计划和 Provider 1.0.0 历史只读，不静默迁移。
2. 一个 Provider 暴露两个小而完整的 typed route：`exact` 读取计划 URL；`site` 从计划官网种子开始，在同源、最大深度、最大页数、时长、请求预算和内容信号内发现页面。
3. `site` 复用 Crawlee 3.18.1 的 robots/sitemap utilities 与持久 RequestQueue。所有网络请求仍通过现有 PostgreSQL admission 和 SSRF/HTTPS/同源边界；Crawlee 队列只拥有 Provider 内待处理 URL，不拥有业务终态。
4. 所有原始响应不可变保存。`contentAssessment.status` 区分 `accepted/rejected/supporting`；只有 accepted 增加 target 有效数并满足数量门。rejected 增加失败数，supporting 只增加 Snapshot 数。site 和 exact HTML 都执行内容门，PDF 还核对文件签名；HTTP 2xx 和 snapshot count 不再代表内容完成。
5. 不启用自动 retry、SessionPool、代理轮换、账号切换、TLS 忽略、验证码绕过或隐式 HTTP→浏览器 fallback。浏览器未来只能作为新计划显式声明的独立 route，经新的调研和真实验证后加入。
6. Planning Agent 仍只调查并返回已核实官网种子和精确正文 URL；Workbench 独占 route、预算、内容信号和 key 的确定性组装，Source Run 不边抓边改计划。

## 结果

- 有价值内容的完成口径成为可持久审计的领域事实，而不是 UI 文案或人工事后判断。
- 官网目录覆盖从“一个 URL 成功”变为有上限的增量发现；完整度仍允许持续新增，不承诺一次得到市场全集。
- 历史 v9 和低质量 Snapshot 保留用于审计，但不会被新版有效计数吸收。
- 依赖增加 `@crawlee/utils@3.18.1`；Graphile、PostgreSQL Source Dataset 和原始 CAS 的事实归属不变。
