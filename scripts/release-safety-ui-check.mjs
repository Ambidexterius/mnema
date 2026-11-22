import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {createUIFixture} from './ui-fixture.mjs';

const chrome=process.env.CHROME_PATH||['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
assert.ok(chrome,'Set CHROME_PATH to the installed Chrome/Chromium binary');
const fixture=await createUIFixture(4475);
const browser=await chromium.launch({executablePath:chrome,headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'});
 await context.addCookies(fixture.cookies);
 await context.addInitScript(()=>{
  const put=Storage.prototype.setItem;
  window.projectStateWrites=0;
  Storage.prototype.setItem=function(key,value){
   if(key==='ai-hyposut.demo.v1')window.projectStateWrites++;
   return put.call(this,key,value);
  };
 });
 const page=await context.newPage();
 page.setDefaultTimeout(10_000);
 await page.goto(fixture.base+'/projects/main/research');
 await page.locator('a.table-study').first().waitFor();
 await page.waitForFunction(()=>window.projectStateWrites>0);
 const initialWrites=await page.evaluate(()=>window.projectStateWrites);
 const poll=async()=>{
  const received=page.waitForResponse(response=>response.url().endsWith('/api/state')&&response.request().method()==='GET');
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  const response=await received;
  await response.finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  return response.json();
 };
 const previous=await poll();
 assert.equal(await page.evaluate(()=>window.projectStateWrites),initialWrites);
 await page.route('**/api/state',async route=>{
  const reply=await route.fetch();
  const data=await reply.json();
  data.state.studies[0].title='Обновление при той же версии';
  data.state.studies[0].fileName='Обновление при той же версии';
  await route.fulfill({json:data});
 });
 assert.equal((await poll()).version,previous.version);
 await page.getByText('Обновление при той же версии',{exact:true}).first().waitFor();
 await page.unroute('**/api/state');
 console.log('PASS unchanged-poll-and-same-version-update');

 await page.route('**/assets/NewsDialog-*.js',route=>route.abort());
 await page.getByRole('button',{name:/^Профиль:/}).click();
 const reload=page.waitForEvent('framenavigated',frame=>frame===page.mainFrame());
 await page.getByRole('menuitem',{name:'Что нового',exact:true}).click();
 await reload;
 await page.locator('.app-shell').waitFor();
 const repeated=await page.evaluate(()=>window.dispatchEvent(new Event('vite:preloadError',{cancelable:true})));
 assert.equal(repeated,true,'The same entry bundle cannot trigger a second automatic reload');
 console.log('PASS chunk-error-reloads-once');

 const ownerHeaders={Cookie:fixture.cookies.map(cookie=>cookie.name+'='+cookie.value).join('; '),
  'X-Mnema-Request':'1','Content-Type':'application/json'};
 const created=await fetch(fixture.base+'/api/workspaces',{method:'POST',headers:ownerHeaders,
  body:JSON.stringify({name:'Синтетический проект по ссылке',mode:'link'})});
 assert.equal(created.status,201);
 const {id}=await created.json();
 const sharing=await fetch(fixture.base+'/api/workspaces/'+id+'/sharing',{headers:ownerHeaders});
 assert.equal(sharing.status,200);
 const link=new URL((await sharing.json()).link.url);
 assert.ok(link.searchParams.get('share'));
 link.searchParams.set('fixture','retained');

 const guest=await browser.newContext({reducedMotion:'reduce'});
 const login=await guest.newPage();
 await login.goto(fixture.base+'/login?returnTo='+encodeURIComponent(link.pathname+link.search));
 const historyBefore=await login.evaluate(()=>history.length);
 await login.getByRole('textbox',{name:'Рабочая почта',exact:true}).fill(fixture.credentials.email);
 await login.getByLabel('Пароль',{exact:true}).fill(fixture.credentials.password);
 const redeem=login.waitForResponse(response=>response.url().endsWith('/share')&&response.request().method()==='POST');
 await login.getByRole('button',{name:'Войти',exact:true}).click();
 assert.equal((await redeem).status(),200);
 await login.waitForURL(url=>url.pathname===link.pathname&&!url.searchParams.has('share'));
 assert.equal(new URL(login.url()).searchParams.get('fixture'),'retained');
 assert.equal(await login.evaluate(()=>history.length),historyBefore);
 assert.equal((await guest.cookies()).find(cookie=>cookie.name==='mnema_ws')?.value,id);
 console.log('PASS project-link-login-clears-token-and-keeps-query');
 await guest.close();
}finally{
 await browser.close();
 await fixture.close();
}
