import { type output, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { CodexAppServerError } from "./codexAppServerClient";

const unsupportedCodexSchemaKeywords = [
  "format", "pattern", "minLength", "maxLength", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems",
];

export function zodSchemaToCodexJsonSchema(schema: ZodTypeAny) {
  return convertSchema(schema, ["format"]);
}

export function zodSchemaToCodexOutputSchema(schema: ZodTypeAny) {
  const generated = convertSchema(schema, unsupportedCodexSchemaKeywords);
  const { $schema: _schemaVersion, ...outputSchema } = generated;
  return outputSchema;
}

function convertSchema(schema: ZodTypeAny, removedKeywords: string[]) {
  return zodToJsonSchema(schema, {
    target: "openAi",
    $refStrategy: "none",
    postProcess: (jsonSchema) => {
      if (!jsonSchema || typeof jsonSchema !== "object") return jsonSchema;
      const supportedSchema = { ...jsonSchema } as Record<string, unknown>;
      for (const keyword of removedKeywords) delete supportedSchema[keyword];
      return supportedSchema as typeof jsonSchema;
    },
  });
}

export function parseCodexStructuredOutput<TSchema extends ZodTypeAny>(input: {
  text: string;
  schema: TSchema;
  label: string;
  observedEvents: string[];
}): output<TSchema> {
  let value: unknown;
  try {
    value = JSON.parse(input.text);
  } catch (error) {
    throw new CodexAppServerError(
      "invalid_output",
      `${input.label}不是合法 JSON，本轮未保存，请重试。`,
      diagnostic(input, error),
    );
  }
  const parsed = input.schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    return `${path}: ${issue.message}`;
  });
  throw new CodexAppServerError(
    "invalid_output",
    `${input.label}不符合协议（${issues.join("；")}），本轮未保存，请重试。`,
    diagnostic(input, parsed.error),
  );
}

function diagnostic(input: { text: string; observedEvents: string[] }, error: unknown) {
  return [
    `textLength=${input.text.length}`,
    `events=${input.observedEvents.join(",")}`,
    `error=${error instanceof Error ? error.message : String(error)}`,
  ].join(" ").slice(-4_000);
}
