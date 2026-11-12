import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createMnemaServer} from './server.ts';

test('MCP: official legacy/modern clients, OAuth PKCE, read-only project grants and immediate revocation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnemonika-mcp-')),base='http://127.0.0.1:4299',setup=randomBytes(32).toString('hex');
 const app=await createMnemaServer({dataDir:dir,baseURL:base,authSecret:randomBytes(32).toString('hex'),setupToken:setup});
 await new Promise<void>(resolve=>app.server.listen(4299,'127.0.0.1',resolve));const clients:Client[]=[];
 const req=async(path:string,{body,method,cookie='',headers={},redirect='follow'}:{body?:any;method?:string;cookie?:string;headers?:Record<string,string>;redirect?:RequestRedirect}={})=>{
  const response=await fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',Origin:base,'X-Mnema-Request':'1',...(cookie?{Cookie:cookie}:{}),...headers},redirect,...(body!==undefined?{body:JSON.stringify(body)}:{})});let data:any;try{data=await response.json()}catch{}return {response,data};
 };
 const connect=async(token:string,modern=true)=>{const client=new Client({name:'mnemonika-fixture',version:'1.0.0'},modern?{versionNegotiation:{mode:{pin:'2026-07-28'}}}:{});clients.push(client);await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{authProvider:{token:async()=>token}}));return client};
 const content=(result:any)=>result.structuredContent||JSON.parse(result.content.find(c=>c.type==='text').text);
 try{
  const owner=await req('/api/register',{body:{email:'mcp-owner@example.com',password:'fixture-mcp-password',setupToken:setup}});assert.equal(owner.response.status,200,JSON.stringify(owner.data));const cookie=owner.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  assert.equal(owner.response.headers.has('set-auth-jwt'),false);
  const metadata=await req('/.well-known/oauth-protected-resource/mcp');assert.equal(metadata.response.status,200,JSON.stringify(metadata.data));assert.equal(metadata.data.resource,base+'/mcp');assert(metadata.data.scopes_supported.includes('mcp:read'));
  const issuer=metadata.data.authorization_servers[0],discovery=await req('/.well-known/oauth-authorization-server/api/auth');assert.equal(discovery.response.status,200,JSON.stringify(discovery.data));assert.equal(discovery.data.issuer,issuer);assert(discovery.data.code_challenge_methods_supported.includes('S256'));assert(discovery.data.client_id_metadata_document_supported);
  const unauth=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(unauth.status,401);assert(unauth.headers.get('WWW-Authenticate').includes('oauth-protected-resource'));
  const b=await req('/api/workspaces',{cookie,body:{name:'Hidden fixture project'}});assert.equal(b.response.status,201);const bid=b.data.id;
  const current=app.db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get('main');const state=JSON.parse(String(current.data));
  state.studies=[{id:'fixture-study',title:'Fixture calendar study',type:'Интервью',format:'TXT',status:'ready',tags:[],summary:[],segments:[{id:'fixture-segment',time:67,speaker:'Participant',text:'Участник проверяет выбранные даты после сохранения.'}]}];
  state.findings=['verified','draft'].map((status,i)=>({id:'fixture-finding-'+i,studyId:'fixture-study',segmentId:'fixture-segment',title:'Fixture finding '+i,description:'Synthetic data only',kind:'Проблема',importance:'Средняя',status,origin:'ai',history:[]}));
  app.db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?').run(JSON.stringify(state),'main');
  const issued=await req('/api/mcp/tokens',{cookie,body:{name:'Fixture bot',projects:['main']}});assert.equal(issued.response.status,201,JSON.stringify(issued.data));const token=issued.data.token;assert(token.startsWith('mnm_'));
  assert(!JSON.stringify(app.db.prepare('SELECT * FROM mnema_mcp_grants').all()).includes(token));assert(!JSON.stringify((await req('/api/mcp/settings',{cookie})).data).includes(token));
  const modern=await connect(token),legacy=await connect(token,false);
  const tools=await modern.listTools();assert.deepEqual(new Set(tools.tools.map(t=>t.name)),new Set(['list_projects','search','fetch','get_findings']));assert(tools.tools.every(t=>t.annotations.readOnlyHint));
  assert.equal((await legacy.listTools()).tools.length,4);
  const projects=content(await modern.callTool({name:'list_projects',arguments:{}}));assert.deepEqual(projects.projects.map(p=>p.id),['main']);assert(!JSON.stringify(projects).includes('Hidden fixture'));
  const search=content(await modern.callTool({name:'search',arguments:{query:'выбранные даты'}}));assert.equal(search.results.length,1);assert(search.results[0].url.includes('workspace=main'));
  const fragment=content(await modern.callTool({name:'fetch',arguments:{id:search.results[0].id}}));assert.equal(fragment.text,state.studies[0].segments[0].text);assert.equal(fragment.metadata.time,67);
  const denied=await modern.callTool({name:'search',arguments:{query:'даты',project_id:bid}});assert.equal(denied.isError,true);
  assert.equal(content(await modern.callTool({name:'get_findings',arguments:{}})).findings.length,2);
  const ownerId=(await req('/api/session',{cookie})).data.user.id;
  app.db.prepare("UPDATE mnema_members SET role='view' WHERE user_id=? AND workspace_id='main'").run(ownerId);
  assert.equal(content(await modern.callTool({name:'get_findings',arguments:{}})).findings.length,1);
  const viewGrant=await req('/api/mcp/tokens',{cookie,body:{name:'View-limited fixture',projects:['main']}});assert.equal(viewGrant.response.status,201);
  app.db.prepare("UPDATE mnema_members SET role='full' WHERE user_id=? AND workspace_id='main'").run(ownerId);const capped=await connect(viewGrant.data.token);
  assert.equal(content(await capped.callTool({name:'get_findings',arguments:{}})).findings.length,1,'role upgrade must not silently widen the grant');
  assert.equal((await fetch(base+'/api/state',{headers:{Authorization:'Bearer '+token}})).status,401);
  assert.equal((await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
  const clientResponse=await fetch(base+'/api/auth/oauth2/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Fixture OAuth client',redirect_uris:['http://127.0.0.1:4309/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'mcp:read offline_access'})});const registered=await clientResponse.json();assert.equal(clientResponse.status,201,JSON.stringify(registered));
  const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
  const authorize=new URL(discovery.data.authorization_endpoint);authorize.search=new URLSearchParams({client_id:registered.client_id,redirect_uri:'http://127.0.0.1:4309/callback',response_type:'code',code_challenge:challenge,code_challenge_method:'S256',resource:base+'/mcp',scope:'mcp:read offline_access',state:'fixture-state'}).toString();
  const authResponse=await fetch(authorize,{headers:{Cookie:cookie,Accept:'text/html','Sec-Fetch-Mode':'navigate'},redirect:'manual'});assert([200,302].includes(authResponse.status));const authJSON=authResponse.status===200?await authResponse.json():null;const consentURL=new URL(authResponse.headers.get('Location')||authJSON?.url,base);assert.equal(consentURL.pathname,'/mcp/consent');
  const query=consentURL.search.slice(1),context=await req('/api/mcp/consent/context',{cookie,body:{query}});assert.equal(context.response.status,200,JSON.stringify(context.data));assert.equal(context.data.client.id,registered.client_id);
  const tampered=new URLSearchParams(query);tampered.set('redirect_uri','https://evil.example');assert.equal((await req('/api/mcp/consent/context',{cookie,body:{query:tampered.toString()}})).response.status,400);
  const accepted=await req('/api/mcp/consent',{cookie,body:{query,accept:true,projects:['main']}});assert.equal(accepted.response.status,200,JSON.stringify(accepted.data));assert.equal(accepted.data.redirect,true);const callback=new URL(accepted.data.url);assert.equal(callback.searchParams.get('state'),'fixture-state');
  const tokenResponse=await fetch(discovery.data.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registered.client_id,redirect_uri:'http://127.0.0.1:4309/callback',code:callback.searchParams.get('code'),code_verifier:verifier,resource:base+'/mcp'})});const oauth=await tokenResponse.json();assert.equal(tokenResponse.status,200,JSON.stringify(oauth));assert(oauth.access_token);
  const authorized=await connect(oauth.access_token);assert.equal((await authorized.listTools()).tools.length,4);assert.equal((await fetch(base+'/api/state',{headers:{Authorization:'Bearer '+oauth.access_token}})).status,401,'OAuth MCP credentials must not authenticate the application REST API');
  const replay=await fetch(discovery.data.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:registered.client_id,redirect_uri:'http://127.0.0.1:4309/callback',code:callback.searchParams.get('code'),code_verifier:verifier,resource:base+'/mcp'})});assert.equal(replay.status,400);
  const grants=(await req('/api/mcp/settings',{cookie})).data.grants,oauthGrant=grants.find(g=>g.kind==='oauth');assert(oauthGrant);assert.equal((await req('/api/mcp/grants/'+oauthGrant.id+'/revoke',{cookie,body:{}})).response.status,200);
  const afterOAuthRevoke=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+oauth.access_token,'Content-Type':'application/json'},body:'{}'});assert.equal(afterOAuthRevoke.status,401);
  const needsConsent=await fetch(authorize,{headers:{Cookie:cookie,Accept:'text/html','Sec-Fetch-Mode':'navigate'},redirect:'manual'});const needsJSON=needsConsent.status===200?await needsConsent.json():null;assert.equal(new URL(needsConsent.headers.get('Location')||needsJSON?.url,base).pathname,'/mcp/consent');
  assert.equal((await req('/api/mcp/grants/'+issued.data.id+'/revoke',{cookie,body:{}})).response.status,200);
  assert.equal((await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'})).status,401);
  const freshResponse=await fetch(authorize,{redirect:'manual'}),freshJSON=freshResponse.status===200?await freshResponse.json():null;
  const loginURL=new URL(freshResponse.headers.get('Location')||freshJSON?.url,base);assert.equal(loginURL.pathname,'/mcp/login');
  const signedLogin=loginURL.search.slice(1),login=await req('/api/auth/sign-in/email',{body:{email:'mcp-owner@example.com',password:'fixture-mcp-password',oauth_query:signedLogin}});
  assert.equal(login.response.status,200,JSON.stringify(login.data));assert.equal(login.data.redirect,true);assert.equal(new URL(login.data.url,base).pathname,'/mcp/consent');

 }finally{
  await Promise.allSettled(clients.map(c=>c.close()));const closed=new Promise<void>(resolve=>app.server.once('close',resolve));app.server.closeAllConnections();app.close();await closed;await rm(dir,{recursive:true,force:true});
 }
});
