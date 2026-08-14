import test from "node:test";
import assert from "node:assert/strict";

import { assertExpectedFileType } from "./capture-files.mjs";

test("文件签名与预期一致时通过", () => {
  assert.doesNotThrow(() =>
    assertExpectedFileType(
      { ext: "pdf", mime: "application/pdf" },
      { ext: "pdf", mime: "application/pdf" },
    ),
  );
});

test("服务器伪装扩展名时失败关闭", () => {
  assert.throws(
    () =>
      assertExpectedFileType(
        { ext: "html", mime: "text/html" },
        { ext: "pdf", mime: "application/pdf" },
      ),
    /文件类型不符/,
  );
});
