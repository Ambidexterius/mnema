import {chromium} from 'playwright-core';
import {startRegistrationFixture} from './registration-fixture.mjs';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';

const chrome=process.env.CHROME_PATH||['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
if(!chrome)throw Error('Set CHROME_PATH to the Chrome/Chromium binary');
const browser=await chromium.launch({executablePath:chrome,headless:true});
await mkdir('artifacts/ui-registration',{recursive:true});const results=[],jsErrors=[];
const png=await readFile(new URL('../server/fixtures/avatar.png',import.meta.url));
async function scenario(name,fn,{theme='light',clock,viewport={width:1440,height:980}}={}){
 // Better Auth shares its in-memory rate limiter across otherwise isolated fixtures.
 const dir=await mkdtemp(join(tmpdir(),'mnema-signup-browser-')),stand=await startRegistrationFixture({port:4494,dataDir:dir}),context=await browser.newContext({viewport,isMobile:viewport.width<640,hasTouch:viewport.width<640,extraHTTPHeaders:{'X-Forwarded-For':'192.0.2.'+(results.length+1)},colorScheme:theme,reducedMotion:'reduce'}),page=await context.newPage();
 page.setDefaultTimeout(7000);page.on('pageerror',error=>jsErrors.push({scenario:name,error:error.message}));
 await context.addInitScript(theme=>localStorage.setItem('ai-hyposut.demo.v1',JSON.stringify({version:1,data:{theme}})),theme);
 if(clock)await page.clock.install({time:clock});
 const begin=async(email='ivan.petrov@sutochno.ru')=>{await page.goto(stand.base+'/signup');await page.getByRole('heading',{name:'Создайте аккаунт',exact:true}).waitFor();await page.getByRole('textbox',{name:'Рабочая почта',exact:true}).fill(email);await page.getByRole('button',{name:'Получить код',exact:true}).click();await page.getByRole('heading',{name:'Подтвердите почту'}).waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Код из письма, цифра 1 из 6')};
 const mailCode=()=>{const match=stand.messages.at(-1).text.match(/\n\n(\d{3}) (\d{3})\n\n/);return match[1]+match[2]};
 const verify=async()=>{await page.getByRole('textbox',{name:'Код из письма, цифра 1 из 6',exact:true}).fill(mailCode());await page.getByRole('button',{name:'Подтвердить',exact:true}).click();await page.getByRole('heading',{name:'Придумайте пароль'}).waitFor();const username=page.locator('#registration-email');assert.equal(await username.inputValue(),stand.messages.at(-1).to);assert.equal(await username.isVisible(),false);assert.equal(await page.locator('#registration-password').getAttribute('name'),'new-password')};
 const password=async()=>{await page.getByRole('textbox',{name:'Пароль',exact:true}).fill('abcdefg');await page.getByRole('button',{name:'Продолжить',exact:true}).click();await page.getByRole('alert').filter({hasText:'Минимум 8 символов'}).waitFor();await page.getByRole('textbox',{name:'Пароль',exact:true}).fill('abcdefgh');await page.getByRole('button',{name:'Продолжить',exact:true}).click();await page.getByRole('heading',{name:'Ваш профиль'}).waitFor()};
 const profile=async()=>{await page.getByRole('textbox',{name:'Имя',exact:true}).fill('Иван');await page.getByRole('textbox',{name:'Фамилия',exact:true}).fill('Петров')};
 try{await fn({stand,context,page,begin,mailCode,verify,password,profile});results.push({name,status:'passed'});console.log('PASS '+name)}
 catch(error){await page.screenshot({path:resolve('artifacts/ui-registration',name.replace(/[^a-z0-9-]/gi,'-')+'-failed.png'),fullPage:true}).catch(()=>{});results.push({name,status:'failed',error:error.message});console.log('FAIL '+name+': '+error.message.slice(0,500))}
 finally{await context.close();await stand.close();await rm(dir,{recursive:true,force:true})}
}
try{
 for(const theme of ['light','dark'])for(const screenWidth of [320,390,1440]){
 const viewport={width:screenWidth,height:screenWidth<640?740:980};
 await scenario('complete-flow-'+theme+'-'+screenWidth,async({stand,context,page,begin,mailCode,verify,password,profile})=>{
  const capture=async step=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow at '+step);await page.screenshot({path:'artifacts/ui-registration/flow-'+step+'-'+theme+'-'+screenWidth+'.png',fullPage:true})};
  const openNavigation=async()=>{if(screenWidth<960)await page.getByRole('button',{name:'Открыть меню',exact:true}).click()};
  await page.goto(stand.base+'/signup');await page.getByRole('heading',{name:'Создайте аккаунт',exact:true}).waitFor();assert.equal(await page.getByText('Для сотрудников Суточно.ру',{exact:true}).count(),0);await capture('signup');
  if(screenWidth<640){await page.getByRole('textbox',{name:'Рабочая почта',exact:true}).fill('person@example.com');await page.getByRole('button',{name:'Получить код',exact:true}).click();await page.getByRole('alert').filter({hasText:'Используйте рабочую почту @sutochno.ru'}).waitFor();assert.equal(stand.messages.length,0);await capture('domain-error')}
  await begin();for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:980});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if([320,1440].includes(width))await page.screenshot({path:'artifacts/ui-registration/code-'+theme+'-'+width+'.png'})}const mailbox=await context.newPage();await mailbox.goto(stand.base+'/__mail');await mailbox.getByRole('link',{name:'Код доступа в Мнемонику',exact:true}).first().click();assert.match(await mailbox.locator('body').innerText(),/30 минут/);assert.ok((await mailbox.locator('body').innerText()).includes(mailCode().slice(0,3)+' '+mailCode().slice(3)));await mailbox.screenshot({path:'artifacts/ui-registration/email-'+theme+'.png'});await mailbox.close();
  await page.setViewportSize(viewport);await capture('confirmation');await verify();
  await page.getByRole('button',{name:'Показать пароль',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Пароль',exact:true}).getAttribute('type'),'text');await page.getByRole('button',{name:'Скрыть пароль',exact:true}).click();await capture('password');
  await password();await page.getByRole('button',{name:'Начать работу',exact:true}).click();await page.getByRole('alert').filter({hasText:'Укажите имя'}).waitFor();await capture('profile-errors');await profile();
  for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:980});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const placement=await page.locator('.registration-photo').evaluate(e=>({photo:e.getBoundingClientRect().top,last:document.querySelector('.registration-last-name').getBoundingClientRect().bottom}));assert.ok(placement.photo>placement.last);if([320,1440].includes(width))await page.screenshot({path:'artifacts/ui-registration/profile-'+theme+'-'+width+'.png'})}
  await page.setViewportSize(viewport);const fileChooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Загрузить фото',exact:true}).click();await (await fileChooser).setFiles({name:'avatar.png',mimeType:'image/png',buffer:png});await page.getByRole('button',{name:'Удалить фото',exact:true}).waitFor();await capture('profile');
  await page.getByRole('button',{name:'Начать работу',exact:true}).click();await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();assert.equal(await page.locator('.project-card').count(),3);await capture('projects');await openNavigation();assert.equal(await page.getByRole('button',{name:'Профиль: Иван Петров',exact:true}).count(),1);
  const avatar=page.locator('.account .g-avatar img');await avatar.waitFor();await avatar.evaluate(e=>e.decode());assert.ok(await avatar.evaluate(e=>e.complete&&e.naturalWidth>0));await page.reload();await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();await openNavigation();assert.equal(await page.getByRole('button',{name:'Профиль: Иван Петров',exact:true}).count(),1);await page.goto(stand.base+'/signup');await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();await openNavigation();
  await page.getByRole('button',{name:'Профиль: Иван Петров',exact:true}).click();await page.getByRole('menuitem',{name:'Выйти',exact:true}).click();await page.getByRole('button',{name:'Войти',exact:true}).waitFor();await page.getByRole('link',{name:'Создать аккаунт',exact:true}).click();await page.getByRole('heading',{name:'Создайте аккаунт',exact:true}).waitFor();await page.getByRole('link',{name:'Войти',exact:true}).click();await page.waitForURL('**/login');await page.getByRole('heading',{name:'Вход в Мнемонику',exact:true}).waitFor();await page.getByRole('textbox',{name:'Рабочая почта',exact:true}).fill('ivan.petrov@sutochno.ru');await page.getByRole('textbox',{name:'Пароль',exact:true}).fill('abcdefgh');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();
 },{theme,viewport});
 }

 await scenario('email-error-and-responsive',async({page,stand})=>{
  await page.goto(stand.base+'/signup');const email=page.getByRole('textbox',{name:'Рабочая почта',exact:true});await email.fill('person@gmail.com');await page.getByRole('button',{name:'Получить код'}).click();const error=page.getByRole('alert').filter({hasText:'Используйте рабочую почту @sutochno.ru'});await error.waitFor();const bounds=await error.boundingBox(),input=await email.boundingBox();assert.ok(bounds.y>=input.y+input.height);assert.equal(stand.messages.length,0);
  for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/ui-registration/email-error-'+width+'.png'})}
  await email.fill('  Ivan.Petrov@SUTOCHNO.RU  ');await email.blur();assert.equal(await email.inputValue(),'ivan.petrov@sutochno.ru');
  await email.fill('');assert.equal(await email.getAttribute('placeholder'),'name@sutochno.ru');const label=await page.locator('label[for="registration-email"]').boundingBox(),field=await email.boundingBox();assert.ok(label.y+label.height<=field.y);assert.equal(await page.locator('.registration-email input').count(),1);assert.equal(await page.locator('.registration-email .g-label,.registration-domain').count(),0);assert.equal(await page.locator('.registration-email .g-text-input__label').count(),0);await email.fill('ivan');assert.equal(await page.locator('label[for="registration-email"]').innerText(),'Рабочая почта');await page.locator('.registration-email .g-clear-button').click();assert.equal(await email.inputValue(),'');
  assert.equal(await page.locator('.registration-progress').count(),0);assert.equal(await page.getByText('После регистрации доступны все проекты',{exact:true}).count(),0);
  const spacing=await page.evaluate(()=>{const box=selector=>document.querySelector(selector).getBoundingClientRect(),label=box('label[for="registration-email"]'),input=box('.registration-email'),button=box('form>.g-button'),footer=box('.registration-bottom'),title=box('.auth-title'),brand=box('.auth-symbol');return {brandToTitle:title.top-brand.bottom,titleToLabel:label.top-title.bottom,labelToInput:input.top-label.bottom,inputToButton:button.top-input.bottom,buttonToFooter:footer.top-button.bottom,linkColor:getComputedStyle(document.querySelector('.registration-bottom a')).color}});
  assert.ok(Math.abs(spacing.labelToInput-8)<1);assert.ok(Math.abs(spacing.inputToButton-16)<1);assert.ok(Math.abs(spacing.buttonToFooter-8)<1);assert.equal(spacing.linkColor,'rgba(0, 0, 0, 0.85)');await writeFile('artifacts/ui-registration/spacing.json',JSON.stringify(spacing,null,2)+'\n');
  await page.screenshot({path:'artifacts/ui-registration/registration-final.png'});
 });

 await scenario('theme-does-not-validate-untouched-email',async({page,stand})=>{
  await page.goto(stand.base+'/signup');await page.getByRole('heading',{name:'Создайте аккаунт',exact:true}).waitFor();
  await page.getByRole('button',{name:'Включить тёмную тему',exact:true}).click();assert.equal(await page.getByRole('alert').filter({hasText:'Используйте рабочую почту'}).count(),0);
  await page.getByRole('button',{name:'Включить светлую тему',exact:true}).click();assert.equal(await page.getByRole('alert').filter({hasText:'Используйте рабочую почту'}).count(),0);
  await page.getByRole('button',{name:'Получить код',exact:true}).click();await page.getByRole('alert').filter({hasText:'Используйте рабочую почту @sutochno.ru'}).waitFor();assert.equal(stand.messages.length,0);
 });

 await scenario('mail-failure-recovery',async({page,stand})=>{
  await page.goto(stand.base+'/signup');stand.controls.failNextMail=true;await page.getByRole('textbox',{name:'Рабочая почта'}).fill('mailfail@sutochno.ru');await page.getByRole('button',{name:'Получить код'}).click();await page.getByRole('alert').filter({hasText:'Не удалось отправить код'}).waitFor();assert.equal(stand.messages.length,0);assert.ok(await page.getByRole('heading',{name:'Создайте аккаунт'}).isVisible());await page.getByRole('button',{name:'Получить код'}).click();await page.getByRole('heading',{name:'Подтвердите почту'}).waitFor();assert.equal(stand.messages.length,1);
 });

 await scenario('otp-keyboard-and-attempts',async({page,begin,mailCode})=>{
  await begin();const cells=page.locator('.registration-otp input');assert.equal(await cells.count(),6);await cells.first().fill(mailCode());assert.equal(await cells.evaluateAll(es=>es.map(e=>e.value).join('')),mailCode());await cells.nth(5).press('Backspace');await cells.nth(5).press('Backspace');assert.ok(await cells.nth(4).evaluate(e=>e===document.activeElement));
  const wrong=mailCode()==='111111'?'222222':'111111';for(let i=0;i<5;i++){await cells.first().fill(wrong);await page.getByRole('button',{name:'Подтвердить',exact:true}).click();await page.getByRole('alert').filter({hasText:i===4?'Слишком много попыток':'Код не подошёл'}).waitFor()}
  assert.equal(await page.getByRole('button',{name:'Подтвердить',exact:true}).isDisabled(),true);
 });

 await scenario('otp-tab-does-not-trap',async({page,begin})=>{await begin();const cells=page.locator('.registration-otp input');await cells.first().focus();for(let i=0;i<6;i++)await page.keyboard.press('Tab');assert.equal(await page.locator('.registration-otp').evaluate(e=>e.contains(document.activeElement)),false,'Tab must leave an empty OTP group')});

 await scenario('refresh-back-and-optional-photo',async({page,begin,verify,password,profile})=>{
  await begin();await verify();await password();await profile();await page.reload();await page.getByRole('heading',{name:'Придумайте пароль'}).waitFor();await page.getByRole('status').filter({hasText:'Почта подтверждена'}).waitFor();await password();assert.equal(await page.getByRole('textbox',{name:'Имя',exact:true}).inputValue(),'Иван');assert.equal(await page.getByRole('textbox',{name:'Фамилия',exact:true}).inputValue(),'Петров');await page.getByRole('button',{name:'Начать работу'}).click();await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();
 });

 await scenario('photo-invalid-and-too-large',async({page,begin,verify,password,profile})=>{
  await begin();await verify();await password();await profile();const input=page.getByLabel('Выбрать фотографию',{exact:true});await input.setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')});await page.getByRole('alert').filter({hasText:'Не удалось открыть фото'}).waitFor();await input.setInputFiles({name:'oversize.png',mimeType:'image/png',buffer:Buffer.alloc(5000001)});await page.getByRole('alert').filter({hasText:'до 5 МБ'}).waitFor();await input.setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});await page.getByRole('button',{name:'Удалить фото'}).waitFor();await page.getByRole('button',{name:'Удалить фото'}).click();assert.equal(await page.getByRole('button',{name:'Удалить фото'}).count(),0);await page.getByRole('button',{name:'Начать работу'}).click();await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();
 });

 await scenario('expired-code-and-resend',async({page,stand,begin,mailCode})=>{
  await begin();stand.app.db.prepare('UPDATE mnema_registration SET expires=0,resend_at=0').run();await page.locator('.registration-otp input').first().fill(mailCode());await page.getByRole('button',{name:'Подтвердить',exact:true}).click();await page.getByRole('alert').filter({hasText:'Код истёк'}).waitFor();assert.equal(await page.getByRole('button',{name:'Подтвердить',exact:true}).isDisabled(),true);
  await page.clock.install();await page.clock.fastForward(61000);await page.getByRole('button',{name:'Отправить новый код',exact:true}).click();await page.waitForFunction(()=>{const input=document.querySelector('.registration-otp input');return input&&!input.disabled&&input.value===''});assert.equal(stand.messages.length,2);assert.equal(await page.locator('.registration-otp input').evaluateAll(es=>es.map(e=>e.value).join('')),'');
 });

 await scenario('resend-failure-keeps-valid-code',async({page,stand,begin,mailCode})=>{
  await begin();const original=mailCode();await page.locator('.registration-otp input').first().fill(original);stand.app.db.prepare('UPDATE mnema_registration SET resend_at=0').run();await page.clock.install();await page.clock.fastForward(61000);stand.controls.failNextMail=true;
  await page.getByRole('button',{name:'Отправить новый код',exact:true}).click();await page.getByRole('alert').filter({hasText:'Не удалось отправить код'}).waitFor();assert.equal(stand.messages.length,1);assert.equal(await page.locator('.registration-otp input').evaluateAll(es=>es.map(e=>e.value).join('')),original);await page.getByRole('button',{name:'Подтвердить',exact:true}).click();await page.getByRole('heading',{name:'Придумайте пароль'}).waitFor();
 });

 await scenario('clock-skew',async({page,begin})=>{await begin();assert.equal(await page.getByRole('alert').filter({hasText:'Код истёк'}).count(),0);await page.locator('.registration-otp input').first().fill('123456');assert.equal(await page.getByRole('button',{name:'Подтвердить',exact:true}).isEnabled(),true)},{clock:new Date('2040-01-01T00:00:00Z')});

 await scenario('two-tabs-email-mismatch',async({page,context,stand,begin,mailCode})=>{
  await begin('first@sutochno.ru');const firstCode=mailCode(),other=await context.newPage();await other.goto(stand.base+'/signup');await other.getByRole('button',{name:'Изменить почту'}).click();await other.getByRole('textbox',{name:'Рабочая почта'}).fill('second@sutochno.ru');await other.getByRole('button',{name:'Получить код'}).click();await other.getByRole('heading',{name:'Подтвердите почту'}).waitFor();await page.locator('.registration-otp input').first().fill(firstCode);await page.getByRole('button',{name:'Подтвердить',exact:true}).click();await page.getByRole('heading',{name:'Создайте аккаунт'}).waitFor();await page.getByRole('alert').filter({hasText:'Почта изменилась'}).waitFor();assert.equal(stand.app.db.prepare('SELECT count(*) AS n FROM mnema_profiles').get().n,0);await other.close();
 });

 await scenario('created-account-open-recovery',async({page,stand,begin,verify,password,profile})=>{
  await begin();await verify();await password();await profile();let once=true;await page.route('**/api/state',async route=>{if(once){once=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'synthetic state failure'})})}return route.continue()});
  await page.getByRole('button',{name:'Начать работу'}).click();await page.getByRole('alert').filter({hasText:'Аккаунт создан'}).waitFor();assert.equal(stand.app.db.prepare("SELECT count(*) AS n FROM user WHERE email='ivan.petrov@sutochno.ru'").get().n,1);await page.getByRole('button',{name:'Открыть проекты',exact:true}).click();await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();
 });

 await scenario('offline-final-step-recovery',async({page,context,stand,begin,verify,password,profile})=>{
  await begin();await verify();await password();await profile();await page.getByLabel('Выбрать фотографию',{exact:true}).setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});await page.getByRole('button',{name:'Удалить фото'}).waitFor();await context.setOffline(true);await page.getByRole('button',{name:'Начать работу'}).click();await page.getByRole('alert').filter({hasText:'Нет соединения с сервером'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Имя',exact:true}).inputValue(),'Иван');assert.ok(await page.getByRole('button',{name:'Удалить фото'}).isVisible());assert.equal(stand.app.db.prepare("SELECT count(*) AS n FROM user WHERE email='ivan.petrov@sutochno.ru'").get().n,0);await context.setOffline(false);await page.getByRole('button',{name:'Начать работу'}).click();await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();
 });

 await scenario('existing-account-no-duplicate',async({page,stand,begin,verify,password,profile,mailCode})=>{
  await begin();await verify();await password();await profile();await page.getByRole('button',{name:'Начать работу'}).click();await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();await page.getByRole('button',{name:'Профиль: Иван Петров'}).click();await page.getByRole('menuitem',{name:'Выйти',exact:true}).click();stand.app.db.prepare('UPDATE mnema_registration SET resend_at=0').run();
  await begin();await page.locator('.registration-otp input').first().fill(mailCode());await page.getByRole('button',{name:'Подтвердить',exact:true}).click();await page.waitForURL('**/login?email=*');await page.getByRole('button',{name:'Войти',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Рабочая почта'}).inputValue(),'ivan.petrov@sutochno.ru');await page.getByRole('textbox',{name:'Пароль',exact:true}).fill('incorrect-password');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('alert').filter({hasText:'Почта или пароль не подошли'}).waitFor();assert.equal(stand.app.db.prepare("SELECT count(*) AS n FROM user WHERE email='ivan.petrov@sutochno.ru'").get().n,1);
 });

 await scenario('expired-session-keeps-registration',async({page,begin,verify,password,profile})=>{
  await begin();await verify();await password();await profile();await page.getByRole('button',{name:'Начать работу'}).click();await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();
  await page.route('**/api/state',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'synthetic expired session'})}));
  await page.getByRole('heading',{name:'Вход в Мнемонику',exact:true}).waitFor({timeout:10000});await page.getByRole('link',{name:'Создать аккаунт',exact:true}).click();await page.getByRole('heading',{name:'Создайте аккаунт',exact:true}).waitFor();
 });

 await scenario('revoked-account-login-message',async({page,stand,begin,verify,password,profile})=>{
  await begin();await verify();await password();await profile();await page.getByRole('button',{name:'Начать работу'}).click();await page.getByRole('heading',{name:'Проект',exact:true}).waitFor();await page.getByRole('button',{name:'Профиль: Иван Петров'}).click();await page.getByRole('menuitem',{name:'Выйти',exact:true}).click();stand.app.db.prepare("UPDATE mnema_access SET revoked=1 WHERE user_id=(SELECT id FROM user WHERE email='ivan.petrov@sutochno.ru')").run();
  await page.goto(stand.base+'/login');await page.getByRole('textbox',{name:'Рабочая почта'}).fill('ivan.petrov@sutochno.ru');await page.getByRole('textbox',{name:'Пароль',exact:true}).fill('abcdefgh');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('alert').filter({hasText:'Доступ к аккаунту закрыт'}).waitFor();assert.equal(await page.locator('.app-shell').count(),0);
 });
}finally{
 await browser.close();await writeFile('artifacts/ui-registration/results.json',JSON.stringify({results,jsErrors},null,2)+'\n');const failed=results.filter(r=>r.status==='failed');console.log(results.length+' cases, '+failed.length+' failed, '+jsErrors.length+' JavaScript errors');if(failed.length||jsErrors.length)process.exitCode=1;
}
