ALTER TABLE `paper_orders` ADD `currency` text;--> statement-breakpoint
ALTER TABLE `paper_orders` ADD `gross_value` real;--> statement-breakpoint
ALTER TABLE `paper_orders` ADD `commission` real;--> statement-breakpoint
ALTER TABLE `paper_orders` ADD `taxes` real;--> statement-breakpoint
ALTER TABLE `paper_orders` ADD `fx_rate` real;--> statement-breakpoint
ALTER TABLE `paper_orders` ADD `net_cash_flow` real;--> statement-breakpoint
ALTER TABLE `paper_orders` ADD `realized_pnl_base` real;--> statement-breakpoint
ALTER TABLE `paper_orders` ADD `market_rule_version` text;--> statement-breakpoint
ALTER TABLE `paper_orders` ADD `market_session` text;