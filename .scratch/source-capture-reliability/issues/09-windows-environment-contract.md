# Windows 本地环境契约

Status: ready-for-agent
Priority: P2
Implementation: locally verified

## 问题

历史 `.env` 参数曾漂移；Windows 环境对 `Path`/`PATH` 大小写不敏感，Codex App Server 子进程曾因重复键或缺少当前 Node 目录影响 Planning。正式抓取还需要本机 `.env.local` 的受信任 `HTTPS_PROXY`，但不得进入 Git 或日志。

## 当前状态

- `.env` 与 `.env.example` 当前均为 7 个同名配置键。
- `.env.local` 只声明本机 `HTTPS_PROXY`，不记录到问题文档的值。
- 子进程环境只保留一个 `PATH` 并前置当前 Node 目录。

## 验收

- Windows 启动时检查必需配置，不回显数据库或代理秘密。
- `.env.example` 是配置 schema，`.env`/`.env.local` 是本机值；程序从实际本机文件读取。
- 干净 checkout 验收覆盖 API、Worker、Planning 和公共资源预检。

## Comments

- 2026-09-02：当前配置键集合已核对，保留为 P2 防回归项。
