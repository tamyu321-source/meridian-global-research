import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => text(name).notNull().default(sql`CURRENT_TIMESTAMP`);

export const userSettings = sqliteTable("user_settings", {
  userEmail: text("user_email").primaryKey(), locale: text("locale").notNull().default("zh-TW"),
  baseCurrency: text("base_currency").notNull().default("TWD"), paperCapital: real("paper_capital"),
  riskPlan: text("risk_plan").notNull().default("capital_first"), emailAlerts: integer("email_alerts", { mode: "boolean" }).notNull().default(false),
  alertEmail: text("alert_email"), updatedAt: timestamp("updated_at"),
});

export const securities = sqliteTable("securities", {
  instrumentId: text("instrument_id").primaryKey(), symbol: text("symbol").notNull(), name: text("name").notNull(),
  market: text("market").notNull(), exchange: text("exchange").notNull(), currency: text("currency").notNull(),
  assetType: text("asset_type").notNull(), sector: text("sector"), active: integer("active", { mode: "boolean" }).notNull().default(true),
  updatedAt: timestamp("updated_at"),
}, (table) => [index("securities_market_idx").on(table.market, table.assetType), uniqueIndex("securities_symbol_market_idx").on(table.symbol, table.market)]);

export const latestQuotes = sqliteTable("latest_quotes", {
  instrumentId: text("instrument_id").primaryKey().references(() => securities.instrumentId), price: real("price").notNull(),
  previousClose: real("previous_close").notNull(), source: text("source").notNull(), freshness: text("freshness").notNull(),
  capturedAt: text("captured_at").notNull(), rawObjectKey: text("raw_object_key"), updatedAt: timestamp("updated_at"),
});

export const dailyScores = sqliteTable("daily_scores", {
  id: integer("id").primaryKey({ autoIncrement: true }), instrumentId: text("instrument_id").notNull().references(() => securities.instrumentId),
  modelVersion: text("model_version").notNull(), riskPlan: text("risk_plan").notNull(), scoreDate: text("score_date").notNull(),
  score: real("score").notNull(), confidence: real("confidence").notNull(), factorsJson: text("factors_json").notNull(),
  createdAt: timestamp("created_at"),
}, (table) => [uniqueIndex("daily_scores_unique_idx").on(table.instrumentId, table.modelVersion, table.riskPlan, table.scoreDate), index("daily_scores_rank_idx").on(table.scoreDate, table.score)]);

export const signals = sqliteTable("signals", {
  id: text("id").primaryKey(), userEmail: text("user_email").notNull(), instrumentId: text("instrument_id").notNull().references(() => securities.instrumentId),
  modelVersion: text("model_version").notNull(), riskPlan: text("risk_plan").notNull(), status: text("status").notNull(), action: text("action").notNull(),
  score: real("score").notNull(), confidence: real("confidence").notNull(), tradePlanJson: text("trade_plan_json").notNull(),
  reasonsJson: text("reasons_json").notNull(), hardGatesJson: text("hard_gates_json").notNull(), sourceCapturedAt: text("source_captured_at").notNull(),
  createdAt: timestamp("created_at"), updatedAt: timestamp("updated_at"),
}, (table) => [index("signals_user_idx").on(table.userEmail, table.createdAt), index("signals_instrument_idx").on(table.instrumentId, table.createdAt)]);

export const watchlist = sqliteTable("watchlist", {
  userEmail: text("user_email").notNull(), instrumentId: text("instrument_id").notNull().references(() => securities.instrumentId), createdAt: timestamp("created_at"),
}, (table) => [uniqueIndex("watchlist_owner_instrument_idx").on(table.userEmail, table.instrumentId)]);

export const paperPortfolios = sqliteTable("paper_portfolios", {
  id: text("id").primaryKey(), userEmail: text("user_email").notNull(), baseCurrency: text("base_currency").notNull(),
  startingCapital: real("starting_capital").notNull(), cash: real("cash").notNull(), riskPlan: text("risk_plan").notNull(),
  highWatermark: real("high_watermark").notNull(), createdAt: timestamp("created_at"), updatedAt: timestamp("updated_at"),
}, (table) => [index("paper_portfolios_user_idx").on(table.userEmail)]);

export const paperOrders = sqliteTable("paper_orders", {
  id: text("id").primaryKey(), portfolioId: text("portfolio_id").notNull().references(() => paperPortfolios.id), userEmail: text("user_email").notNull(),
  instrumentId: text("instrument_id").notNull().references(() => securities.instrumentId), side: text("side").notNull(), quantity: real("quantity").notNull(),
  requestedPrice: real("requested_price").notNull(), filledPrice: real("filled_price"), status: text("status").notNull(),
  signalId: text("signal_id"), rejectionReason: text("rejection_reason"), createdAt: timestamp("created_at"),
}, (table) => [index("paper_orders_user_idx").on(table.userEmail, table.createdAt)]);

export const paperPositions = sqliteTable("paper_positions", {
  portfolioId: text("portfolio_id").notNull().references(() => paperPortfolios.id), instrumentId: text("instrument_id").notNull().references(() => securities.instrumentId),
  quantity: real("quantity").notNull(), averageCost: real("average_cost").notNull(), realizedPnl: real("realized_pnl").notNull().default(0), updatedAt: timestamp("updated_at"),
}, (table) => [uniqueIndex("paper_positions_unique_idx").on(table.portfolioId, table.instrumentId)]);

export const backtestRuns = sqliteTable("backtest_runs", {
  id: text("id").primaryKey(), modelVersion: text("model_version").notNull(), market: text("market").notNull(), riskPlan: text("risk_plan").notNull(),
  status: text("status").notNull(), startedAt: text("started_at").notNull(), completedAt: text("completed_at"), metricsJson: text("metrics_json"),
  artifactKey: text("artifact_key"), createdAt: timestamp("created_at"),
}, (table) => [index("backtest_runs_model_idx").on(table.modelVersion, table.market)]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(), userEmail: text("user_email").notNull(), kind: text("kind").notNull(), title: text("title").notNull(),
  body: text("body").notNull(), deliveryStatus: text("delivery_status").notNull().default("in_app"), readAt: text("read_at"), createdAt: timestamp("created_at"),
}, (table) => [index("notifications_user_idx").on(table.userEmail, table.createdAt)]);

export const ingestEvents = sqliteTable("ingest_events", {
  idempotencyKey: text("idempotency_key").primaryKey(), provider: text("provider").notNull(), capturedAt: text("captured_at").notNull(),
  objectKey: text("object_key"), recordCount: integer("record_count").notNull(), status: text("status").notNull(), createdAt: timestamp("created_at"),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(), actor: text("actor").notNull(), action: text("action").notNull(), resource: text("resource").notNull(),
  detailJson: text("detail_json").notNull(), createdAt: timestamp("created_at"),
}, (table) => [index("audit_logs_actor_idx").on(table.actor, table.createdAt)]);
