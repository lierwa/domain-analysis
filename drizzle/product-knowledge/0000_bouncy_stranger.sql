CREATE TABLE `category_definition_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`category_code` text NOT NULL,
	`label` text NOT NULL,
	`market` text NOT NULL,
	`content_json` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`confirmed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `product_knowledge_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_definition_project_version_uq` ON `category_definition_versions` (`project_id`,`version`);--> statement-breakpoint
CREATE INDEX `category_definition_project_status_idx` ON `category_definition_versions` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `collection_board_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`confirmed_scope_version_id` text NOT NULL,
	`content_json` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`confirmed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `product_knowledge_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_scope_version_id`) REFERENCES `confirmed_scope_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_board_project_version_uq` ON `collection_board_versions` (`project_id`,`version`);--> statement-breakpoint
CREATE INDEX `collection_board_project_status_idx` ON `collection_board_versions` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `confirmed_scope_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`category_definition_version_id` text NOT NULL,
	`market` text NOT NULL,
	`content_json` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`confirmed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `product_knowledge_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_definition_version_id`) REFERENCES `category_definition_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `confirmed_scope_project_version_uq` ON `confirmed_scope_versions` (`project_id`,`version`);--> statement-breakpoint
CREATE INDEX `confirmed_scope_project_status_idx` ON `confirmed_scope_versions` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `product_knowledge_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`knowledge_topic` text NOT NULL,
	`market` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
