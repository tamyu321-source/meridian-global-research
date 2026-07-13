import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import test from "node:test";
import { createAnalysisJob, expandAnalysisScope, isTerminalComponent, mergeProgressCounts, phaseIndex } from "../lib/analysis-jobs";

class TestStatement {
  private values:SQLInputValue[]=[];
  constructor(private readonly statement:StatementSync) {}
  bind(...values:SQLInputValue[]){this.values=values;return this;}
  run(){const result=this.statement.run(...this.values);return {success:true,meta:{changes:Number(result.changes)}};}
  first<T>(){return (this.statement.get(...this.values) as T|undefined)??null;}
  all<T>(){return {success:true,results:this.statement.all(...this.values) as T[]};}
}

class TestD1 {
  constructor(private readonly sqlite:DatabaseSync) {}
  prepare(sql:string){return new TestStatement(this.sqlite.prepare(sql));}
  async batch(statements:TestStatement[]){return statements.map((statement)=>statement.run());}
}

test("full-analysis scope expands markets and keeps stock and ETF buckets isolated", () => {
  const all = expandAnalysisScope("ALL","ALL");
  assert.equal(all.buckets.length,14);
  assert.deepEqual(expandAnalysisScope("TW","ETF").buckets,[{market:"TW",assetType:"ETF"}]);
  assert.throws(()=>expandAnalysisScope("XX","STOCK"),/UNSUPPORTED_MARKET/);
  assert.throws(()=>expandAnalysisScope("US","CRYPTO"),/UNSUPPORTED_ASSET_TYPE/);
});

test("analysis phases are monotonic and terminal states release work", () => {
  assert.ok(phaseIndex("HISTORY") < phaseIndex("SCORING"));
  assert.ok(phaseIndex("SCORING") < phaseIndex("COMPLETE"));
  assert.equal(isTerminalComponent("COMPLETE"),true);
  assert.equal(isTerminalComponent("STALLED"),true);
  assert.equal(isTerminalComponent("RUNNING"),false);
});

test("terminal failure preserves the last durable progress counters", () => {
  const current={total:500,processed:120,updated:90,failed:3};
  assert.deepEqual(mergeProgressCounts(current,{total:0,processed:0,updated:0,failed:1},"FAILED"),current);
  assert.deepEqual(mergeProgressCounts(current,{total:500,processed:121,updated:91,failed:3},"RUNNING"),{total:500,processed:121,updated:91,failed:3});
});

test("overlapping full-analysis requests reuse one active market and asset component", async () => {
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE analysis_jobs(id TEXT PRIMARY KEY,user_email TEXT,trigger TEXT,market_scope TEXT,asset_scope TEXT,status TEXT,github_run_id TEXT,github_run_url TEXT,error_code TEXT,error_detail TEXT,completed_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE analysis_components(id TEXT PRIMARY KEY,active_key TEXT UNIQUE,model_version TEXT,market TEXT,asset_type TEXT,status TEXT,phase TEXT,total_count INTEGER DEFAULT 0,processed_count INTEGER DEFAULT 0,updated_count INTEGER DEFAULT 0,failed_count INTEGER DEFAULT 0,scan_id TEXT,github_run_id TEXT,github_run_url TEXT,heartbeat_at TEXT,started_at TEXT,completed_at TEXT,error_code TEXT,error_detail TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE analysis_job_components(job_id TEXT,component_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(job_id,component_id));`);
  const db=new TestD1(sqlite) as unknown as D1Database;
  const first=await createAnalysisJob(db,"owner@example.com","MANUAL","TW","ETF");
  const overlapping=await createAnalysisJob(db,"owner@example.com","MANUAL","TW","ETF");
  assert.equal(first.createdComponents.length,1);
  assert.equal(overlapping.createdComponents.length,0);
  assert.equal(first.components[0].id,overlapping.components[0].id);
  sqlite.close();
});
