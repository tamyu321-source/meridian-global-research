export async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signed)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifySignedBody(secret: string, body: string, signature: string | null, timestamp: string | null, now = Date.now()) {
  if (!signature || !timestamp) return { ok: false, reason: "Missing signature or timestamp" };
  const clockSkew = Math.abs(now - Date.parse(timestamp));
  if (!Number.isFinite(clockSkew) || clockSkew > 5 * 60_000) return { ok: false, reason: "Timestamp outside five-minute window" };
  const expected = await hmacHex(secret, `${timestamp}.${body}`);
  if (expected.length !== signature.length) return { ok: false, reason: "Invalid signature" };
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return { ok: mismatch === 0, reason: mismatch === 0 ? undefined : "Invalid signature" };
}
