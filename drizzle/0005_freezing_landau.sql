CREATE TABLE `data_artifacts` (
	`object_key` text PRIMARY KEY NOT NULL,
	`model_version` text NOT NULL,
	`kind` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_versions` (
	`model_version` text PRIMARY KEY NOT NULL,
	`config_hash` text NOT NULL,
	`config_json` text NOT NULL,
	`validation_status` text NOT NULL,
	`activated_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shadow_validation_days` (
	`model_version` text NOT NULL,
	`validation_date` text NOT NULL,
	`scan_id` text NOT NULL,
	`completeness_pct` real NOT NULL,
	`freshness_pct` real NOT NULL,
	`consistency_pct` real NOT NULL,
	`major_incident` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shadow_validation_unique_idx` ON `shadow_validation_days` (`model_version`,`validation_date`);--> statement-breakpoint
CREATE TABLE `universe_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_date` text NOT NULL,
	`market` text NOT NULL,
	`scan_id` text NOT NULL,
	`discovered_count` integer NOT NULL,
	`analyzed_count` integer NOT NULL,
	`source` text NOT NULL,
	`coverage_pct` real NOT NULL,
	`object_key` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `universe_snapshots_unique_idx` ON `universe_snapshots` (`snapshot_date`,`market`,`scan_id`);--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `config_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `validation_status` text DEFAULT 'SHADOW' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `source_conflicts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `corporate_action_anomalies` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `quality_gate_passed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `universe_snapshot_date` text;--> statement-breakpoint
ALTER TABLE `signals` ADD `asset_model` text DEFAULT 'LEGACY_V1' NOT NULL;--> statement-breakpoint
ALTER TABLE `signals` ADD `validation_status` text DEFAULT 'SHADOW' NOT NULL;--> statement-breakpoint
ALTER TABLE `signals` ADD `config_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `signals` ADD `data_quality_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `signals` ADD `selection_json` text DEFAULT '{}' NOT NULL;