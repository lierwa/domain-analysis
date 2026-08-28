# 数据抓取平台开发进度

更新日期：2026-08-28
当前阶段：`ROADMAP.md` Z1 单品牌纵向验证（已通过）

## 当前状态

ZOL 单来源方案已经确认并落库。V0 已接入现有 Source Execution、持久请求准入和 Source Dataset，真实运行完成 7 页面单品牌纵向验证。

本轮没有修改共享公共 interface 或数据库 schema；新增 ZOL V0 adapter、同主机 canonical HTTPS 规范化、请求准入身份跟随来源 Provider 的必要修正、V0 测试和正式运行入口。

## 已验证事实

- ZOL 门类页公开品牌入口和来源侧产品数量；
- ZOL 门类品牌榜公开关注占比、综合评分和产品数量；
- 品牌页公开当前型号、稳定分页和型号链接；
- 型号参数页公开基本参数、技术参数、功能特点、尺寸重量和包装附件；
- 仓库已有 Crawlee 持久队列、进程内队列、熔断、robots、跨进程 Source Access Gate 和不可变 Source Dataset；
- 当前设计不需要新增依赖或服务。
- ZOL V0 单测通过：正常 fixture 形成 7 个页面事件；结构失败先保存 rejected 原始页面再停止；分页总数从 `1/16` 正确读取为 16；同主机 HTTP canonical Location 只升级为 HTTPS，跨 origin 仍拒绝。
- 真实正式 Run `source-run-22592d98-33a9-4cf8-b689-4436c4aafceb` 已保存 2 个 robots supporting 快照、7 个可访问页面快照和完整原始 JSONL；门类页识别 148 个品牌入口，品牌榜 P1 首个品牌为海尔，关注占比覆盖 96.0%，两页海尔目录各识别 48 个型号，三个参数页各识别基本参数、技术参数和功能特点。
- 两个型号参数 URL 的门类段由 ZOL 301 canonical 到 `2101` 和 `1423`；父 Attempt 为 301，安全 HTTPS 子 Attempt 为 200，未访问 HTTP。Run/Batch/target 均为 `completed`，Run 快照 9 个（2 robots + 7 页面）、Attempt 12 个、无 running 残留；每个 origin 的相邻 Attempt 间隔至少 30 秒。
- 全量 `npm test` 本轮为 35 个测试文件通过、2 个文件失败、2 个跳过（142 个测试通过、8 个失败、7 个跳过）；失败来自现有 Web React hook 运行环境和 Workbench `modelSelection` fixture，不属于 ZOL V0，未修改其范围。

## 下一步

Z1 V0 交付点已完成；下一阶段按 `ROADMAP.md` 决定是否进入 V1。当前不执行 V2、完整品牌抓取或双品牌放量。

## 架构影响

澄清。ZOL adapter 复用既有 Provider、请求准入和 Source Dataset 职责；公共传输只增加同主机默认端口的 HTTPS canonical 规范化，本轮没有改变模块职责、事实源、依赖方向或公共 contract。

## Git 与接续状态

文档与实现已提交并推送至 `codex/zol-v0-vertical-publish-20260828`；本地、tracking 和远程分支已完成 SHA parity，ahead/behind 为 `0 0`。后续任务可从该分支或其远程分支继续。

## 本轮 Baseline Impact

```text
Baseline Impact:
- touched modules: packages/worker ZOL V0 adapter, public request gate identity, worker tests, standalone formal run script, this progress record
- owning fact source: confirmed Crawl Plan freezes the V0 route and budget; Source Dataset owns actual request attempts, immutable raw snapshots and lineage
- public interface changed: no
- new protocol/adapter/fallback: one ZOL category adapter and bounded same-host HTTPS canonical normalization; no generic retry, queue or access bypass added
- compatibility or legacy path changed: no
- research update required: no; existing RESEARCH.md covers public ZOL HTML, Crawlee, p-retry, robots and Source Access Gate
- architecture or ADR update required: no; module ownership and dependency direction are unchanged
- tests and real-surface validation: ZOL provider unit tests, 全仓 workspace typecheck, formal PostgreSQL Source Dataset run, request ledger, raw JSONL export and terminal-state audit；全量测试中的既有 Web/Workbench 失败保持范围外
```

正式证据：task `task-zol-v0-b437758c-e40a-4602-9c3d-74d91faaae21`，plan `plan-zol-v0-b437758c-e40a-4602-9c3d-74d91faaae21`，batch `source-batch-378bd9d5-dd47-4d3d-bb1c-c31bef8b0982`，run `source-run-22592d98-33a9-4cf8-b689-4436c4aafceb`，原始导出 `/private/tmp/task-zol-v0-b437758c-e40a-4602-9c3d-74d91faaae21.jsonl`。本轮已 commit 并 push，未 merge。
