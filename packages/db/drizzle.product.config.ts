import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/productKnowledgeSchema.ts",
  out: "../../drizzle/product-knowledge-postgres",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.POSTGRES_DATABASE_URL
      ?? "postgresql://guojunxi@127.0.0.1:5432/domain_analysis",
  },
});
