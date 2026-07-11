import { apiUser, jsonError, runtimeEnv, sendEmail } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await apiUser(request);
  if (!user) return jsonError("Sign in required", 401);
  const db = runtimeEnv().DB;
  if (!db) return jsonError("D1 unavailable", 503);
  try {
    const settings = await db.prepare("SELECT alert_email,email_alerts FROM user_settings WHERE user_email=?").bind(user.email).first<Record<string, unknown>>();
    const title = "Meridian 通知測試";
    const body = "站內通知已正常運作。Email 未設定時，重要訊號仍會永久保留在通知中心。";
    const delivery = settings?.email_alerts ? await sendEmail(String(settings.alert_email ?? user.email), title, body) : { ok: false, reason: "email_disabled" };
    await db.prepare("INSERT INTO notifications (id,user_email,kind,title,body,delivery_status,created_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(), user.email, "SYSTEM", title, body, delivery.ok ? "email_sent" : String(delivery.reason ?? "in_app")).run();
    return Response.json({ delivered: { inApp: true, email: delivery.ok, reason: delivery.ok ? null : delivery.reason } });
  } catch (error) { return jsonError("Test alert failed", 500, error); }
}
