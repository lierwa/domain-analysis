# R-018 Drizzle migration 隔离 POC

状态：已通过并接受；见 ADR-0008
关联调研：R-004
调查日期：2026-08-14

## 简单说明

项目当前能运行，但建表逻辑同时存在于 `schema.ts` 和 `initializeDatabase()`，已经出现约束漂移。本 POC 只用项目锁定的 Drizzle 版本生成并验证 migration，不改真实数据库，也不先删除现有启动逻辑。

## 为什么隔离安装

根工作区实测 `drizzle-kit@0.23.2` 无法发现 db workspace 中的 `drizzle-orm@0.32.2`，报“Please install latest version of drizzle-orm”。Drizzle 官方 issue 把它确认为 npm monorepo 依赖提升问题；官方 0.32.0 release 又明确这组 ORM/Kit 版本属于同一 release。

第一轮先把相同版本放进一个隔离 package，已证明共址后生成器可用。随后 `npm audit --omit=dev` 发现 `drizzle-orm <=0.45.1` 命中 GHSA-gpj5-g38j-94v9 high 级 SQL identifier 注入公告，官方修复版为 0.45.2；因此第二轮升级隔离 POC 到 `drizzle-orm@0.45.2`、`drizzle-kit@0.31.7`，并复用 R-015 已验证的 `@libsql/client@0.17.4` 满足官方 peer 下限，仍不改根 lockfile。只有新版兼容原型和根工程回归全部通过后，才允许提出正式升级。

## 停止门

- 生成器仍要求升级或无法读取当前 `schema.ts`；
- migration 不能在空库重复执行；
- 旧 DDL 库无法安全识别且需要自研 baseline/repair；
- 失败 migration 后应用仍会带未知 Schema 启动；
- 任何步骤需要连接真实数据库或修改 `data/`。

## 实测结果

- 旧锁定版本隔离共址后成功生成 9 表 migration，确认根失败来自 npm workspace 解析；
- 修复版 `drizzle-orm@0.45.2`、`drizzle-kit@0.31.7`、`@libsql/client@0.17.4` 读取同一 snapshot 无变化；
- 3/3 contract 通过：空库首次/重复执行、失败整批回滚、旧手写 DDL 库失败关闭；
- Drizzle CLI 对隔离库连续执行两次成功，ORM migration log 只保留一条；
- 根依赖升级后 generate 成功，原有 test 12 文件/52 项、typecheck、build 全部通过；生产 audit 中不再出现 Drizzle 的 high 公告。

结论：接受官方 migration 和修复版依赖；新产品库使用新路径，不给旧 DDL 自研 baseline/repair。正式 Product Schema 落地时生成生产 migration，再切换新启动链。
