import { createHash } from "node:crypto";

import { createCrawleePublicWebTextSource } from "@domain-analysis/worker";

const source = createCrawleePublicWebTextSource({
  allowedOrigins: ["https://www.midea.cn"],
});

const capture = await source.capture({
  requestedUrl: "https://www.midea.cn/1/1000000000400692992139.html",
  selector: "#product_spec",
  requiredText: "BCD-501WSPM(Q)",
  maximumBytes: 40_000,
});

console.log(JSON.stringify({
  state: "accessible",
  status: capture.httpValidation.status,
  finalUrl: capture.finalUrl,
  bytes: new TextEncoder().encode(capture.content).byteLength,
  sha256: createHash("sha256").update(capture.content).digest("hex"),
  containsRequiredModel: capture.content.includes("BCD-501WSPM(Q)"),
}));
