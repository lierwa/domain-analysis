# R-026 冰箱来源访问与最小证据真实纵切片

日期：2026-08-16
运行时：Node `v24.19.0` x64
访问组件：`@crawlee/cheerio@3.18.1`、`@crawlee/http@3.18.1`、`@crawlee/core@3.18.1`、`unpdf@1.8.1`、`libarchive-wasm@1.2.0`、`read-excel-file@9.3.10`、`sharp@0.35.3`

## 样本与边界

- 真实来源 1：海尔官网 `https://www.haier.com/cooling/20241126_252875.shtml`，对象 `BCD-500WGHFDB5XAU1`，页面以 JSON-LD 声明产品数据。
- 真实来源 2：美的官网 `https://www.midea.cn/1/1000000000400692992139.html`，对象 `BCD-501WSPM(Q)`，页面以 HTML 规格表声明产品数据。
- 真实来源 3：美的官方说明书 `https://dsdcp.smartmidea.net/mcsp/prod/20230803/6b0f37e5343a4abfba8c4a5274565d70.pdf`，对象 `MR-457WUSPZE`，16 页 PDF。
- 真实来源 4：中国标准化研究院公开 RAR `https://www.cnis.ac.cn/tzgg/202412/P020241231788865667216.rar`，内含家用电冰箱备案 XLSX，对象 `MR-457WUSPZE`。
- 真实来源 5：海尔产品页直接声明的官方产品图 `https://image.haier.com/cn/cooling/W020241126359088762136_1200.png`，对象 `BCD-500WGHFDB5XAU1`。
- 问题：官方页面声明的型号与原始规格数据是什么。
- 临时完整页面只在 Crawlee 内存响应中；`persistStorage:false`，不创建 Crawlee 磁盘存储。
- 永久内容仅为命中型号的 JSON-LD 块或规格表文本；不解析属性、不清洗、不生成知识候选。
- 来源 origin 由本地配置显式允许；初始 URL 与重定向后的最终 URL 都校验。

## 真实命令

```bash
npm exec --yes --package=node@24 -- npm exec tsx docs/development/pocs/r026/src/haier-public-web-text.ts success
npm exec --yes --package=node@24 -- npm exec tsx docs/development/pocs/r026/src/midea-public-web-text.ts
npm exec --yes --package=node@24 -- npm exec tsx docs/development/pocs/r026/src/energy-label-regulatory-json.ts success
npm exec --yes --package=node@24 -- npm exec tsx docs/development/pocs/r026/src/energy-label-regulatory-json.ts missing
npm exec --yes --package=node@24 -- npm exec tsx docs/development/pocs/r026/src/haier-public-web-text.ts missing
npm exec --yes --package=node@24 -- npm exec tsx docs/development/pocs/r026/src/midea-manual-pdf.ts
npm exec --yes --package=node@24 -- npm exec tsx docs/development/pocs/r026/src/midea-manual-pdf.ts missing
npm exec --yes --package=node@24 -- npm exec tsx docs/development/pocs/r026/src/cnis-regulatory-xlsx.ts
npm exec --yes --package=node@24 -- npm exec tsx docs/development/pocs/r026/src/cnis-regulatory-xlsx.ts missing
npm exec --yes --package=node@24 -- npm exec tsx docs/development/pocs/r026/src/haier-product-image.ts
```

Workbench 实际提交通过 typed API 完成，输入绑定已冻结的项目版本、`official_catalog` 路线、`model_number` Knowledge Need 和 `household_refrigerator_cn` 目标。

## 结果

