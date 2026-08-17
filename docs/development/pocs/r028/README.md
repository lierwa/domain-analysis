# R-028：本地 Chat Timeline 选型记录

日期：2026-08-16
状态：选型已进入生产；隔离可执行项目于 2026-08-17 压缩删除

## 目的与结论

R-028 曾用独立 Vite/React/Playwright 项目验证 `@assistant-ui/react@0.15.14` 的
ExternalStoreRuntime 能否只投影项目自有消息事实，同时覆盖流式、取消、重试、错误、
中文输入法、滚动、桌面/390px、可访问性和无 Assistant Cloud 请求。

Node 24 复跑时，类型检查、Vitest `2/2`、Vite build 和桌面/390px Playwright `2/2`
通过。已知成本为 673 modules、主 JS 424.28 kB / gzip 127.82 kB，以及 0.x API、
未使用云包和整包 Radix 的依赖负担。选型因此只接受薄 UI adapter，不让 assistant-ui
拥有消息、决定或任务书事实。

## 当前生产替代

- `apps/web/src/pages/CategoryInterviewTimeline.tsx` 已直接使用
  `AssistantRuntimeProvider`、`ThreadPrimitive` 和 `useExternalStoreRuntime`；
- `apps/web/src/lib/api.ts` 使用项目自己的 typed SSE；
- Workbench 数据库拥有 Interview Session、Message、Decision 和 Brief；
- 根 `apps/web/package.json` 与 `package-lock.json` 已锁定实际生产依赖。

隔离 POC 的组件、localStorage fake、浏览器用例、构建配置、独立 `package.json` 和
`package-lock.json` 不再保护当前生产事实，且不会被根 workspace、测试或构建调用，
因此不随正式代码提交。未来升级 assistant-ui 时，应针对当前生产页面建立新的临时
兼容性验证，不能复活这套已漂移的平行应用。

详细技术结论和当前接受状态以 `docs/development/RESEARCH.md` 的 R-028 为准。
