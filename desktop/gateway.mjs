import { createReadStream, lstatSync, realpathSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { parseBackupCatalog, parseBackupStatus } from '../infra/dashboard/access.mjs';
import { readPublishedRelease } from '../lib/published-release.mjs';
import { localFetch } from './local-fetch.mjs';

const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.ico':'image/x-icon' };
const SECURITY = {
  'cache-control':'no-store', 'x-content-type-options':'nosniff', 'x-frame-options':'DENY',
  'referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
export function jsonReply(response,status,value) {
  const body=Buffer.from(JSON.stringify(value));
  response.writeHead(status,{...SECURITY,'content-type':'application/json','content-length':body.length}); response.end(body);
}

function validAttentionDismissal(value) {
  return value && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).length===2
    && typeof value.identity==='string' && /^[a-z0-9][a-z0-9:._-]{0,179}$/.test(value.identity)
    && typeof value.conditionRevision==='string' && value.conditionRevision.length>=1
    && value.conditionRevision.length<=1000 && !/[\u0000-\u001f\u007f]/.test(value.conditionRevision);
}

async function boundedResponseText(response, limit=4096) {
  const rawLength=response.headers.get('content-length');
  if(rawLength!==null) {
    const length=Number(rawLength);
    if(!Number.isSafeInteger(length) || length<0 || length>limit) {
      await response.body?.cancel().catch(()=>{});
      throw new Error('invalid response length');
    }
  }
  if(!response.body) {
    const text=await response.text();
    if(Buffer.byteLength(text,'utf8')>limit) throw new Error('response too large');
    return text;
  }
  const reader=response.body.getReader();
  const chunks=[]; let total=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      total+=value.byteLength;
      if(total>limit) throw new Error('response too large');
      chunks.push(Buffer.from(value));
    }
  } catch(error) {
    await reader.cancel().catch(()=>{});
    throw error;
  }
  return Buffer.concat(chunks,total).toString('utf8');
}

