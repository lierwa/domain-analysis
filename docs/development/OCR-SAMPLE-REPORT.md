# 本机 OCR 样本实验报告

实验日期：2026-09-03。范围：M1 Pro 本机、固定 12 张图片、有限文字提取。

## 简单说明

本机已经跑通 RapidOCR + ONNX Runtime CPU，模型来自 PaddleOCR。12 张图识别约 3.67 秒，平均约 0.31 秒/图；整个进程峰值内存约 1.18 GiB。两次独立进程处理得到相同的 92 行文字、位置和置信度。图片处理均在系统禁止联网的环境下完成。

结果可用于人工复核与后续样包实验；92 行均保留“待人工复核”状态。当前证据证明这组输入在本机可以运行，准确率、Windows/Linux 运行表现和知识包消费效果分别等待对应验收。

## 环境与边界

- Git 基线：master，93a57b6219229796f811ca45cea142f93097ae4d；实验未修改生产模块或原始数据。
- 硬件：Apple M1 Pro，8 核，16 GiB 内存；macOS 26.5.1，ARM64。
- Python 3.12.13；RapidOCR 3.9.2；ONNX Runtime 1.29.0；OpenCV 5.0.0.93；NumPy 2.5.2。全部 21 个依赖由 uv 生成带哈希的 lock 后安装于独立环境。
- 模型：PP-OCRv5 mobile 检测、识别，加 PP-OCRv4 文字方向分类。三个模型使用固定本地路径，下载文件 SHA-256 与 RapidOCR v3.9.2 的官方清单一致。
- 推理配置：ONNX Runtime CPU，intra-op 4 线程、inter-op 1 线程，单图串行；置信度阈值 0.5，其余图片预处理沿用锁定版本默认值。
- 网络隔离：sandbox-exec 的 deny network*；同一策略下 socket 创建返回 EPERM，实际图片处理仅读取本地文件。
- 输入：来自 [固定输入清单](KNOWLEDGE-PACK-SAMPLE-INPUT.md) 的 12 个不同图片哈希。实验脚本每次执行前校验模型和图片字节哈希；输出保留 Snapshot、Asset、Subject、原分类、序号、文字框与置信度。

## 实测性能与资源

| 指标 | 结果与口径 |
| --- | --- |
| 依赖安装 | 约 40.28 秒；Python 3.12 已在本机存在；uv 解析 lock 另约 8.75 秒 |
| 模型下载 | 合计 22,036,414 bytes，约 21.02 MiB；下载约 6.21 秒 |
| 独立环境落盘 | du 报告约 281.35 MiB；模型另约 21.02 MiB，不含已有 Python 安装与 uv 缓存 |
| 首批 3 图 | 初始化及导入 12.692 秒；OCR 1.109 秒；峰值 0.986 GiB |
| 完整 12 图 | 初始化及导入 0.469 秒；OCR 3.671 秒；外部计时 4.365 秒 |
| 12 图独立进程复跑 | 初始化及导入 0.409 秒；OCR 3.700 秒；外部计时 4.285 秒 |
| 单图 OCR 时间 | 平均 0.306 秒，中位数 0.235 秒，范围 0.137–0.656 秒 |
| 12 图峰值内存 | 首次 1.178 GiB，复跑 1.172 GiB；resource.getrusage 的整个进程峰值 RSS |
| 输出与重复性 | 两次各 92 行，文字、位置和置信度逐项相同；不代表文字本身已正确 |
| OCR 模型费用 | 本地 CPU 推理，无外部模型 API 或 LLM token 计费；下载、计算和人工复核仍有成本 |

峰值包含 Python、原生依赖、模型及图片处理内存，不能用 22MB 模型文件大小代替。后续进程启动时系统缓存已经变化，0.47 秒初始化不是首次安装后的冷启动保证。样本共约 1.27MB，图片尺寸见下表，不能直接外推到超大长图或高并发。

### 首次启动观察

