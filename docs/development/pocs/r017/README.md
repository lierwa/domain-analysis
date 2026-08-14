# R-017 持久流水线编排器对照 POC

状态：已通过并接受 DBOS；见 ADR-0007
目标阶段：2
调查日期：2026-08-14

## 简单说明

流水线做完一段后停下来等人工，程序被关掉再启动，已做完的段不能重做，人工决定也不能丢。这里只比较成熟开源编排器，不扩展现有 `p-queue + setInterval`。

## 候选筛选

| 候选 | 许可证/运行前提 | 处置 |
| --- | --- | --- |
| Temporal | Server 和 TypeScript SDK 为 MIT；独立服务；开发服务可本地运行 | 进入恢复原型 |
| DBOS Transact | MIT；库直接嵌入 Node；必须有 PostgreSQL | 进入恢复原型 |
| Hatchet | MIT；Hatchet Engine＋PostgreSQL＋Worker | 能力重叠但比 DBOS 多一层服务，不进入本轮原型 |
| Restate | Server 为 BSL 1.1，许可证正文明确不是 Open Source | 拒绝 |
| Inngest | Server 为 SSPL | 拒绝 |
| Trigger.dev | 自托管为 Webapp、Redis、PostgreSQL、Worker 多容器 | 对当前单机 MVP 过重，拒绝 |
| Kestra | Apache-2.0，但需独立 Java 平台且流程以平台 DSL 为中心 | 与现有 TypeScript 模块化单体不匹配，拒绝 |

## 实测结果

| 项目 | Temporal 1.22.0 | DBOS 4.25.14 |
| --- | --- | --- |
| 崩溃范围 | Worker 与本地服务均停止并重启 | 首个 Node 进程 `SIGKILL`，新进程启动 |
| 持久介质 | CLI `--db-filename` 的 SQLite 文件 | 临时 PostgreSQL 14.22 |
| 恢复结果 | `collect` 一次，信号后 `package` 一次 | `collect` 一次，消息后 `package` 一次 |
| 额外控制 | 官方 Signal/Query/取消/重试 API | 实测同 ID 幂等、步骤重试、取消、恢复、消息幂等 |
| 本轮安装体量 | `@temporalio` 约 170 MB＋CLI 约 128 MB | `@dbos-inc` scope 约 2.2 MB；另需 PostgreSQL |
| 运行形态 | 独立 Temporal 服务＋Worker | SDK 嵌入现有 Node 进程＋PostgreSQL |

Temporal 的单文件开发服务虽通过恢复测试，但 CLI 明确警告 `start-dev` 不可作为生产入口。DBOS 在相同能力下少一个独立编排服务，更符合当前模块化单体；因此接受 DBOS，并把 PostgreSQL 影响交给 R-004 继续验证，不在本 POC 擅自迁移 Workbench 数据库。

## 同条件停止门

- 首个外部步骤只成功一次；
- 流水线等待人工信号时不占用执行线程；
- Worker/应用停止并重启后仍处于等待状态；
- 人工信号恢复后从下一步继续；
- 已完成步骤不重复；
- 取消、超时、重试和运行状态有官方 API；
- 不自行实现事件日志、锁、重放、信号或队列。

## 可复现命令

Temporal 测试会启动、终止并重启临时服务：

```bash
R017_TEMPORAL_EXECUTABLE=/path/to/temporal npm run test:temporal
```

DBOS 测试只连接专用临时 PostgreSQL，不得指向真实业务库：

```bash
R017_DBOS_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run test:dbos
```

## 官方资料

- Temporal：https://docs.temporal.io/ 、https://docs.temporal.io/develop/typescript/workflows/message-passing
- DBOS：https://docs.dbos.dev/typescript/tutorials/workflow-tutorial 、https://docs.dbos.dev/typescript/tutorials/workflow-communication
- Hatchet：https://github.com/hatchet-dev/hatchet
- Restate 许可证：https://github.com/restatedev/restate/blob/main/LICENSE
- Inngest 许可证：https://github.com/inngest/inngest/blob/main/LICENSE.md
- Trigger.dev 自托管：https://trigger.dev/docs/self-hosting/overview
- Kestra 人工暂停：https://kestra.io/docs/how-to-guides/pause-resume
