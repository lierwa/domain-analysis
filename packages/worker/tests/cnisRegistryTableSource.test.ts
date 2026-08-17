import { describe, expect, it } from "vitest";

import { createCnisRegistryTableSource } from "../src";

describe("CnisRegistryTableSource", () => {
  it("在网络请求前拒绝未授权的监管附件 origin", async () => {
    const source = createCnisRegistryTableSource({
      allowedOrigins: ["https://www.energylabel.com.cn"],
    });

    await expect(source.captureByModel({
      productModel: "MR-457WUSPZE",
      year: 2023,
      maximumArchiveBytes: 10 * 1024 * 1024,
      maximumEvidenceBytes: 4096,
    })).rejects.toMatchObject({ code: "origin_not_allowed" });
  });
});
