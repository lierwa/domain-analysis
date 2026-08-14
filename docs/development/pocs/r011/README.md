# R-011 知识质量分层隔离原型

本目录只比较成熟工具的职责边界，不实现通用质量框架，也不决定生产知识包 Schema。

## 验证对象

- Ajv `8.17.1`：复用项目已经存在的直接依赖，验证 JSON Schema 结构硬门。
- Great Expectations `1.20.0`：通过隔离 Python 环境验证批次级非空、枚举、唯一性和格式断言。
- Soda Core v4：不运行。当前主分支使用 Elastic License 2.0，限制把其主要功能作为托管服务提供，不符合本项目开源优先和未来部署退出边界。
- Promptfoo：当前 `0.122.0` 要求 Node `>=22.22.0`；隔离原型固定使用仍支持 Node `>=20` 的 `0.119.0`，只验证 Runtime/Agent contract，不把旧版本装入项目，也不据此冻结生产版本。

## 运行

```bash
node validate-with-ajv.mjs valid-knowledge-claims.json
node validate-with-ajv.mjs invalid-knowledge-claims.json

uvx --python 3.12 --from great-expectations==1.20.0 \
  python validate-with-gx.py valid-knowledge-claims.csv
uvx --python 3.12 --from great-expectations==1.20.0 \
  python validate-with-gx.py invalid-knowledge-claims.csv

npx --yes promptfoo@0.119.0 eval --config promptfoo-valid.yaml --no-cache
npx --yes promptfoo@0.119.0 eval --config promptfoo-invalid.yaml --no-cache
```

正确样例应以 `0` 退出，错误样例应以非零退出并列出失败规则。Promptfoo 命令必须从本目录运行，确保 `file://` Provider 可解析。

## 不能由本原型证明的内容

- Ajv 不验证跨文件证据引用真的存在，也不评估检索或导购任务效果。
- Great Expectations 的内建断言适合表格/SQL 批次，但复杂知识图关系和证据定位仍需在真实知识存储候选上验证；不得用自写 Custom Expectation 偷换成自研质量引擎。
- Runtime/Agent 能力问题与下游任务评测需要兼容项目运行时的成熟评测器；兼容旧版只证明集成可行，不足以冻结 Promptfoo 依赖，正式采用前必须在受支持的 Node LTS 上复验当前版本。

## 调查依据

- [Ajv 官方仓库](https://github.com/ajv-validator/ajv)：MIT，支持 JSON Schema draft-07/2019-09/2020-12，Node 18 至当前版本。
- [Great Expectations Expectations](https://docs.greatexpectations.io/docs/core/define_expectations/)：Expectation Suite 组织可验证数据断言；Python 3.10～3.13。
- [Great Expectations 唯一性规则](https://docs.greatexpectations.io/docs/reference/learn/data_quality_use_cases/uniqueness/)：内建单列与组合列唯一性检查。
- [Soda Core 当前许可证](https://raw.githubusercontent.com/sodadata/soda-core/main/LICENSE)：Elastic License 2.0，包含托管服务限制。
- [Promptfoo 当前 package.json](https://raw.githubusercontent.com/promptfoo/promptfoo/main/package.json)：MIT，Node `>=22.22.0`；[`0.119.0` package.json](https://raw.githubusercontent.com/promptfoo/promptfoo/0.119.0/package.json)要求 Node `>=20.0.0`，仅用于隔离兼容性验证。
