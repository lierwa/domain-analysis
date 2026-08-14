# R-010 市场总体版本隔离原型

## 目的

本目录验证 `MarketUniverseVersion` 能否把监管身份、官方在售总体、市场优先级、来源核验、许可和未知项分开记录。冰箱与电视样例使用同一 Schema，只验证结构可迁移，不宣称已经列全中国市场品牌或型号，也不是生产 Schema。

## 调查依据

- 中国标准化研究院公开的能效备案包含型号、生产者、能效等级和备案号，适合发现合规身份，不等同当前在售：https://www.cnis.ac.cn/tzgg/202412/t20241231_59316.html
- 市场监管总局明确 2026 冰箱新规则实施后，旧规则产品可以延迟两年换标，因此总体必须记录快照日期和并存标准版本：https://www.samr.gov.cn/xw/zj/art/2026/art_622696c3b0d24421b782e1ffd657dbeb.html
- 京东帮助中心说明商品页标注“自营”即为京东销售，可形成确定性来源核验规则：https://help.jd.com/user/issue/44-75.html
- 京东帮助中心对授权专卖店的说明证明平台店铺命名依赖商标和授权文件；本项目仍不把店名本身当成充分证据，旗舰店必须再有品牌反链、平台资质或授权证据：https://help.jd.com/user/issue/325-2069.html
- 海尔官方支持中心允许按品类和型号查询说明书，美的官方商城页面直接给出型号、上下架/库存和规格，证明品牌官方来源可以支撑身份和时点在售发现：https://www.haier.com/support/ 、https://www.midea.cn/1/1000000000400692547081.html
- 京东电视自营入口与 TCL 官方产品目录证明同一来源分层和核验结构可迁移到第二品类：https://www.jd.com/brand/737b854e4dacb50aa96.html 、https://www.tcl.com/cn/zh/tvs
- 公开市场文章和上市公司报告只能支撑趋势，不提供可构造品牌/型号分母的授权明细；取得明确许可前，`market_priority` 保持 pending。

## 已验证的产品边界

1. 合规身份、官方在售和市场优先级是三个独立层。
2. `ModelCandidate` 以品牌＋厂商型号为身份，页面、卖家、颜色和 Offer 不制造新型号。
3. 官方在售需要同一快照窗口的官方证据；只有历史备案的型号保持 activity unknown。
4. 来源许可默认从严：公告未明确再分发时使用 `unknown` 或 `lookup_only`，不能把批量原始数据塞进可分发知识包。
5. 结构样例不能计算覆盖率；只有 lifecycle 为 `frozen` 的真实总体版本才能成为分母。

## 复现命令

以下命令使用 LinkML 隔离运行，不修改项目依赖：

```bash
uvx --python 3.12 --from linkml==1.11.1 linkml lint market-universe.linkml.yaml
uvx --python 3.12 --from linkml==1.11.1 linkml validate market-universe.linkml.yaml
uvx --python 3.12 --from linkml==1.11.1 linkml-validate --schema market-universe.linkml.yaml --target-class MarketUniverseVersion refrigerator-market-universe.yaml
uvx --python 3.12 --from linkml==1.11.1 linkml-validate --schema market-universe.linkml.yaml --target-class MarketUniverseVersion television-market-universe.yaml
uvx --python 3.12 --from linkml==1.11.1 linkml-validate --schema market-universe.linkml.yaml --target-class MarketUniverseVersion invalid-market-universe.yaml
```

前四条应成功；错误样例必须因错误日期、错误枚举和三个空列表非零退出。

## 尚未通过的停止门

- 尚未验证品牌官网产品目录的完整分页/接口是否可稳定枚举；单个官方详情页成功不代表目录完整。
- 尚未拿到一个京东品牌旗舰店的品牌反链或可保存资质证据；此前不纳入来源白名单。
- 尚未取得可按品牌/型号使用的市场监测数据及许可；此前不计算销量加权覆盖率。
- 冰箱/电视已通过同 Schema 结构校验，但尚未对任一品类构造完整真实总体，因此不能把结构复用等同覆盖率完成。
