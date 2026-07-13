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
  scanId: text("scan_id"),
  modelVersion: text("model_version").notNull(), riskPlan: text("risk_plan").notNull(), status: text("status").notNull(), action: text("action").notNull(),
  score: real("score").notNull(), confidence: real("confidence").notNull(), tradePlanJson: text("trade_plan_json").notNull(),
  reasonsJson: text("reasons_json").notNull(), hardGatesJson: text("hard_gates_json").notNull(), sourceCapturedAt: text("source_captured_at").notNull(),
  analysisPrice: real("analysis_price"),
  assetModel: text("asset_model").notNull().default("LEGACY_V1"), validationStatus: text("validation_status").notNull().default("SHADOW"),
  configHash: text("config_hash").notNull().default(""), dataQualityJson: text("data_quality_json").notNull().default("{}"), selectionJson: text("selection_json").notNull().default("{}"),
  setupJson: text("setup_json").notNull().default("{}"),
  createdAt: timestamp("created_at"), updatedAt: timestamp("updated_at"),
}, (table) => [index("signals_user_idx").on(table.userEmail, table.createdAt), index("signals_instrument_idx").on(table.instrumentId, table.createdAt), index("signals_scan_idx").on(table.scanId, table.score)]);

export const scanRuns = sqliteTable("scan_runs", {
  id: text("id").primaryKey(), provider: text("provider").notNull(), modelVersion: text("model_version").notNull(),
  status: text("status").notNull(), startedAt: text("started_at").notNull(), completedAt: text("completed_at"),
  requestedMarkets: text("requested_markets").notNull(), targetStocksPerMarket: integer("target_stocks_per_market").notNull(),
  targetEtfsPerMarket: integer("target_etfs_per_market").notNull(), discoveredCount: integer("discovered_count").notNull().default(0),
  analyzedCount: integer("analyzed_count").notNull().default(0), failedCount: integer("failed_count").notNull().default(0),
  fallbackCount: integer("fallback_count").notNull().default(0), coverageJson: text("coverage_json").notNull().default("{}"),
  configHash: text("config_hash").notNull().default(""), validationStatus: text("validation_status").notNull().default("SHADOW"),
  sourceConflicts: integer("source_conflicts").notNull().default(0), corporateActionAnomalies: integer("corporate_action_anomalies").notNull().default(0),
  qualityGatePassed: integer("quality_gate_passed", { mode:"boolean" }).notNull().default(false), universeSnapshotDate: text("universe_snapshot_date"),
  jobId: text("job_id"), componentId: text("component_id"), requestedAssetTypes: text("requested_asset_types").notNull().default('["STOCK","ETF"]'),
  createdAt: timestamp("created_at"), updatedAt: timestamp("updated_at"),
}, (table) => [index("scan_runs_status_idx").on(table.status, table.completedAt)]);

export const analysisJobs = sqliteTable("analysis_jobs", {
  id: text("id").primaryKey(), userEmail: text("user_email").notNull(), trigger: text("trigger").notNull(),
  marketScope: text("market_scope").notNull(), assetScope: text("asset_scope").notNull(), status: text("status").notNull(),
  githubRunId: text("github_run_id"), githubRunUrl: text("github_run_url"), errorCode: text("error_code"), errorDetail: text("error_detail"),
  completedAt: text("completed_at"), createdAt: timestamp("created_at"), updatedAt: timestamp("updated_at"),
}, (table) => [index("analysis_jobs_user_idx").on(table.userEmail, table.createdAt), index("analysis_jobs_status_idx").on(table.status, table.updatedAt)]);

