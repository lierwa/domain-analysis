# R-015 知识包与离线查询对照 POC

状态：已通过，SQLite＋FTS5 已接受为 MVP 知识包基线
目标阶段：1C
调查日期：2026-08-14

## 简单说明

同一份已确认格式的商品知识，分别装进 SQLite 单文件和 DuckDB＋Orama 双产物。验证型号、中文、数值筛选、证据、冲突/未知、只读复制、版本切换和回滚；不调用模型、网络或 embedding。

## 开源候选

| 候选 | 官方事实 | 本轮验证重点 |
| --- | --- | --- |
| SQLite FTS5＋`@libsql/client` | SQLite 是稳定的跨平台单文件；FTS5 内建 prefix、`unicode61` 和 trigram tokenizer | 一个文件同时承担结构化事实、关系、证据和中文/型号检索 |
| DuckDB Node Neo＋Orama | DuckDB FTS 首次从官方扩展仓库自动下载；Orama 提供 Mandarin tokenizer、筛选和持久化 | DuckDB 只做结构化查询，Orama 做全文；测量两个文件和一致性成本 |

DuckDB 自带 FTS 不进入离线 POC，因为官方说明首次使用会从扩展仓库透明自动加载，目标机器无网络时不满足启动硬门。除非未来有成熟的随包扩展分发方案，否则不为 POC 自研扩展安装器。

Orama 官方持久化插件 3.1.18 的 restore 会创建默认 tokenizer；实测持久化前 Mandarin 查询全部命中，恢复后中文与混合别名均为 0。候选因此改用 Orama 核心官方 `save/load`：把状态加载到预先创建的 Mandarin 实例，不为插件编写兼容层，并从隔离依赖中移除该插件。

## 实测结论

Node `v22.22.3`、macOS arm64 的同进程方向性对照：

| 数据量 | SQLite 单文件 | DuckDB＋Orama 双产物 |
| --- | --- | --- |
| 3 商品/6 claim | 69,632 B；构建 32.44 ms；查询 1.29 ms | 3,169,124 B；构建 168.63 ms；查询 16.92 ms |
| 1000 商品/2000 claim | 1,769,472 B；构建 2675.27 ms；查询 4.85 ms | 4,602,415 B；构建 1740.56 ms；查询 25.29 ms |

两套候选均通过 9 项冻结查询、复制后只读、禁止写入和异常状态可见性；放大样本的全文结果统一限制为前 10 条。SQLite 构建较慢，但它只产生一个事实＋索引文件，包更小、查询更快，也没有双产物一致性问题，因此接受 SQLite＋FTS5。DuckDB＋Orama 保留为已验证但拒绝的备选，不进入生产依赖。

不可变对照记录：`data/pocs/r015/attempts/2026-08-14T11-06-00.360Z/comparison.json`，SHA-256 `e75d490266d4a0671661f79e8df37eb133fdc3d6c515d2b243109d7748a890cf`。`data/` 默认不入 Git；跨电脑用本目录锁文件和 `npm run compare` 重建证据。

R-011 当前硬门已由 Zod、关系约束、只读写入失败和冻结查询覆盖，没有出现引入 Great Expectations 的真实缺口，因此不增加 Python 质量基础设施。

## 冻结查询

1. 精确型号 `MR-457WUSPZE`；
2. 别名/短文本 `436L十字门`；
3. 中文全文 `净味抗菌`；
4. 冰箱总容积 `>=500L` 的数值筛选；
5. claim 到 evidence 的联查；
6. `conflict` 和 `unknown` 状态可见；
7. 复制到新目录后只读打开；
8. 新包校验后切换，旧包可回滚；
9. 运行期间不下载扩展、不调用模型、embedding 或网络服务。

## 停止门

- 中文/型号只能靠自写 tokenizer；
- 证据必须复制到第二事实源才能查询；
- 首次只读加载需要联网；
- 只读约束无法执行验证；
- 为过 POC 引入生产数据库、migration 或 Runtime 重构。

## 官方资料

- SQLite 单文件：https://www.sqlite.org/onefile.html
- SQLite FTS5：https://www.sqlite.org/fts5.html
- DuckDB FTS：https://duckdb.org/docs/current/core_extensions/full_text_search.html
- DuckDB extension 安装：https://duckdb.org/docs/current/extensions/installing_extensions.html
- DuckDB Node Neo：https://duckdb.org/docs/stable/clients/node_neo/overview
- Orama：https://docs.orama.com/docs/orama-js
- Orama 中文：https://docs.orama.com/docs/orama-js/supported-languages/using-chinese-with-orama
- Orama 持久化：https://docs.orama.com/docs/orama-js/plugins/plugin-data-persistence
