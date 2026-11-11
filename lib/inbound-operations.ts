import { z } from 'zod';
import type { SQLiteDatabase } from '../db/index';
import { parseProviderTelemetry } from './provider-telemetry.ts';
import { operationSurfaces, type OperationObservation, type OperationSurface, type OperationsResponse } from './operations.ts';
import { parseAiUsage, type AiUsage } from './ai-usage.ts';

const time = z.string().datetime({offset:true}).transform(s=>new Date(s).toISOString());
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const proof = z.object({checkedAt:time,requestedSnapshot:z.string().regex(/^(latest|[a-fA-F0-9]{64})$/),ok:z.boolean(),
  sourceCreatedAt:time.optional(),checksumsVerified:count.optional(),credentialDecryptionVerified:z.boolean().optional(),
  counts:z.object({credentials:count,users:count,workflows:count}).strict().optional(),
  dashboard:z.object({databases:count,files:count}).strict().optional(),serverDashboard:z.object({messages:count,tables:count}).strict().optional()}).strict();
const workflowId=z.enum(['SecDashAzureOperational','SecDashCloudflareOperational','SecDashGoDaddyOperational','SecDashGoogleDriveStorage','SecDashLemonSqueezyOperational','SecDashMailboxContinuityPrepared','SecDashMailboxRoutingDrain','SecDashRecoveryOperational']);
const aiUsage = z.custom<AiUsage>(value => parseAiUsage(value) !== null).transform(value => parseAiUsage(value)!);
const automation=z.object({measuredAt:time,workflows:z.array(z.object({id:workflowId,name:z.string().min(1).max(160),active:z.boolean()}).strict()).max(8),executionHistoryAvailable:z.boolean(),lastExecution:z.object({workflowId,status:z.string().min(1).max(40),startedAt:time,finishedAt:time.nullable(),durationMs:count.nullable()}).strict().nullable(),failureCount24h:count.nullable(),aiUsage:aiUsage.optional()}).strict().refine(x=>x.executionHistoryAvailable ? (x.lastExecution!==null && x.failureCount24h!==null) : (x.lastExecution===null && x.failureCount24h===null)).refine(x=>!x.aiUsage || Date.parse(x.aiUsage.measuredAt)<=Date.parse(x.measuredAt)+300_000);
const catalogEvent=z.object({id:z.string().min(1).max(128),kind:z.enum(['snapshot','verification','offload']),status:z.enum(['succeeded','failed']),occurredAt:time,snapshotId:z.string().min(1).max(128).nullable(),summary:z.string().max(320)}).strict();
const catalogDestination=z.object({id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),label:z.string().min(1).max(96),kind:z.enum(['google-drive','external-drive']),status:z.enum(['current','stale','error','unavailable','not-initialized']),lastSnapshot:z.object({snapshotId:z.string().min(1).max(128),createdAt:time,sizeBytes:count.nullable()}).strict().nullable(),lastVerification:z.object({status:z.enum(['passed','failed']),verifiedAt:time,snapshotId:z.string().min(1).max(128).nullable()}).strict().nullable(),history:z.array(catalogEvent).max(100),repositoryBytes:count.nullable().optional(),repositoryBytesStatus:z.enum(['measured','unavailable']).optional(),repositoryBytesMeasuredAt:time.nullable().optional()}).strict().refine(x=>{const any=x.repositoryBytes!==undefined||x.repositoryBytesStatus!==undefined||x.repositoryBytesMeasuredAt!==undefined;if(!any)return true;return x.repositoryBytesStatus==='measured'?x.repositoryBytes!==null&&x.repositoryBytesMeasuredAt!==null:x.repositoryBytesStatus==='unavailable'&&x.repositoryBytes===null&&x.repositoryBytesMeasuredAt===null;});
const catalogLibrary=z.object({id:z.enum(['dashboard-n8n','example-app-source']),name:z.string().min(1).max(96),mode:z.literal('active-sync'),setup:z.enum(['initialized','not-initialized','unavailable']),eligibleForSync:z.boolean(),phase:z.enum(['idle','preparing','snapshotting','uploading','verifying','complete','failed','unavailable']),summary:z.string().max(320),destinations:z.array(catalogDestination).max(8),sourceLogicalBytes:count.nullable().optional()}).strict();
const backupCatalog=z.object({schemaVersion:z.literal(1),generatedAt:time,libraries:z.array(catalogLibrary).length(2)}).strict().refine(x=>new Set(x.libraries.map(v=>v.id)).size===2);
const recoveryData = z.object({schemaVersion:z.literal(1),generatedAt:time,
  backupFolder:z.object({name:z.literal('SecDash Backups'),bytes:count,objects:count,measuredAt:time}).strict(),
  restoreChecks:z.array(proof).max(1000),automation:automation.optional(),backupCatalog:backupCatalog.optional()}).strict();
