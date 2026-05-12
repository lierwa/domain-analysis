import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunStatusBadge } from "./RunStatusBadge";

describe("RunStatusBadge", () => {
  it("renders login-required runs as a recoverable status", () => {
    const html = renderToStaticMarkup(<RunStatusBadge status="login_required" />);

    expect(html).toContain("Login Required");
    expect(html).toContain("amber");
    expect(html).not.toContain("Failed");
  });
});