第一次完整尝试在 30 秒总进程预算内没有输出，被测量器终止。定位用的 Python 栈停在 cv2 原生模块加载，尚未取得 OCR 推理结果。随后不读取图片的 OpenCV 依赖导入检查在约 3.99 秒完成；同版本、同模型、同网络隔离策略的 3 图与两次 12 图实验均成功。

该观察定位到依赖加载阶段，具体为何首次加载缓慢尚未确认。本轮保留原版本与脚本、保留失败日志；没有把后续快速启动称为首次启动问题已修复。新环境首次安装仍需核对加载时间。

## 每张图片的结果

| 样本 ID | 原分类 | 尺寸 px | OCR 秒 | 文字行 | 内容状态 |
| --- | --- | --- | --- | --- | --- |
| 334331-I1 | 整体外观图 | 600 × 450 | 0.164 | 1 | 待人工复核 |
| 334331-I2 | 官方图 | 800 × 600 | 0.472 | 20 | 待人工复核 |
| 334331-I3 | 评测图解 | 790 × 1076 | 0.316 | 12 | 待人工复核 |
| 334331-I4 | 官方图 | 800 × 600 | 0.147 | 3 | 待人工复核 |
| 1406333-I1 | 黑色 | 1387 × 1040 | 0.375 | 1 | 待人工复核 |
| 1406333-I2 | 黑色 | 2204 × 1653 | 0.553 | 4 | 待人工复核 |
| 1406333-I3 | 黑色 | 1961 × 1471 | 0.656 | 23 | 待人工复核 |
| 1406333-I4 | 黑色 | 790 × 615 | 0.252 | 5 | 待人工复核 |
| 1406483-I1 | 官方图 | 805 × 604 | 0.137 | 2 | 待人工复核 |
| 1406483-I2 | 评测图解 | 790 × 900 | 0.219 | 9 | 待人工复核 |
| 1406483-I3 | 评测图解 | 790 × 900 | 0.191 | 8 | 待人工复核 |
| 1406483-I4 | 评测图解 | 790 × 350 | 0.188 | 4 | 待人工复核 |

## 文字质量与来源差异

- 首批外观图 334331-I1 只提取到 Galanz；这说明不同图片的提取收益可能差异很大，图片数不能直接视为知识数量。
- 1406333-I2 提取到“46道自动菜单”，关联参数页的原字段记录“58道菜单”（Snapshot source-snapshot-630866de-6260-49fd-8736-fa835ea98be8）。这是需要核对原图、型号归属与版本的候选差异，当前保留两份来源。
- 1406483-I3 的数值候选包括 30S、3.5min、56L/min、100℃。即使置信度较高，也仍需核对小数点、单位和所属文字说明；本轮不自动把它们解释为商品参数。
- 92 行中包含品牌、来源水印和宣传文字。当前输出保留识别原文与位置，不把所有文字直接纳入知识包。
- 当前没有人工金标，不能计算字符准确率、漏字率或声称已达到 R-014 的 80% 继续门。所有输出均为 pending_human_review。
- 12 张均有文字输出；本轮没有实际覆盖“未检出文字”或损坏输入的结果分支。

## 可复核产物

本机目录：data/knowledge-pack-ocr-20260903/，受现有 .gitignore 保护。以下相对路径均以该目录为起点：

| 文件 | 用途 |
| --- | --- |
| review-first3.md、review-first3.html | 首批 3 张原图与 13 行候选文字，供有限人工复核 |
| review.html | 12 张原图与逐行文字、置信度、位置的人工对照页；页面引用本地图片 |
| results/all12/ocr.jsonl | 92 行候选文字及对应来源、位置、处理状态 |
| results/all12/summary.json、results/all12-repeat/summary.json | 两次独立进程的性能与内存 |
| inputs.json、models.json | 固定输入及模型身份、文件路径、哈希与下载量 |
| requirements.in、requirements.lock、install.json | 依赖声明、哈希锁定与安装计时 |
| validation.json | 两次输出一致性、数量与结构检查 |
| first3.log、engine-import-diagnostic.log、opencv-import-diagnostic.log | 首次超时与依赖导入定位证据 |
| first3-after-import-execution.json、all12-execution.json、all12-repeat-execution.json | 外部计时、终态和网络隔离策略 |

