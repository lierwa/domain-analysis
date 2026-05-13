import { z } from "zod";

export const aiProviderSchema = z.enum(["openai-compatible", "openai", "anthropic", "google"]);

export interface AiProviderConfig {
  provider: z.infer<typeof aiProviderSchema>;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface AiProviderStatus {
  configured: boolean;
  provider: AiProviderConfig["provider"];
  model?: string;
  baseUrl?: string;
}

export function loadAiProviderConfig(env: NodeJS.ProcessEnv = process.env): AiProviderConfig {
  const provider = parseProvider(env.AI_PROVIDER);
  const model = env.AI_MODEL?.trim();
  const apiKey = env.AI_API_KEY?.trim();
  if (!model || !apiKey) {
    throw Object.assign(new Error("ai_provider_not_configured"), { statusCode: 400 });
  }
  return {
    provider,
    model,
    apiKey,
    baseUrl: env.AI_BASE_URL?.trim() || undefined
  };
}

export function getAiProviderStatus(env: NodeJS.ProcessEnv = process.env): AiProviderStatus {
  const provider = parseProvider(env.AI_PROVIDER);
  const model = env.AI_MODEL?.trim() || undefined;
  const configured = Boolean(model && env.AI_API_KEY?.trim());
  return {
    configured,
    provider,
    model,
    baseUrl: env.AI_BASE_URL?.trim() || undefined
  };
}

function parseProvider(value: string | undefined) {
  const parsed = aiProviderSchema.safeParse(value?.trim() || "openai-compatible");
  if (!parsed.success) {
    throw Object.assign(new Error("unsupported_ai_provider"), { statusCode: 400 });
  }
  return parsed.data;
}
