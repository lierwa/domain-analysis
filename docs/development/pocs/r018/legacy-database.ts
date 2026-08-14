import { initializeDatabase } from "../../../../packages/db/src/client";

const databaseUrl = process.argv[2];
if (!databaseUrl?.startsWith("file:")) throw new Error("旧库 POC 只允许 file: 临时数据库");
await initializeDatabase(databaseUrl);
