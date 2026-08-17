import { createHash } from "node:crypto";

import {
  createCrawleeEnergyLabelRecordSource,
  SourceAccessError,
} from "@domain-analysis/worker";

const mode = process.argv[2] ?? "success";
const productModel = mode === "missing" ? "MODEL-THAT-DOES-NOT-EXIST" : "BCD-501WSPM(Q)";
const source = createCrawleeEnergyLabelRecordSource({
  allowedOrigins: ["https://www.energylabel.com.cn"],
});

try {
  const capture = await source.captureByModel({ productModel, maximumBytes: 40_000 });
  console.log(JSON.stringify({
    mode,
    state: "accessible",
    endpoint: capture.finalUrl,
    bytes: new TextEncoder().encode(capture.content).byteLength,
    sha256: createHash("sha256").update(capture.content).digest("hex"),
    containsRequiredModel: capture.content.includes("BCD-501WSPM(Q)"),
    containsRegistrationNumber: capture.content.includes("20241017-471100-92391729144470006"),
  }));
} catch (error) {
  if (mode === "missing" && error instanceof SourceAccessError) {
    console.log(JSON.stringify({ mode, state: "failed", code: error.code }));
  } else {
    throw error;
  }
}
