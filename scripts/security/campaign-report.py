"""Generate source evidence and, optionally, probe the three public demo boundaries."""
import http.client
import argparse, csv, hashlib, io, json, pathlib, re, socket, ssl, subprocess, urllib.request, datetime, sys
import os
if sys.platform=='darwin' and not os.environ.get('SSL_CERT_FILE') and pathlib.Path('/etc/ssl/cert.pem').is_file():
 os.environ['SSL_CERT_FILE']='/etc/ssl/cert.pem'
root=pathlib.Path(__file__).resolve().parents[2]
origin='vps-ca027b84.vps.ovh.us'
upstream='https://raw.githubusercontent.com/OWASP/ASVS/5cf9b032440be53ce345ab3c130fda46ba1ce7a2/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv'
parser=argparse.ArgumentParser()
parser.add_argument('--hosted',action='store_true');parser.add_argument('--output',default='artifacts/campaign/report.json')
args=parser.parse_args()
ref=urllib.request.urlopen(upstream, timeout=20).read()
assert hashlib.sha256(ref).hexdigest()=='98c8fe911b9edb403af8ee05d3ce8201ecac2659e313b053890a62847cdcf680'
official={r['req_id'][1:] for r in csv.DictReader(io.StringIO(ref.decode('utf-8-sig'))) if r['L']=='1'}
rows=json.loads((root/'docs/security/campaign/requirements.json').read_text());assert len(rows)==len(official)==70 and {r['id'] for r in rows}==official
checks=[]
def check(title,fn,ids):
 try: detail=fn(); result='Observed'
 except Exception as e: detail=str(e);result='Failed'
 checks.append(dict(check=title,outcome=result,detail=detail,mapped=ids))
paths=subprocess.check_output(['git','ls-files','app','lib','db','proxy.ts'],cwd=root,text=True).splitlines()
def primitive_inventory():
 hits=[]
 for path in paths:
  if not path.endswith(('.ts','.tsx','.mjs','.mts')):continue
  src=(root/path).read_text();hits.extend(path+': '+m for m in re.findall(r"(?:createHash|createHmac|createCipheriv|createDecipheriv)\(['\x22]([^'\x22]+)",src))
  if re.search(r"(?:createHash|createHmac|createCipheriv|createDecipheriv)\(['\x22](?:md5|sha1|des|rc4|[^'\x22]*ecb)",src,re.I):raise ValueError('Review primitive in '+path)
 return {'literal_call_sites':sorted(set(hits)), 'scope':'First-party tracked server source; review non-literal calls and dependencies separately.'}
check('First-party cryptographic primitives',primitive_inventory,['11.3.1','11.3.2','11.4.1'])
if args.hosted:
 def tls(host,version=None):
  c=ssl.create_default_context()
  if version:c.minimum_version=version;c.maximum_version=version
  with socket.create_connection((host,443),timeout=8) as sock,c.wrap_socket(sock,server_hostname=host) as ss:return {'negotiated':ss.version(),'validTo':ss.getpeercert()['notAfter']}
 for host in [origin,'mira.15-204-123-246.sslip.io','theo.15-204-123-246.sslip.io','attack.15-204-123-246.sslip.io']:
  def preferred(h=host):
   result=tls(h);assert result['negotiated']=='TLSv1.3',result;return result
  check(host+' trusted HTTPS, preferred protocol',preferred,['12.1.1','12.2.1','12.2.2'])
  def redirect(h=host):
   conn=http.client.HTTPConnection(h,80,timeout=8)
   try:
    conn.request('GET','/');r=conn.getresponse();assert r.status in (301,302,307,308) and r.getheader('Location')=='https://'+h+'/',r.status;return {'status':r.status,'location':r.getheader('Location')}
   finally:conn.close()
  check(host+' redirects cleartext HTTP',redirect,['12.2.1'])
 def obsolete(ver):
  c=ssl.create_default_context();c.minimum_version=ver;c.maximum_version=ver;c.set_ciphers('DEFAULT:@SECLEVEL=0')
  try:
   with socket.create_connection((origin,443),timeout=8) as sock,c.wrap_socket(sock,server_hostname=origin):pass
  except ssl.SSLError as e:
   if 'ALERT_PROTOCOL_VERSION' in str(e) or 'ALERT_HANDSHAKE_FAILURE' in str(e):return 'Peer rejected legacy TLS'
   raise
  raise ValueError('Legacy protocol was accepted')
 for v in (ssl.TLSVersion.TLSv1,ssl.TLSVersion.TLSv1_1):check(v.name+' disabled',lambda v=v:obsolete(v),['12.1.1'])
 check('TLS 1.2 still negotiates',lambda:tls(origin,ssl.TLSVersion.TLSv1_2),['12.1.1'])
 def probe(path,content=None):
  with urllib.request.urlopen('https://'+origin+path,timeout=10) as r:
   h=r.headers;assert re.search(r'max-age=(?:31536000|[4-9][0-9]{7,})',h.get('Strict-Transport-Security','')),'Missing one-year HSTS'
   ct=h.get('Content-Type','');assert not content or content in ct,ct
   return {'status':r.status,'type':ct,'hsts':h.get('Strict-Transport-Security')}
 for path,ct in [('/launch','text/html'),('/version','application/json')]:check(path+' headers',lambda p=path,t=ct:probe(p,t),['3.4.1','4.1.1'])
 def metadata():
  try: urllib.request.urlopen('https://'+origin+'/.git/HEAD',timeout=8)
  except urllib.error.HTTPError as e:
   if e.code in (401,403,404):return {'status':e.code}
   raise
  raise ValueError('Unexpectedly accessible')
 check('Public source metadata unavailable',metadata,['13.4.1'])
 commit=json.load(urllib.request.urlopen('https://'+origin+'/version',timeout=8))['commit']
else:commit=None
report={'standard':'OWASP ASVS 5.0.0 Level 1','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'deployedCommit':commit,'mappedRequirements':len(rows),'checks':checks,'note':'Observations support individual controls. Dependency advisories, remediation age, token handling, TLS policy and manual verdicts also require the linked evidence.'}
out=root/args.output;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n')
for c in checks:print(c['outcome'],c['check'])
if any(c['outcome']=='Failed' for c in checks):sys.exit(1)
