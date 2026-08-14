import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataRoot = path.join(projectRoot, "data/pocs");

export const sampleInputs = {
  variants: [
    {
      id: "I01",
      sourceObjectId: "midea:1000000000400692547080",
      htmlPath: path.join(
        dataRoot,
        "r001/attempts-patchright/2026-08-14T08-54-16.683Z-498a4246/S02/page.html",
      ),
      metadataPath: path.join(
        dataRoot,
        "r001/attempts-patchright/2026-08-14T08-54-16.683Z-498a4246/S02/metadata.json",
      ),
    },
    {
      id: "I02",
      sourceObjectId: "midea:1000000000400692547081",
      htmlPath: path.join(
        dataRoot,
        "r001/attempts-patchright/2026-08-14T08-55-25.570Z-f7533e01/S03/page.html",
      ),
      metadataPath: path.join(
        dataRoot,
        "r001/attempts-patchright/2026-08-14T08-55-25.570Z-f7533e01/S03/metadata.json",
      ),
    },
  ],
  manual: {
    id: "I03",
    sourceObjectId: "midea:manual:MR-457WUSPZE",
    path: path.join(
      dataRoot,
      "r001/file-attempts/2026-08-14T09-34-33.105Z/F01/midea-mr-457wuspze-manual.pdf",
    ),
    metadataPath: path.join(
      dataRoot,
      "r001/file-attempts/2026-08-14T09-34-33.105Z/F01/metadata.json",
    ),
  },
  registry: {
    id: "I04",
    sourceObjectId: "cnis:refrigerator-energy:2023:MR-457WUSPZE",
    path: path.join(
      dataRoot,
      "r014/inputs/regulatory/1 家用电冰箱电冰箱（2016.08-2024.12）/家用电冰箱2015版标准 （2023年1月-12月）.xlsx",
    ),
    sheet: "结果",
    row: 479,
    model: "MR-457WUSPZE",
  },
  marketplace: [
    {
      id: "I05",
      sourceObjectId: "jd:100062957294",
      modelKey: "MIDEA:MR-531WSPZE",
      brand: "美的",
      model: "MR-531WSPZE",
      path: path.join(
        dataRoot,
        "r001/sanitized-attempts-patchright/2026-08-14T08-19-43.912Z-641021a4/S05/projection.json",
      ),
    },
    {
      id: "I06",
      sourceObjectId: "jd:100044587428",
      modelKey: "HAIER:BCD-505WGHTD14S8U1",
      brand: "海尔",
      model: "BCD-505WGHTD14S8U1",
      path: path.join(
        dataRoot,
        "r001/sanitized-attempts-patchright/2026-08-14T08-20-25.615Z-a2245b0b/S06/projection.json",
      ),
    },
  ],
};

export const unitHints = {
  "电源电压（V）": { source: "V", canonical: "V" },
  "总容积（L）": { source: "L", canonical: "L" },
  "冷冻室容积（L）": { source: "L", canonical: "L" },
  "冷藏室容积（L）": { source: "L", canonical: "L" },
  "变温容积（L）": { source: "L", canonical: "L" },
  "产品净重(kg)：": { source: "kg", canonical: "kg" },
  "包装重量(kg)：": { source: "kg", canonical: "kg" },
};
