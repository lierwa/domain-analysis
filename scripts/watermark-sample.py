"""Compare local OpenCV watermark treatments for the fixed OCR sample."""

import argparse
import hashlib
import html
import importlib.metadata
import json
import re
import runpy
import time
from pathlib import Path

import cv2
import numpy as np


def is_watermark(text):
    # ZOL 标记属于本次来源规则，不参与商品正文的语义判断。
    return bool(re.search(r"z[o0]l|中关村|关村在", text, re.IGNORECASE))


def make_template(root, profile, by_id):
    item = by_id[profile["templateSampleId"]]
    path = root / item["localPath"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != item["asset"]["contentHash"]:
        raise ValueError("Template source identity mismatch")
    source = cv2.imread(str(path))
    left, top, right, bottom = profile["templateBounds"]
    region = np.zeros(source.shape[:2], dtype=np.uint8)
    region[top:bottom, left:right] = 255
    # 模板来自已检查的平滑背景图；这里只估计模板底色，不重绘目标商品的矩形区域。
    background = cv2.inpaint(source, region, 3, cv2.INPAINT_NS)
    gray = cv2.cvtColor(source[top:bottom, left:right], cv2.COLOR_BGR2GRAY)
    base = cv2.cvtColor(background[top:bottom, left:right], cv2.COLOR_BGR2GRAY)
    _, glyph = cv2.threshold(cv2.absdiff(gray, base), profile["supportThreshold"] - 1, 255, cv2.THRESH_BINARY)
    glyph = cv2.dilate(glyph, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    return {"gray": gray, "glyph": glyph, "sourceSha256": item["asset"]["contentHash"]}


def locate(source, template, calibration, profile):
    left, top, right, bottom = calibration["searchBounds"]
    search = cv2.cvtColor(source[top:bottom, left:right], cv2.COLOR_BGR2GRAY)
    scores = cv2.matchTemplate(cv2.Laplacian(search, cv2.CV_32F),
                               cv2.Laplacian(template["gray"], cv2.CV_32F), cv2.TM_CCOEFF_NORMED)
    _, score, _, point = cv2.minMaxLoc(scores)
    if score < profile["minimumMatchScore"]:
        raise ValueError(f"Template match below sample gate: {score:.3f}")
    height, width = template["glyph"].shape
    x, y = left + point[0], top + point[1]
    return {"bounds": [x, y, x + width, y + height], "templateScore": score}


def edge_check(image, reference):
    # 验收坐标取自原图未遮挡的直边，和修补参数分开保存；色差可抑制白色水印的亮度干扰。
    chroma = image[:, :, 2].astype(float) - image[:, :, 0]
    left, right = reference["searchX"]
    start, end = reference["checkRows"]
    edges = [left + int(np.argmax(chroma[row, left:right] > reference["threshold"])) for row in range(start, end)]
    deviation = np.abs(np.array(edges) - reference["edgeReferenceX"])
    return {"maxDeviationPixels": float(deviation.max()),
            "p95DeviationPixels": float(np.percentile(deviation, 95)),
            "passed": bool(deviation.max() <= reference["maxAllowedDeviationPixels"])}


def repair(source, mask, cuts, flag):
    result = source.copy()
    boundaries = [0, *cuts, source.shape[1]]
    # 已标定的商品边界分开修补，避免背景颜色填入机身；未知图不自动推断这条边界。
    for left, right in zip(boundaries, boundaries[1:]):
        result[:, left:right] = cv2.inpaint(source[:, left:right].copy(), mask[:, left:right].copy(), 3, flag)
    return result


def process(item, original, root, output, template, profile):
    source_path = root / item["localPath"]
    digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
    if digest != item["asset"]["contentHash"] or digest != original["sha256"]:
        raise ValueError(f"Input identity mismatch: {item['sampleId']}")
    source = cv2.imread(str(source_path))
    if source is None:
        raise ValueError(f"Unreadable image: {item['sampleId']}")
    calibration = profile["calibratedSamples"].get(item["sampleId"])
    started = time.perf_counter()
    location = locate(source, template, calibration, profile) if calibration else None
    seconds = time.perf_counter() - started
    record = {
        "sampleId": item["sampleId"], "sourceSnapshotId": item["snapshotId"],
        "sourceAssetId": item["asset"]["id"], "sourceSha256": digest,
        "sourcePath": item["localPath"], "dimensions": list(source.shape[1::-1]),
        "sourceSection": item["section"], "sourceUrl": item["asset"]["sourceUrl"],
        "originalOcr": original, "location": location,
        "locationSeconds": seconds, "variants": [], "calibration": calibration,
        "templateSourceSha256": template["sourceSha256"],
        "status": "pending_visual_review" if location else "needs_sample_calibration",
    }
    if location is None:
        return record
    left, top, right, bottom = location["bounds"]
    mask = np.zeros(source.shape[:2], dtype=np.uint8)
    mask[top:bottom, left:right] = template["glyph"]
    mask_path = output / f"{item['sampleId']}-mask.png"
    if not cv2.imwrite(str(mask_path), mask):
        raise OSError("Cannot write mask")
    record["maskPath"] = mask_path.name
    record["maskFraction"] = float(np.count_nonzero(mask) / mask.size)
    record["overlappingText"] = []
    for line in original["lines"]:
        polygon = np.zeros_like(mask)
        cv2.fillPoly(polygon, [np.array(line["box"], dtype=np.int32)], 255)
        if not is_watermark(line["text"]) and np.any((polygon > 0) & (mask > 0)):
            record["overlappingText"].append(line["text"])
    for method, flag in [("telea", cv2.INPAINT_TELEA), ("navier-stokes", cv2.INPAINT_NS)]:
        started = time.perf_counter()
        repaired = repair(source, mask, calibration["verticalBoundaryCuts"], flag)
        seconds = time.perf_counter() - started
        path = output / f"{item['sampleId']}-{method}.png"
        if not cv2.imwrite(str(path), repaired):
            raise OSError("Cannot write derivative")
        decoded = cv2.imread(str(path))
        outside_changed = int(np.count_nonzero(np.any(decoded != source, axis=2) & (mask == 0)))
        if decoded.shape != source.shape or outside_changed:
            raise ValueError(f"Pixel preservation failed: {item['sampleId']}")
        edge = edge_check(decoded, calibration["edgeReference"]) if "edgeReference" in calibration else None
        if edge and not edge["passed"]:
            raise ValueError(f"Product boundary regression: {item['sampleId']}")
        record["variants"].append({
            "method": method, "path": path.name, "seconds": seconds,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "outsideMaskChangedPixels": outside_changed, "edgeCheck": edge,
        })
    if hashlib.sha256(source_path.read_bytes()).hexdigest() != digest:
        raise ValueError("Original changed during processing")
    return record


def image_panel(record, path, label, zoom=False):
    width, height = record["dimensions"]
    location = record["location"]
    view = f"0 0 {width} {height}"
    mark = ""
    if zoom and location:
        left, top, right, bottom = location["bounds"]
        left, top = max(0, left - 30), max(0, top - 30)
        view = f"{left} {top} {min(width, right + 30) - left} {min(height, bottom + 30) - top}"
    if location and not zoom:
        left, top, right, bottom = location["bounds"]
        mark = f'<rect class="mask-outline" x="{left}" y="{top}" width="{right-left}" height="{bottom-top}"/>'
    return f'''<figure><figcaption>{html.escape(label)}</figcaption>
<a href="{html.escape(path)}" target="_blank"><svg role="img" aria-label="{html.escape(label)}" viewBox="{view}">
<image href="{html.escape(path)}" width="{width}" height="{height}"/>{mark}</svg></a></figure>'''


def review_article(record):
    original_path = "../../" + record["sourcePath"]
    paths = [(original_path, "原图"), *[(v["path"], "字形处理 A · Telea" if v["method"] == "telea" else "字形处理 B · Navier-Stokes") for v in record["variants"]]]
    panels = "".join(image_panel(record, path, label) for path, label in paths)
    zooms = "".join(image_panel(record, path, label, True) for path, label in paths) if record["location"] else ""
    lines = record["originalOcr"]["lines"]
    rows = "".join(f'<tr><td>{i+1}</td><td>{html.escape(line["text"])}</td><td>{line["confidence"]:.1%}</td></tr>' for i, line in enumerate(lines))
    status = "已生成字形处理结果，待看图验收" if record["location"] else "样本待标定，本图展示原图及 OCR"
    overlaps = record.get("overlappingText", [])
    note = f'处理区域与原 OCR 的「{html.escape("、".join(overlaps))}」相交，请核对该文字是否属于水印。' if overlaps else ""
    edge = next((v["edgeCheck"] for v in record["variants"] if v.get("edgeCheck")), None)
    if edge:
        note += f' 本图机身直边已标定，当前最大偏移 {edge["maxDeviationPixels"]:.0f} 像素。'
    metadata = html.escape(json.dumps({key: record.get(key) for key in ["sourceSnapshotId", "sourceAssetId", "sourceSha256", "location", "calibration", "variants"]}, ensure_ascii=False, indent=2))
    return f'''<article id="{record['sampleId']}"><header><h2>{record['sampleId']} <small>{html.escape(record['sourceSection'])}</small></h2><span>{status}</span></header>
<div class="panels">{panels}</div><div class="zooms">{zooms}</div><p class="notice">{note}</p>
<details open><summary>原图 OCR · {len(lines)} 行文字候选</summary><table><thead><tr><th>行</th><th>原始识别文字</th><th>置信度</th></tr></thead><tbody>{rows}</tbody></table></details>
<details><summary>来源、处理区域与运行记录</summary>{f'<a href="{record["maskPath"]}" target="_blank">查看字形处理范围（白色像素）</a>' if record.get("maskPath") else ''}<pre>{metadata}</pre></details></article>'''


def write_review(results, summary, output):
    ordered = sorted(results, key=lambda record: (not any(v.get("edgeCheck") for v in record["variants"]), record["location"] is None, record["sampleId"]))
    nav = "".join(f'<a href="#{record["sampleId"]}">{record["sampleId"]}</a>' for record in ordered)
    articles = "".join(review_article(record) for record in ordered)
    lines = sum(len(record["originalOcr"]["lines"]) for record in results)
    page = f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OCR 与去水印效果对照</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f3f5f7;color:#17202d;font:15px/1.6 system-ui,sans-serif}}main{{max-width:1540px;margin:auto;padding:24px}}
h1{{font-size:28px;margin:0 0 10px}}h2{{font-size:21px;margin:0}}small{{font-size:14px;font-weight:400;color:#617083}}p{{margin:8px 0}}
nav{{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}}a{{color:#1855a0}}nav a{{padding:5px 10px;background:white;border-radius:6px;text-decoration:none}}
article{{background:white;border:1px solid #dae0e7;border-radius:12px;margin:24px 0;padding:20px;scroll-margin-top:10px}}
header{{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}}header span{{font-size:13px;color:#755513}}
.panels,.zooms{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}}figure{{margin:0}}figcaption{{font-size:13px;font-weight:600;padding:6px 0}}
svg{{display:block;width:100%;height:510px;background:#f7f7f8;border:1px solid #e0e4e9}}.zooms{{margin:16px 0}}.zooms svg{{height:190px}}
.mask-outline{{fill:none;stroke:#e64072;stroke-width:2;display:none}}.show-masks .mask-outline{{display:block}}label{{display:inline-block;margin:10px 0;cursor:pointer}}
table{{border-collapse:collapse;width:100%;max-width:860px}}td,th{{padding:7px 12px;border-bottom:1px solid #e6eaf0;text-align:left}}th{{font-size:13px;color:#607084}}
details{{margin-top:15px}}summary{{cursor:pointer;font-weight:600}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f5f7fa;padding:12px}}
.notice{{color:#865810}}.meta{{color:#617083}}@media(max-width:760px){{main{{padding:12px}}article{{padding:12px}}header{{display:block}}.panels,.zooms{{gap:6px}}svg{{height:290px}}.zooms svg{{height:110px}}figcaption{{font-size:11px}}}}
</style></head><body><main><h1>OCR 与去水印效果对照</h1>
<p>{len(results)} 张原图 · {lines} 行 OCR · {summary['located']} 张已生成字形处理结果 · {len(results)-summary['located']} 张样本待标定</p>
<p>页首展示机身直边样本，请检查商品边缘、局部纹理和水印残留。点击图片可打开完整尺寸。当前为已标定小样，视觉效果待复核。</p>
<p class="meta">模板定位 {summary['locationSeconds']:.3f} 秒；两种修补合计 {summary['inpaintSeconds']:.3f} 秒。OCR 复用原图结果。边界位置来自样本标注，批量自动处理尚未验收。</p>
<label><input id="mask-toggle" type="checkbox"> 在完整图上显示水印定位框</label><nav>{nav}</nav>{articles}
</main><script>document.getElementById('mask-toggle').addEventListener('change',e=>document.body.classList.toggle('show-masks',e.target.checked));</script></body></html>'''
    (output / "review.html").write_text(page)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--run-name", required=True)
    parser.add_argument("--sample-ids", nargs="+", required=True)
    parser.add_argument("--ocr-run", default="watermark-originals")
    parser.add_argument("--profile", type=Path, required=True)
    args = parser.parse_args()
    started = time.perf_counter()
    manifest = json.loads((args.root / "inputs.json").read_text())
    by_id = {item["sampleId"]: item for item in manifest["images"]}
    originals = [json.loads(line) for line in (args.root / "results" / args.ocr_run / "ocr.jsonl").read_text().splitlines()]
    by_original = {record["sampleId"]: record for record in originals}
    output = args.root / "results" / args.run_name
    output.mkdir(parents=True, exist_ok=False)
    ocr = runpy.run_path(str(Path(__file__).with_name("ocr-sample.py")))
    profile = json.loads(args.profile.read_text())
    template = make_template(args.root, profile, by_id)
    results = [process(by_id[key], by_original[key], args.root, output, template, profile) for key in args.sample_ids]
    summary = {
        "samples": len(results), "located": sum(record["location"] is not None for record in results),
        "variants": sum(len(record["variants"]) for record in results),
        "locationSeconds": sum(record["locationSeconds"] for record in results),
        "inpaintSeconds": sum(variant["seconds"] for record in results for variant in record["variants"]),
        "totalSeconds": time.perf_counter() - started,
        "processPeakRssBytes": ocr["peak_rss_bytes"](),
        "opencvPython": importlib.metadata.version("opencv-python"),
        "humanReviewStatus": "pending", "originalOcrRun": args.ocr_run,
        "profileSha256": hashlib.sha256(args.profile.read_bytes()).hexdigest(),
        "processingProfile": profile,
    }
    (output / "watermark.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    write_review(results, summary, output)
    print(json.dumps(summary, ensure_ascii=False))
    for record in results:
        print(json.dumps({key: record.get(key) for key in ["sampleId", "status", "location", "overlappingText"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
