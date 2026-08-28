import { z } from "zod";
import { modelReasoningEffortSchema } from "@domain-analysis/shared";

const configSchema = z.object({
  nodeEnv: z.string().default("development"),
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().min(1).max(65535).default(4000),
  postgresDatabaseUrl: z.string()
    .default("postgresql://guojunxi@127.0.0.1:5432/domain_analysis"),
  interviewModelId: z.string().min(1).default("gpt-5.6-terra"),
  interviewReasoningEffort: modelReasoningEffortSchema.default("medium"),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): AppConfig {
  return configSchema.parse({
    nodeEnv: env.NODE_ENV,
    host: env.API_HOST,
    port: env.API_PORT,
    postgresDatabaseUrl: env.POSTGRES_DATABASE_URL,
    interviewModelId: env.INTERVIEW_MODEL_ID,
    interviewReasoningEffort: env.INTERVIEW_REASONING_EFFORT,
  });
}
