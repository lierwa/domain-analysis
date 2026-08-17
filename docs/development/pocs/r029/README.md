# R-029：Codex 交互运行时候选处置记录

日期：2026-08-16
状态：App Server/SDK thread 路线已拒绝；隔离可执行项目于 2026-08-17 压缩删除

## 历史实验结论

R-029 曾比较官方 TypeScript SDK 与 `codex app-server --stdio`：

- SDK 能返回工具事件、恢复 thread 和识别显式 Skill，但没有文字 delta；AbortSignal
  返回后曾留下探针子进程；
- App Server 能返回文字 delta、interrupt 和 resume，但命令仍是 experimental，实际
  schema 与文档出现漂移；更关键的是 `thread/start/resume` 会把产品采访写入全局
  Codex Session；
- App Server 的 ephemeral fork 仍依赖一个已存储 source thread，不能解决完整隔离。

因此此前“接受 App Server 最小例外”的阶段结论已经作废。继续保留可执行矩阵会诱导
后续开发重跑已拒绝路径并再次制造全局 Session。

## 当前生产替代

当前接受且已经接入生产的是：Workbench 持有全部 typed 继续上下文，每轮通过官方稳定
`codex exec --ephemeral --json --output-schema` 无状态执行。

- `packages/workbench/src/codexExecClient.ts`：官方 CLI 薄 adapter；
- `packages/workbench/src/codexCategoryInterviewRuntime.ts`：采访事件投影；
- `packages/workbench/tests/codexCategoryInterviewRuntime.test.ts`：完成、取消、搜索完成门和
  Session 零写入 fake 回归；
- `packages/workbench/tests/codexCategoryInterviewRuntime.acceptance.test.ts`：显式真实
  acceptance，验证全局 Session rollout 零新增；
- 根 `packages/workbench/package.json` 和 `package-lock.json` 锁定生产依赖。

旧 SDK/App Server 探针、POC Skill、独立 `package.json`、`package-lock.json` 和
`tsconfig.json` 不参与生产 workspace、测试或构建，现已删除。历史能力差异和候选淘汰
理由由本文件与 `docs/development/RESEARCH.md` 的 R-029 保留；未来只有官方能力或产品
约束发生变化时才建立新的临时 POC。
