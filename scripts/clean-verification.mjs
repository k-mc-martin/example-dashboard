import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const {id}=JSON.parse(readFileSync('artifacts/receiver-test.json','utf8'));
if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid test fixture identity');
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','wrangler.local.json','--command',`DELETE FROM messages WHERE id = '${id}' AND sender = 'Dashboard test (synthetic)'`],{stdio:'inherit'});
process.exit(result.status??1);
