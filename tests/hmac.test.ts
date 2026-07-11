import assert from "node:assert/strict";
import test from "node:test";
import { hmacHex, verifySignedBody } from "../lib/hmac";

test("valid signed ingest body is accepted", async () => {
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({ provider: "fixture", snapshots: [] });
  const signature = await hmacHex("test-secret", `${timestamp}.${body}`);
  assert.equal((await verifySignedBody("test-secret", body, signature, timestamp)).ok, true);
});

test("tampered and replayed ingest bodies are rejected", async () => {
  const timestamp = new Date().toISOString();
  const signature = await hmacHex("test-secret", `${timestamp}.original`);
  assert.equal((await verifySignedBody("test-secret", "tampered", signature, timestamp)).ok, false);
  const old = new Date(Date.now() - 6 * 60_000).toISOString();
  const oldSignature = await hmacHex("test-secret", `${old}.original`);
  assert.equal((await verifySignedBody("test-secret", "original", oldSignature, old)).ok, false);
});
