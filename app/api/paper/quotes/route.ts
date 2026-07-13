import { fetchLatestQuoteBatch } from "@/lib/public-data";
import { recordAudit } from "@/lib/repository";
import { apiUser, runtimeEnv } from "@/lib/server";

export const dynamic = "force-dynamic";

type HoldingRow = { instrument_id:string; symbol:string };
const quoteError=(error:string,errorCode:string,status:number,detail?:unknown)=>Response.json({error,errorCode,detail:detail instanceof Error?detail.message:detail},{status});

export async function POST(request:Request) {
  const user=await apiUser(request);
  if(!user)return quoteError("Sign in required","SIGN_IN_REQUIRED",401);
  const db=runtimeEnv().DB;
  if(!db)return quoteError("Portfolio quote service unavailable","SERVICE_UNAVAILABLE",503);
  try {
    const portfolio=await db.prepare("SELECT id FROM paper_portfolios WHERE user_email=? LIMIT 1").bind(user.email).first<{id:string}>();
    if(!portfolio)return quoteError("Paper portfolio not configured","SETUP_REQUIRED",409);
    const result=await db.prepare(`SELECT p.instrument_id,s.symbol FROM paper_positions p JOIN securities s ON s.instrument_id=p.instrument_id
      WHERE p.portfolio_id=? AND p.quantity>0 ORDER BY p.instrument_id`).bind(portfolio.id).all<HoldingRow>();
    const holdings=result.results??[];
    let updated=0;
    const failed:string[]=[];
    let capturedAt=new Date().toISOString();
    for(let index=0;index<holdings.length;index+=20){
      const batch=holdings.slice(index,index+20);
      try{
        const refreshed=await fetchLatestQuoteBatch(batch.map(row=>({instrumentId:row.instrument_id,symbol:row.symbol})));
        capturedAt=refreshed.quotes[0]?.capturedAt??capturedAt;
        failed.push(...refreshed.missing.map(row=>row.instrumentId));
        for(const quote of refreshed.quotes){
          try{
            await db.prepare(`UPDATE latest_quotes SET price=?,previous_close=?,source=?,freshness=?,captured_at=?,updated_at=CURRENT_TIMESTAMP WHERE instrument_id=?`)
              .bind(quote.price,quote.previousClose,quote.source,quote.freshness,quote.capturedAt,quote.instrumentId).run();
            updated+=1;
          }catch{failed.push(quote.instrumentId);}
        }
      }catch{failed.push(...batch.map(row=>row.instrument_id));}
    }
    const uniqueFailed=[...new Set(failed)];
    try{await recordAudit(user.email,"PAPER_HOLDING_QUOTES_REFRESHED",portfolio.id,{holdings:holdings.length,updated,failed:uniqueFailed,capturedAt});}catch{/* Quote refresh remains available if audit logging is unavailable. */}
    if(holdings.length>0&&updated===0)return quoteError("No holding quotes could be refreshed","HOLDING_QUOTE_REFRESH_FAILED",502,{failed:uniqueFailed.length});
    return Response.json({holdings:holdings.length,updated,failed:uniqueFailed.length,capturedAt},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return quoteError("Portfolio quote refresh failed","HOLDING_QUOTE_REFRESH_FAILED",502,error);}
}
