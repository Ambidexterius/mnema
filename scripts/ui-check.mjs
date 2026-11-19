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
let holdSpeakers;
const fixture=await createUIFixture(Number(process.env.UI_CHECK_PORT||4461),ANSWER,async({segments,participants,onProgress})=>{
 assert.equal(participants,4);
 onProgress?.('Определяем спикеров: 45:00 из 1:09:09 · часть 4 из 5');
 await holdSpeakers;
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
  await run(theme+': early transcript opens read-only and resolves the same passage after speakers',async()=>{
   let ready=false;
   const early={time:12,end:20,text:'Проверяем первую фразу. Затем вторую.'};
   const final=[{id:'early-a',time:12,end:16,text:'Проверяем первую фразу.',speaker:'Спикер 1'},
                {id:'early-b',time:16,end:20,text:'Затем вторую.',speaker:'Спикер 2'}];
   const routeState=async route=>{
    const response=await route.fetch(),data=await response.json();
    const study=data.state.studies.find(s=>s.id==='sample');
    Object.assign(study,{format:'Видео',status:ready?'ready':'processing',segments:ready?final:[],
     transcriptPreview:ready?undefined:[early],activity:ready?{state:'ready',label:'Текст готов'}:
      {state:'running',label:'Расшифровка готова',detail:'Определяем спикеров'}});
    await route.fulfill({json:data});
   };
   await page.route('**/api/state',routeState);
   try{
    await page.goto(fixture.base+'/projects/main/studies/sample');
    const preview=page.getByLabel('Предварительная расшифровка');
    await preview.waitFor();assert.equal(await preview.getByRole('button').count(),1);
    await preview.getByRole('button',{name:'Перейти к 0:12'}).press('Enter');
    ready=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.locator('#segment-early-a.cited-text').waitFor();assert.equal(await preview.count(),0);
    assert(await page.locator('.transcript-time:focus').count());
    assert.equal(await page.locator('#segment-early-b').innerText(),'Затем вторую.');
   }finally{await page.unroute('**/api/state',routeState)}
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
   if(width<640){const geometry=await page.locator('.projects-heading').evaluate(e=>{const h=e.querySelector('h1').getBoundingClientRect(),b=e.querySelector('button').getBoundingClientRect(),card=document.querySelector('.project-catalog-card').getBoundingClientRect(),grid=document.querySelector('.project-catalog-grid').getBoundingClientRect();return{headingY:h.y+h.height/2,buttonY:b.y+b.height/2,card:card.width,grid:grid.width}});assert.ok(Math.abs(geometry.headingY-geometry.buttonY)<2);assert.ok(Math.abs(geometry.card-geometry.grid)<1);if(width===390)await screenshot('projects-mobile')}
  });
  await run(theme+': project catalog sorting and view switch',async()=>{
   await goto('/projects');
   const views=page.getByRole('radiogroup',{name:'Вид проектов'});
   const grid=views.getByRole('radio',{name:'Сетка'});
   const table=views.getByRole('radio',{name:'Таблица'});
   const sort=page.getByRole('combobox',{name:'Сортировка'});
   assert.equal(await page.getByRole('searchbox',{name:'Поиск проектов'}).count(),0);
   assert.equal(await sort.innerText(),'Сначала новые');
   await grid.focus();
   await page.keyboard.press('ArrowRight');
   assert.ok(await table.evaluate(element=>element===document.activeElement));
   assert.ok(await table.isChecked());
   await page.getByRole('table',{name:'Проекты'}).waitFor();
   assert.equal(await page.locator('.project-catalog-table-open').first().innerText(),'Длинное название для проверки переноса текста на телефоне');
   await sort.click();
   await page.getByRole('option',{name:'Сначала старые',exact:true}).click();
   assert.equal(await page.locator('.project-catalog-table-open').first().innerText(),'Тест интерфейса');
   await grid.check();
   assert.equal(await page.locator('.project-catalog-title').first().innerText(),'Тест интерфейса');
   await table.check();
   await page.setViewportSize({width:320,height:844});
   assert.ok(await page.locator('.project-catalog-table .g-table').evaluate(element=>element.scrollWidth<=element.clientWidth+1));
   await page.getByRole('button',{name:'Тест интерфейса',exact:true}).click();
   await page.getByRole('link',{name:'Назад к проектам',exact:true}).click();
   await table.waitFor();
   assert.ok(await table.isChecked());
   assert.equal(await sort.innerText(),'Сначала старые');
   await sort.click();
   await page.getByRole('option',{name:'Сначала новые',exact:true}).click();
   await grid.click();
  });
  await run(theme+': shared quiet styling across all five tables',async()=>{
   await page.setViewportSize({width:1440,height:950});
   for(const [path,name,shot] of [
    ['/projects','Проекты','catalog'],
    ['/projects/main/research','Материалы','materials'],
    ['/projects/main/findings','Находки проекта','project-findings'],
    ['/all-findings','Все находки','all-findings'],
    ['/users','Пользователи','users'],
   ]){
    await goto(path);
    if(shot==='catalog')await page.getByRole('radio',{name:'Таблица'}).click();
    const table=page.getByRole('table',{name,exact:true});
    await table.waitFor();
    if(shot==='users'){
     await table.getByRole('columnheader',{name:'Доступ',exact:true}).waitFor();
     assert.equal(await table.getByRole('columnheader',{name:'Админ',exact:true}).count(),0);
     await table.locator('.user-status').getByText('Администратор',{exact:true}).waitFor();
    }
    const metrics=await table.evaluate(element=>{
     const wrapper=element.closest('.table-scroll');
     const header=element.querySelector('thead th');
     const style=getComputedStyle(header),shell=getComputedStyle(wrapper);
     return {border:shell.borderTopWidth,radius:shell.borderRadius,weight:style.fontWeight,
      size:style.fontSize,lineHeight:style.lineHeight,edge:style.paddingInlineStart,
      background:getComputedStyle(element.tHead).backgroundColor};
    });
    assert.deepEqual(metrics,{border:'0px',radius:'0px',weight:'400',size:'12px',lineHeight:'16px',edge:'0px',background:'rgba(0, 0, 0, 0)'},shot);
    const metric=table.locator('tbody .table-number').first();
    if(await metric.count())assert.deepEqual(await metric.evaluate(cell=>[getComputedStyle(cell).textAlign,getComputedStyle(cell).fontVariantNumeric]),['end','tabular-nums']);
    if(shot==='project-findings'||shot==='all-findings'){
     const labels=await table.locator('.g-label').filter({hasText:/^Проверено$/}).evaluateAll(items=>items.map(item=>item.classList.contains('g-label_theme_success')));
     assert.ok(labels.length&&labels.every(Boolean));
    }
    const linkSelector={
     catalog:'.project-catalog-table-open',materials:'.table-study strong',
     'project-findings':'.finding-cell a','all-findings':'.catalog-link',
    }[shot];
    if(linkSelector){
     const link=table.locator(linkSelector).first();
     await link.hover();
     assert.deepEqual(await link.evaluate(element=>[
      getComputedStyle(element).color,getComputedStyle(element).textDecorationLine,
     ]),[theme==='light'?'rgb(185, 23, 58)':'rgb(255, 128, 156)','none']);
    }
    await page.mouse.move(1,1);
    await screenshot('uniform-table-'+shot);
   }
   await goto('/projects');
   await page.getByRole('radio',{name:'Сетка'}).click();
  });
  await run(theme+': mobile project navigation and desktop table',async()=>{
   for(const width of [320,390,768,1024,1440]){
    await page.setViewportSize({width,height:844});
    await goto('/projects/main');
    const compact=width<960;
    const tab=page.locator('.page-heading .project-tabs').getByRole('tab',{name:new RegExp('^'+(compact?'Документы':'Материалы'))});
    await tab.waitFor();
    // Back is an icon beside H1; no separate navigation row above the heading.
    assert.equal(await page.getByRole('link',{name:'К проектам',exact:true}).count(),0);
    assert.equal(await page.locator('.topbar .project-tabs').count(),0);
    const title=await page.locator('.project-overview h1').boundingBox(),tabs=await page.locator('.page-heading .project-tabs').boundingBox();
    const back=page.getByRole('link',{name:'Назад к проектам',exact:true});assert.equal(await back.getAttribute('href'),'/projects');assert.equal(await page.locator('.page-heading .page-title-row>.page-back').count(),1);assert.equal(await page.locator('.project-back').count(),0);await checkBackPosition(back,page.locator('.project-overview h1'));
    assert.ok(tabs.y>=title.y+title.height);
    const tabList=page.getByRole('tablist',{name:'Разделы проекта'});
    const overviewTab=tabList.getByRole('tab',{name:'Обзор',selected:true});
    const crumbs=page.locator('.content-shell > .topbar nav[aria-label="Путь"]');
    const overviewCrumbs=await crumbs.innerText();
    if(!compact)assert.equal(await crumbs.locator('[aria-current="page"]').innerText(),'Тест интерфейса');
    assert.equal(await overviewTab.count(),1);
    assert.match(await tab.innerText(),/2$/);
    assert.ok(await tabList.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await overviewTab.focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await tab.evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Space');
    await page.locator(compact?'.mobile-material-list':'.study-table').waitFor();
    assert.equal(await tab.getAttribute('aria-selected'),'true');
    assert.equal(await crumbs.innerText(),overviewCrumbs);
    assert.equal(await page.getByRole('button',{name:'Добавить',exact:true}).count(),1);
    const toolbar=await page.locator('.material-filters').evaluate(element=>{
     const strip=element.querySelector('.material-filter-strip').getBoundingClientRect();
     const button=element.querySelector(':scope > .g-button').getBoundingClientRect();
     const tabs=document.querySelector('.page-heading .project-tabs').getBoundingClientRect();
     return {stripTop:strip.top,stripRight:strip.right,buttonTop:button.top,buttonLeft:button.left,tabsBottom:tabs.bottom};
    });
    assert.ok(toolbar.stripTop>=toolbar.tabsBottom&&Math.abs(toolbar.buttonTop-toolbar.stripTop)<2&&toolbar.buttonLeft>=toolbar.stripRight);
    // Every project section keeps the project name as its only H1; the tab names the section.
    for(const path of ['/projects/main','/projects/main/findings','/projects/main/research']){await goto(path);await page.locator('.page-heading .project-tabs').waitFor();assert.deepEqual(await page.locator('h1').allInnerTexts(),['Тест интерфейса']);assert.equal(await back.getAttribute('href'),'/projects')}
    assert.match(await page.title(),/^(Материалы|Документы) · Тест интерфейса — Мнемодак$/);
    await goto('/projects/main');await back.click();await page.waitForURL(fixture.base+'/projects');
    await page.getByRole('button',{name:'Открыть проект «Тест интерфейса»',exact:true}).click();await page.locator('.project-overview').waitFor();await page.waitForFunction(()=>document.activeElement?.id==='main');await back.focus();await back.press('Enter');await page.waitForURL(fixture.base+'/projects');
    await goto('/projects/main');await tab.click();await page.waitForURL(fixture.base+'/projects/main/research');
    const findingsTab=page.locator('.project-tabs').getByRole('tab',{name:/^Находки/});
    await page.waitForFunction(()=>document.activeElement?.id==='main');
    await tab.focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await findingsTab.evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Enter');
    await page.waitForURL(fixture.base+'/projects/main/findings');
    await tabList.getByRole('tab',{name:/^Находки/,selected:true}).waitFor();
    assert.equal(await crumbs.innerText(),overviewCrumbs);
    await page.goBack();await page.waitForURL(fixture.base+'/projects/main/research');await tab.waitFor();
    await findingsTab.click();await page.waitForURL(fixture.base+'/projects/main/findings');
    assert.equal(await back.getAttribute('href'),'/projects');await screenshot('project-back-'+width);
    await back.click();await page.waitForURL(fixture.base+'/projects');await page.locator('.projects-heading').waitFor();
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
   await page.setViewportSize({width:1440,height:950});await goto('/chat');
   const composer=page.getByRole('textbox',{name:'Вопрос по всем исследованиям',exact:true});
   const topbar=page.locator('.content-shell > .topbar'),chatTitle=topbar.locator('.hub-topbar-title');
   const height=(await topbar.boundingBox()).height;
   const question='Какие проблемы у хозяев с ответом гостям?';
   assert.equal(await chatTitle.count(),0);
   await composer.fill(question);
   assert.equal(await chatTitle.count(),0);
   await composer.press('Enter');
   await chatTitle.waitFor();
   assert.equal(await chatTitle.innerText(),question);
   assert.equal((await topbar.boundingBox()).height,height);
   await page.waitForFunction(title=>document.title===title+' — Мнемодак',question);
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
    for(const width of [320,390,768,1024,1440]){
     await page.setViewportSize({width,height:844});await page.waitForTimeout(80);
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
     if(!path.endsWith('/research'))assert.equal(await page.locator('.overview-materials').evaluate(element=>getComputedStyle(element).position),width>=1024?'sticky':'static');
    }
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
   await page.getByRole('link',{name:'MCP',exact:true}).click();
   const mcp=page.getByRole('region',{name:'Подключение по MCP'});
   await mcp.getByRole('complementary',{name:'Только чтение'}).waitFor();
   await mcp.getByRole('heading',{name:'Подключений пока нет',exact:true}).waitFor();
   assert.deepEqual(await mcp.locator('.settings-group-label').evaluateAll(headings=>headings.map(h=>Math.round(h.getBoundingClientRect().left-document.querySelector('.settings-header h2').getBoundingClientRect().left))),[0,0,0]);
   assert.deepEqual(await page.locator('.settings-nav a').evaluateAll(links=>links.slice(-2).map(link=>link.getAttribute('aria-label'))),['Оценки ответов','Пользователи']);
   await screenshot('mcp-settings');
  });
  await run(theme+': What’s new explains feedback on an element',async()=>{
   await goto('/projects');
   await page.getByRole('button',{name:/^Профиль:/}).click();
   await page.getByRole('menuitem',{name:'Что нового',exact:true}).click();
   const news=page.getByRole('dialog',{name:'Что нового',exact:true});
   const latest=news.locator('.updates-feed section').first();
   assert.equal(await latest.locator('time').getAttribute('datetime'),'2026-11-20');
   assert.equal(await latest.getByRole('heading').innerText(),'Расшифровку можно читать раньше');
   const latestText=(await latest.innerText()).replaceAll('\u00a0',' ');
   assert.match(latestText,/3 минуты 6 секунд вместо 17 минут 13 секунд/);
   assert.match(latestText,/14 минут 15 секунд.+2 минуты 53 секунды/s);
   await news.getByRole('heading',{name:'Речь распознаёт GigaAM v3',exact:true}).waitFor();
   await news.getByRole('heading',{name:'Обратная связь по элементу интерфейса',exact:true}).waitFor();
   assert.match(await news.innerText(),/Выберите элемент интерфейса, напишите комментарий/);
   await news.press('Escape');await news.waitFor({state:'hidden'});
  });
  await run(theme+': local news editor saves Markdown and keeps the dialog inside the viewport',async()=>{
   const title='Новость для проверки '+theme;
   async function show(){
    await page.getByRole('button',{name:/^Профиль:/}).click();
    await page.getByRole('menuitem',{name:'Что нового',exact:true}).click();
    const feed=page.getByRole('dialog',{name:'Что нового',exact:true});
    await feed.getByRole('heading',{name:'Расшифровку можно читать раньше'}).waitFor();return feed;
   }
   try{
    const feed=await show(),dialog=feed.locator('.updates-dialog');
    const box=await dialog.boundingBox();assert(box&&box.height<=601);
    const close=feed.locator('.g-dialog-btn-close__btn'),before=await close.boundingBox();
    await feed.locator('.g-dialog-body').evaluate(el=>el.scrollTop=el.scrollHeight);
    assert(await feed.locator('.g-dialog-body').evaluate(el=>el.scrollTop>0));
    assert.equal((await close.boundingBox()).y,before.y);
    await feed.getByRole('button',{name:'Добавить новость'}).click();
    const create=page.getByRole('dialog',{name:'Новая новость'});
    await create.getByRole('textbox',{name:'Заголовок'}).fill(title);
    await create.getByRole('textbox',{name:'Описание'}).fill('## Раздел\n\n- **Начало**\n- *Продолжение*\n\n[Ссылка](/projects)');
    await create.getByRole('radio',{name:'Предпросмотр'}).check();await create.locator('strong',{hasText:'Начало'}).waitFor();
    await create.getByRole('button',{name:'Опубликовать'}).click();
    await feed.getByRole('button',{name:'Редактировать: '+title}).click();
    const edit=page.getByRole('dialog',{name:'Редактировать новость'});
    await edit.getByRole('textbox',{name:'Описание'}).fill('Изменённый **текст**');
    await edit.getByRole('button',{name:'Сохранить'}).click();await feed.locator('.updates-feed section').first().locator('strong').waitFor();
    await page.reload();await show();const first=feed.locator('.updates-feed section').first();assert.equal(await first.locator('h3').innerText(),title);assert.equal(await first.locator('strong').innerText(),'текст');
    await page.setViewportSize({width:320,height:568});const mobile=await dialog.boundingBox();assert(mobile.height<=568&&mobile.y>=0&&mobile.y+mobile.height<=569);
    await feed.press('Escape');await feed.waitFor({state:'hidden'});
   }finally{fixture.app.db.prepare('DELETE FROM mnema_news WHERE title=?').run(title);await page.setViewportSize({width:1440,height:950})}
  });
  await run(theme+': select an element on a 320px screen',async()=>{
   await page.setViewportSize({width:320,height:760});await goto('/projects');
   const menu=page.getByRole('button',{name:'Открыть меню',exact:true});await menu.click();
   await page.getByRole('dialog',{name:'Основная навигация'}).getByRole('button',{name:'Оставить отзыв',exact:true}).click();
   await page.locator('#main').dispatchEvent('click');
   assert.equal(await page.locator('.feedback-composer').count(),0);
   const heading=page.getByRole('heading',{name:'Проект',exact:true});await heading.click();
   const form=page.getByRole('dialog',{name:'Отзыв об элементе',exact:true});await form.waitFor();
   assert.equal(await form.getByText('Вся страница',{exact:true}).count(),0);
   const box=await form.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=321);
   for(const [surface, fill] of [['.feedback-mode','rgb(23, 24, 26)'],['.feedback-composer-popup','rgb(255, 255, 255)']]){
    const style=await page.locator(surface).evaluate(element=>{const style=getComputedStyle(element);return [style.borderRadius,style.backgroundColor]});
    assert.deepEqual(style,['24px',fill]);
   }
   assert.equal(await page.locator('.feedback-composer-popup').evaluate(element=>getComputedStyle(element).getPropertyValue('--g-popup-border-width')),'0px');
   const hint=form.getByText('Коллеги увидят отзыв в портале идей',{exact:true});
   assert.equal(await hint.evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);return range.getClientRects().length}),1);
   assert.ok(contrast(await hint.evaluate(element=>getComputedStyle(element).color),'rgb(255, 255, 255)')>=4.5);
   assert.ok(contrast(await page.locator('.feedback-mode p').evaluate(element=>getComputedStyle(element).color),'rgb(23, 24, 26)')>=4.5);
   assert.equal(await form.getByRole('button',{name:'Отправить отзыв',exact:true}).locator('.lucide-arrow-right').count(),1);
   await screenshot('feedback-mobile');
   await page.keyboard.press('Escape');await form.waitFor({state:'hidden'});
   await heading.click();
   await form.getByRole('textbox',{name:'Отзыв',exact:true}).fill('Отзыв о заголовке на телефоне ('+theme+')');
   await form.getByRole('button',{name:'Отправить отзыв',exact:true}).click();
   const published=page.getByRole('dialog',{name:'Идея опубликована',exact:true});
   await published.getByRole('button',{name:'Закрыть',exact:true}).last().click();
   await published.waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Открыть меню');
   await page.setViewportSize({width:1440,height:950});
  });
  await run(theme+': select an interface element, retry feedback and publish it as an idea',async()=>{
   await goto('/projects');
   const trigger=page.getByRole('button',{name:'Оставить отзыв',exact:true});
   const toolbar=page.getByRole('complementary',{name:'Обратная связь',exact:true});
   await trigger.click();await toolbar.waitFor();
   const myIdeas=toolbar.getByRole('button',{name:'Мои идеи',exact:true});
   assert.match(await myIdeas.getAttribute('class'),/view_outlined/);
   assert.ok(await myIdeas.evaluate(button=>{const toolbar=button.closest('.feedback-mode'),style=getComputedStyle(toolbar);return Math.abs(button.offsetWidth-(toolbar.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)))<=1}));
   assert.equal(await toolbar.getByRole('button',{name:'О странице',exact:true}).count(),0);
   await page.keyboard.press('Escape');await toolbar.waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Оставить отзыв');
   await trigger.click();
   const create=page.getByRole('button',{name:'Создать',exact:true});
   await create.focus();await page.keyboard.press('Enter');
   const form=page.getByRole('dialog',{name:'Отзыв об элементе',exact:true});
   const outline=page.locator('.feedback-outline');
   await form.waitFor();assert.equal(await outline.getAttribute('data-selected'),'true');
   assert.equal(await page.getByRole('dialog',{name:'Новый проект',exact:true}).count(),0);
   await form.getByRole('button',{name:'Выбрать другой элемент'}).click();
   const heading=page.getByRole('heading',{name:'Проект',exact:true});
   await heading.hover();await outline.waitFor();
   const hoverFill=await outline.evaluate(element=>getComputedStyle(element).backgroundColor);
   assert.ok(await outline.evaluate(element=>parseFloat(getComputedStyle(element).borderRadius)>0));
   const [headingBox,outlineBox]=await Promise.all([heading.boundingBox(),outline.boundingBox()]);
   assert.ok(Math.abs(headingBox.x-outlineBox.x)<=2.1&&Math.abs(headingBox.width-outlineBox.width)<=4.1);
   await screenshot('feedback-hover');
   await create.click();await form.waitFor();
   assert.equal(await outline.getAttribute('data-selected'),'true');
   assert.notEqual(await outline.evaluate(element=>getComputedStyle(element).backgroundColor),hoverFill);
   const send=form.getByRole('button',{name:'Отправить отзыв',exact:true});
   assert.equal(await send.isEnabled(),false);
   const message='Уточнить, что создаёт кнопка ('+theme+')';
   const field=form.getByRole('textbox',{name:'Отзыв',exact:true});
   await field.fill(message);
   await form.getByRole('combobox',{name:'Категория отзыва (необязательно)'}).click();
   await page.getByRole('option',{name:'Текст и содержание',exact:true}).click();
   await screenshot('feedback');
   await page.route('**/api/ideas',r=>r.request().method()==='POST'?r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Тест: не удалось отправить'})}):r.continue());
   await send.click();await form.getByRole('alert').waitFor();assert.equal(await field.inputValue(),message);
   await page.unroute('**/api/ideas');await send.click();
   const published=page.getByRole('dialog',{name:'Идея опубликована',exact:true});
   await published.waitFor();await screenshot('feedback-published');
   await published.getByRole('button',{name:'Открыть портал идей',exact:true}).click();
   const row=page.locator('.ideas-row').filter({hasText:message});
   await row.locator('.ideas-meta .g-label').getByText('Текст и содержание',{exact:true}).waitFor();
   await row.getByText('Проекты → Создать',{exact:true}).waitFor();
   assert.equal(await row.getByText('Голосование',{exact:true}).count(),0);
   const uncategorized=page.locator('.ideas-row').filter({hasText:'Отзыв о заголовке на телефоне ('+theme+')'});
   await uncategorized.waitFor();assert.equal(await uncategorized.locator('.ideas-meta .g-label').count(),0);
   await uncategorized.getByText('Проекты → Заголовок',{exact:true}).waitFor();
   await screenshot('feedback-portal');
   await row.locator('.idea-entry').click();
   const idea=page.locator('.idea-post');await page.getByRole('region',{name:'Элемент интерфейса',exact:true}).getByText('Проекты → Создать',{exact:true}).waitFor();
   assert.ok(await idea.getByText('Текст и содержание',{exact:true}).isVisible());
   assert.ok(await idea.getByRole('button',{name:'Действия с идеей'}).isVisible());
   await goto('/chat#ideas');
   await row.locator('.idea-entry').click();
   await page.getByRole('button',{name:'Показать в интерфейсе',exact:true}).click();
   await page.waitForURL(fixture.base+'/projects');
   await page.locator('[data-feedback-located]').waitFor();
   assert.equal(await create.getAttribute('data-feedback-located')===null,false);
   await screenshot('feedback-located');
   await trigger.click();await toolbar.getByRole('button',{name:'Мои идеи',exact:true}).click();
  });
  await run(theme+': ideas hierarchy, search and form error',async()=>{
   await page.locator('.ideas-sheet').waitFor();assert.equal(await page.locator('.ideas-sheet .g-button_view_action').count(),0);
   const search=page.getByLabel('Поиск по идеям',{exact:true});await search.fill('Нет такой идеи');await search.blur();assert.equal(await page.locator('.ideas-list .empty-state p').evaluate(e=>getComputedStyle(e).fontSize),'14px');assert.equal(await page.locator('.ideas-search').evaluate(e=>getComputedStyle(e).getPropertyValue('--g-text-input-border-color').trim()),theme==='light'?'#0000001a':'#232426');await screenshot('ideas');
   await page.getByRole('button',{name:'Предложить идею',exact:true}).last().click();await page.getByLabel('Описание идеи',{exact:true}).fill('Тестовая идея');
   await page.route('**/api/ideas',r=>r.request().method()==='POST'?r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Тест: не удалось сохранить'})}):r.continue());
   const dialog=page.locator('.g-dialog').last();assert.equal(await dialog.locator('.g-button_view_action').count(),1);await dialog.getByText('Отправить',{exact:true}).click();await dialog.getByRole('alert').waitFor();assert.match(await dialog.innerText(),/Тест: не удалось сохранить/);await screenshot('idea-error');await page.unroute('**/api/ideas');await dialog.getByText('Отмена',{exact:true}).click();
  });
  await run(theme+': author edits and deletes within a day; expired menu explains the limit',async()=>{
   const act=async(scope,item)=>{await scope.getByRole('button',{name:'Действия с идеей',exact:true}).click();await page.locator('.g-popup').getByText(item,{exact:true}).click()};
   const user=fixture.app.db.prepare('SELECT id FROM user').get(),now=Date.now(),fresh='edit-'+theme,old='expired-'+theme;
   const insert=fixture.app.db.prepare('INSERT INTO mnema_ideas(id,user_id,text,created,updated) VALUES(?,?,?,?,?)');insert.run(fresh,user.id,'Свежая идея для редактирования',now,now);insert.run(old,user.id,'Идея старше суток',now-86400000,now-86400000);
   try{
    await page.getByRole('button',{name:'Закрыть портал идей',exact:true}).click();await goto('/projects');await page.getByRole('button',{name:'Оставить отзыв',exact:true}).click();await page.getByRole('button',{name:'Мои идеи',exact:true}).click();await page.locator('.ideas-sheet').waitFor();
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
   for(const width of [320,1440]){
    await page.setViewportSize({width,height:900});
    for(const catalog of ['/projects','/all-findings']){
     await goto(catalog);
     assert.equal(await page.locator('.topbar nav[aria-label="Путь"]').count(),0);
     if(width===320)assert.ok(await page.getByRole('button',{name:'Открыть меню',exact:true}).isVisible());
     else assert.equal(await page.locator('.content-shell > .topbar').getAttribute('aria-hidden'),'true');
    }
   }
   const rootToolbarHeight=(await page.locator('.content-shell > .topbar').boundingBox()).height;
   await page.locator('.finding-open').first().click();await page.locator('.finding-page').waitFor();
   assert.equal((await page.locator('.content-shell > .topbar').boundingBox()).height,rootToolbarHeight);await page.waitForFunction(()=>document.activeElement?.id==='main');const findingsCrumbs=page.locator('.topbar nav[aria-label="Путь"]');
   assert.equal(await findingsCrumbs.locator('.lucide-lightbulb').getAttribute('aria-hidden'),'true');
   assert.equal(await findingsCrumbs.getByRole('link',{name:'Находки',exact:true}).getAttribute('href'),'/all-findings');
   assert.equal(await findingsCrumbs.locator('[aria-current="page"]').innerText(),'Нет ответа до оплаты');
   for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:950});await page.waitForTimeout(80);await checkBackPosition(page.getByRole('link',{name:'Назад к находкам',exact:true}),page.locator('.finding-page h1'));assert.equal(await page.locator('.finding-page .page-back').count(),1);await screenshot('finding-back-inline-'+width)}await page.setViewportSize({width:1440,height:950});
   assert.equal(await page.locator('.finding-side>.finding-project-link').count(),0);assert.equal(await page.locator('.finding-block:has(#finding-study-title) .finding-project-link').count(),1);
   await page.locator('.finding-study-link').click();await page.locator('.study-sheet').waitFor();await page.getByRole('button',{name:'Закрыть материал',exact:true}).click();await page.locator('.study-sheet').waitFor({state:'hidden'});await page.getByRole('link',{name:'Назад к находкам',exact:true}).click();await page.locator('.catalog-table').waitFor();assert.equal(new URL(page.url()).pathname,'/all-findings');await screenshot('findings');
   const projectFindings='/projects/main/findings?kind='+encodeURIComponent('Проблема');
   await goto(projectFindings);await page.getByRole('link',{name:'Нет ответа до оплаты',exact:true}).click();await page.locator('.finding-page').waitFor();
   assert.equal(await findingsCrumbs.getByRole('link',{name:'Тест интерфейса',exact:true}).getAttribute('href'),'/projects/main');
   assert.equal(await findingsCrumbs.getByRole('link',{name:'Находки',exact:true}).getAttribute('href'),projectFindings);
   assert.equal(await findingsCrumbs.locator('[aria-current="page"]').innerText(),'Нет ответа до оплаты');
   await screenshot('project-finding-crumbs');
   await page.locator('.finding-study-link').click();await page.locator('.study-sheet').waitFor();await page.getByRole('button',{name:'Закрыть материал',exact:true}).click();await page.locator('.study-sheet').waitFor({state:'hidden'});
   await page.getByRole('link',{name:'Назад к находкам',exact:true}).click();await page.waitForURL(fixture.base+projectFindings);
   await page.getByRole('link',{name:'Назад к проектам',exact:true}).click();await page.waitForURL(fixture.base+'/projects');
  });
  await run(theme+': mobile settings navigation',async()=>{
   await goto('/projects');await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Открыть меню',exact:true}).click();await page.locator('.mobile-nav-sheet').waitFor();await page.locator('.mobile-nav-sheet').getByRole('link',{name:'Настройки',exact:true}).click();await page.locator('.settings-sheet').waitFor();await page.locator('.mobile-nav-sheet').waitFor({state:'hidden'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('.settings-sheet').press('Escape');await page.locator('.settings-sheet').waitFor({state:'hidden'});
  });
  await context.close();
 }
 const db=fixture.app.db;
 const readProject=()=>JSON.parse(db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get().data);
 const saveProject=state=>db.prepare("UPDATE mnema_workspaces SET data=?,version=version+1 WHERE id='main'").run(JSON.stringify(state));
 await run('recording tab status is personal, survives switching projects and follows transcription and speaker detection',async()=>{
  const context=await browser.newContext();await context.addCookies(fixture.cookies);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const state=readProject(),owner=db.prepare('SELECT id FROM user').get().id;
  const recording={...state.studies[0],id:'tab-recording',format:'Видео',status:'processing',uploadedById:'another-user'};
  const save=()=>saveProject({...state,studies:[...state.studies,recording]});
  const ready=async()=>{await page.locator('.app-shell').waitFor();await page.waitForFunction(()=>document.title.endsWith(' — Мнемодак'))};
  try{
   const project=await context.request.post(fixture.base+'/api/workspaces',{headers:{'X-Mnema-Request':'1'},data:{name:'Проект проверки обработки'}});
   assert.equal(project.status(),201);
   save();await page.goto(fixture.base+'/projects');await ready();
   assert.equal(await page.title(),'Проекты — Мнемодак');
   recording.uploadedById=owner;save();
   await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
   await page.waitForFunction(()=>document.title==='Обработка · Проекты — Мнемодак');
   const icon=page.locator('link[rel="icon"]');assert.match(await icon.getAttribute('href'),/\/brand-mark-processing\.svg\?/);
   assert.equal((await page.request.get(new URL(await icon.getAttribute('href'),fixture.base).href)).status(),200);
   await page.getByRole('button',{name:'Открыть проект «Проект проверки обработки»',exact:true}).click();
   await page.waitForFunction(()=>document.title==='Обработка · Обзор проекта · Проект проверки обработки — Мнемодак');
   await page.goto(fixture.base+'/projects/main');await ready();
   await page.waitForFunction(()=>document.title.startsWith('Обработка · '));
   recording.status='ready';save();
   await page.waitForFunction(()=>document.querySelector('link[rel="icon"]').href.includes('brand-mark-unread.svg'));
   assert.equal(await page.title(),'Обзор проекта · Тест интерфейса — Мнемодак');
   recording.speakerInfo={state:'running'};save();
   await page.waitForFunction(()=>document.title.startsWith('Обработка · '));
   recording.speakerInfo={state:'error'};save();
   await page.waitForFunction(()=>document.title==='Обзор проекта · Тест интерфейса — Мнемодак');
   assert.match(await icon.getAttribute('href'),/\/brand-mark-unread\.svg\?/);
  }finally{saveProject(state);await context.close()}
 });
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
    await page.getByRole('button',{name:'Открыть фрагмент',exact:true}).first().click();
    await page.getByRole('button',{name:'Открыть в материале',exact:true}).waitFor();
    assert.equal(await page.locator('.source-panel .panel-error').count(),0);
    await page.getByRole('button',{name:'Закрыть источник',exact:true}).click();
    if(width===1440){
     const response=page.waitForResponse(r=>r.url().endsWith('/api/project-summary')&&r.request().method()==='POST');
     await section.getByRole('button',{name:'Обновить сводку'}).click();
     assert.equal((await response).status(),200);
     assert.equal(await section.getByRole('alert').count(),0);
    }
    // A question chip swaps the summary to its answer in place; «Общий обзор» swaps back without a new request.
    const question=section.getByRole('button',{name:'Какие проблемы повторяются?'});
    const answered=page.waitForResponse(r=>r.url().endsWith('/api/chat')&&r.request().method()==='POST');
    await question.click();assert.equal((await answered).status(),200);
    assert.equal(await question.getAttribute('aria-pressed'),'true');
    await section.getByRole('button',{name:'Обновить ответ'}).waitFor();
    await section.locator('.summary-text .footnote').first().waitFor();
    await section.getByRole('button',{name:'Общий обзор'}).click();
    assert.equal(await section.getByRole('button',{name:'Общий обзор'}).getAttribute('aria-pressed'),'true');
    await section.getByRole('button',{name:'Обновить сводку'}).waitFor();
    for(const chip of await section.locator('.summary-question').all()){const [box,text]=await Promise.all([chip.boundingBox(),chip.locator('.g-button__text').boundingBox()]);assert(text.y+text.height<=box.y+box.height+1,'chip text stays inside the chip')}
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   }finally{await context.close()}
  });
  await run(theme+': material divider, header, and mobile tab icons',async()=>{
   const state=readProject();
   Object.assign(state.studies.find(item=>item.id==='sample'),{format:'Видео'});
   saveProject(state);
   for(const deviceWidth of (width===1440?[1024,1440]:[320,390,768])){
    const context=await browser.newContext({viewport:{width:deviceWidth,height:900},hasTouch:deviceWidth<960,reducedMotion:'reduce'});
    try{
     await context.addCookies(fixture.cookies);
     await context.addInitScript(theme=>localStorage.setItem('ai-hyposut.demo.v1',JSON.stringify({version:1,data:{theme}})),theme);
     const page=await context.newPage();
     await page.goto(fixture.base+'/projects/main/studies/sample');
     const sheet=page.locator('.study-sheet');
     const bar=sheet.locator('.study-sheet-bar');
     await bar.getByRole('button',{name:'Удалить файл',exact:true}).waitFor();
     assert.equal(await sheet.getByRole('heading',{level:1}).count(),1);
     assert.equal(await bar.getByRole('link').count(),0);
     assert.equal(await bar.locator('button svg').evaluateAll(icons=>icons.map(icon=>icon.getBoundingClientRect().width).join(',')),'16,18');
     const divider=sheet.locator('.study-panel-divider');
     if(deviceWidth>=960){
      assert.equal(await sheet.evaluate(el=>getComputedStyle(el).borderRadius),'24px');
      assert.equal(await divider.locator('span').evaluate(el=>getComputedStyle(el).opacity),'0');
      assert(await divider.evaluate(el=>{
       const rect=el.getBoundingClientRect();
       const source=el.parentElement.querySelector('.study-source').getBoundingClientRect();
       const panel=el.parentElement.querySelector('.study-summary').getBoundingClientRect();
       return rect.left>=source.right-1&&rect.right<=panel.left+1;
      }));
      await divider.hover();
      assert.equal(await divider.locator('span').evaluate(el=>getComputedStyle(el).opacity),'1');
      assert.equal(await divider.evaluate(el=>getComputedStyle(el,'::before').borderInlineStartColor),theme==='dark'?'rgb(40, 40, 43)':'rgba(0, 0, 0, 0.15)');
      await divider.click();
      assert.equal(await divider.getAttribute('aria-expanded'),'false');
      assert(await sheet.getByRole('tab',{name:'Хайлайты',exact:true}).isVisible());
      await divider.press('Enter');
      assert.equal(await divider.getAttribute('aria-expanded'),'true');
     }else{
      assert.equal(await divider.count(),0);
      const icons=sheet.locator('.panel-rail button>svg');
      assert.equal(await icons.count(),5);
      assert(await icons.evaluateAll(items=>items.every(icon=>icon.getBoundingClientRect().width>0)));
      await sheet.getByRole('tab',{name:'Хайлайты',exact:true}).tap();
      await sheet.getByRole('tabpanel',{name:'Хайлайты',exact:true}).waitFor();
      await sheet.getByRole('tab',{name:'Материал',exact:true}).tap();
      await sheet.getByRole('heading',{name:'Расшифровка',exact:true}).waitFor();
     }
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    }finally{await context.close()}
   }
  });
  await run(theme+': speaker confirmation, retry and saved participant limit',async()=>{
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   await context.addCookies(fixture.cookies);
   await context.addInitScript(theme=>localStorage.setItem('ai-hyposut.demo.v1',JSON.stringify({version:1,data:{theme}})),theme);
   const page=await context.newPage();page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message));
   let resumeSpeakers;
   holdSpeakers=new Promise(resolve=>{resumeSpeakers=resolve});
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
    const progress=panel.locator('.speaker-detection-progress');
    await progress.getByText('45:00 из 1:09:09 записи',{exact:true}).waitFor();
    assert.equal(await detect.count(),0);
    assert.equal(await page.locator('.material-analysis').count(),0);
    assert.equal(await page.locator('.transcript-toolbar').count(),0);
    await panel.getByRole('heading',{name:'Текущая разметка · 10 спикеров'}).waitFor();
    await page.locator('.study-sheet').screenshot({path:resolve(out,theme+'-speaker-variant-a.png')});
    await tab.click();
    if(width===1440){await page.getByRole('tab',{name:'Спикеры, в работе'}).waitFor()}
    else{await page.getByRole('button',{name:'Определяем спикеров',exact:true}).waitFor()}
    assert.equal(await page.getByRole('checkbox',{name:'Прокручивать текст за записью'}).count(),0);
    const paragraph=page.locator('.transcript-paragraph').first();await paragraph.waitFor();
    assert.ok(await paragraph.evaluate(el=>Math.abs(el.getBoundingClientRect().width-el.parentElement.getBoundingClientRect().width)<1));
    if(width===1440)await tab.click();else await page.getByRole('button',{name:'Определяем спикеров',exact:true}).click();
    await progress.waitFor();
    resumeSpeakers();holdSpeakers=undefined;
    if(width===1440){
     await panel.getByRole('alert').getByText(/Не удалось различить голоса/).waitFor();
     await panel.getByRole('button',{name:'Переименовать: Интервьюер',exact:true}).waitFor();
     await panel.getByRole('button',{name:'Повторить',exact:true}).click();await confirm();
    }
    await page.getByRole('tab',{name:'Спикеры, 4',exact:true}).waitFor();
    assert.equal(await panel.locator('.participant-count strong').innerText(),'4');
    assert.equal(readProject().studies.find(item=>item.id==='sample').segments[0].speaker,'Запись');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   }finally{resumeSpeakers();holdSpeakers=undefined;await context.close()}
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
 await run('Theme wipe preserves the chat draft and supports a keyboard interruption and reduced motion',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light',reducedMotion:'no-preference'});
  await context.addCookies(fixture.cookies);
  const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  const theme=page.locator('html');
  const draft=page.getByRole('textbox',{name:'Вопрос по всем исследованиям',exact:true});
  const dark=page.getByRole('radio',{name:'Тёмная',exact:true});
  const light=page.getByRole('radio',{name:'Светлая',exact:true});
  const settled=value=>page.waitForFunction(value=>document.documentElement.dataset.theme===value&&!document.documentElement.classList.contains('theme-wiping'),value);
  const openProfile=()=>page.getByRole('button',{name:/^Профиль:/}).click();
  try{
   await page.goto(fixture.base+'/chat');await draft.fill('Черновик вопроса');await settled('light');await openProfile();
   await dark.click();
   await page.waitForFunction(()=>document.getAnimations().filter(animation=>animation.animationName==='mn-theme-reveal').length===2);
   assert.equal(await theme.getAttribute('data-theme'),'dark');
   const mid=await page.evaluate(()=>{
    const transitions=document.getAnimations().filter(animation=>animation.animationName==='mn-theme-reveal');
    for(const animation of transitions){animation.pause();animation.currentTime=420}
    return transitions.map(animation=>animation.effect.getTiming().duration);
   });
   assert.deepEqual(mid,[1000,1000]);
   await page.screenshot({path:resolve(out,'theme-wipe-midpoint.png')});
   await light.press('Space');await settled('light');
   assert.equal(await draft.inputValue(),'Черновик вопроса');
   assert.equal(new URL(page.url()).pathname,'/chat');
   await page.emulateMedia({reducedMotion:'reduce'});await dark.click();await settled('dark');
   assert.equal(await page.evaluate(()=>document.getAnimations().some(animation=>animation.animationName==='mn-theme-reveal')),false);
   await page.reload();await settled('dark');await openProfile();
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.evaluate(()=>Object.defineProperty(document,'startViewTransition',{value:undefined}));
   await light.click();await settled('light');
  }finally{await context.close()}
 });
 await run('Theme wipe works on the mobile sign-in screen and in the mobile profile',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:'light',reducedMotion:'no-preference'});
  const phone=await context.newPage();phone.setDefaultTimeout(8000);phone.on('pageerror',error=>errors.push(error.message));
  const checkTheme=async value=>{
   await phone.waitForFunction(()=>document.getAnimations().some(animation=>animation.animationName==='mn-theme-reveal'));
   await phone.waitForFunction(value=>document.documentElement.dataset.theme===value&&!document.documentElement.classList.contains('theme-wiping'),value);
  };
  try{
   await phone.goto(fixture.base+'/login');
   const email=phone.getByRole('textbox',{name:'Рабочая почта',exact:true});
   await email.fill('demo@example.test');
   await phone.getByRole('button',{name:'Включить тёмную тему',exact:true}).tap();
   await checkTheme('dark');assert.equal(await email.inputValue(),'demo@example.test');
   await context.addCookies(fixture.cookies);await phone.goto(fixture.base+'/projects');
   await phone.getByRole('button',{name:'Открыть меню',exact:true}).tap();
   await phone.getByRole('button',{name:/^Профиль:/}).tap();
   await phone.getByRole('radio',{name:'Светлая',exact:true}).tap();await checkTheme('light');
   assert.ok(await phone.getByRole('button',{name:'Оставить отзыв',exact:true}).isVisible());
  }finally{await context.close()}
 });
 await run('Material dialog motion follows input and Escape closes only the visible top dialog',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
  await context.addCookies(fixture.cookies);
  await context.addInitScript(()=>{window.studyMotion=[];document.addEventListener('transitionrun',e=>{
   const role=['study-layer','study-backdrop','study-sheet'].find(name=>e.target.classList?.contains(name));
   if(role)window.studyMotion.push([role,e.propertyName,e.target.closest('.study-layer').hasAttribute('data-closing')?'close':'open']);
  })});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
   const url=fixture.base+'/projects/main/research';await page.goto(url);
   const trigger=page.locator('a[href="/projects/main/studies/sample"]').first();
   const sheet=page.locator('.study-sheet');
   const close=page.getByRole('button',{name:'Закрыть материал',exact:true});
   const events=()=>page.evaluate(()=>window.studyMotion);
   const reset=()=>page.evaluate(()=>{window.studyMotion=[]});
   const restored=()=>page.waitForFunction(()=>document.activeElement?.getAttribute('href')==='/projects/main/studies/sample');
   await trigger.press('Enter');await sheet.waitFor();await page.waitForFunction(()=>document.activeElement?.classList.contains('study-sheet'));
   await page.keyboard.press('Tab');assert.ok(await sheet.evaluate(el=>el.contains(document.activeElement)&&el!==document.activeElement));
   await sheet.getByRole('button',{name:'Удалить файл',exact:true}).press('Enter');
   const nested=page.getByRole('dialog',{name:'Удалить исследование',exact:true});await nested.waitFor();
   await page.waitForFunction(()=>document.activeElement?.closest('[role="dialog"][aria-label="Удалить исследование"]'));
   await page.keyboard.press('Escape');await nested.waitFor({state:'hidden'});assert.ok(await sheet.isVisible());
   await page.waitForFunction(()=>document.activeElement?.closest('.study-sheet'));
   await page.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});await page.waitForURL(url);await restored();
   assert.deepEqual(await events(),[]);
   await trigger.press('Enter');await close.press('Enter');await sheet.waitFor({state:'hidden'});await restored();assert.deepEqual(await events(),[]);
   await trigger.click();await page.waitForFunction(()=>window.studyMotion.length===3);
   assert.deepEqual((await events()).map(e=>e.join(':')).sort(),['study-backdrop:opacity:open','study-sheet:opacity:open','study-sheet:transform:open']);
   assert.equal(await sheet.evaluate(el=>getComputedStyle(el.parentElement).opacity),'1');
   await sheet.evaluate(async el=>{await Promise.allSettled(el.getAnimations().map(a=>a.finished))});
   await close.click();await sheet.waitFor({state:'hidden'});await page.waitForURL(url);await restored();
   assert.deepEqual((await events()).slice(3).map(e=>e.join(':')).sort(),['study-backdrop:opacity:close','study-sheet:opacity:close','study-sheet:transform:close']);
   await reset();await page.emulateMedia({reducedMotion:'reduce'});await trigger.click();await close.click();await sheet.waitFor({state:'hidden'});
   assert.deepEqual(await events(),[]);
  }finally{await context.close()}
 });
 assert.deepEqual(errors,[]);
}finally{await writeFile(resolve(out,'checks.json'),JSON.stringify({checks,errors},null,2));await browser.close();await fixture.close()}
console.log('UI check passed: '+checks.length+' scenarios; no JavaScript errors');
