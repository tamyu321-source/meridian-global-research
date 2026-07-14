import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("all D1 migrations apply in order to an empty SQLite database", () => {
  const database=new DatabaseSync(":memory:");
  const migrations=readdirSync(new URL("../drizzle",import.meta.url)).filter(name=>/^\d{4}_.+\.sql$/.test(name)).sort();
  for(const name of migrations){
    const sql=readFileSync(new URL(`../drizzle/${name}`,import.meta.url),"utf8");
    for(const statement of sql.split("--> statement-breakpoint").map(item=>item.trim()).filter(Boolean))database.exec(statement);
  }
  const profileTable=database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='model_market_profiles'").get();
  const policyColumns=database.prepare("PRAGMA table_info(user_risk_policies)").all() as Array<{name:string}>;
  assert.equal(profileTable?.name,"model_market_profiles");
  assert.ok(policyColumns.some(column=>column.name==="risk_budget_pct"));
  database.close();
});
