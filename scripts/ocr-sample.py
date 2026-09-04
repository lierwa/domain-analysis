"""Run the fixed Source Dataset OCR sample with preloaded local models."""

import argparse
import hashlib
import importlib.metadata
import json
import platform
import resource
import time
from pathlib import Path


def peak_rss_bytes():
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if platform.system() == "Darwin" else value * 1024)


def read_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--sample-ids", nargs="+", required=True)
    parser.add_argument("--run-name", required=True)
    return parser.parse_args()


def recognize(engine, item, root):
    from PIL import Image

    image_path = root / item["localPath"]
    actual_hash = hashlib.sha256(image_path.read_bytes()).hexdigest()
    if actual_hash != item["asset"]["contentHash"]:
        raise ValueError(f"Input hash mismatch: {item['sampleId']}")
    with Image.open(image_path) as image:
        dimensions = list(image.size)
    started = time.perf_counter()
    result = engine(str(image_path))
    seconds = time.perf_counter() - started
    texts = list(result.txts or ())
    scores = list(result.scores or ())
    boxes = result.boxes.tolist() if result.boxes is not None else []
    if not (len(texts) == len(scores) == len(boxes)):
        raise ValueError(f"OCR result alignment mismatch: {item['sampleId']}")
    # 空结果只说明当前模型未检出，不能替代人工判断图片里没有文字。
    return {
        "sampleId": item["sampleId"],
        "snapshotId": item["snapshotId"],
        "subjectId": item["subjectId"],
        "assetId": item["asset"]["id"],
        "sha256": actual_hash,
        "sourceUrl": item["asset"]["sourceUrl"],
        "sourceSection": item["section"],
        "sourceOrdinal": item["ordinal"],
        "dimensions": dimensions,
        "status": "text_detected" if texts else "no_text_detected",
        "reviewStatus": "pending_human_review",
        "wallSeconds": seconds,
        "engineSeconds": float(result.elapse or 0),
        "processPeakRssBytesSoFar": peak_rss_bytes(),
        "lines": [
            {"text": text, "confidence": float(score), "box": box}
            for text, score, box in zip(texts, scores, boxes)
        ],
    }


def make_engine(root):
    from rapidocr import EngineType, ModelType, OCRVersion, RapidOCR

    model_dir = root / "models"
    manifest = json.loads((root / "models.json").read_text())
    for model in manifest:
        actual_hash = hashlib.sha256((model_dir / model["filename"]).read_bytes()).hexdigest()
        if actual_hash != model["sha256"]:
            raise ValueError(f"Model hash mismatch: {model['filename']}")
    # 显式指定三个本地模型，防止库默认版本变化或在离线执行时触发下载。
    params = {
        "Global.model_root_dir": str(model_dir),
        "Global.text_score": 0.5,
        "EngineConfig.onnxruntime.intra_op_num_threads": 4,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        "EngineConfig.onnxruntime.use_cuda": False,
        "EngineConfig.onnxruntime.use_coreml": False,
        "EngineConfig.onnxruntime.use_dml": False,
        "EngineConfig.onnxruntime.use_cann": False,
    }
    for stage, version, filename in [
        ("Det", OCRVersion.PPOCRV5, "ch_PP-OCRv5_det_mobile.onnx"),
        ("Rec", OCRVersion.PPOCRV5, "ch_PP-OCRv5_rec_mobile.onnx"),
        ("Cls", OCRVersion.PPOCRV4, "ch_ppocr_mobile_v2.0_cls_mobile.onnx"),
    ]:
        params.update({
            f"{stage}.engine_type": EngineType.ONNXRUNTIME,
            f"{stage}.model_type": ModelType.MOBILE,
            f"{stage}.ocr_version": version,
            f"{stage}.model_path": str(model_dir / filename),
        })
    return RapidOCR(params=params)


def main():
    started = time.perf_counter()
    args = read_args()
    if platform.system() not in {"Darwin", "Linux"}:
        raise RuntimeError("This RSS benchmark currently measures macOS/Linux only")
    manifest = json.loads((args.root / "inputs.json").read_text())
    by_id = {item["sampleId"]: item for item in manifest["images"]}
    selected = [by_id[sample_id] for sample_id in args.sample_ids]
    initialized = time.perf_counter()
    engine = make_engine(args.root)
    startup_seconds = time.perf_counter() - initialized
    results = [recognize(engine, item, args.root) for item in selected]
    summary = {
        "platform": platform.platform(),
        "python": platform.python_version(),
        "packages": {name: importlib.metadata.version(name) for name in ["rapidocr", "onnxruntime"]},
        "threads": {"intraOp": 4, "interOp": 1},
        "backend": "ONNX Runtime CPU",
        "startupImportAndLoadSeconds": startup_seconds,
        "ocrTotalSeconds": sum(item["wallSeconds"] for item in results),
        "totalSeconds": time.perf_counter() - started,
        "processPeakRssBytes": peak_rss_bytes(),
        "sampleCount": len(results),
        "textLineCount": sum(len(item["lines"]) for item in results),
        "qualityGate": "pending_human_review",
        "modelManifest": "models.json",
        "inputsManifest": "inputs.json",
    }
    output = args.root / "results" / args.run_name
    output.mkdir(parents=True, exist_ok=False)
    (output / "ocr.jsonl").write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in results))
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, ensure_ascii=False))
    for item in results:
        print(json.dumps({key: item[key] for key in ["sampleId", "status", "dimensions", "wallSeconds"]}))


if __name__ == "__main__":
    main()
