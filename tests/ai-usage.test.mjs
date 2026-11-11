import assert from 'node:assert/strict';
import test from 'node:test';
import {parseAiUsage,projectAiUsage} from '../lib/ai-usage.ts';
import {parseOperation,storeOperation,readOperations} from '../lib/inbound-operations.ts';
import {getDb,closeDb} from '../db/index.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const totals=(cost=0,calls=0)=>({calls,inputTokens:calls*1000,outputTokens:calls*20,estimatedCostUsd:cost});
const sample=()=>({status:'ok',measuredAt:'2026-09-30T12:00:00.000Z',trackingStartedAt:'2026-09-01T12:00:00.000Z',windowStartedAt:'2026-09-01T12:00:00.000Z',model:'gpt-5.6-luna',currency:'USD',monthKey:'2026-09',today:totals(.0003,1),month:totals(.03,100),window:totals(.03,100),reservedMonthUsd:.12,limits:{perRunUsd:.05,perDayUsd:.2,perMonthUsd:2},daily:[{date:'2026-09-02',...totals(.0297,99)},{date:'2026-09-30',...totals(.0003,1)}],unresolvedCalls:0});

test('projection uses elapsed observation window, not reservations or monthly ceiling',()=>{
 const usage=parseAiUsage(sample());assert.ok(usage);
 const projection=projectAiUsage(usage);
 assert.equal(projection.elapsedDays,29);
 assert.ok(Math.abs(projection.annualizedUsd-(.03/29*365))<1e-12);
 assert.equal(projection.annualBudgetUsd,24);assert.equal(projection.monthUsedPercent,1.5);assert.equal(projection.monthReservedPercent,6);assert.equal(projection.provisional,false);
 const early=sample();early.trackingStartedAt=early.windowStartedAt='2026-09-30T11:00:00.000Z';early.window=early.today;early.daily=early.daily.slice(-1);
 assert.equal(projectAiUsage(parseAiUsage(early)).provisional,true);
 early.trackingStartedAt=early.windowStartedAt=early.measuredAt;
 assert.equal(projectAiUsage(parseAiUsage(early)).annualizedUsd,null);
});

test('usage contract rejects leaked content, impossible periods and invalid numbers',()=>{
 for(const mutate of [x=>{x.secret='redacted'},x=>{x.today.subject='private'},x=>{x.month.estimatedCostUsd=-1},x=>{x.reservedMonthUsd=Infinity},x=>{x.windowStartedAt='2026-10-01T00:00:00Z'},x=>{x.monthKey='2026-10'},x=>{x.daily[0].date='2026-02-30'},x=>{x.daily.reverse()},x=>{x.daily[0].estimatedCostUsd=10},x=>{x.today.calls=1.5},x=>{x.limits.perMonthUsd=0}]){
  const usage=sample();mutate(usage);assert.equal(parseAiUsage(usage),null);
 }
 assert.deepEqual(parseAiUsage({status:'unavailable',measuredAt:sample().measuredAt,errorCode:'usage_unavailable'}),{status:'unavailable',measuredAt:sample().measuredAt,errorCode:'usage_unavailable'});
});

test('new month and zero usage remain valid while caps and tiny costs stay precise',()=>{
 const usage=sample();usage.measuredAt='2026-10-01T00:00:01.000Z';usage.monthKey='2026-10';usage.trackingStartedAt=usage.windowStartedAt='2026-09-30T23:00:00Z';usage.daily=[{date:'2026-09-30',...totals(.0003786,1)},{date:'2026-10-01',...totals()}];usage.today=usage.month=totals();usage.window=totals(.0003786,1);usage.reservedMonthUsd=0;
 assert.ok(parseAiUsage(usage));assert.equal(projectAiUsage(usage).monthUsedPercent,0);assert.ok(projectAiUsage(usage).annualizedUsd>0);
});

test('AI telemetry is accepted and persisted only through the existing strict operations intake',async t=>{
 closeDb();const dir=mkdtempSync(join(tmpdir(),'secdash-ai-'));process.env.SECDASH_DATABASE_PATH=join(dir,'db.sqlite');t.after(()=>{closeDb();rmSync(dir,{recursive:true});});const db=getDb();
 const at=sample().measuredAt;
 const record={surface:'recovery',status:'ok',observedAt:at,data:{schemaVersion:1,generatedAt:at,backupFolder:{name:'SecDash Backups',bytes:12,objects:1,measuredAt:at},restoreChecks:[],automation:{measuredAt:at,workflows:[],executionHistoryAvailable:false,lastExecution:null,failureCount24h:null,aiUsage:sample()}}};
 assert.ok(parseOperation(record));assert.equal(await storeOperation(db,parseOperation(record)),true);assert.equal(await storeOperation(db,parseOperation(record)),false);
 const result=await readOperations(db);assert.deepEqual(result.surfaces.recovery.latest.data.automation.aiUsage,sample());assert.deepEqual(result.surfaces.recovery.latestAiUsage,sample());
 const failed=structuredClone(record);failed.observedAt=failed.data.generatedAt=failed.data.automation.measuredAt='2026-09-30T12:05:00.000Z';failed.data.automation.aiUsage={status:'unavailable',measuredAt:failed.observedAt,errorCode:'usage_unavailable'};
 assert.ok(parseOperation(failed));await storeOperation(db,parseOperation(failed));
 const fallback=await readOperations(db);assert.equal(fallback.surfaces.recovery.latest.data.automation.aiUsage.status,'unavailable');assert.deepEqual(fallback.surfaces.recovery.latestAiUsage,sample());
 const legacy=structuredClone(failed);legacy.observedAt=legacy.data.generatedAt='2026-09-30T12:10:00.000Z';delete legacy.data.automation.aiUsage;assert.ok(parseOperation(legacy));
 record.data.automation.aiUsage.today.body='must never pass';assert.equal(parseOperation(record),null);
});
