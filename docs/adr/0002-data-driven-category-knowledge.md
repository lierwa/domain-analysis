# 商品品类差异必须数据化

商品知识系统采用一套稳定的商品知识模型和共享属性字典；冰箱、电视、微波炉等差异以版本化品类知识定义、来源种子、决策维度和能力问题表达，不新增品类专用数据库列、TypeScript 类、Runtime API 或通用流水线分支。该决定避免首个冰箱 MVP 把系统做成一次性定制品，并以第二品类迁移门约束后续实现；依据包括 Schema.org 的通用 `additionalProperty`、Akeneo 的共享属性与 Family 组合方式，以及 Pimcore Classification Store 在不改变产品类定义时承载动态品类属性的实践。
