# R-008 隔离原型

状态：非生产、已完成真实电视小样本迁移验证

本目录验证成熟开源建模工具能否让冰箱与电视共用同一商品知识 Schema。品类差异必须是版本化数据，不允许演变成 `RefrigeratorModel`、品类数据库列或品类专用 Runtime API。

## 原型边界

- `product-knowledge.linkml.yaml`：唯一通用 LinkML 建模样例；
- `refrigerator-category-definition.yaml`：冰箱品类知识定义数据样例；
- `television-category-definition.yaml`：已用 TCL 65T7G 官方页补充真实电视小样本，仍不代表电视市场知识已完整；
- `valid-research-brief.yaml` / `invalid-research-brief.yaml`：用途访谈的接受与拒绝样例；
- `render-form.mjs`：调用 RJSF 验证生成 Schema 能否被现成表单库消费；
- `generate-scenarios.py` / `calculate-sample-sizes.py`：调用成熟库验证组合覆盖和抽检计算方法；
- 生成物和依赖只能放在临时目录，不修改产品依赖或业务代码。

## 本次纠偏

第一版“公共父类＋`RefrigeratorModel` 子类”虽然能被 LinkML 表达，但会把每个品类变成新的生产 Schema 和代码改造，违背低成本切换品类的首要目标，已明确拒绝。

第二版采用：

1. 一套稳定的 `ProductModel`、`AttributeClaim`、`ProductKnowledgeClaim`、`Offer` 和证据模型；
2. 品类知识定义只选择共享属性、值类型、单位、别名、决策维度、能力问题和官方来源策略；
3. 冰箱与电视两个 YAML 数据文件由同一个 `CategoryKnowledgeDefinition` 校验；
4. 功能、机制、适用条件和取舍使用通用专业知识结论表达，不塞进下游 Agent 提示词；
5. 后续品类迁移门要求生产 Schema、数据库结构、Runtime API 和通用流水线零修改。

## 调查依据

- [Schema.org `additionalProperty`](https://schema.org/additionalProperty)允许产品用 `PropertyValue` 表达未被固定词汇覆盖的特征，同时建议已有专用属性时优先复用；
- [Akeneo Family](https://help.akeneo.com/en_US/serenity-discover-akeneo-concepts/23-serenity-what-is-a-family)由共享属性集合组成，同一属性可以被多个 Family 复用；
- [Akeneo Variant](https://help.akeneo.com/serenity-what-about-products-with-variants)区分公共属性、变体轴和变体属性；
- [Pimcore Classification Store](https://docs.pimcore.com/platform/Pimcore/Objects/Object_Classes/Data_Types/Classification_Store/)用 key/group 承载动态品类属性；官方 Data Object 文档明确说明它可在不修改类定义时处理品类专用属性。

这些依据支持“稳定公共模型＋数据化品类定义”，但不等于本项目已经选用 Akeneo、Pimcore 或 LinkML 作为生产依赖。

## 已验证与仍待验证

已验证：LinkML `1.11.1` 能让冰箱和电视数据使用同一 Schema；R-016 已把 TCL 官方页的身份、规格、功能、机制和决策知识用同一知识包/Runtime 跑通；用途访谈能生成 JSON Schema，并由 `json-schema-to-typescript` 与 RJSF 消费；组合覆盖和抽检计算可由成熟库承担。

仍待验证：多品牌真实官方资料能否稳定映射；共享属性字典如何治理；功能、机制和决策知识是否足够支撑专业导购；生产 TypeScript 组件是否存在成熟方案；“主流品牌/型号”总体如何有证据地定义。

## 可复现命令

以下命令在本目录或复制到临时目录后运行，不在项目根目录安装候选依赖：

```bash
uvx --python 3.12 --from linkml==1.11.1 linkml lint product-knowledge.linkml.yaml
uvx --python 3.12 --from linkml==1.11.1 linkml validate product-knowledge.linkml.yaml
uvx --python 3.12 --from linkml==1.11.1 linkml validate \
  --schema product-knowledge.linkml.yaml \
  --target-class CategoryKnowledgeDefinition refrigerator-category-definition.yaml
uvx --python 3.12 --from linkml==1.11.1 linkml validate \
  --schema product-knowledge.linkml.yaml \
  --target-class CategoryKnowledgeDefinition television-category-definition.yaml
uvx --python 3.12 --from linkml==1.11.1 linkml validate \
  --schema product-knowledge.linkml.yaml \
  --target-class KnowledgeUseBrief valid-research-brief.yaml
```

## 明确不是结论

- 没有接受 LinkML、RJSF、ETIM、Akeneo、Pimcore 或 Python 工具为正式组件；
- 电视样例只验证结构迁移，不证明电视知识定义专业或完整；
- 没有冻结冰箱字段、访谈问题、质量门槛、数据库结构或品牌/型号数量；
- 禁止从本原型恢复“每个品类一个类”的生产方向。
