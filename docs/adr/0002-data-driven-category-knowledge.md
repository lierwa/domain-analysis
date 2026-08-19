---
status: superseded by ADR-0015
date: 2026-08-14
---

# 商品品类差异必须数据化

商品知识系统采用一套稳定的商品知识模型和共享属性字典；冰箱、电视、微波炉等差异以版本化品类知识定义、来源种子、决策维度和能力问题表达，不新增品类专用数据库列、TypeScript 类、Runtime API 或通用流水线分支。该决定避免首个冰箱 MVP 把系统做成一次性定制品，并以第二品类迁移门约束后续实现；依据包括 Schema.org 的通用 `additionalProperty`、Akeneo 的共享属性与 Family 组合方式，以及 Pimcore Classification Store 在不改变产品类定义时承载动态品类属性的实践。

`ConfirmedScope.targets` 允许 `foundational_concept`，用于把跨商品底层原理作为正式研究对象；品牌、品类、型号只通过关系引用这些概念，不能反向拥有或复制一份原理事实。2026-08-17 的电视真实纵切片以同一表结构和 Runtime interface 表达电视定义、LCD/OLED 架构、生命周期成本规则和 ENERGY STAR 型号，没有新增电视专用表、类、查询方法或流程分支，第二品类最小迁移门通过。
