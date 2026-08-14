import type {
  CategoryDefinitionContent,
  CollectionBoardContent,
  ConfirmedScopeContent,
} from "@domain-analysis/shared";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const versionColumns = {
  version: integer("version").notNull(),
  status: text("status", { enum: ["draft", "confirmed", "superseded"] }).notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  confirmedAt: text("confirmed_at"),
};

// WHY：新产品库与旧 Social Intelligence 库物理隔离，避免给旧库伪造 migration 历史。
export const productKnowledgeProjects = sqliteTable("product_knowledge_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  knowledgeTopic: text("knowledge_topic").notNull(),
  market: text("market").notNull(),
  status: text("status", { enum: ["draft", "ready", "archived"] }).notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const categoryDefinitionVersions = sqliteTable("category_definition_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  categoryCode: text("category_code").notNull(),
  label: text("label").notNull(),
  market: text("market").notNull(),
  content: text("content_json", { mode: "json" }).$type<CategoryDefinitionContent>().notNull(),
  ...versionColumns,
}, (table) => [
  uniqueIndex("category_definition_project_version_uq").on(table.projectId, table.version),
  index("category_definition_project_status_idx").on(table.projectId, table.status),
]);

export const confirmedScopeVersions = sqliteTable("confirmed_scope_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  categoryDefinitionVersionId: text("category_definition_version_id").notNull()
    .references(() => categoryDefinitionVersions.id),
  market: text("market").notNull(),
  content: text("content_json", { mode: "json" }).$type<ConfirmedScopeContent>().notNull(),
  ...versionColumns,
}, (table) => [
  uniqueIndex("confirmed_scope_project_version_uq").on(table.projectId, table.version),
  index("confirmed_scope_project_status_idx").on(table.projectId, table.status),
]);

export const collectionBoardVersions = sqliteTable("collection_board_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => productKnowledgeProjects.id),
  confirmedScopeVersionId: text("confirmed_scope_version_id").notNull()
    .references(() => confirmedScopeVersions.id),
  content: text("content_json", { mode: "json" }).$type<CollectionBoardContent>().notNull(),
  ...versionColumns,
}, (table) => [
  uniqueIndex("collection_board_project_version_uq").on(table.projectId, table.version),
  index("collection_board_project_status_idx").on(table.projectId, table.status),
]);
