"""Local image processing through verified OpenCV and RapidOCR components."""
import hashlib
import importlib.metadata
import json
import sys
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def models(root):
    names = ["ch_PP-OCRv5_det_mobile.onnx", "ch_PP-OCRv5_rec_mobile.onnx", "ch_ppocr_mobile_v2.0_cls_mobile.onnx"]
    manifest = json.loads((root / "models.json").read_text())
    selected = [item for item in manifest if item["filename"] in names]
    if len(selected) != 3:
        raise ValueError("Local OCR model manifest is incomplete")
    for item in selected:
        if sha((root / "models" / item["filename"]).read_bytes()) != item["sha256"]:
            raise ValueError("Local OCR model integrity check failed")
    return selected


def capabilities(job):
    import cv2
    import numpy
    from PIL import Image, ImageOps
    result = {"imageProcessing": True, "ocr": False, "pdf": "review", "detail": "图片处理已就绪；OCR 需要本地模型", "models": []}
    result["versions"] = {"opencv": cv2.__version__, "numpy": numpy.__version__, "pillow": Image.__version__}
    try:
        import rapidocr
        import onnxruntime
        result["models"] = models(Path(job["modelRoot"]))
        result["ocr"] = True
        result["versions"].update({"rapidocr": importlib.metadata.version("rapidocr"), "onnxruntime": onnxruntime.__version__})
        result["detail"] = "本地图片处理与 OCR 已就绪"
    except (ImportError, OSError, ValueError):
        pass
    return result


def image_array(filename):
    import cv2
    import numpy as np
    from PIL import Image, ImageOps
    # WHY：先用成熟图片解析器检查像素预算，再解码数组，限制压缩图片的内存放大。
    with Image.open(filename) as image:
        if image.width * image.height > 25_000_000:
            raise ValueError("Image exceeds the 25 megapixel processing budget")
        image.verify()
    with Image.open(filename) as image:
        oriented = ImageOps.exif_transpose(image)
        alpha = "A" in image.getbands() or "transparency" in image.info
        pixels = np.array(oriented.convert("RGBA" if alpha else "RGB"))
    return cv2.cvtColor(pixels, cv2.COLOR_RGBA2BGRA if alpha else cv2.COLOR_RGB2BGR)


def engine(root):
    from rapidocr import EngineType, ModelType, OCRVersion, RapidOCR
    models(root)
    params = {"Global.model_root_dir": str(root / "models"), "Global.text_score": 0.5,
              "EngineConfig.onnxruntime.intra_op_num_threads": 4, "EngineConfig.onnxruntime.inter_op_num_threads": 1}
    for backend in ["cuda", "coreml", "dml", "cann"]:
        params[f"EngineConfig.onnxruntime.use_{backend}"] = False
    for stage, version, name in [("Det", OCRVersion.PPOCRV5, "ch_PP-OCRv5_det_mobile.onnx"),
                                  ("Rec", OCRVersion.PPOCRV5, "ch_PP-OCRv5_rec_mobile.onnx"),
                                  ("Cls", OCRVersion.PPOCRV4, "ch_ppocr_mobile_v2.0_cls_mobile.onnx")]:
        params.update({f"{stage}.engine_type": EngineType.ONNXRUNTIME, f"{stage}.model_type": ModelType.MOBILE,
                       f"{stage}.ocr_version": version, f"{stage}.model_path": str(root / "models" / name)})
    return RapidOCR(params=params)


def recognize(job, original):
    result = engine(Path(job["modelRoot"]))(original)
    texts, scores = list(result.txts or ()), list(result.scores or ())
    boxes = result.boxes.tolist() if result.boxes is not None else []
    if len(texts) != len(scores) or len(texts) != len(boxes):
        raise ValueError("OCR result alignment failed")
    return [{"text": text, "confidence": float(score), "box": box}
            for text, score, box in zip(texts, scores, boxes)]


def write_png(path, image):
    import cv2
    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise ValueError("PNG encoding failed")
    Path(path).write_bytes(encoded.tobytes())


def inpaint(job, original, mask):
    import cv2
    import numpy as np
    if np.count_nonzero(mask) > mask.size * 0.1:
        raise ValueError("Watermark mask exceeds ten percent of the image")
    # WHY：只在已定位的字形区域运行 Telea，并验证遮罩外像素，避免批处理改写商品主体。
    result = original.copy()
    result[:, :, :3] = cv2.inpaint(original[:, :, :3], mask, 3, cv2.INPAINT_TELEA)
    changed = np.any(result != original, axis=2)
    outside = int(np.count_nonzero(changed & (mask == 0)))
    if outside:
        raise ValueError("Pixels outside the watermark mask changed")
    write_png(job["imageOutput"], result)
    return {"outsideMaskChangedPixels": outside, "width": result.shape[1], "height": result.shape[0]}


def automatic(job, original):
    import cv2
    import numpy as np
    if job["imageAction"] == "keep":
        write_png(job["imageOutput"], original)
        return {"outsideMaskChangedPixels": 0, "width": original.shape[1], "height": original.shape[0]}
    mask = np.zeros(original.shape[:2], dtype=np.uint8)
    for box in job["boxes"]:
        points = np.asarray(box, dtype=np.int32)
        if points.shape != (4, 2):
            raise ValueError("OCR watermark box must contain four points")
        cv2.fillPoly(mask, [points], 255)
    # WHY：OCR 框贴住字形边缘；小幅膨胀覆盖抗锯齿像素，同时仍受 10% 面积门限制。
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=2)
    write_png(job["mask"], mask)
    return inpaint(job, original, mask)


def main():
    job = json.loads(Path(sys.argv[1]).read_text())
    if job["action"] == "capabilities":
        value = capabilities(job)
    else:
        if sha(Path(job["input"]).read_bytes()) != job["sha256"]:
            raise ValueError("Source image hash mismatch")
        original = image_array(job["input"])
        value = {"dimensions": [original.shape[1], original.shape[0]], "lines": []}
        if job["action"] == "ocr":
            value["lines"] = recognize(job, original)
        if job["action"] == "automatic":
            value = automatic(job, original)
    Path(job["output"]).write_text(json.dumps(value, ensure_ascii=False))


if __name__ == "__main__":
    main()