const errorCodes = z.enum(['authorization_required','provider_unavailable','rate_limited','invalid_response','incomplete_collection']);
const recovery = z.union([
  z.object({surface:z.literal('recovery'),observedAt:time,status:z.literal('ok'),data:recoveryData}).strict(),
  z.object({surface:z.literal('recovery'),observedAt:time,status:z.literal('error'),errorCode:errorCodes}).strict(),
]);
export type InboundOperation = Omit<OperationObservation,'receivedAt'>;
export function parseOperation(value:unknown):InboundOperation|null {
  if (!value || typeof value !== 'object') return null;
  const result = (value as {surface?:unknown}).surface === 'recovery' ? recovery.safeParse(value) : null;
  const parsed = result ? (result.success ? result.data : null) : parseProviderTelemetry(value);
  if (!parsed || Date.parse(parsed.observedAt)>Date.now()+300_000) return null;
  return parsed as InboundOperation;
}
export function operationStatement(db:SQLiteDatabase, sample:InboundOperation, receivedAt=new Date().toISOString()) {
  return db.prepare('INSERT INTO operational_observations(surface,observed_at,status,payload_json,received_at) VALUES(?,?,?,?,?) ON CONFLICT(surface,observed_at) DO NOTHING')
    .bind(sample.surface,sample.observedAt,sample.status,JSON.stringify(sample),receivedAt);
}
export async function storeOperation(db:SQLiteDatabase, sample:InboundOperation, receivedAt=new Date().toISOString()) {
  const result = await operationStatement(db,sample,receivedAt).run();
  return result.meta.changes===1;
}
export async function readOperationSurface(db: SQLiteDatabase, surface: OperationSurface, storageOnly = false) {
  const query = 'SELECT payload_json AS payload,received_at AS receivedAt FROM operational_observations WHERE surface=?';
  type Row = {payload: string; receivedAt: string};
  function observation(row: Row): OperationObservation {
    const record = {...JSON.parse(row.payload), receivedAt: row.receivedAt};
    if (storageOnly && record.data) {
      const {schemaVersion, generatedAt, backupFolder, restoreChecks, backupCatalog} = record.data;
      record.data = {schemaVersion, generatedAt, backupFolder, restoreChecks, backupCatalog};
    }
    return record;
  }
  const recent = await db.prepare<Row>(query + ' ORDER BY observed_at DESC LIMIT 24').bind(surface).all();
  const rows = recent.results.map(observation);
  const successful = await db.prepare<Row>(query + " AND status IN ('ok','partial') ORDER BY observed_at DESC LIMIT 1").bind(surface).first() as Row | null;
  const record: OperationsResponse['surfaces'][OperationSurface] = {
    latest: rows[0] ?? null, latestSuccess: successful ? observation(successful) : null,
    history: rows.map(({data: _data,...event}) => event).reverse(),
  };
  if (surface === 'recovery' && !storageOnly) {
    const lastUsage = await db.prepare<{usage:string}>("SELECT json_extract(payload_json, '$.data.automation.aiUsage') AS usage FROM operational_observations WHERE surface='recovery' AND status='ok' AND json_extract(payload_json, '$.data.automation.aiUsage.status')='ok' ORDER BY observed_at DESC LIMIT 1").first() as {usage:string}|null;
    const parsed = lastUsage ? parseAiUsage(JSON.parse(lastUsage.usage)) : null;
    record.latestAiUsage = parsed?.status === 'ok' ? parsed : null;
  }
  return record;
}

export async function readOperations(db:SQLiteDatabase):Promise<OperationsResponse> {
  const surfaces = {} as OperationsResponse['surfaces'];
  for (const surface of operationSurfaces) surfaces[surface] = await readOperationSurface(db, surface);
  return {surfaces, serverTime:new Date().toISOString()};
}
