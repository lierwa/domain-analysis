import { createHash } from "node:crypto";

import {
  createCrawleePublicWebTextSource,
  SourceAccessError,
} from "@domain-analysis/worker";

const mode = process.argv[2] ?? "success";
const source = createCrawleePublicWebTextSource({
  allowedOrigins: ["https://www.haier.com"],
});

try {
  const capture = await source.capture({
    requestedUrl: "https://www.haier.com/cooling/20241126_252875.shtml",
    selector: "script[type='application/ld+json']",
    requiredText: mode === "missing" ? "MODEL-THAT-DOES-NOT-EXIST" : "BCD-500WGHFDB5XAU1",
    maximumBytes: 40_000,
  });
  console.log(JSON.stringify({
    mode,
    state: "accessible",
    status: capture.httpValidation.status,
    finalUrl: capture.finalUrl,
    bytes: new TextEncoder().encode(capture.content).byteLength,
    sha256: createHash("sha256").update(capture.content).digest("hex"),
    containsRequiredModel: capture.content.includes("BCD-500WGHFDB5XAU1"),
  }));
} catch (error) {
  if (mode === "missing" && error instanceof SourceAccessError) {
    console.log(JSON.stringify({ mode, state: "failed", code: error.code }));
  } else {
    throw error;
  }
}
