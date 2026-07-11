CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`detail_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor`,`created_at`);--> statement-breakpoint
CREATE TABLE `backtest_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`model_version` text NOT NULL,
	`market` text NOT NULL,
	`risk_plan` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`metrics_json` text,
	`artifact_key` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `backtest_runs_model_idx` ON `backtest_runs` (`model_version`,`market`);--> statement-breakpoint
CREATE TABLE `daily_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instrument_id` text NOT NULL,
	`model_version` text NOT NULL,
	`risk_plan` text NOT NULL,
	`score_date` text NOT NULL,
	`score` real NOT NULL,
	`confidence` real NOT NULL,
	`factors_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `securities`(`instrument_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_scores_unique_idx` ON `daily_scores` (`instrument_id`,`model_version`,`risk_plan`,`score_date`);--> statement-breakpoint
CREATE INDEX `daily_scores_rank_idx` ON `daily_scores` (`score_date`,`score`);--> statement-breakpoint
CREATE TABLE `ingest_events` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`captured_at` text NOT NULL,
	`object_key` text,
	`record_count` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `latest_quotes` (
	`instrument_id` text PRIMARY KEY NOT NULL,
	`price` real NOT NULL,
	`previous_close` real NOT NULL,
	`source` text NOT NULL,
	`freshness` text NOT NULL,
	`captured_at` text NOT NULL,
	`raw_object_key` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `securities`(`instrument_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`delivery_status` text DEFAULT 'in_app' NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_email`,`created_at`);--> statement-breakpoint
CREATE TABLE `paper_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`user_email` text NOT NULL,
	`instrument_id` text NOT NULL,
	`side` text NOT NULL,
	`quantity` real NOT NULL,
	`requested_price` real NOT NULL,
	`filled_price` real,
	`status` text NOT NULL,
	`signal_id` text,
	`rejection_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `paper_portfolios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `securities`(`instrument_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `paper_orders_user_idx` ON `paper_orders` (`user_email`,`created_at`);--> statement-breakpoint
CREATE TABLE `paper_portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`base_currency` text NOT NULL,
	`starting_capital` real NOT NULL,
	`cash` real NOT NULL,
	`risk_plan` text NOT NULL,
	`high_watermark` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `paper_portfolios_user_idx` ON `paper_portfolios` (`user_email`);--> statement-breakpoint
CREATE TABLE `paper_positions` (
	`portfolio_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`quantity` real NOT NULL,
	`average_cost` real NOT NULL,
	`realized_pnl` real DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `paper_portfolios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_id`) REFERENCES `securities`(`instrument_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_positions_unique_idx` ON `paper_positions` (`portfolio_id`,`instrument_id`);--> statement-breakpoint
CREATE TABLE `securities` (
	`instrument_id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`market` text NOT NULL,
	`exchange` text NOT NULL,
	`currency` text NOT NULL,
	`asset_type` text NOT NULL,
	`sector` text,
	`active` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `securities_market_idx` ON `securities` (`market`,`asset_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `securities_symbol_market_idx` ON `securities` (`symbol`,`market`);--> statement-breakpoint
CREATE TABLE `signals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`instrument_id` text NOT NULL,
	`model_version` text NOT NULL,
	`risk_plan` text NOT NULL,
	`status` text NOT NULL,
	`action` text NOT NULL,
	`score` real NOT NULL,
	`confidence` real NOT NULL,
	`trade_plan_json` text NOT NULL,
	`reasons_json` text NOT NULL,
	`hard_gates_json` text NOT NULL,
	`source_captured_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `securities`(`instrument_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `signals_user_idx` ON `signals` (`user_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `signals_instrument_idx` ON `signals` (`instrument_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_email` text PRIMARY KEY NOT NULL,
	`locale` text DEFAULT 'zh-TW' NOT NULL,
	`base_currency` text DEFAULT 'TWD' NOT NULL,
	`paper_capital` real,
	`risk_plan` text DEFAULT 'capital_first' NOT NULL,
	`email_alerts` integer DEFAULT false NOT NULL,
	`alert_email` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`user_email` text NOT NULL,
	`instrument_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `securities`(`instrument_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_owner_instrument_idx` ON `watchlist` (`user_email`,`instrument_id`);