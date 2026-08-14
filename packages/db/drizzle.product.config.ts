import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/productKnowledgeSchema.ts",
  out: "../../drizzle/product-knowledge",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.PRODUCT_KNOWLEDGE_DATABASE_URL
      ?? "file:data/product-knowledge-workbench.sqlite",
  },
});
