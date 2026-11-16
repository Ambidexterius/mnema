import {chromium} from 'playwright-core';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createUIFixture} from './ui-fixture.mjs';

const chrome=process.env.CHROME_PATH||['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
if(!chrome)throw Error('Set CHROME_PATH to the installed Chrome/Chromium binary');
const out=resolve(process.env.UI_CHECK_OUTPUT||'artifacts/ui-check');await mkdir(out,{recursive:true});
const fixture=await createUIFixture(Number(process.env.UI_CHECK_PORT||4461));
const browser=await chromium.launch({executablePath:chrome,headless:true});
const checks=[],errors=[];
const run=async(name,fn)=>{await fn();checks.push(name)};
try{
 for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'});await context.addCookies(fixture.cookies);
  await context.addInitScript(theme=>{const saved=JSON.parse(localStorage.getItem('ai-hyposut.demo.v1')||'{}');localStorage.setItem('ai-hyposut.demo.v1',JSON.stringify({version:1,data:{...saved.data,theme}}))},theme);
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const goto=async path=>{await page.goto(fixture.base+path);await page.locator('.app-shell').waitFor()};
  const screenshot=name=>page.screenshot({path:resolve(out,theme+'-'+name+'.png')});
  await run(theme+': catalog copy and design colors',async()=>{
   await goto('/projects');await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Создать',exact:true}).count(),1);
   const palette=await page.locator('.g-root').first().evaluate(e=>({theme:e.className,background:getComputedStyle(e).getPropertyValue('--g-color-base-background').trim(),brand:getComputedStyle(e).getPropertyValue('--g-color-base-brand').trim()}));
   assert.ok(palette.theme.includes('theme_'+theme));assert.equal(palette.background,theme==='dark'?'#121213':'#fff');assert.equal(palette.brand,'#ee204d');assert.equal(await page.locator('.projects-heading>p').evaluate(e=>getComputedStyle(e).fontSize),'14px');await screenshot('projects');
  });
  for(const width of [320,390,768,1024,1440])await run(theme+': projects responsive '+width,async()=>{
   await page.setViewportSize({width,height:844});await page.waitForTimeout(80);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(width<640){const geometry=await page.locator('.projects-heading').evaluate(e=>{const h=e.querySelector('h1').getBoundingClientRect(),b=e.querySelector('button').getBoundingClientRect(),card=document.querySelector('.project-folder-stage').getBoundingClientRect(),grid=document.querySelector('.projects-grid').getBoundingClientRect();return{headingY:h.y+h.height/2,buttonY:b.y+b.height/2,card:card.width,grid:grid.width}});assert.ok(Math.abs(geometry.headingY-geometry.buttonY)<2);assert.ok(Math.abs(geometry.card-geometry.grid)<1);if(width===390)await screenshot('projects-mobile')}
  });
  await run(theme+': single-key creation, editing guards and persistent opt-out',async()=>{
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
   await page.getByRole('button',{name:/Профиль:/}).click();await page.locator('.account-menu-row').filter({hasText:'Горячие клавиши'}).locator('.g-switch').click();assert.equal(await page.getByLabel('Горячие клавиши',{exact:true}).isChecked(),false);await page.getByRole('button',{name:/Профиль:/}).click();await page.locator('.account-menu').waitFor({state:'hidden'});
   await main.press('c');await main.press('t');assert.equal(await dialog.count(),0);assert.equal(new URL(page.url()).pathname,'/projects');assert.equal(await create.getAttribute('aria-keyshortcuts'),null);
   await page.reload();await page.locator('.app-shell').waitFor();assert.equal(await create.getAttribute('aria-keyshortcuts'),null);await create.click();await dialog.waitFor();await name.press('Escape');await dialog.waitFor({state:'hidden'});
   await page.getByRole('button',{name:/Профиль:/}).click();await page.locator('.account-menu-row').filter({hasText:'Горячие клавиши'}).locator('.g-switch').click();assert.equal(await page.getByLabel('Горячие клавиши',{exact:true}).isChecked(),true);await screenshot('shortcut-settings');await page.getByRole('button',{name:/Профиль:/}).click();await page.locator('.account-menu').waitFor({state:'hidden'});
   await main.press('c');await dialog.waitFor();await name.press('Escape');await dialog.waitFor({state:'hidden'});await screenshot('shortcuts');
  });
  await run(theme+': reports first in both material tables',async()=>{
   for(const path of ['/projects/main','/projects/main/research']){
    await page.setViewportSize({width:1440,height:950});await goto(path);await page.locator('.study-table tbody tr').first().waitFor();
    const links=page.locator('.study-table .table-study');assert.match(await links.first().getAttribute('href'),/studies\/report$/);assert.match(await links.nth(1).getAttribute('href'),/studies\/sample$/);
    assert.equal(await page.locator('.study-table tbody tr').first().locator('td').nth(1).innerText(),'Отчёт');assert.equal(await page.locator('.study-table .table-study .g-label').count(),0);
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
   await goto('/users');await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('button',{name:'Добавить',exact:true}).count(),1);assert.equal(await page.getByText('Участники Мнемоники и их доступ ко всем проектам.',{exact:true}).count(),0);
   const placement=await page.locator('.settings-toolbar').evaluate(e=>({button:e.querySelector('button').getBoundingClientRect().left,title:document.querySelector('.settings-header h2').getBoundingClientRect().left}));assert.ok(Math.abs(placement.button-placement.title)<1);await screenshot('users');
   await page.getByRole('link',{name:'Модели',exact:true}).click();assert.equal(await page.getByText('Выбирайте поставщика для ответов и анализа материалов.',{exact:true}).count(),0);
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
  await run(theme+': findings and material context',async()=>{
   await goto('/all-findings');await page.locator('.finding-open').first().click();await page.locator('.finding-page').waitFor();assert.equal(await page.locator('.topbar .lucide-lightbulb').count(),1);
   assert.equal(await page.locator('.finding-side>.finding-project-link').count(),0);assert.equal(await page.locator('.finding-block:has(#finding-study-title) .finding-project-link').count(),1);
   await page.locator('.finding-study-link').click();await page.locator('.study-sheet').waitFor();await page.getByRole('button',{name:'Закрыть материал',exact:true}).click();await page.locator('.study-sheet').waitFor({state:'hidden'});await page.getByRole('link',{name:'Назад к находкам',exact:true}).click();await page.locator('.catalog-table').waitFor();assert.equal(new URL(page.url()).pathname,'/all-findings');await screenshot('findings');
  });
  await run(theme+': mobile settings navigation',async()=>{
   await goto('/projects');await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Открыть меню',exact:true}).click();await page.locator('.mobile-nav-sheet').waitFor();await page.locator('.mobile-nav-sheet').getByRole('link',{name:'Настройки',exact:true}).click();await page.locator('.settings-sheet').waitFor();await page.locator('.mobile-nav-sheet').waitFor({state:'hidden'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('.settings-sheet').press('Escape');await page.locator('.settings-sheet').waitFor({state:'hidden'});
  });
  await context.close();
 }
 const motion=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'no-preference'});await motion.addCookies(fixture.cookies);await motion.addInitScript(()=>{window.__uiAnimations=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.classList.contains('content-shell'))window.__uiAnimations.push(options.duration);return animate.call(this,frames,options)}});const page=await motion.newPage();await page.goto(fixture.base+'/projects');await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();await page.getByRole('button',{name:'Свернуть меню',exact:true}).click();await page.waitForFunction(()=>window.__uiAnimations.includes(160));await page.getByRole('button',{name:'Развернуть меню',exact:true}).click();await page.waitForTimeout(200);assert.equal(await page.getByRole('button',{name:'Свернуть меню',exact:true}).getAttribute('aria-expanded'),'true');checks.push('Pointer sidebar collapse is animated and interruptible');await motion.close();
 assert.deepEqual(errors,[]);
}finally{await writeFile(resolve(out,'checks.json'),JSON.stringify({checks,errors},null,2));await browser.close();await fixture.close()}
console.log('UI check passed: '+checks.length+' scenarios; no JavaScript errors');
