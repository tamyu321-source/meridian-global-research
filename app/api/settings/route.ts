import { calculateCapitalAdjustment } from "@/lib/portfolio-capital";
import { recordAudit } from "@/lib/repository";
import { apiUser, jsonError, runtimeEnv } from "@/lib/server";
import { RISK_PLANS, type Locale, type RiskPlanId } from "@/lib/types";

export const dynamic = "force-dynamic";

type SettingsErrorCode = "PAPER_CAPITAL_REQUIRED" | "CAPITAL_REDUCTION_BLOCKED" | "BASE_CURRENCY_LOCKED" | "SETTINGS_SAVE_FAILED";
const settingsFallback:Record<SettingsErrorCode,string> = { PAPER_CAPITAL_REQUIRED:"Paper capital must be greater than zero", CAPITAL_REDUCTION_BLOCKED:"Paper capital cannot be reduced below the invested amount", BASE_CURRENCY_LOCKED:"Base currency cannot change after paper activity exists", SETTINGS_SAVE_FAILED:"Settings could not be saved" };
function settingsError(errorCode:SettingsErrorCode,status:number,errorParams:Record<string,string|number>={},detail?:unknown){return Response.json({error:settingsFallback[errorCode],errorCode,errorParams,detail:detail instanceof Error?detail.message:undefined},{status});}

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
    const portfolio = await db.prepare("SELECT * FROM paper_portfolios WHERE user_email=? LIMIT 1").bind(user.email).first<Record<string,unknown>>();
    if (portfolio && !paperCapital) return settingsError("PAPER_CAPITAL_REQUIRED",409);
    let adjustment:null|{previousCapital:number|null;capital:number;delta:number;cash:number;highWatermark:number;currencyChanged?:boolean}=null;
    if (portfolio && paperCapital) {
      const previousCurrency=String(portfolio.base_currency);
      if(previousCurrency!==baseCurrency){
        const activity=await db.prepare("SELECT (SELECT COUNT(*) FROM paper_orders WHERE portfolio_id=?) + (SELECT COUNT(*) FROM paper_positions WHERE portfolio_id=?) activity").bind(String(portfolio.id),String(portfolio.id)).first<{activity:number}>();
        if(Number(activity?.activity??0)>0)return settingsError("BASE_CURRENCY_LOCKED",409,{currency:previousCurrency});
        adjustment={previousCapital:null,capital:paperCapital,delta:0,cash:paperCapital,highWatermark:paperCapital,currencyChanged:true};
      }else{
        const result=calculateCapitalAdjustment({startingCapital:Number(portfolio.starting_capital),cash:Number(portfolio.cash),highWatermark:Number(portfolio.high_watermark)},paperCapital);
        if(!result.ok)return settingsError(result.reason,409,result.reason==="CAPITAL_REDUCTION_BLOCKED"?{minimum:result.minimumCapital}:{ });
        adjustment={previousCapital:result.previousCapital,capital:result.capital,delta:result.delta,cash:result.cash,highWatermark:result.highWatermark};
      }
    }
    const statements:D1PreparedStatement[]=[db.prepare(`INSERT INTO user_settings (user_email,locale,base_currency,paper_capital,risk_plan,email_alerts,alert_email,updated_at)
      VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_email) DO UPDATE SET locale=excluded.locale,base_currency=excluded.base_currency,paper_capital=excluded.paper_capital,risk_plan=excluded.risk_plan,email_alerts=excluded.email_alerts,alert_email=excluded.alert_email,updated_at=CURRENT_TIMESTAMP`)
      .bind(user.email, locale, baseCurrency, paperCapital, riskPlan, Boolean(payload.emailAlerts) ? 1 : 0, alertEmail)];
    if (paperCapital) {
      if (!portfolio) statements.push(db.prepare("INSERT INTO paper_portfolios (id,user_email,base_currency,starting_capital,cash,risk_plan,high_watermark,created_at,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
        .bind(crypto.randomUUID(), user.email, baseCurrency, paperCapital, paperCapital, riskPlan, paperCapital));
      else statements.push(db.prepare("UPDATE paper_portfolios SET starting_capital=?,cash=?,risk_plan=?,base_currency=?,high_watermark=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(adjustment!.capital,adjustment!.cash,riskPlan,baseCurrency,adjustment!.highWatermark,String(portfolio.id)));
    }
    await db.batch(statements);
    if(adjustment)await recordAudit(user.email,"PAPER_CAPITAL_ADJUSTED",String(portfolio?.id??"new"),{...adjustment,baseCurrency,riskPlan});
    return Response.json({ saved: true, settings: { locale, baseCurrency, paperCapital, riskPlan, emailAlerts: Boolean(payload.emailAlerts), alertEmail }, portfolioAdjustment:adjustment });
  } catch (error) { return settingsError("SETTINGS_SAVE_FAILED",500,{},error); }
}
