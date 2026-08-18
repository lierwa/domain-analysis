import { z } from "zod";

const configSchema = z.object({
  nodeEnv: z.string().default("development"),
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().min(1).max(65535).default(4000),
  databaseUrl: z.string().default("file:../../data/domain-analysis.sqlite"),
  postgresDatabaseUrl: z.string()
    .default("postgresql://guojunxi@127.0.0.1:5432/domain_analysis"),
  evidenceRoot: z.string().min(1).default("data/evidence"),
  knowledgePackageRoot: z.string().min(1).default("data/knowledge-packages"),
  interviewModelId: z.string().min(1).default("gpt-5.6-terra"),
  interviewReasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).default("medium"),
  // WHY：批次候选用途已单独验收固定模型；拒绝从采访或本机默认设置隐式继承。
  knowledgeFactoryModelId: z.literal("gpt-5.3-codex-spark").default("gpt-5.3-codex-spark"),
  knowledgeFactoryReasoningEffort: z.literal("low").default("low"),
  jdCdpEndpoint: z.string().url().default("http://127.0.0.1:9223"),
  // WHY：这些 origin 已被当前确认来源策略和 R-010 实测限定；环境变量仍可收窄或替换。
  collectionAllowedOrigins: z.array(z.string().url()).default([
    "https://www.haier.com",
    "https://www.leader.com.cn",
    "https://www.midea.cn",
    "https://www.tcl.com",
    "https://www.hisense.com",
    "https://mlmall.meiling.com",
    "https://www.konka.com",
    "https://www.siemens-home.bsh-group.cn",
    "https://www.rsdgroup.com.cn",
    "https://www.jd.com",
    "https://item.jd.com",
    "https://www.energylabel.com.cn",
    "https://www.cnis.ac.cn",
    "https://www.nist.gov",
    "https://www.fsis.usda.gov",
    "https://www.energy.gov",
    "https://data.energystar.gov",
  ]),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): AppConfig {
  return configSchema.parse({
    nodeEnv: env.NODE_ENV,
    host: env.API_HOST,
    port: env.API_PORT,
    databaseUrl: env.DATABASE_URL,
    postgresDatabaseUrl: env.POSTGRES_DATABASE_URL,
    evidenceRoot: env.EVIDENCE_ROOT,
    knowledgePackageRoot: env.KNOWLEDGE_PACKAGE_ROOT,
    interviewModelId: env.INTERVIEW_MODEL_ID,
    interviewReasoningEffort: env.INTERVIEW_REASONING_EFFORT,
    knowledgeFactoryModelId: env.KNOWLEDGE_FACTORY_MODEL_ID,
    knowledgeFactoryReasoningEffort: env.KNOWLEDGE_FACTORY_REASONING_EFFORT,
    jdCdpEndpoint: env.JD_CDP_ENDPOINT,
    collectionAllowedOrigins: env.COLLECTION_ALLOWED_ORIGINS
      ? env.COLLECTION_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)
      : undefined,
  });
}
