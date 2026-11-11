import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { localFetch } from "./local-fetch.mjs";

function listen(handler) {
  const server=createServer(handler);
  return new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>resolve(server));
  });
}

function close(server) {
  server.closeAllConnections();
  return new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}

test("native local fetch accepts bounded loopback responses without global fetch", async t => {
  const server=await listen((request,response)=>{
    if(request.url==="/declared") {
      response.writeHead(200,{"content-length":"4097"}); response.end("x".repeat(4097)); return;
    }
    if(request.url==="/streamed") {
      response.writeHead(200); response.write("x".repeat(3000)); response.end("x".repeat(3000)); return;
    }
    response.writeHead(200,{"content-type":"application/json"}); response.end('{"ok":true}');
  });
  t.after(()=>close(server));
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await localFetch(`${base}/valid`);
  assert.equal(response.ok,true); assert.equal(response.status,200);
  assert.equal(response.headers.get("content-type"),"application/json");
  assert.equal(await response.text(),'{"ok":true}');
  await assert.rejects(localFetch(`${base}/declared`),/response length/);
  await assert.rejects(localFetch(`${base}/streamed`),/response too large/);
  await assert.rejects(localFetch("http://localhost:5780/v1/jobs/latest"),/loopback/);
  await assert.rejects(localFetch("https://127.0.0.1:5780/v1/jobs/latest"),/loopback/);
});
