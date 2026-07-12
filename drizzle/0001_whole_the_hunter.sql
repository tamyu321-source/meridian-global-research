CREATE TABLE `scan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model_version` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`requested_markets` text NOT NULL,
	`target_stocks_per_market` integer NOT NULL,
	`target_etfs_per_market` integer NOT NULL,
	`discovered_count` integer DEFAULT 0 NOT NULL,
	`analyzed_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`fallback_count` integer DEFAULT 0 NOT NULL,
	`coverage_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scan_runs_status_idx` ON `scan_runs` (`status`,`completed_at`);--> statement-breakpoint
ALTER TABLE `signals` ADD `scan_id` text;--> statement-breakpoint
CREATE INDEX `signals_scan_idx` ON `signals` (`scan_id`,`score`);