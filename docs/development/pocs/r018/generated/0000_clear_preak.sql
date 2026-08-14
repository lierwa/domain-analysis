CREATE TABLE `analysis_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`goal` text NOT NULL,
	`language` text NOT NULL,
	`market` text NOT NULL,
	`default_platform` text DEFAULT 'reddit' NOT NULL,
	`default_limit` integer DEFAULT 100 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`collection_plan_id` text,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`run_trigger` text DEFAULT 'manual' NOT NULL,
	`include_keywords` text NOT NULL,
	`exclude_keywords` text NOT NULL,
	`platform` text DEFAULT 'reddit' NOT NULL,
	`run_limit` integer DEFAULT 100 NOT NULL,
	`collected_count` integer DEFAULT 0 NOT NULL,
	`valid_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`analyzed_count` integer DEFAULT 0 NOT NULL,
	`report_id` text,
	`error_message` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `analysis_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`collection_plan_id`) REFERENCES `collection_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `analyzed_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_content_id` text NOT NULL,
	`analysis_run_id` text,
	`summary` text NOT NULL,
	`content_type` text NOT NULL,
	`topics` text NOT NULL,
	`entities` text NOT NULL,
	`intent` text NOT NULL,
	`sentiment` text NOT NULL,
	`insight_score` integer DEFAULT 0 NOT NULL,
	`opportunity_score` integer DEFAULT 0 NOT NULL,
	`content_opportunity` text,
	`reason` text NOT NULL,
	`model_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`raw_content_id`) REFERENCES `raw_contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cleaned_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_content_id` text NOT NULL,
	`analysis_run_id` text,
	`normalized_text` text NOT NULL,
	`language` text NOT NULL,
	`is_duplicate` integer DEFAULT false NOT NULL,
	`is_ad` integer DEFAULT false NOT NULL,
	`is_irrelevant` integer DEFAULT false NOT NULL,
	`quality_score` integer DEFAULT 0 NOT NULL,
	`engagement_score` integer DEFAULT 0 NOT NULL,
	`clean_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`raw_content_id`) REFERENCES `raw_contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `collection_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`platform` text DEFAULT 'reddit' NOT NULL,
	`include_keywords` text NOT NULL,
	`exclude_keywords` text NOT NULL,
	`language` text NOT NULL,
	`market` text NOT NULL,
	`cadence` text DEFAULT 'daily' NOT NULL,
	`batch_limit` integer DEFAULT 100 NOT NULL,
	`max_runs_per_day` integer DEFAULT 4 NOT NULL,
	`last_run_at` text,
	`next_run_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `analysis_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `crawl_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`analysis_run_id` text NOT NULL,
	`collection_plan_id` text,
	`source_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`target_count` integer DEFAULT 100 NOT NULL,
	`collected_count` integer DEFAULT 0 NOT NULL,
	`valid_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` text,
	`finished_at` text,
	`scheduled_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`analysis_run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`collection_plan_id`) REFERENCES `collection_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `raw_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`source_id` text NOT NULL,
	`analysis_project_id` text NOT NULL,
	`analysis_run_id` text NOT NULL,
	`crawl_task_id` text NOT NULL,
	`matched_keywords` text NOT NULL,
	`external_id` text,
	`url` text NOT NULL,
	`author_name` text,
	`author_handle` text,
	`text` text NOT NULL,
	`media_urls` text,
	`metrics_json` text,
	`published_at` text,
	`captured_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`raw_json` text,
	`raw_html_path` text,
	`screenshot_path` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_project_id`) REFERENCES `analysis_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crawl_task_id`) REFERENCES `crawl_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`analysis_run_id` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`content_markdown` text DEFAULT '' NOT NULL,
	`content_json` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `analysis_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`requires_login` integer DEFAULT false NOT NULL,
	`crawler_type` text DEFAULT 'cheerio' NOT NULL,
	`default_limit` integer DEFAULT 100 NOT NULL,
	`rate_limit_config` text,
	`login_profile_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analysis_runs_project_idx` ON `analysis_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `analysis_runs_status_idx` ON `analysis_runs` (`status`);--> statement-breakpoint
CREATE INDEX `collection_plans_project_idx` ON `collection_plans` (`project_id`);--> statement-breakpoint
CREATE INDEX `collection_plans_status_next_run_idx` ON `collection_plans` (`status`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `crawl_tasks_status_idx` ON `crawl_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `crawl_tasks_run_idx` ON `crawl_tasks` (`analysis_run_id`);--> statement-breakpoint
CREATE INDEX `raw_contents_run_idx` ON `raw_contents` (`analysis_run_id`);--> statement-breakpoint
CREATE INDEX `raw_contents_external_idx` ON `raw_contents` (`platform`,`external_id`);--> statement-breakpoint
CREATE INDEX `reports_run_idx` ON `reports` (`analysis_run_id`);