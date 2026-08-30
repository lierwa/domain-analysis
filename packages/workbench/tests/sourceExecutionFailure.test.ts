import { describe, expect, it } from "vitest";

import {
  classifySourceExecutionFailure,
  isAccessRestrictionObservation,
} from "../src/sourceExecutionFailure";

describe("Source Execution 失败分类", () => {
  it("把可信 DNS SERVFAIL 归入瞬态传输失败", () => {
    expect(classifySourceExecutionFailure(new Error("可信 DoH 查询失败：DNS status 2")))
      .toBe("transient_transport");
  });

  it("把临时网关错误归入瞬态传输失败", () => {
    expect(classifySourceExecutionFailure(new Error("503 - ZOL 临时网关错误")))
      .toBe("transient_transport");
  });

  it("只把真实访问限制升级为来源停止信号", () => {
    expect(["login_required", "verification_required", "access_denied"]
      .every(isAccessRestrictionObservation)).toBe(true);
    expect(["not_found", "source_error", "accessible"]
      .some(isAccessRestrictionObservation)).toBe(false);
  });
});
