import { readFile, writeFile } from "node:fs/promises";

import Form from "@rjsf/core";
import validator from "@rjsf/validator-ajv8";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const schema = JSON.parse(
  await readFile(new URL("./knowledge-use-brief.schema.json", import.meta.url), "utf8"),
);

// WHY：这里只验证成熟表单库能消费生成 schema，不实现动态表单能力。
const markup = renderToStaticMarkup(
  React.createElement(Form, {
    schema,
    validator,
    noHtml5Validate: true,
    showErrorList: false,
  }),
);

await writeFile(new URL("./knowledge-use-brief.form.html", import.meta.url), markup);

const requiredLabels = [
  "knowledge_topic",
  "knowledge_purposes",
  "competency_questions",
  "freshness_need",
  "quality_risk",
];

for (const label of requiredLabels) {
  if (!markup.includes(label)) {
    throw new Error(`RJSF output is missing field: ${label}`);
  }
}

if (!markup.includes("shopping_comparison") || !markup.includes("balanced")) {
  throw new Error("RJSF output is missing enum choices");
}

console.log(
  JSON.stringify({
    htmlBytes: Buffer.byteLength(markup),
    requiredLabels,
    enumChoicesPresent: true,
  }),
);
