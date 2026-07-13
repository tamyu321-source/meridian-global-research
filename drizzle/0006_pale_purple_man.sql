CREATE TABLE `active_scan_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`model_version` text NOT NULL,
	`market` text NOT NULL,
	`asset_type` text NOT NULL,
	`scan_id` text NOT NULL,
	`analysis_captured_at` text NOT NULL,
	`activated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `active_scan_outputs_bucket_idx` ON `active_scan_outputs` (`model_version`,`market`,`asset_type`);--> statement-breakpoint
CREATE INDEX `active_scan_outputs_scan_idx` ON `active_scan_outputs` (`scan_id`);--> statement-breakpoint
CREATE TABLE `analysis_components` (
	`id` text PRIMARY KEY NOT NULL,
	`active_key` text,
	`model_version` text NOT NULL,
	`market` text NOT NULL,
	`asset_type` text NOT NULL,
	`status` text NOT NULL,
	`phase` text DEFAULT 'QUEUED' NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`scan_id` text,
	`github_run_id` text,
	`github_run_url` text,
	`heartbeat_at` text,
	`started_at` text,
	`completed_at` text,
	`error_code` text,
	`error_detail` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_components_active_idx` ON `analysis_components` (`active_key`);--> statement-breakpoint
CREATE INDEX `analysis_components_scope_idx` ON `analysis_components` (`model_version`,`market`,`asset_type`,`created_at`);--> statement-breakpoint
CREATE TABLE `analysis_job_components` (
	`job_id` text NOT NULL,
	`component_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_job_components_unique_idx` ON `analysis_job_components` (`job_id`,`component_id`);--> statement-breakpoint
CREATE INDEX `analysis_job_components_component_idx` ON `analysis_job_components` (`component_id`);--> statement-breakpoint
CREATE TABLE `analysis_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`trigger` text NOT NULL,
	`market_scope` text NOT NULL,
	`asset_scope` text NOT NULL,
	`status` text NOT NULL,
	`github_run_id` text,
	`github_run_url` text,
	`error_code` text,
	`error_detail` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analysis_jobs_user_idx` ON `analysis_jobs` (`user_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `analysis_jobs_status_idx` ON `analysis_jobs` (`status`,`updated_at`);--> statement-breakpoint
ALTER TABLE `data_artifacts` ADD `market` text;--> statement-breakpoint
ALTER TABLE `data_artifacts` ADD `asset_type` text;--> statement-breakpoint
ALTER TABLE `data_artifacts` ADD `scan_id` text;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `job_id` text;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `component_id` text;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `requested_asset_types` text DEFAULT '["STOCK","ETF"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `signals` ADD `analysis_price` real;