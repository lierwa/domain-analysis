import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  zodSchemaToCodexJsonSchema,
  zodSchemaToCodexOutputSchema,
} from "../src/codexStructuredOutput";

describe("Codex structured output schema", () => {
  it("只向 App Server 发送结构约束，业务值约束留给本地 Zod", () => {
    const schema = z.object({
      id: z.string().trim().min(1).max(20).regex(/^item-/),
      count: z.number().int().positive().max(10),
      values: z.array(z.enum(["a", "b"])).min(1).max(3),
    }).strict();

    const output = zodSchemaToCodexOutputSchema(schema);
    const serialized = JSON.stringify(output);

    expect(output).toMatchObject({
      type: "object",
      required: ["id", "count", "values"],
      additionalProperties: false,
    });
    for (const keyword of [
      "$schema", "format", "pattern", "minLength", "maxLength", "minimum", "maximum",
      "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems",
    ]) expect(serialized).not.toContain(`"${keyword}"`);
    expect(JSON.stringify(zodSchemaToCodexJsonSchema(schema))).toContain('"minItems":1');
  });
});
