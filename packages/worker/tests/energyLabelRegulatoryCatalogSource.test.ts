import type { EnergyLabelRecordSource } from "../src/energyLabelRecordSource";
import { createEnergyLabelRegulatoryCatalogSource } from "../src/energyLabelRegulatoryCatalogSource";
import { describe, expect, it, vi } from "vitest";

describe("EnergyLabelRegulatoryCatalogSource", () => {
  it("逐型号保留全部备案并把缺失记录成 partial outcome", async () => {
    const records = vi.fn(async ({ productModel }: { productModel: string }) => {
      if (productModel === "MR-404") return [];
      return [
        registration(1, productModel, "海尔智家股份有限公司", "record-1"),
        registration(2, productModel, "海尔智家股份有限公司", "record-2"),
      ];
    });
    const source = createEnergyLabelRegulatoryCatalogSource({
      energyLabels: {
        requestedUrl: "https://www.energylabel.com.cn/admin-api/gateway/productRegistration/productDetailById",
        findRegistrationsByModel: records,
        captureByModel: vi.fn(),
      } as EnergyLabelRecordSource,
      now: () => new Date("2026-08-16T12:00:00.000Z"),
    });

    const result = await source.reconcile([
      { brand: "海尔", manufacturerModel: "BCD-500" },
      { brand: "海尔", manufacturerModel: "BCD-500" },
      { brand: "美的", manufacturerModel: "MR-404" },
    ]);

    expect(records).toHaveBeenCalledTimes(2);
    expect(result.snapshot).toMatchObject({
      sourceAuthorityType: "regulatory_source",
      coverageKind: "regulatory_registry_lookup",
      coverageStatus: "partial",
      acceptedItemCount: 2,
    });
    expect(result.snapshot.entries).toHaveLength(2);
    expect(result.outcomes).toEqual([
      expect.objectContaining({ manufacturerModel: "BCD-500", status: "matched", registrationCount: 2 }),
      expect.objectContaining({ manufacturerModel: "MR-404", status: "not_found", registrationCount: 0 }),
    ]);
  });
});

function registration(id: number, productModel: string, producerName: string, registrationNumber: string) {
  return { id, productModel, productTypeCode: "81", producerName, registrationNumber };
}
