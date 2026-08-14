import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "../../../../packages/db/src/schema.ts",
  out: "./generated",
  dialect: "sqlite",
  dbCredentials: {
    url: "file:./migration-poc.sqlite",
  },
});
