import { apiUser, jsonError, runtimeEnv } from "@/lib/server";
import { RISK_PLANS, type Locale, type RiskPlanId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await apiUser(request);
  if (!user) return jsonError("Sign in required", 401);
  const db = runtimeEnv().DB;
  if (!db) return Response.json({ settings: { locale: "zh-TW", baseCurrency: "TWD", paperCapital: null, riskPlan: "capital_first", emailAlerts: false, alertEmail: user.email }, persistence: false });
  try {
    const settings = await db.prepare("SELECT locale,base_currency baseCurrency,paper_capital paperCapital,risk_plan riskPlan,email_alerts emailAlerts,alert_email alertEmail FROM user_settings WHERE user_email=?").bind(user.email).first();
    return Response.json({ settings: settings ?? { locale: "zh-TW", baseCurrency: "TWD", paperCapital: null, riskPlan: "capital_first", emailAlerts: false, alertEmail: user.email }, persistence: true });
  } catch (error) { return jsonError("Settings unavailable", 503, error); }
}

export async function PUT(request: Request) {
  const user = await apiUser(request);
  if (!user) return jsonError("Sign in required", 401);
  const db = runtimeEnv().DB;
  if (!db) return jsonError("D1 unavailable", 503);
  const payload = await request.json() as { locale?: Locale; baseCurrency?: string; paperCapital?: number | null; riskPlan?: RiskPlanId; emailAlerts?: boolean; alertEmail?: string };
  const locale = ["en", "zh-TW", "zh-CN", "ja", "ko"].includes(String(payload.locale)) ? payload.locale! : "zh-TW";
  const riskPlan = RISK_PLANS[payload.riskPlan ?? "capital_first"] ? payload.riskPlan! : "capital_first";
  const baseCurrency = String(payload.baseCurrency ?? "TWD").toUpperCase().slice(0, 3);
  const paperCapital = Number(payload.paperCapital ?? 0) > 0 ? Number(payload.paperCapital) : null;
  const alertEmail = String(payload.alertEmail ?? user.email).trim();
  try {
    await db.prepare(`INSERT INTO user_settings (user_email,locale,base_currency,paper_capital,risk_plan,email_alerts,alert_email,updated_at)
      VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_email) DO UPDATE SET locale=excluded.locale,base_currency=excluded.base_currency,paper_capital=excluded.paper_capital,risk_plan=excluded.risk_plan,email_alerts=excluded.email_alerts,alert_email=excluded.alert_email,updated_at=CURRENT_TIMESTAMP`)
      .bind(user.email, locale, baseCurrency, paperCapital, riskPlan, Boolean(payload.emailAlerts) ? 1 : 0, alertEmail).run();
    if (paperCapital) {
      const portfolio = await db.prepare("SELECT id FROM paper_portfolios WHERE user_email=? LIMIT 1").bind(user.email).first<{ id: string }>();
      if (!portfolio) await db.prepare("INSERT INTO paper_portfolios (id,user_email,base_currency,starting_capital,cash,risk_plan,high_watermark,created_at,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
        .bind(crypto.randomUUID(), user.email, baseCurrency, paperCapital, paperCapital, riskPlan, paperCapital).run();
      else await db.prepare("UPDATE paper_portfolios SET risk_plan=?,base_currency=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(riskPlan, baseCurrency, portfolio.id).run();
    }
    return Response.json({ saved: true, settings: { locale, baseCurrency, paperCapital, riskPlan, emailAlerts: Boolean(payload.emailAlerts), alertEmail } });
  } catch (error) { return jsonError("Settings could not be saved", 500, error); }
}
