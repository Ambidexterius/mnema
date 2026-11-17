import {chromium} from 'playwright-core';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createUIFixture} from './ui-fixture.mjs';

const chrome=process.env.CHROME_PATH||['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
if(!chrome)throw Error('Set CHROME_PATH to the installed Chrome/Chromium binary');
const out=resolve(process.env.UI_CHECK_OUTPUT||'artifacts/ui-check');await mkdir(out,{recursive:true});
// Sectioned answer exercises «Главное», quiet captions, bold item leads and conclusion cards.
const ANSWER='Хозяева не успевают ответить быстро [1].\n\n## Цифры\n- Отмечают задержку: 7 из 12 хозяев — интервью [1]\n- **Опоздание**: до 3 часов — дневники [1]\n\n## Скорость ответа\n- **Уведомления теряются.** Узнают о вопросе поздно [1].\n\n## Выводы\n- Важнее уведомления, чем шаблоны.\n\n## Что осталось невыясненным\n- Влияние на отмены неизвестно.';
let failSpeakers=true;
const fixture=await createUIFixture(Number(process.env.UI_CHECK_PORT||4461),ANSWER,async({segments,participants})=>{
 assert.equal(participants,4);
 if(failSpeakers){failSpeakers=false;throw new Error('Fixture failure')}
 return {speakers:Object.fromEntries(segments.slice(1).map((segment,i)=>[segment.id,'Спикер '+(i%4+1)])),count:4,engine:'Fixture',processingSeconds:0};
});
const browser=await chromium.launch({executablePath:chrome,headless:true});
const checks=[],errors=[];
const run=async(name,fn)=>{await fn();checks.push(name)};
const contrast=(foreground,background)=>{
 const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const a=luminance(foreground),b=luminance(background);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
};
try{
 for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'});await context.addCookies(fixture.cookies);
  await context.addInitScript(theme=>{const saved=JSON.parse(localStorage.getItem('ai-hyposut.demo.v1')||'{}');localStorage.setItem('ai-hyposut.demo.v1',JSON.stringify({version:1,data:{...saved.data,theme}}))},theme);
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const goto=async path=>{await page.goto(fixture.base+path);await page.locator('.app-shell').waitFor()};
  const screenshot=name=>page.screenshot({path:resolve(out,theme+'-'+name+'.png')});
  const checkBackPosition=async(back,heading)=>{
   const b=await back.boundingBox(),h=await heading.boundingBox(),bar=await page.locator('.topbar').boundingBox();
   assert.ok(b.x+b.width<=h.x+1);assert.ok(b.y<h.y+h.height&&b.y+b.height>h.y);assert.ok(b.y>=bar.y+bar.height-1);assert.ok(b.width>=32&&b.height>=32);
  };
  await run(theme+': centered startup status at 16px',async()=>{
   let unlock;const gate=new Promise(resolve=>unlock=resolve);await page.route('**/api/session',async route=>{await gate;await route.continue()});
   try{await page.goto(fixture.base+'/projects');await page.locator('.auth-loading').waitFor();const geometry=await page.locator('.auth-loading').evaluate(e=>{const t=e.querySelector(':scope>span').getBoundingClientRect(),loader=e.querySelector('.g-loader').getBoundingClientRect();return{font:getComputedStyle(e).fontSize,x:t.x+t.width/2,y:(loader.y+t.bottom)/2,width:innerWidth,height:innerHeight}});assert.equal(geometry.font,'16px');assert.ok(Math.abs(geometry.x-geometry.width/2)<1);assert.ok(Math.abs(geometry.y-geometry.height/2)<1);await screenshot('startup-loading')}
   finally{unlock();await page.locator('.app-shell').waitFor();await page.unroute('**/api/session')}
  });
  await run(theme+': catalog copy and design colors',async()=>{
   await goto('/projects');await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Создать',exact:true}).count(),1);
   const palette=await page.locator('.g-root').first().evaluate(e=>({theme:e.className,background:getComputedStyle(e).getPropertyValue('--g-color-base-background').trim(),brand:getComputedStyle(e).getPropertyValue('--g-color-base-brand').trim()}));
   assert.ok(palette.theme.includes('theme_'+theme));assert.equal(palette.background,theme==='dark'?'#121213':'#fff');assert.equal(palette.brand,'#ee204d');assert.equal(await page.locator('.projects-heading>p').evaluate(e=>getComputedStyle(e).fontSize),'14px');await screenshot('projects');
  });
  await run(theme+': primary action contrast keeps brand red',async()=>{
   await page.getByRole('button',{name:'Создать',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Новый проект',exact:true});await dialog.waitFor();
   const button=dialog.getByRole('button',{name:'Создать и перейти',exact:true});
   const privacy=dialog.getByRole('checkbox',{name:'Только приглашённые',exact:true});
   assert.equal(await privacy.isChecked(),false);
   await privacy.check();
   assert.equal(await privacy.isChecked(),true);
   const pair=()=>button.evaluate(e=>({text:getComputedStyle(e).color,fill:getComputedStyle(e,'::before').backgroundColor}));
   let colors=await pair();assert.equal(colors.fill,'rgb(224, 30, 72)');assert.ok(contrast(colors.text,colors.fill)>=4.5);
   await button.hover();await page.waitForTimeout(180);colors=await pair();assert.ok(contrast(colors.text,colors.fill)>=4.5);await page.mouse.move(0,0);await dialog.press('Escape');await dialog.waitFor({state:'hidden'});
  });
  for(const width of [320,390,768,1024,1440])await run(theme+': projects responsive '+width,async()=>{
   await page.setViewportSize({width,height:844});await page.waitForTimeout(80);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(width<640){const geometry=await page.locator('.projects-heading').evaluate(e=>{const h=e.querySelector('h1').getBoundingClientRect(),b=e.querySelector('button').getBoundingClientRect(),card=document.querySelector('.project-folder-stage').getBoundingClientRect(),grid=document.querySelector('.projects-grid').getBoundingClientRect();return{headingY:h.y+h.height/2,buttonY:b.y+b.height/2,card:card.width,grid:grid.width}});assert.ok(Math.abs(geometry.headingY-geometry.buttonY)<2);assert.ok(Math.abs(geometry.card-geometry.grid)<1);if(width===390)await screenshot('projects-mobile')}
  });
  await run(theme+': mobile project navigation and desktop table',async()=>{
   for(const width of [320,390,768,1024,1440]){
    await page.setViewportSize({width,height:844});
    await goto('/projects/main');
    const compact=width<960;
    const tab=page.locator('.page-heading .project-tabs').getByRole('link',{name:new RegExp('^'+(compact?'Документы':'Материалы'))});
    await tab.waitFor();
    // Back is an icon beside H1; no separate navigation row above the heading.
    assert.equal(await page.getByRole('link',{name:'К проектам'}).count(),0);
    assert.equal(await page.locator('.topbar .project-tabs').count(),0);
    const title=await page.locator('.project-overview h1').boundingBox(),tabs=await page.locator('.page-heading .project-tabs').boundingBox();
    const back=page.getByRole('link',{name:'Назад',exact:true});assert.equal(await back.getAttribute('href'),'/projects');assert.equal(await page.locator('.page-heading .page-title-row>.page-back').count(),1);assert.equal(await page.locator('.project-back').count(),0);await checkBackPosition(back,page.locator('.project-overview h1'));
    assert.ok(tabs.y>=title.y+title.height);
    await tab.click();
    await page.locator(compact?'.mobile-material-list':'.study-table').waitFor();
    assert.equal(await page.getByRole('button',{name:'Добавить',exact:true}).count(),1);
    // Every project section keeps the project name as its only H1; the tab names the section.
    for(const path of ['/projects/main','/projects/main/findings','/projects/main/research']){await goto(path);await page.locator('.page-heading .project-tabs').waitFor();assert.deepEqual(await page.locator('h1').allInnerTexts(),['Тест интерфейса']);assert.equal(await page.getByRole('link',{name:'Назад',exact:true}).count(),1)}
    assert.match(await page.title(),/^(Материалы|Документы) · Тест интерфейса — Мнемодак$/);
    await goto('/projects/main');await back.click();await page.waitForURL(fixture.base+'/projects');
    await page.getByRole('button',{name:'Открыть проект «Тест интерфейса»',exact:true}).click();await page.locator('.project-overview').waitFor();await page.waitForFunction(()=>document.activeElement?.id==='main');await back.focus();await back.press('Enter');await page.waitForURL(fixture.base+'/projects');
    await goto('/projects/main');await page.locator('.project-tabs').getByRole('link',{name:/^Находки/}).click();await page.waitForURL(fixture.base+'/projects/main/findings');await back.click();await page.waitForURL(fixture.base+'/projects/main');await page.locator('.project-overview').waitFor();await screenshot('project-back-'+width);
   }
  });
  await run(theme+': private project shows its access mode at every width',async()=>{
   const project=fixture.app.db.prepare('SELECT id FROM mnema_workspaces WHERE name=?').get('Другой раздел');
   await context.request.patch(fixture.base+'/api/workspaces/'+project.id+'/sharing',{headers:{'X-Mnema-Request':'1'},data:{mode:'private'}});
   await goto('/projects/'+project.id);
   for(const width of [320,390,768,1024,1440]){
    await page.setViewportSize({width,height:844});
    const share=page.getByRole('button',{name:'Поделиться проектом',exact:true});
    await share.waitFor();
    const status=page.locator('.project-access-status');
    assert.match(await status.innerText(),width<960?/Приватный/:/Только приглашённые/);
    assert.equal(await status.evaluate(el=>Boolean(el.closest('button,a'))),false);
    const bounds=await share.boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1);
    if(width<=390){
     assert.ok(bounds.height>=48 && bounds.width>=48);
     const face=await share.evaluate(el=>{const box=el.getBoundingClientRect(),style=getComputedStyle(el,'::before');return [box.width-parseFloat(style.left)-parseFloat(style.right),box.height-parseFloat(style.top)-parseFloat(style.bottom)]});
     assert.deepEqual(face,[36,36]);
    }
    if(width!==320 && width!==1440)continue;
    await share.click();
    const dialog=page.getByRole('dialog',{name:'Поделиться проектом',exact:true});
    await dialog.getByText('Только приглашённые',{exact:true}).waitFor();
    await dialog.getByRole('textbox',{name:'Рабочая почта участника'}).fill('invite@example.test');
    const role=dialog.getByRole('combobox',{name:'Роль нового участника'});
    await role.click();await page.getByRole('option',{name:'Полный доступ',exact:true}).click();
    assert.equal(await role.innerText().then(t=>t.trim()),'Полный доступ');
    await screenshot('private-sharing-'+width);
    await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
   }
  });
  await run(theme+': overview materials column stays short in a large project',async()=>{
   const row=fixture.app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get(),state=JSON.parse(row.data),base=state.studies.find(s=>s.id==='sample');
   const extra=Array.from({length:40},(_,i)=>({...base,id:'bulk'+i,title:'Интервью № '+i,date:'2026-11-0'+(1+i%9),...(i===39?{status:'error'}:{})}));
   fixture.app.db.prepare("UPDATE mnema_workspaces SET data=? WHERE id='main'").run(JSON.stringify({...state,studies:[...state.studies,...extra]}));
   try{
    for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:844});await goto('/projects/main');const rows=page.locator('.material-rail>li');await rows.first().waitFor();
     assert.equal(await rows.count(),8);assert.match(await rows.first().locator('.material-rail-text a').getAttribute('href'),/studies\/report$/);assert.match(await rows.nth(1).locator('.material-rail-text a').getAttribute('href'),/studies\/bulk39$/);
     const section=page.getByRole('region',{name:/^Материалы/}),more=section.getByRole('link',{name:'Все материалы',exact:true}),add=section.getByRole('button',{name:'Добавить файл',exact:true});
     assert.match(await more.getAttribute('href'),/\/projects\/main\/research$/);assert.match(await section.getByRole('link',{name:/^Скачать всё/}).getAttribute('href'),/^\/api\/files\/archive/);
     const heading=await section.locator('.section-heading').boundingBox(),link=await more.boundingBox(),button=await add.boundingBox(),first=await rows.first().boundingBox();
     assert.ok(link.y>=heading.y&&link.y+link.height<=heading.y+heading.height+1);assert.ok(button.y>=heading.y+heading.height);const rail=await rows.first().boundingBox();
     assert.ok(button.x>heading.x);assert.ok(Math.abs(button.x-rail.x)<1);
     assert.equal(button.height,width<960?36:28);assert.ok(Math.abs(button.width-rail.width)<1);assert.ok(first.y>=button.y+button.height);
     const title=rows.first().locator('.material-rail-text a'),fullTitle=await title.innerText(),text=await title.evaluate(e=>({height:e.getBoundingClientRect().height,overflow:getComputedStyle(e).textOverflow,nowrap:getComputedStyle(e).whiteSpace,clipped:e.scrollWidth>e.clientWidth}));
     assert.equal(text.height,20);assert.equal(text.overflow,'ellipsis');assert.equal(text.nowrap,'nowrap');assert.equal(await title.getAttribute('title'),width<960?null:fullTitle);if(width===320||width===1440)assert.ok(text.clipped);
     const findings=page.getByRole('link',{name:'Все находки',exact:true});assert.equal(await findings.getAttribute('class'),await more.getAttribute('class'));assert.match(await findings.getAttribute('href'),/\/projects\/main\/findings$/);
     await page.emulateMedia({reducedMotion:'no-preference'});await title.hover();assert.equal(await page.getByRole('tooltip').count(),0);
     if(width>=960&&text.clipped){await page.waitForFunction(()=>{const e=document.querySelector('.material-rail-text a');return e.scrollLeft>=e.scrollWidth-e.clientWidth-1});await screenshot('overview-material-title-hover-'+width)}else{await page.waitForTimeout(350);assert.equal(await title.evaluate(e=>e.scrollLeft),0)}
     await page.mouse.move(0,0);await page.waitForFunction(()=>document.querySelector('.material-rail-text a').scrollLeft===0);
     await page.emulateMedia({reducedMotion:'reduce'});await title.hover();assert.equal(await title.evaluate(e=>e.scrollLeft),0);await page.mouse.move(0,0);
     await add.click();const upload=page.getByRole('dialog');await upload.waitFor();await page.keyboard.press('Escape');await upload.waitFor({state:'hidden'});
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await screenshot('overview-many-materials-'+width);
    }
    await page.getByRole('link',{name:'Все материалы',exact:true}).click();await page.locator('.study-table').waitFor();
   }finally{fixture.app.db.prepare("UPDATE mnema_workspaces SET data=? WHERE id='main'").run(row.data)}
  });
  await run(theme+': single-key creation always enabled, visible hints and no settings switch',async()=>{
   await page.evaluate(()=>{const key='ai-hyposut.demo.v1',saved=JSON.parse(localStorage.getItem(key)||'{}');localStorage.setItem(key,JSON.stringify({...saved,version:1,data:{...saved.data,shortcutsEnabled:false}}))});await page.reload();await page.locator('.app-shell').waitFor();
   await goto('/projects');const main=page.locator('#main'),create=page.getByRole('button',{name:'Создать',exact:true});
   assert.equal(await create.getAttribute('aria-keyshortcuts'),'C');assert.equal(await page.getByRole('link',{name:'Проекты',exact:true}).first().locator('.shortcut-hint').innerText(),'C');assert.equal(await page.locator('.sidebar a[aria-keyshortcuts="T"] .shortcut-hint').isVisible(),true);
   for(const [selector,label,key] of [['.sidebar a[aria-label="Проекты"]','Создать новый проект','C'],['.sidebar a[aria-label="Новый чат"]','Новый чат','T']]){
    await page.locator(selector).hover();const tip=page.getByRole('tooltip').filter({hasText:label});await tip.waitFor();assert.equal(await tip.locator('kbd').last().innerText(),key);await screenshot('tooltip-'+key);await page.mouse.move(800,500);await tip.waitFor({state:'hidden'});
   }
   await main.press('c');const dialog=page.getByRole('dialog',{name:'Новый проект',exact:true});await dialog.waitFor();
   const name=page.getByRole('textbox',{name:'Название',exact:true});await name.fill('ct');await name.press('t');assert.equal(await name.inputValue(),'ctt');assert.equal(new URL(page.url()).pathname,'/projects');
   await name.press('Escape');await dialog.waitFor({state:'hidden'});
   await main.dispatchEvent('keydown',{key:'с',code:'KeyC',bubbles:true,cancelable:true});await dialog.waitFor();await name.press('Escape');await dialog.waitFor({state:'hidden'});
   const ignored=await main.evaluate(el=>[{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{repeat:true},{isComposing:true},{keyCode:229}].map(options=>{const e=new KeyboardEvent('keydown',{key:'c',code:'KeyC',bubbles:true,cancelable:true,...options});el.dispatchEvent(e);return e.defaultPrevented}));assert.ok(ignored.every(value=>!value));assert.equal(await dialog.count(),0);
   await main.dispatchEvent('keydown',{key:'е',code:'KeyT',bubbles:true,cancelable:true});await page.waitForURL('**/chat');const composer=page.getByRole('textbox',{name:'Вопрос по всем исследованиям',exact:true});await composer.waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Вопрос по всем исследованиям');
   await composer.fill('ct');await composer.press('c');assert.equal(await composer.inputValue(),'ctc');assert.equal(await dialog.count(),0);
   await goto('/projects');await main.evaluate(el=>{const e=document.createElement('div');e.contentEditable='true';e.id='shortcut-editor';el.appendChild(e)});await page.locator('#shortcut-editor').press('c');assert.equal(await dialog.count(),0);await page.locator('#shortcut-editor').evaluate(el=>el.remove());
   await page.getByRole('button',{name:/Профиль:/}).click();await page.locator('.account-menu').waitFor();assert.equal(await page.getByText('Горячие клавиши',{exact:true}).count(),0);assert.equal(await page.getByLabel('Звук уведомлений',{exact:true}).count(),1);await screenshot('profile-shortcuts-always-enabled');await page.getByRole('button',{name:/Профиль:/}).click();await page.locator('.account-menu').waitFor({state:'hidden'});
   await page.reload();await page.locator('.app-shell').waitFor();assert.equal(await create.getAttribute('aria-keyshortcuts'),'C');await main.press('c');await dialog.waitFor();await name.press('Escape');await dialog.waitFor({state:'hidden'});await screenshot('shortcuts');
  });
  await run(theme+': MnemoDuck brand, chat poses and reduced motion',async()=>{
   await page.setViewportSize({width:1440,height:950});await goto('/chat');
   const brand=page.locator('.sidebar .brand-symbol');assert.ok(await brand.evaluate(e=>e.complete&&e.naturalWidth>0));assert.equal(await brand.evaluate(e=>getComputedStyle(e).filter),'none');
   assert.match(await page.locator('link[rel~="icon"]').getAttribute('href'),/brand=mnemoduck-red-1/);
   const composer=page.getByRole('textbox',{name:'Вопрос по всем исследованиям',exact:true});await composer.fill('');
   const duck=page.locator('.chat-welcome .mascot svg');await duck.waitFor();
   assert.equal(await duck.getAttribute('data-state'),'idle');assert.equal(await duck.getAttribute('data-theme'),theme);
   await composer.fill('Проверка состояния');assert.equal(await duck.getAttribute('data-state'),'listening');
   await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await duck.getAttribute('data-phase'),'living');
   assert.equal(await duck.locator('.float-root').evaluate(e=>getComputedStyle(e).animationName),'duckListen');
   await composer.fill('');await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await duck.locator('.float-root').evaluate(e=>getComputedStyle(e).animationName),'none');
   assert.ok(await duck.evaluate(e=>e.getRootNode() instanceof ShadowRoot));
   const colors=await duck.evaluate(svg=>({body:[...svg.querySelectorAll('#sun stop')].map(s=>s.getAttribute('stop-color')),rays:[...svg.querySelectorAll('.rays path')].map(p=>getComputedStyle(p).stroke)}));assert.deepEqual(colors.body,['#F53C65','#EE204D','#D91C45']);assert.deepEqual(colors.rays,['rgb(238, 32, 77)','rgb(238, 32, 77)','rgb(238, 32, 77)']);
   const logo=await(await page.request.get(fixture.base+'/brand-mark.svg')).text();assert.match(logo,/<linearGradient id="sun"[^]*?stop-color="#F53C65"[^]*?stop-color="#EE204D"[^]*?stop-color="#D91C45"/);assert.match(logo,/<g class="[^"]*rays[^"]*"[^>]*stroke="#EE204D"/);
   for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:950});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
   await screenshot('mnemoduck-chat');
  });
  await run(theme+': sectioned chat answer: lead, captions, item leads and cards',async()=>{
   await page.setViewportSize({width:1440,height:950});await goto('/chat');const composer=page.getByRole('textbox',{name:'Вопрос по всем исследованиям',exact:true});await composer.fill('Какие проблемы у хозяев с ответом гостям?');await composer.press('Enter');
   const answer=page.locator('.answer_sectioned').last();await answer.locator('.answer-card_open').waitFor();
   assert.match(await answer.locator('.answer-lead').innerText(),/^Главное\s+Хозяева не успевают/);assert.equal(await answer.locator(':scope > ul li strong').first().innerText(),'Уведомления теряются.');assert.equal(await answer.locator('h3').first().evaluate(e=>getComputedStyle(e).fontSize),'13px');
   assert.equal(await answer.locator('.answer-card_ok h3').innerText(),'Выводы');assert.equal(await answer.locator('.answer-card').count(),2);const metric=answer.locator('.answer-metrics li');assert.equal(await metric.count(),2);assert.equal(await metric.first().locator('.answer-metric-label').innerText(),'Отмечают задержку');assert.equal(await metric.first().locator('.answer-metric-value').innerText(),'7 из 12 хозяев');assert.equal(await metric.nth(1).locator('.answer-metric-label').innerText(),'Опоздание');assert.equal(await answer.innerText().then(t=>t.includes('**')),false);
   for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:844});await page.waitForTimeout(80);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const cols=await answer.locator('.answer-metrics ul').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);assert.equal(cols,width<640?1:2);if(width===390)await screenshot('chat-answer-mobile')}
   await page.setViewportSize({width:1440,height:950});await answer.scrollIntoViewIfNeeded();await screenshot('chat-answer');
  });
  await run(theme+': reports first in both material tables',async()=>{
   for(const path of ['/projects/main','/projects/main/research']){
    await page.setViewportSize({width:1440,height:950});await goto(path);
    if(path.endsWith('/research')){await page.locator('.study-table tbody tr').first().waitFor();
     const links=page.locator('.study-table .table-study');assert.match(await links.first().getAttribute('href'),/studies\/report$/);assert.match(await links.nth(1).getAttribute('href'),/studies\/sample$/);
     assert.equal(await page.locator('.study-table tbody tr').first().locator('td').nth(1).innerText(),'Отчёт');assert.equal(await page.locator('.study-table .table-study .g-label').count(),0);
    }else{
     // Overview: materials column next to «Кратко» and findings, report first, every ready file downloadable, one ZIP for all.
     const rows=page.locator('.material-rail>li');await rows.first().waitFor();
     assert.match(await rows.first().locator('.material-rail-text a').getAttribute('href'),/studies\/report$/);assert.match(await rows.nth(1).locator('.material-rail-text a').getAttribute('href'),/studies\/sample$/);
     assert.equal(await page.locator('.material-rail .table-download').count(),await rows.count());
     assert.match(await page.getByRole('link',{name:/^Скачать всё/}).getAttribute('href'),/^\/api\/files\/archive/);
     const main=await page.locator('.overview-main').boundingBox(),rail=await page.locator('.overview-materials').boundingBox();assert.ok(rail.x>=main.x+main.width);
    }
    for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:844});await page.waitForTimeout(80);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
    await screenshot(path.endsWith('/research')?'reports-research':'reports-overview');
   }
   await goto('/projects');
  });
  await run(theme+': mobile drawer and focus',async()=>{
   await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Открыть меню',exact:true}).click();await page.locator('.mobile-nav-sheet').waitFor();
   const rect=await page.locator('.mobile-nav-sheet').boundingBox();assert.equal(rect.x,0);assert.equal(rect.y,0);assert.equal(rect.height,844);assert.ok(rect.width<=350);await screenshot('drawer');
   await page.locator('.mobile-nav-sheet').press('Tab');assert.ok(await page.locator('.mobile-nav-sheet').evaluate(e=>e.contains(document.activeElement)));
   await page.locator('.mobile-nav-sheet').press('Escape');await page.locator('.mobile-nav-sheet').waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Открыть меню',null,{timeout:2500});
  });
  await page.setViewportSize({width:1440,height:950});
  await run(theme+': settings users and captions',async()=>{
   await goto('/users');await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('button',{name:'Добавить',exact:true}).count(),1);assert.equal(await page.getByText('Участники Мнемодака и их доступ ко всем проектам.',{exact:true}).count(),0);
   const placement=await page.locator('.settings-toolbar').evaluate(e=>({button:e.querySelector('button').getBoundingClientRect().left,title:document.querySelector('.settings-header h2').getBoundingClientRect().left}));assert.ok(Math.abs(placement.button-placement.title)<1);await screenshot('users');
   await page.getByRole('link',{name:'Модели',exact:true}).click();assert.equal(await page.getByText('Выбирайте поставщика для ответов и анализа материалов.',{exact:true}).count(),0);await page.getByRole('button',{name:'Добавить модель'}).click();// The connection dialog sits over the settings modal and is currently aria-hidden there (known a11y defect), so it is addressed by class.
const connect=page.locator('.model-connection-dialog');await connect.waitFor();const reserved=()=>connect.locator('input[type=checkbox]').evaluateAll(list=>list.map(e=>e.checked));assert.deepEqual(await reserved(),[false]);await connect.getByText('Резервная модель',{exact:true}).click();assert.deepEqual(await reserved(),[true]);assert.match(await connect.innerText(),/Основная пропускается 10 минут/);await screenshot('model-reserve');await connect.getByText('Отмена',{exact:true}).click();await connect.waitFor({state:'hidden'});
   await page.getByRole('link',{name:'Интеграции',exact:true}).click();assert.equal(await page.getByText('Готовим подключения к сервисам команды.',{exact:true}).count(),0);
   await page.getByRole('link',{name:'Оценки ответов',exact:true}).click();assert.equal(await page.locator('.feedback-settings>.settings-note').evaluate(e=>getComputedStyle(e).fontSize),'14px');
   const alignment=await page.locator('.feedback-settings>.settings-note').evaluate(e=>({note:e.getBoundingClientRect().left,title:document.querySelector('.settings-header h2').getBoundingClientRect().left}));assert.ok(Math.abs(alignment.note-alignment.title)<1);
   await page.locator('.feedback-settings .g-segmented-radio-group__option').nth(1).click();const selected=await page.locator('.feedback-settings .g-segmented-radio-group__option_checked').evaluate(e=>getComputedStyle(e,'::after').backgroundColor);assert.equal(selected,theme==='light'?'rgba(238, 32, 77, 0.12)':'rgba(238, 32, 77, 0.18)');
   if(theme==='light')for(const selector of ['.settings-sheet','.settings-main','.settings-header','.settings-body'])assert.equal(await page.locator(selector).evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
   await screenshot('ratings');
  });
  await run(theme+': feedback wording and centered ghost action',async()=>{
   await goto('/projects');await page.getByRole('button',{name:'Обратная связь',exact:true}).click();await page.getByText('Как оцениваете сервис?',{exact:true}).waitFor();
   const ghost=page.getByRole('button',{name:'Открыть портал идей',exact:true});assert.ok((await ghost.getAttribute('class')).includes('view_flat'));const pos=await ghost.evaluate(e=>{const b=e.getBoundingClientRect(),d=e.closest('.g-dialog').getBoundingClientRect();return Math.abs(b.left+b.width/2-d.left-d.width/2)});assert.ok(pos<2);await screenshot('feedback');await ghost.click();
  });
  await run(theme+': ideas hierarchy, search and form error',async()=>{
   await page.locator('.ideas-sheet').waitFor();assert.equal(await page.locator('.ideas-sheet .g-button_view_action').count(),0);assert.equal(await page.locator('.ideas-empty p').evaluate(e=>getComputedStyle(e).fontSize),'14px');
   const search=page.getByLabel('Поиск по идеям',{exact:true});await search.fill('Нет такой идеи');await search.blur();assert.equal(await page.locator('.ideas-search').evaluate(e=>getComputedStyle(e).getPropertyValue('--g-text-input-border-color').trim()),theme==='light'?'#0000001a':'#232426');await screenshot('ideas');
   await page.getByRole('button',{name:'Предложить идею',exact:true}).last().click();await page.getByLabel('Описание идеи',{exact:true}).fill('Тестовая идея');
   await page.route('**/api/ideas',r=>r.request().method()==='POST'?r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Тест: не удалось сохранить'})}):r.continue());
   const dialog=page.locator('.g-dialog').last();assert.equal(await dialog.locator('.g-button_view_action').count(),1);await dialog.getByText('Отправить',{exact:true}).click();await dialog.getByRole('alert').waitFor();assert.match(await dialog.innerText(),/Тест: не удалось сохранить/);await screenshot('idea-error');await page.unroute('**/api/ideas');await dialog.getByText('Отмена',{exact:true}).click();
  });
  await run(theme+': author edits and deletes within a day; expired menu explains the limit',async()=>{
   const act=async(scope,item)=>{await scope.getByRole('button',{name:'Действия с идеей',exact:true}).click();await page.locator('.g-popup').getByText(item,{exact:true}).click()};
   const user=fixture.app.db.prepare('SELECT id FROM user').get(),now=Date.now(),fresh='edit-'+theme,old='expired-'+theme;
   const insert=fixture.app.db.prepare('INSERT INTO mnema_ideas(id,user_id,text,created,updated) VALUES(?,?,?,?,?)');insert.run(fresh,user.id,'Свежая идея для редактирования',now,now);insert.run(old,user.id,'Идея старше суток',now-86400000,now-86400000);
   try{
    await page.getByRole('button',{name:'Закрыть портал идей',exact:true}).click();await goto('/projects');await page.getByRole('button',{name:'Обратная связь',exact:true}).click();await page.getByRole('button',{name:'Открыть портал идей',exact:true}).click();await page.locator('.ideas-sheet').waitFor();
    const row=page.locator('.ideas-row').filter({hasText:'Свежая идея для редактирования'});await act(row,'Редактировать');const editor=page.getByRole('dialog',{name:'Редактировать идею',exact:true});await editor.waitFor();
    await editor.getByRole('textbox',{name:'Описание идеи',exact:true}).fill('Уточнённая идея');await editor.getByRole('button',{name:'Отмена',exact:true}).click();await editor.waitFor({state:'hidden'});assert.equal(fixture.app.db.prepare('SELECT text FROM mnema_ideas WHERE id=?').get(fresh).text,'Свежая идея для редактирования');
    await act(row,'Редактировать');await editor.getByRole('textbox',{name:'Описание идеи',exact:true}).fill('Уточнённая идея');await editor.getByRole('button',{name:'Сохранить',exact:true}).click();await editor.waitFor({state:'hidden'});await page.getByText('Уточнённая идея',{exact:true}).waitFor();assert.equal(fixture.app.db.prepare('SELECT created FROM mnema_ideas WHERE id=?').get(fresh).created,now);
    const expired=page.locator('.ideas-row').filter({hasText:'Идея старше суток'});assert.equal(await expired.getByRole('button',{name:'Действия с идеей',exact:true}).isDisabled(),true);await expired.locator('.idea-edit-trigger').hover();await page.getByRole('tooltip').filter({hasText:'Изменить или удалить идею можно только в течение суток после отправки'}).waitFor();await screenshot('idea-expired');await page.mouse.move(200,200);
    await page.locator('.ideas-row').filter({hasText:'Уточнённая идея'}).locator('.ideas-row-main').click();await page.locator('.idea-page').waitFor();assert.equal(await page.locator('#ideas-title').innerText(),'Уточнённая идея');await act(page.locator('.idea-page'),'Редактировать');await editor.waitFor();const title='Длинный заголовок идеи с подробным описанием '.repeat(8).trim();await editor.getByRole('textbox',{name:'Описание идеи',exact:true}).fill(title+'\nПолное описание идеи остаётся в содержимом.');await editor.getByRole('button',{name:'Сохранить',exact:true}).click();await editor.waitFor({state:'hidden'});await page.waitForFunction(title=>document.querySelector('#ideas-title')?.textContent===title,title);assert.equal(await page.locator('#ideas-title').evaluate(e=>getComputedStyle(e).textOverflow==='ellipsis'&&e.scrollWidth>e.clientWidth),true);
    const comment=page.getByRole('textbox',{name:'Комментарий',exact:true});await comment.fill('Первый комментарий: нужно связать карту с записью теста.');await page.getByRole('button',{name:'Отправить комментарий',exact:true}).click();await page.locator('.idea-comments .idea-comment-author').waitFor();assert.equal(await page.locator('.idea-comments .g-avatar').count(),1);assert.equal(await page.locator('.idea-post .g-avatar').count(),1);assert.match(await page.locator('.idea-comments-title').innerText(),/Комментарии · 1/);assert.equal(await page.locator('.idea-comments .g-label').innerText(),'Автор идеи');assert.equal(await page.locator('.idea-comments time[datetime]').count(),1);for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:950});await page.waitForTimeout(80);assert.ok(await page.locator('.ideas-sheet').evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(width===390)await screenshot('idea-comments-mobile')}await screenshot('idea-title-comments');
    const confirm=page.getByRole('dialog',{name:'Удалить идею',exact:true});await act(page.locator('.idea-page'),'Удалить');await confirm.waitFor();await screenshot('idea-delete-confirm');await confirm.getByRole('button',{name:'Отмена',exact:true}).click();await confirm.waitFor({state:'hidden'});await page.locator('.idea-page').waitFor();assert.equal(fixture.app.db.prepare('SELECT count(*) AS n FROM mnema_ideas WHERE id=?').get(fresh).n,1);
    await act(page.locator('.idea-page'),'Удалить');await confirm.getByRole('button',{name:'Удалить идею',exact:true}).click();await confirm.waitFor({state:'hidden'});await page.locator('.ideas-list').waitFor();assert.equal(await page.locator('.idea-page').count(),0);
    for(const table of [['mnema_ideas','id'],['mnema_idea_votes','idea_id'],['mnema_idea_comments','idea_id']])assert.equal(fixture.app.db.prepare('SELECT count(*) AS n FROM '+table[0]+' WHERE '+table[1]+'=?').get(fresh).n,0);
    await page.getByRole('button',{name:'Закрыть портал идей',exact:true}).click();
   }finally{fixture.app.db.prepare('DELETE FROM mnema_idea_comments WHERE idea_id IN (?,?)').run(fresh,old);fixture.app.db.prepare('DELETE FROM mnema_ideas WHERE id IN (?,?)').run(fresh,old)}
  });
  await run(theme+': findings and material context',async()=>{
   await goto('/all-findings');await page.locator('.finding-open').first().click();await page.locator('.finding-page').waitFor();await page.waitForFunction(()=>document.activeElement?.id==='main');assert.equal(await page.locator('.topbar .lucide-lightbulb').count(),0);
   for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:950});await page.waitForTimeout(80);await checkBackPosition(page.getByRole('link',{name:'Назад к находкам',exact:true}),page.locator('.finding-page h1'));assert.equal(await page.locator('.finding-page .page-back').count(),1);await screenshot('finding-back-inline-'+width)}await page.setViewportSize({width:1440,height:950});
   assert.equal(await page.locator('.finding-side>.finding-project-link').count(),0);assert.equal(await page.locator('.finding-block:has(#finding-study-title) .finding-project-link').count(),1);
   await page.locator('.finding-study-link').click();await page.locator('.study-sheet').waitFor();await page.getByRole('button',{name:'Закрыть материал',exact:true}).click();await page.locator('.study-sheet').waitFor({state:'hidden'});await page.getByRole('link',{name:'Назад к находкам',exact:true}).click();await page.locator('.catalog-table').waitFor();assert.equal(new URL(page.url()).pathname,'/all-findings');await screenshot('findings');
  });
  await run(theme+': mobile settings navigation',async()=>{
   await goto('/projects');await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Открыть меню',exact:true}).click();await page.locator('.mobile-nav-sheet').waitFor();await page.locator('.mobile-nav-sheet').getByRole('link',{name:'Настройки',exact:true}).click();await page.locator('.settings-sheet').waitFor();await page.locator('.mobile-nav-sheet').waitFor({state:'hidden'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('.settings-sheet').press('Escape');await page.locator('.settings-sheet').waitFor({state:'hidden'});
  });
  await context.close();
 }
 const db=fixture.app.db;
 const readProject=()=>JSON.parse(db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get().data);
 const saveProject=state=>db.prepare("UPDATE mnema_workspaces SET data=?,version=version+1 WHERE id='main'").run(JSON.stringify(state));
 for(const [theme,width] of [['light',1440],['dark',390]]){
  await run(theme+': project summary status, retry, source and refresh',async()=>{
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   await context.addCookies(fixture.cookies);
   const page=await context.newPage();page.setDefaultTimeout(9000);page.on('pageerror',e=>errors.push(e.message));
   try{
    const state=readProject();delete state.projectSummary;saveProject(state);
    await page.goto(fixture.base+'/projects/main');
    const section=page.getByRole('region',{name:'Сводка проекта'});
    const create=section.getByRole('button',{name:'Создать сводку'});
    await create.waitFor();
    let rejectRequest;
    const rejected=new Promise(resolve=>rejectRequest=resolve);
    await page.route('**/api/project-summary',async route=>{await rejected;await route.abort()},{times:1});
    try{
     await create.click();
     await section.getByText('Создаём сводку…',{exact:true}).waitFor();
     assert(await create.isDisabled());
    }finally{rejectRequest()}
    await section.getByRole('alert').getByText('Не удалось создать сводку').waitFor();
    await section.getByRole('button',{name:'Повторить',exact:true}).click();
    await section.getByRole('button',{name:'Обновить сводку'}).waitFor();
    await section.locator('.footnote').first().click();
    await page.locator('.source-panel').getByText('Синтетический', {exact:false}).first().waitFor();
    await page.getByRole('button',{name:'Закрыть источники',exact:true}).click();
    if(width===1440){
     const response=page.waitForResponse(r=>r.url().endsWith('/api/project-summary')&&r.request().method()==='POST');
     await section.getByRole('button',{name:'Обновить сводку'}).click();
     assert.equal((await response).status(),200);
     assert.equal(await section.getByRole('alert').count(),0);
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   }finally{await context.close()}
  });
  await run(theme+': speaker confirmation, retry and saved participant limit',async()=>{
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   await context.addCookies(fixture.cookies);
   const page=await context.newPage();page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message));
   try{
    const state=readProject(),study=state.studies.find(item=>item.id==='sample');
    Object.assign(study,{format:'Видео',participants:4,speakerInfo:{state:'ready',count:10},speakerEdits:[{action:'renamed'}],
     segments:Array.from({length:10},(_,i)=>({...study.segments[0],id:i?'segment-'+i:'segment',time:i*4,end:i*4+3,speaker:i?'Спикер '+(i+1):'Интервьюер'}))});
    saveProject(state);
    await page.goto(fixture.base+'/projects/main/studies/sample');
    const tab=page.getByRole('tab',{name:/Спикеры/});await tab.click();
    const panel=page.getByRole('tabpanel',{name:/Спикеры/});
    const detect=panel.getByRole('button',{name:'Определить спикеров заново',exact:true});
    await detect.waitFor();
    await detect.click();
    const confirmation=page.getByRole('dialog',{name:'Определить спикеров заново?'});
    await confirmation.getByRole('button',{name:'Отмена'}).click();
    assert.equal(readProject().studies.find(item=>item.id==='sample').speakerInfo.state,'ready');
    const confirm=async()=>{await confirmation.getByRole('button',{name:'Определить заново'}).click()};
    await detect.click();await confirm();
    if(width===1440){
     await panel.getByRole('alert').getByText(/Не удалось различить голоса/).waitFor();
     await panel.getByRole('button',{name:'Переименовать: Интервьюер',exact:true}).waitFor();
     await panel.getByRole('button',{name:'Повторить',exact:true}).click();await confirm();
    }
    await page.getByRole('tab',{name:'Спикеры, 4',exact:true}).waitFor();
    assert.equal(await panel.locator('.participant-count strong').innerText(),'4');
    assert.equal(readProject().studies.find(item=>item.id==='sample').segments[0].speaker,'Запись');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   }finally{await context.close()}
  });
 }
 await run('Living avatar follows the mouse, loves on hover, sleeps and respects reduced motion',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'no-preference'});await context.addCookies(fixture.cookies);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(fixture.base+'/chat');const host=page.locator('.chat-welcome .mascot'),duck=host.locator('svg');await duck.waitFor();
  await page.waitForFunction(()=>document.querySelector('.chat-welcome .mascot')?.shadowRoot?.querySelector('svg')?.dataset.phase==='living');
  const intro=await duck.evaluate(node=>{const phase=node.dataset.phase;node.dataset.phase='intro';const head=getComputedStyle(node.querySelector('.facial')),rays=getComputedStyle(node.querySelector('.rays'));const result={headDuration:parseFloat(head.animationDuration),headDelay:head.animationDelay,raysDuration:parseFloat(rays.animationDuration),raysDelay:rays.animationDelay,paths:[...node.querySelectorAll('.rays path')].map(e=>getComputedStyle(e).animationName)};node.dataset.phase=phase;return result});
  assert.equal(intro.headDuration,.66);assert.equal(intro.headDelay,'0.78s');assert.equal(intro.raysDuration,.24);assert.equal(intro.raysDelay,'2.1s');assert.deepEqual(intro.paths,['none','none','none']);
  const stateIs=state=>page.waitForFunction(state=>document.querySelector('.chat-welcome .mascot')?.shadowRoot?.querySelector('svg')?.dataset.state===state,state);
  const box=await host.boundingBox(),look=duck.locator('.mascot-gaze');
  await page.mouse.move(box.x-220,box.y-100);await page.waitForTimeout(250);const left=await look.evaluate(e=>getComputedStyle(e).transform);
  await page.mouse.move(box.x+box.width+220,box.y+100);await page.waitForTimeout(250);const right=await look.evaluate(e=>getComputedStyle(e).transform);assert.notEqual(left,right);
  assert.ok(Number(left.split(',')[4])<0);assert.ok(Number(right.split(',')[4])>0);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(250);await stateIs('love');assert.equal(await duck.locator('.heart-extra').evaluate(e=>getComputedStyle(e).opacity),'1');
  await page.screenshot({path:resolve(out,'living-avatar-hover.png')});
  await page.mouse.move(400,100);await stateIs('idle');
  const composer=page.getByRole('textbox',{name:'Вопрос по всем исследованиям',exact:true});await composer.fill('Проверка');await stateIs('listening');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await stateIs('love');await page.mouse.move(400,100);await stateIs('listening');
  await page.clock.install();await composer.fill('');await page.clock.fastForward(61000);await page.waitForTimeout(250);assert.equal(await duck.getAttribute('data-phase'),'sleep');assert.ok(await duck.locator('.zzz').evaluate(e=>Number(getComputedStyle(e).opacity)>0));
  await page.mouse.move(410,110);await page.waitForTimeout(250);await stateIs('idle');
  await page.emulateMedia({reducedMotion:'reduce'});await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(250);await stateIs('love');assert.equal(await look.evaluate(e=>getComputedStyle(e).transform),'none');assert.equal(await duck.locator('.eyes-love').evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.goto(fixture.base+'/projects');await page.locator('.app-shell').waitFor();await page.clock.fastForward(65000);await context.close();
  const touch=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});await touch.addCookies(fixture.cookies);const phone=await touch.newPage();await phone.goto(fixture.base+'/chat');const avatar=phone.locator('.chat-welcome .mascot');await avatar.waitFor();const rect=await avatar.boundingBox();await phone.touchscreen.tap(rect.x+rect.width/2,rect.y+rect.height/2);assert.notEqual(await avatar.locator('svg').getAttribute('data-state'),'love');assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await phone.screenshot({path:resolve(out,'living-avatar-mobile.png')});await touch.close();
 });
 const motion=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'no-preference'});await motion.addCookies(fixture.cookies);await motion.addInitScript(()=>{window.__uiAnimations=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.classList.contains('content-shell'))window.__uiAnimations.push(options.duration);return animate.call(this,frames,options)}});const page=await motion.newPage();await page.goto(fixture.base+'/projects');await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();await page.getByRole('button',{name:'Свернуть меню',exact:true}).click();await page.waitForFunction(()=>window.__uiAnimations.includes(160));await page.getByRole('button',{name:'Развернуть меню',exact:true}).click();await page.waitForTimeout(200);assert.equal(await page.getByRole('button',{name:'Свернуть меню',exact:true}).getAttribute('aria-expanded'),'true');checks.push('Pointer sidebar collapse is animated and interruptible');await motion.close();
 assert.deepEqual(errors,[]);
}finally{await writeFile(resolve(out,'checks.json'),JSON.stringify({checks,errors},null,2));await browser.close();await fixture.close()}
console.log('UI check passed: '+checks.length+' scenarios; no JavaScript errors');