export const analysisComponents = sqliteTable("analysis_components", {
  id: text("id").primaryKey(), activeKey: text("active_key"), modelVersion: text("model_version").notNull(),
  market: text("market").notNull(), assetType: text("asset_type").notNull(), status: text("status").notNull(), phase: text("phase").notNull().default("QUEUED"),
  totalCount: integer("total_count").notNull().default(0), processedCount: integer("processed_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0), failedCount: integer("failed_count").notNull().default(0),
  scanId: text("scan_id"), githubRunId: text("github_run_id"), githubRunUrl: text("github_run_url"), heartbeatAt: text("heartbeat_at"),
  startedAt: text("started_at"), completedAt: text("completed_at"), errorCode: text("error_code"), errorDetail: text("error_detail"),
  createdAt: timestamp("created_at"), updatedAt: timestamp("updated_at"),
}, (table) => [uniqueIndex("analysis_components_active_idx").on(table.activeKey), index("analysis_components_scope_idx").on(table.modelVersion, table.market, table.assetType, table.createdAt)]);

export const analysisJobComponents = sqliteTable("analysis_job_components", {
  jobId: text("job_id").notNull(), componentId: text("component_id").notNull(), createdAt: timestamp("created_at"),
}, (table) => [uniqueIndex("analysis_job_components_unique_idx").on(table.jobId, table.componentId), index("analysis_job_components_component_idx").on(table.componentId)]);

export const activeScanOutputs = sqliteTable("active_scan_outputs", {
  id: text("id").primaryKey(), modelVersion: text("model_version").notNull(), market: text("market").notNull(), assetType: text("asset_type").notNull(),
  scanId: text("scan_id").notNull(), analysisCapturedAt: text("analysis_captured_at").notNull(), activatedAt: timestamp("activated_at"),
}, (table) => [uniqueIndex("active_scan_outputs_bucket_idx").on(table.modelVersion, table.market, table.assetType), index("active_scan_outputs_scan_idx").on(table.scanId)]);

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
  currency: text("currency"), grossValue: real("gross_value"), commission: real("commission"), taxes: real("taxes"), fxRate: real("fx_rate"),
  netCashFlow: real("net_cash_flow"), realizedPnlBase: real("realized_pnl_base"), marketRuleVersion: text("market_rule_version"), marketSession: text("market_session"),
  riskException: text("risk_exception"),
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

export const modelVersions = sqliteTable("model_versions", {
  modelVersion: text("model_version").primaryKey(), configHash: text("config_hash").notNull(), configJson: text("config_json").notNull(),
  validationStatus: text("validation_status").notNull(), activatedAt: text("activated_at"), createdAt: timestamp("created_at"),
});

export const universeSnapshots = sqliteTable("universe_snapshots", {
  id: integer("id").primaryKey({ autoIncrement:true }), snapshotDate: text("snapshot_date").notNull(), market: text("market").notNull(),
  scanId: text("scan_id").notNull(), discoveredCount: integer("discovered_count").notNull(), analyzedCount: integer("analyzed_count").notNull(),
  source: text("source").notNull(), coveragePct: real("coverage_pct").notNull(), objectKey: text("object_key"), createdAt: timestamp("created_at"),
}, (table) => [uniqueIndex("universe_snapshots_unique_idx").on(table.snapshotDate, table.market, table.scanId)]);

export const shadowValidationDays = sqliteTable("shadow_validation_days", {
  modelVersion: text("model_version").notNull(), validationDate: text("validation_date").notNull(), scanId: text("scan_id").notNull(),
  completenessPct: real("completeness_pct").notNull(), freshnessPct: real("freshness_pct").notNull(), consistencyPct: real("consistency_pct").notNull(),
  majorIncident: integer("major_incident", { mode:"boolean" }).notNull().default(false), createdAt: timestamp("created_at"),
}, (table) => [uniqueIndex("shadow_validation_unique_idx").on(table.modelVersion, table.validationDate)]);

export const dataArtifacts = sqliteTable("data_artifacts", {
  objectKey: text("object_key").primaryKey(), modelVersion: text("model_version").notNull(), kind: text("kind").notNull(),
  market: text("market"), assetType: text("asset_type"), scanId: text("scan_id"), contentType: text("content_type").notNull(), bytes: integer("bytes").notNull(), sha256: text("sha256").notNull(), createdAt: timestamp("created_at"),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(), actor: text("actor").notNull(), action: text("action").notNull(), resource: text("resource").notNull(),
  detailJson: text("detail_json").notNull(), createdAt: timestamp("created_at"),
}, (table) => [index("audit_logs_actor_idx").on(table.actor, table.createdAt)]);