实验脚本：[scripts/ocr-sample.py](../../scripts/ocr-sample.py)。以新 run-name 在同一台 Mac 上复跑首批 3 图：

```sh
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  data/knowledge-pack-ocr-20260903/.venv/bin/python scripts/ocr-sample.py \
  --root "$PWD/data/knowledge-pack-ocr-20260903" \
  --run-name manual-check --sample-ids 334331-I1 1406333-I2 1406483-I3
```

本次测量器通过 Node 的 spawnSync 对整个子进程设置 30 秒超时，严格于单图 30 秒上限；上述人工复跑命令只展示 OCR 调用。脚本的峰值 RSS 测量适用于 macOS/Linux，Linux 尚未实跑，Windows 需要对应的测量适配与实测。

## OCR 与去水印联合复跑（2026-09-03）

本次复用同一批 12 张原图与原环境，原图 OCR 和去水印副本分开保存；原图及三个模型的 SHA-256 全部吻合。研究候选与处置只在 RESEARCH.md R-016 维护。

| 执行范围 | 结果 |
| --- | --- |
| 原图 OCR 12 张 | 4.081 秒；92 行文字、位置、置信度与先前 all12 完全一致；含启动的进程外部墙钟 5.436 秒 |
| 去水印首批 3 张 | 定位 1 张、生成 2 个候选副本；角落 OCR 0.631 秒、修补 0.012 秒；外部墙钟 1.707 秒 |
| 去水印全部 12 张 | 定位 2 张、生成 4 个候选副本；角落 OCR 2.404 秒、修补 0.019 秒；外部墙钟 3.367 秒 |
| 全量进程峰值 RSS | 原图 OCR 1,166,032,896 bytes；定位与修补 1,147,207,680 bytes；两个进程顺序运行 |
| 像素与来源 | 12 张原图哈希未变；4 个 PNG 与原图尺寸相同，mask 外变更像素均为 0 |
| 效果状态 | 全部待人工复核；10 张水印位置待确认，不能判为无水印；1 张与原 OCR「村」相交 |

两张已定位样本为 1406483-I2、1406483-I3。比较方法为 OpenCV Telea 与 Navier-Stokes，均采用半径 3 的局部修补；定位区域来自原图 OCR 和右下角放大 OCR。完整矩形 mask、识别锚点、扩展规则、原图身份与副本哈希随结果保存。矩形内部可能包含背景或未识别细节，像素保持检查只证明区域外不变，不证明区域内修补正确。

产物仍位于本机实验根目录，新增路径如下：

