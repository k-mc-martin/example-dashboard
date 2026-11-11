import { getDb } from '../../../../db';
import { authorized, denied } from '../../../../lib/server-auth';
import { parseOperation, storeOperation } from '../../../../lib/inbound-operations';
export async function POST(request:Request) {
  if(!authorized(request,'ingest'))return denied(request);
  if(!(request.headers.get('content-type')||'').startsWith('application/json'))return Response.json({error:'JSON required'},{status:415});
  const reader=request.body?.getReader(); if(!reader)return Response.json({error:'Observation required'},{status:400});
  const parts:Uint8Array[]=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>262144){await reader.cancel();return Response.json({error:'Observation exceeds 256 KiB'},{status:413});}parts.push(part.value);}
  let json:unknown;try{json=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return Response.json({error:'Invalid JSON'},{status:400});}
  const sample=parseOperation(json);if(!sample)return Response.json({error:'Invalid operational observation'},{status:400});
  try{return Response.json({surface:sample.surface,observedAt:sample.observedAt,stored:await storeOperation(getDb(),sample)},{headers:{'Cache-Control':'no-store'}});}
  catch{return Response.json({error:'Storage unavailable; retry the same observation'},{status:503});}
}
