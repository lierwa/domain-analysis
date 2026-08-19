import { type output, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { CodexAppServerError } from "./codexAppServerClient";

export function zodSchemaToCodexJsonSchema(schema: ZodTypeAny) {
  return zodToJsonSchema(schema, {
    target: "openAi",
    $refStrategy: "none",
    postProcess: (jsonSchema) => {
      if (!jsonSchema || !("format" in jsonSchema)) return jsonSchema;
      // WHY：Codex strict schema 不接受 uri/date-time 等 format；最终结果仍由原始 Zod 完整校验。
      const { format: _unsupportedFormat, ...supportedSchema } = jsonSchema;
      return supportedSchema;
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
