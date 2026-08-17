import { describe, expect, it } from "vitest";

import {
  createCrawleeEnergyLabelRecordSource,
  parseEnergyLabelRegistrationList,
} from "../src";

describe("EnergyLabelRecordSource", () => {
  it("在网络请求前拒绝未授权的监管来源 origin", async () => {
    const source = createCrawleeEnergyLabelRecordSource({
      allowedOrigins: ["https://www.haier.com"],
    });

    await expect(source.captureByModel({
      productModel: "BCD-501WSPM(Q)",
      maximumBytes: 40_000,
    })).rejects.toMatchObject({ code: "origin_not_allowed" });
  });

  it("保留同一型号的全部合法备案，不在 Source 内静默选最新", () => {
    const records = parseEnergyLabelRegistrationList({
      code: 200,
      data: {
        total: 2,
        list: [
          {
            id: 1009904,
            productModel: "BCD-500WGHFDB5XAU1",
            productTypeCode: "81",
            producerName: "海尔智家股份有限公司",
            registrationNumber: "20241211-471100-81411733896020014",
          },
          {
            id: 1009383,
            productModel: "BCD-500WGHFDB5XAU1",
            productTypeCode: "81",
            producerName: "海尔智家股份有限公司",
            registrationNumber: "20241016-471100-62361729048470007",
          },
        ],
      },
    }, "BCD-500WGHFDB5XAU1");

    expect(records).toHaveLength(2);
    expect(new Set(records.map((item) => item.producerName))).toEqual(new Set(["海尔智家股份有限公司"]));
  });
});
