import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {closeDb,getDb} from '../db/index.ts';
import {parseOperation,readOperations,storeOperation} from '../lib/inbound-operations.ts';
const at='2026-09-29T01:00:00.000Z';
const sample={surface:'recovery',observedAt:at,status:'ok',data:{schemaVersion:1,generatedAt:at,backupFolder:{name:'SecDash Backups',bytes:1200,objects:4,measuredAt:at},restoreChecks:[{checkedAt:at,requestedSnapshot:'a'.repeat(64),ok:true,checksumsVerified:10}]}};
test('recovery envelope rejects secrets, unknown values and impossible metrics',()=>{
 assert.ok(parseOperation(sample));
 assert.equal(parseOperation({...sample,token:'secret'}),null);
 assert.equal(parseOperation({...sample,observedAt:new Date(Date.now()+600000).toISOString()}),null);
 assert.equal(parseOperation({...sample,data:{...sample.data,backupFolder:{...sample.data.backupFolder,bytes:-1}}}),null);
 assert.equal(parseOperation({...sample,data:{...sample.data,restoreChecks:[{...sample.data.restoreChecks[0],credentials:'secret'}]}}),null);
 assert.ok(parseOperation({surface:'recovery',observedAt:at,status:'error',errorCode:'provider_unavailable'}));
});
test('operations retain prior success, reject duplicate replacement and return compact ordered history',async t=>{
 closeDb();const dir=mkdtempSync(join(tmpdir(),'secdash-ops-'));process.env.SECDASH_DATABASE_PATH=join(dir,'db.sqlite');t.after(()=>{closeDb();rmSync(dir,{recursive:true});});const db=getDb();
 assert.equal(await storeOperation(db,parseOperation(sample)),true);
 assert.equal(await storeOperation(db,parseOperation({...sample,data:{...sample.data,backupFolder:{...sample.data.backupFolder,bytes:999}}})),false);
 for(let i=1;i<=30;i++) await storeOperation(db,{surface:'recovery',observedAt:new Date(Date.parse(at)+i*60000).toISOString(),status:'error',errorCode:'provider_unavailable'});
 const result=await readOperations(db);const recovery=result.surfaces.recovery;
 assert.equal(recovery.latest.status,'error');assert.equal(recovery.latestSuccess.data.backupFolder.bytes,1200);
 assert.equal(recovery.history.length,24);assert.ok(recovery.history[0].observedAt<recovery.history.at(-1).observedAt);
 assert.ok(recovery.history.every(row=>!('data' in row)));
 assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM operational_observations').first('count'),31);
 assert.equal(result.surfaces.azure.latest,null);
});

test('recovery automation distinguishes absent execution history from measured zero failures',()=>{
 const base={measuredAt:at,workflows:[],executionHistoryAvailable:false,lastExecution:null,failureCount24h:null};
 const withAutomation=automation=>({...sample,data:{...sample.data,automation}});
 assert.ok(parseOperation(withAutomation(base)));
 assert.equal(parseOperation(withAutomation({...base,failureCount24h:0})),null);
 assert.equal(parseOperation(withAutomation({...base,executionHistoryAvailable:true})),null);
 const measured={...base,executionHistoryAvailable:true,failureCount24h:0,lastExecution:{workflowId:'SecDashRecoveryOperational',status:'success',startedAt:at,finishedAt:at,durationMs:0}};
 assert.ok(parseOperation(withAutomation(measured)));
 assert.equal(parseOperation(withAutomation({...measured,secret:'redacted'})),null);
});
test('recovery accepts only the bounded two-library source catalog',()=>{
 const library=id=>({id,name:id,mode:'active-sync',setup:'not-initialized',eligibleForSync:true,phase:'idle',summary:'Awaiting setup.',destinations:[]});
 const catalog={schemaVersion:1,generatedAt:at,libraries:[library('dashboard-n8n'),library('example-app-source')]};
 assert.ok(parseOperation({...sample,data:{...sample.data,backupCatalog:catalog}}));
 assert.equal(parseOperation({...sample,data:{...sample.data,backupCatalog:{...catalog,privatePath:'/secret'}}}),null);
 assert.equal(parseOperation({...sample,data:{...sample.data,backupCatalog:{...catalog,libraries:[library('dashboard-n8n'),library('dashboard-n8n')]}}}),null);
});