- results/watermark-originals/ocr.jsonl 与 summary.json：本轮完整 OCR。
- results/watermark-all12/review.html：12 图、92 行文字、两种修补及局部放大对照；已在 Codex 内置浏览器打开，DOM 检查为 12 个样本、92 行、22 个图片视图，无横向溢出。
- results/watermark-all12/watermark.json、summary.json、validation.json：处理区域、候选副本、计时、来源与校验记录。
- results/watermark-all12/*-mask.png、*-telea.png、*-navier-stokes.png：2 张处理区域图与 4 个候选副本。
- watermark-originals-execution.json、watermark-first3-execution.json、watermark-all12-execution.json：外部计时、进程终态与 deny network* 记录。

复跑入口：[scripts/watermark-sample.py](../../scripts/watermark-sample.py)，参数 --root 指向实验根目录，--ocr-run 指向同一输入的 OCR 运行名，--profile 指向 watermark-profile.json 的已标定样本参数，--run-name 使用新的输出目录名，--sample-ids 提供固定清单。继续沿用前述 sandbox-exec 禁止联网及 Node 30 秒进程预算。当前只在 Mac 实跑，不增加依赖或模型。

## 商品边界保护验证（2026-09-03）

负责人截图中的 1406483-I3 显示机身直边在首轮矩形修补后明显凹凸变形。当前脚本使用同版本水印的平滑背景样本估计字形，仅处理字形附近像素，并在已标定的机身边界两侧分别调用 OpenCV，限制背景颜色填入金属区域。

| 检查 | 原图 | 首轮 Telea / Navier-Stokes | 当前 Telea / Navier-Stokes |
| --- | --- | --- | --- |
| 机身直边最大偏移 | 1 px | 13 / 20 px | 0 / 0 px |
| 机身直边 P95 偏移 | 0 px | 11.1 / 18.1 px | 0 / 0 px |
| 字形区域外像素变化 | 基准 | 首轮使用矩形范围 | 0 / 0 |

- 基准取原图未遮挡的 y=792–799、864–877 行，以红蓝色差阈值识别灰色机身与棕色背景的交界；参考 x=682，验收范围 y=802–860，允许最大偏移 2 像素。该度量只覆盖截图指出的直边，不等于完整图像保真评价。
- 当前字形 mask 为 2,741 像素，约为原定位矩形 5,700 像素的 48.1%；两张同版水印的模板匹配分数约 1.000 / 0.903。模板来自 1406483-I2 平滑背景，机身边界只针对 1406483-I3 标注，均保存在本机 profile。
- 2 图各输出两种方法，共 4 个 PNG；定位 0.0026 秒、修补 0.0176 秒，进程外部墙钟 0.588 秒，峰值 RSS 129,466,368 bytes。复用全部 12 图的原始 OCR，无新增 OCR 或视觉生成模型调用；本轮另对局部图片作视觉检查。
- 局部对照确认凹凸边缘问题已消除；放大后仍有轻微纹理修补痕迹。该结论仅限标定样本，最终图像质量与批量自动化仍待验收，其余 10 张未处理。
- 当前产物：results/watermark-boundary/ 下的 review.html、comparison.png、watermark.json、summary.json、validation.json，以及 2 张 mask 和 4 张处理副本；watermark-profile.json、edge-regression-baseline.json 和 watermark-boundary-execution.json 位于实验根目录。
- 处置：保留原始快照、OCR 与首轮失败对照；脚本重写为当前字形/边界处理，失败的形态学和透明度校正尝试只在本机 probe 区保留，不进入当前加工路径。原图 bytes、生产接口和依赖均未改变。

## Baseline Impact

- 服务阶段：ROADMAP.md 的数据处理阶段采访、调研与小样验证；承接 ARCHITECTURE.md 的 Source Dataset 只读边界。
- 复用：RapidOCR、ONNX Runtime、PaddleOCR 模型、uv 以及 Python/Node 标准库。产品特有代码仅选择既有样本、保留来源关系并记录实验指标。
- touched modules: scripts/ocr-sample.py、scripts/watermark-sample.py 独立实验及证据文档；生产模块未修改
- owning fact source: Source Dataset；OCR 文件是带来源标识的实验衍生结果
- public interface changed: no
- new protocol/adapter/fallback: yes，仅实验脚本适配官方 OCR 输出与 OpenCV 修补；生产接口无变化
- compatibility or legacy path changed: no
- research update required: yes，R-015/R-016 登记候选实测结果与限制
- architecture or ADR update required: no；本轮架构影响为“澄清”
- 验证：模型/图片哈希，3 图与两次 12 图离线执行，92 行结果一致，人工对照页 12 张图片/92 行记录，脚本语法与文档差异检查；没有执行生产构建或全仓测试。
- 当前完成度与下一步只在 PROGRESS.md 维护；本机环境、原图与未经复核的 OCR 内容不进入 Git。
