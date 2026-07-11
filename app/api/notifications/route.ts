import { apiUser, jsonError, runtimeEnv } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await apiUser(request);
  if (!user) return jsonError("Sign in required", 401);
  const db = runtimeEnv().DB;
  if (!db) return Response.json({ notifications: [] });
  try {
    const result = await db.prepare("SELECT * FROM notifications WHERE user_email=? ORDER BY created_at DESC LIMIT 100").bind(user.email).all();
    return Response.json({ notifications: result.results ?? [] });
  } catch (error) { return jsonError("Notifications unavailable", 503, error); }
}