- 海尔样本：HTTP 200；原始 JSON-LD 3,997 bytes；SHA-256 hex `c4819d551a766ed09955c115205af4472f5de367127b8800b9571a26d47e529d`；包含目标型号。
- 美的样本：HTTP 200；原始 HTML 规格表文本 5,873 bytes；SHA-256 hex `3c11f72f24589a90d49c4806fad715b1f297ea742079945f6359c127e8970b06`；包含目标型号。
- 中国能效标识网公开备案详情：`BCD-501WSPM(Q)` 的 1,079-byte 原始 JSON，SHA-256 hex `9d7b01b670d89bdc0d40f83ff90c4832b1b6caca8722afc3016d0ce049494cc3`；包含备案号 `20241017-471100-92391729144470006`、生产者、能效等级、依据标准、耗电量和间室容积。
- 美的说明书：HTTP 200；完整 PDF 1,154,097 bytes，SHA-256 hex `bd173c352c759dea6a4128dcc4dda079b1a8102dec7a01f40f96846036ca2478`；`unpdf` 读取 16 页。型号会出现在 5 页，按本次“型号＋年综合耗电量＋外形尺寸”问题定位到第 14 页，保留 3,768-byte 原始页文本，SHA-256 hex `97c17f2d1bbea79422a82854bb5153503d157f1b9a5f467cbc38cc6fec6dbc96`。
- CNIS 监管表：服务器把 RAR 错标为 `text/plain`；Crawlee 强制二进制响应后由 `libarchive-wasm` 验证并解包。RAR 2,301,639 bytes、SHA-256 `d493ec919949a655c8d9dae9d0319ebaa5eacd257cfa2cf97dcefa618ac97f11`，共 14 个条目、13 个 XLSX；目标 2023 工作簿 307,787 bytes、SHA-256 `192e397e54cd5e9f6e5b5f0074c4a2a04e5f13931279c8b7664aeba0c9b0a173`。`read-excel-file` 在 sheet `结果` 中唯一定位表头 `A2:G2` 与型号行 `A479:G479`，永久内容仅为 261-byte 表头＋原始行 JSON，SHA-256 `7ddabeb88d2d9d94b2daa5485f0a1aad87da5edabe4ac6ce1f582b5040041093`。
- 海尔产品图：不带来源页 Referer 的首次真实请求为 HTTP 403；只加入产品页 Referer 与普通图片 Accept 后 HTTP 200，不使用 Cookie、认证、代理或反检测。`.png` URL 实际内容协商为 `image/webp`；`sharp` 验证 88,486 bytes、1200×1200、单帧 WebP，SHA-256 `90a96450d6c91ba5225cb78145fb3415630fff339f99be6e049d8c7a6f474ff6`。`sharp@0.35.3` 在 macOS arm64 真实运行，Linux x64 glibc 隔离安装同时解析到 `@img/sharp-linux-x64@0.35.3` 与 `@img/sharp-libvips-linux-x64@1.3.2`。
- 缺失样本：Crawlee 完成既定重试后返回 typed `evidence_not_found`，没有空内容成功。
- 海尔 Workbench：EvidenceRequest `request-d2ba7c17-c286-4c09-b9ce-f6a1c9e19af7`、SourceObservation `observation-9e5572bd-2230-480f-a0fd-ca91fe78aad6`、EvidenceItem `evidence-1cecd512-13f5-4819-a18b-9f29e20bbd51`；SRI `sha256-xIGdVRp2btCZVcEVIFr0Ry9d42cSe4gAuVcaJtR+Up0=`；充分性 `sufficient`。
- 美的 Workbench：EvidenceRequest `request-066f8c40-75ac-4c33-8677-514c07086141`、SourceObservation `observation-15ebdf60-d41f-4639-a29f-b3a9e1c8e0aa`、EvidenceItem `evidence-ff00ae46-d4d6-41d8-8229-4b9880f29993`；SRI `sha256-PBH3LyRYmpDUnEgG+tcVsfKX6nQgeZRfY1nBJ+iXCwY=`；充分性 `sufficient`。
- CNIS Workbench：EvidenceRequest `request-7bf21455-54e5-41e5-b93c-ddcc471bb5d9`、SourceObservation `observation-a6d6eebf-1cb3-4c86-a9dc-a336176bcf4b`、EvidenceItem `evidence-3c60c601-cb59-4c99-8fbd-fda7ca6223f6`；内容 SRI `sha256-fdq+uI0tnZSy2qVIXwoarYfaXtq+SsbOH1grUEAEEJM=`；manifest SRI `sha256-r+0CdanrN7slHxzOyGt92JrcRV/T1V09O1bPJ80EcOk=`；充分性 `sufficient`。
- API 重读与 Workbench 投影保留四份正式原始内容、来源 URL、字节数和 SRI；未添加品牌分支或属性 projector。PDF 仍因项目缺少 `official_manual` 路线而只保留 POC 结果；图片因二进制 API 读取投影尚未获确认而未提交。

## 退出成本与未通过项

Source Access 只依赖四个窄 interface：公开网页、能效详情、PDF 页摘录和 CNIS 监管表行；退出任一库时可替换对应 adapter，不影响 Evidence contract、PostgreSQL 或 CAS。当前已证明冰箱＋两个官方站点＋两种静态布局＋两个监管协议＋PDF 页摘录＋XLSX 最小区域＋整图字节验证；动态页面、图片正式读取投影、登录/验证/限流和三品类矩阵仍未通过完整 1A。PDF 尚未形成正式 EvidenceItem，因为当前已确认 Collection Board 没有 `official_manual` 路线；不得将它冒充 `brand_official_site`。

监管 POC 首次错误假设 `PlainResponse.rawBody` 存在，触发三次读取失败；根据 Crawlee `HttpCrawlingContext.body` 官方 union contract 重写后通过，没有保留 fallback。该来源需要“型号列表 → 备案详情”两步公开 POST JSON 协议；生产化只允许用薄 adapter 隔离该外部协议，不得将它写入通用 Evidence contract。

PDF POC 首次错误假设“型号只出现一页”，实际命中 5 页；该判定已删除，改为由 EvidenceRequest 的对象标识与章节线索共同定位唯一页。随后发现 `FileDownload` 3.18.1 的公开 TypeScript 构造签名不接受自定义 `Configuration`，不能可靠证明 `persistStorage:false`；隔离安装目录连同可能的临时 storage 已整体移入废纸篓。最终使用同属 Crawlee 的 `HttpCrawler` 并显式允许 `application/pdf`，其自定义配置受类型检查且真实成功/缺失路径均通过。完整 PDF 只存在本次内存响应，仓库和 Evidence CAS 均未保存完整文件。

CNIS POC 首次按响应头处理，因站点把 RAR 错标为 `text/plain` 被 Crawlee 拒绝；修正为 buffer 后由 libarchive 校验实际格式。第二个错误假设是“首行即表头”，真实 A1 是标题、表头在 A2；该假设已删除。成功和缺失型号路径都只在内存处理完整 RAR/XLSX，三个隔离目录均已移入废纸篓。

图片 POC 首次把 URL 后缀当格式并省略来源页 Referer，分别暴露 HTTP 403 和 PNG/WebP 不一致；两项错误假设均已删除。生产 Evidence 核心现在只接受能由 `sharp` 复核 hash、真实格式、尺寸和单帧属性的整图；裁片因尚不能从永久最小内容独立复核原图 hash，继续失败关闭。图片正式提交仍等待公共读取投影从单一文本字段变为明确的 UTF-8/base64 判别联合；在确认前不落生产入口。