export function createDesktopHandler({uiRoot,getPort,getUpstream,operatorToken,backupService,backupControllerPort=5780,timeoutMs=15000}) {
  const root=realpathSync(uiRoot);
  return async (req,res) => {
    const host=`127.0.0.1:${getPort()}`;
    const origin=`http://${host}`;
    const site=req.headers['sec-fetch-site'];
    if (req.headers.host!==host || (req.headers.origin && req.headers.origin!==origin) || (site && !['same-origin','none'].includes(site)) || typeof req.url!=='string' || !req.url.startsWith('/') || req.url.startsWith('//')) {
      return jsonReply(res,403,{error:'This interface is available only in the local app.'});
    }
    let url;
    try { url=new URL(req.url,origin); } catch { return jsonReply(res,400,{error:'Invalid request.'}); }
    if(url.origin!==origin || url.username || url.password) return jsonReply(res,403,{error:'Invalid destination.'});
    if (url.pathname === '/api/releases') {
      if (req.method !== 'GET') return jsonReply(res,405,{error:'Method not allowed.'});
      try { return jsonReply(res,200,await readPublishedRelease()); }
      catch { return jsonReply(res,503,{error:'Published release unavailable.'}); }
    }
    if(url.pathname==='/api/backups' || url.pathname==='/api/backup-catalog') {
      if(!['GET','POST'].includes(req.method)) return jsonReply(res,405,{error:'Method not allowed.'});
      const catalog=url.pathname==='/api/backup-catalog';
      const action=JSON.stringify({action:'sync'});
      if(req.method==='POST' && (req.headers.origin!==origin || site!=='same-origin' || req.headers['transfer-encoding'] || (catalog ? (req.headers['content-type']?.split(';')[0]!=='application/json' || Number(req.headers['content-length']||0)!==Buffer.byteLength(action)) : Number(req.headers['content-length']||0)!==0))) return jsonReply(res,403,{error:'Same-origin request required.'});
      if(catalog && req.method==='POST') { const chunks=[]; for await(const chunk of req) chunks.push(chunk); if(Buffer.concat(chunks).toString('utf8')!==action) return jsonReply(res,400,{error:'Invalid catalog action.'}); }
      try {
        if(!backupService || !await backupService.ensure()) throw new Error('unavailable');
        const endpoint=catalog?'/v1/catalog':(req.method==='POST'?'/v1/jobs':'/v1/jobs/latest');
        const response=await localFetch(`http://127.0.0.1:${backupControllerPort}${endpoint}`,{method:req.method,headers:{authorization:`Bearer ${backupService.token}`,...(catalog&&req.method==='POST'?{'content-type':'application/json','content-length':String(Buffer.byteLength(action))}:{})},...(catalog&&req.method==='POST'?{body:action}:{}),maxResponseBytes:catalog?65536:4096,signal:AbortSignal.timeout(5000)});
        const text=await boundedResponseText(response,catalog?65536:4096);
        const status=catalog?parseBackupCatalog(JSON.parse(text)):parseBackupStatus(JSON.parse(text));
        if(!status || !(response.ok || (response.status===409 && (catalog?status.update.state==='running':status.state==='running')))) throw new Error('invalid');
        return jsonReply(res,req.method==='POST'?202:200,status);
      } catch { return jsonReply(res,503,{error:'The local backup service is unavailable.'}); }
    }
    if(url.pathname==='/api/attention-dismissals' && req.method==='POST') {
      if(req.headers.origin!==origin || site!=='same-origin' || req.headers['transfer-encoding']
        || req.headers['content-type']?.split(';')[0]!=='application/json') return jsonReply(res,403,{error:'Same-origin JSON request required.'});
      const declared=Number(req.headers['content-length']||0);
      if(!Number.isSafeInteger(declared) || declared<1 || declared>2048) return jsonReply(res,413,{error:'Dismissal request is too large.'});
      const chunks=[]; let size=0;
      for await(const chunk of req) { size+=chunk.length; if(size>2048) return jsonReply(res,413,{error:'Dismissal request is too large.'}); chunks.push(chunk); }
      if(size!==declared) return jsonReply(res,400,{error:'Invalid dismissal request.'});
      let value; try { value=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return jsonReply(res,400,{error:'Invalid dismissal request.'}); }
      if(!validAttentionDismissal(value)) return jsonReply(res,400,{error:'Invalid dismissal request.'});
      const body=Buffer.from(JSON.stringify(value));
      let upstreamPort;
      try { upstreamPort=await getUpstream(); } catch { return jsonReply(res,503,{error:'The private server is unavailable. Reconnect and refresh.'}); }
      const upstream=httpRequest({hostname:'127.0.0.1',port:upstreamPort,path:url.pathname,method:'POST',headers:{host:'127.0.0.1:5286',authorization:`Bearer ${operatorToken}`,accept:'application/json','content-type':'application/json','content-length':body.length,origin:'http://127.0.0.1:5286','sec-fetch-site':'same-origin'}},remote=>{
        res.writeHead(remote.statusCode??502,{...SECURITY,'content-type':'application/json'});
        remote.on('error',()=>res.destroy()); remote.pipe(res);
      });
      upstream.setTimeout(timeoutMs,()=>upstream.destroy());
      upstream.on('error',()=>res.headersSent?res.destroy():jsonReply(res,503,{error:'The private server connection is unavailable. Try refreshing.'}));
      res.on('close',()=>upstream.destroy()); upstream.end(body); return;
    }
    if(url.pathname.startsWith('/api/')) {
      if(!['GET','HEAD'].includes(req.method)) return jsonReply(res,405,{error:'Method not allowed.'});
      if(!['/api/dashboard','/api/health','/api/drive-storage','/api/operations','/api/feedback','/api/attention-dismissals'].includes(url.pathname) && !/^\/api\/messages\/[a-f0-9]{64}$/.test(url.pathname)) return jsonReply(res,403,{error:'This operation is not available in the desktop client.'});
      if(url.search && url.pathname!=='/api/feedback') return jsonReply(res,400,{error:'Unexpected query.'});
      let upstreamPort;
      try { upstreamPort=await getUpstream(); } catch { return jsonReply(res,503,{error:'The private server is unavailable. Reconnect and refresh.'}); }
      const upstream=httpRequest({hostname:'127.0.0.1',port:upstreamPort,path:url.pathname+url.search,method:req.method,headers:{host:'127.0.0.1:5286',authorization:`Bearer ${operatorToken}`,accept:'application/json'}},remote=>{
        res.writeHead(remote.statusCode??502,{...SECURITY,'content-type':'application/json'});
        remote.on('error',()=>res.destroy()); remote.pipe(res);
      });
      upstream.setTimeout(timeoutMs,()=>upstream.destroy());
      upstream.on('error',()=>res.headersSent?res.destroy():jsonReply(res,503,{error:'The private server connection is unavailable. Try refreshing.'}));
      res.on('close',()=>upstream.destroy()); upstream.end(); return;
    }
    if(!['GET','HEAD'].includes(req.method)) return jsonReply(res,405,{error:'Method not allowed.'});
    let file;
    try {
      const name=decodeURIComponent(url.pathname);
      if(name.includes('\0') || name.includes('\\') || name.split('/').includes('..')) throw new Error('path');
      file=path.resolve(root,name==='/'?'index.html':`.${name}`);
      if(!file.startsWith(root+path.sep) || lstatSync(file).isSymbolicLink() || realpathSync(file)!==file || !statSync(file).isFile() || !TYPES[path.extname(file)]) throw new Error('path');
    } catch { return jsonReply(res,404,{error:'Resource not found.'}); }
    const size=statSync(file).size;
    res.writeHead(200,{...SECURITY,'content-type':TYPES[path.extname(file)],'content-length':size});
    if(req.method==='HEAD') return res.end();
    const stream=createReadStream(file); stream.on('error',()=>res.destroy()); stream.pipe(res);
  };
}
