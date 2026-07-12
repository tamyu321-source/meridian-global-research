import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { verifySignedBody } from "./hmac";

type RuntimeEnv = {
  DB?: D1Database;
  MARKET_ARCHIVE?: R2Bucket;
  INGEST_HMAC_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
};

export function runtimeEnv() { return env as unknown as RuntimeEnv; }

export async function apiUser(request: Request) {
  const user = await getChatGPTUser();
  if (user) return user;
  const host = new URL(request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") return { email: "owner@local.meridian", displayName: "Local owner", fullName: "Local owner" };
  return null;
}

export function jsonError(message: string, status: number, detail?: unknown) {
  return Response.json({ error: message, detail: detail instanceof Error ? detail.message : detail }, { status });
}

export async function verifyHmac(body: string, signature: string | null, timestamp: string | null) {
  const secret = runtimeEnv().INGEST_HMAC_SECRET;
  if (!secret) return { ok: false, reason: "INGEST_HMAC_SECRET is not configured" };
  if (!signature || !timestamp) return { ok: false, reason: "Missing signature or timestamp" };
  return verifySignedBody(secret, body, signature, timestamp);
}

export async function verifyHmacBytes(body: Uint8Array, signature: string | null, timestamp: string | null) {
  const secret = runtimeEnv().INGEST_HMAC_SECRET;
  if (!secret || !signature || !timestamp) return { ok:false, reason:"Missing signature, timestamp, or secret" };
  const skew = Math.abs(Date.now() - Date.parse(timestamp));
  if (!Number.isFinite(skew) || skew > 5 * 60_000) return { ok:false, reason:"Timestamp outside five-minute window" };
  const prefix = new TextEncoder().encode(`${timestamp}.`); const value = new Uint8Array(prefix.length + body.length); value.set(prefix); value.set(body, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, value); const expected = [...new Uint8Array(signed)].map((byte)=>byte.toString(16).padStart(2,"0")).join("");
  let mismatch = expected.length ^ signature.length; for (let i=0;i<Math.min(expected.length,signature.length);i+=1) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return { ok:mismatch===0, reason:mismatch===0 ? undefined : "Invalid signature" };
}

export async function sendEmail(to: string, subject: string, body: string) {
  const config = runtimeEnv();
  if (!config.RESEND_API_KEY || !config.RESEND_FROM) return { ok: false, reason: "resend_not_configured" };
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: config.RESEND_FROM, to: [to], subject, text: body }) });
  return response.ok ? { ok: true } : { ok: false, reason: `resend_${response.status}` };
}
