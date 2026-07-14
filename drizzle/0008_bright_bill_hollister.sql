CREATE TABLE `model_market_profiles` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`model_version` text NOT NULL,
	`market` text NOT NULL,
	`asset_type` text NOT NULL,
	`strategy_family` text NOT NULL,
	`gate_preset` text NOT NULL,
	`config_json` text NOT NULL,
	`config_hash` text NOT NULL,
	`status` text DEFAULT 'CALIBRATING' NOT NULL,
	`backtest_run_id` text,
	`shadow_days` integer DEFAULT 0 NOT NULL,
	`selected_at` text,
	`activated_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_market_profiles_bucket_idx` ON `model_market_profiles` (`model_version`,`market`,`asset_type`);--> statement-breakpoint
CREATE INDEX `model_market_profiles_status_idx` ON `model_market_profiles` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `risk_policy_revisions` (
	`revision_id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`policy_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `risk_policy_revisions_user_idx` ON `risk_policy_revisions` (`user_email`,`created_at`);--> statement-breakpoint
CREATE TABLE `shadow_validation_buckets` (
	`model_version` text NOT NULL,
	`market_profile_id` text NOT NULL,
	`market` text NOT NULL,
	`asset_type` text NOT NULL,
	`validation_date` text NOT NULL,
	`scan_id` text NOT NULL,
	`completeness_pct` real NOT NULL,
	`freshness_pct` real NOT NULL,
	`consistency_pct` real NOT NULL,
	`major_incident` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shadow_validation_buckets_unique_idx` ON `shadow_validation_buckets` (`model_version`,`market_profile_id`,`market`,`asset_type`,`validation_date`);--> statement-breakpoint
CREATE TABLE `user_market_limits` (
	`user_email` text NOT NULL,
	`market` text NOT NULL,
	`max_market_pct` real NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_market_limits_unique_idx` ON `user_market_limits` (`user_email`,`market`);--> statement-breakpoint
CREATE TABLE `user_risk_policies` (
	`user_email` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`risk_budget_pct` real NOT NULL,
	`max_weight_pct` real NOT NULL,
	`max_sector_pct` real NOT NULL,
	`drawdown_breaker_pct` real NOT NULL,
	`allow_minimum_lot_exception` integer DEFAULT true NOT NULL,
	`customized` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `analysis_components` ADD `market_profile_id` text;--> statement-breakpoint
ALTER TABLE `analysis_components` ADD `market_profile_hash` text;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `asset_type` text DEFAULT 'ALL' NOT NULL;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `market_profile_id` text;--> statement-breakpoint
ALTER TABLE `backtest_runs` ADD `config_hash` text;--> statement-breakpoint
ALTER TABLE `paper_orders` ADD `risk_policy_revision_id` text;--> statement-breakpoint
ALTER TABLE `paper_orders` ADD `market_profile_id` text;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `market_profile_id` text;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `market_profile_hash` text;--> statement-breakpoint
ALTER TABLE `signals` ADD `market_profile_id` text;--> statement-breakpoint
ALTER TABLE `signals` ADD `market_profile_hash` text;