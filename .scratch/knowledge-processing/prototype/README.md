# 知识加工界面与组件原型

用途：评审阶段 2 建设 A 的选料、加工、审核、版本与导出流程，并用本机真实资料验证内容准入和成品封装。产品接入方案见 [PRD](../PRD.md)，候选处置见 [RESEARCH R-017](../../../docs/development/RESEARCH.md)，当前结果见 [PROGRESS](../../../docs/development/PROGRESS.md)。

界面地址：`http://127.0.0.1:6184`。顶部可选择空包、运行、停止、局部失败、必需内容缺失和更新情景。创建、停止、复核意见及确认发布均为操作演示；下载链接指向真实构建的隔离 ZIP。浏览器本地记录只保存演示名称、预算和复核意见，正式业务事实仍待接入工作台持久模块。

## 复跑

在仓库根目录使用 Node 24 与 npm 11。先安装根项目的锁定依赖；原型复用其中 React/Radix、Cheerio、cacache、canonicalize、Zod、Execa、ndjson、Vite 与 TypeScript。新增候选依赖有独立 package-lock，不修改生产 workspace 的依赖。

```sh
node --version
npm --version
npm --prefix .scratch/knowledge-processing/prototype ci --legacy-peer-deps --ignore-scripts
node .scratch/knowledge-processing/prototype/prepare-inputs.mjs
node .scratch/knowledge-processing/prototype/probe.mjs
npm --prefix .scratch/knowledge-processing/prototype test
npm exec -- tsc -p .scratch/knowledge-processing/prototype/tsconfig.json
npm --prefix .scratch/knowledge-processing/prototype run build
npm --prefix .scratch/knowledge-processing/prototype run dev
```

`prepare-inputs` 需要本机 API 4000、既有样包/OCR/图片标定证据及对应 Source Dataset；它只读选定 Run 与 Asset，并下载官方 Data Package schema。`probe` 只使用已保存输入，本次生成式模型调用为 0；每次运行创建新的 `run-*` 目录，正式原件及既有样包不覆盖。依赖安装需要网络，固定输入后构建可离线。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| prepare-inputs.mjs | 通过既有 API 读取固定输入，核对哈希并保存本机副本 |
| source-adapter.mjs | ZOL 来源字段提取、既有 OCR/图片证据适配与缓存 |
| package-probe.mjs | 产品内容准入、成熟 ZIP/Schema 组件适配、版本保留 |
| pdf-probe.mjs | 官方 PDF.js 文字与位置提取，最多前 5 页 |
| probe.mjs | 固定小样与新增型号的实验编排、检查和 UI 证据生成 |
| main.tsx / panels.tsx / styles.css | 五个工作视图、情景操作、实际内容与版本预览 |
| tests/package-probe.test.mjs | 歧义传播、图片准入、来源依赖、重建/缩减、版本及 ZIP 边界 |

## 产物与核验边界

忽略目录 `data/knowledge-processing-prototype/` 中：`input.json` 固定输入；`datapackage-schema.json` 为官方 schema；`run-*/report.json` 记录每次检查及成本；`run-*/versions/` 保留两版 ZIP；`latest-report.json` 指向最近实际结果；`ui/` 为浏览器的本机预览副本；`baseline-hashes.json` 用于核对原有脚本与实验产物保留情况。

组件原型接收已明确处置的候选内容；已知菜单冲突映射只存在于实验输入。它验证准入后的全部消费文件与附件，尚未证明自动发现任意歧义。人工效果确认与内容确认分开，未确认的 OCR、性能图和复杂 PDF 保持审核候选。正式交易式发布、Worker 中断恢复、图片扩量以及 Linux/Windows 安装和运行均有后续通过门。

新加的 ZIP 校验只处理本系统生成的有界小包；任意外部 ZIP 导入不属于本原型。待核原值、原图、PDF 和实验诊断只在本机审核区，不进入消费 ZIP。源码与依赖锁可以纳入 Git，原始数据、图片与本机报告继续留在忽略目录。
