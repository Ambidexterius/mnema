import {createMnemaServer} from '../server/server.ts';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

// Disposable test data only. This helper never opens the production data directory.
export async function createUIFixture(port=4461){
 const dir=await mkdtemp(join(tmpdir(),'mnema-ui-')),base='http://127.0.0.1:'+port,setup=randomBytes(32).toString('hex');
 process.env.LLM_KEY_CUSTOM2=randomBytes(24).toString('hex');
 process.env.MNEMA_S3_ENABLED='0';
 const app=await createMnemaServer({production:false,dataDir:dir,publicDir:fileURLToPath(new URL('../dist',import.meta.url)),baseURL:base,setupToken:setup,authSecret:randomBytes(48).toString('hex'),sendInvitationMail:async()=>{},sendCompletionMail:async()=>{},providerFetch:async()=>new Response(JSON.stringify({choices:[{message:{content:'Синтетический ответ для проверки интерфейса [1].'}}],usage:{total_tokens:12}}),{headers:{'Content-Type':'application/json'}})});
 await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
 const response=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json','X-Mnema-Request':'1'},body:JSON.stringify({email:'ui@example.test',name:'Проверка интерфейса',password:randomBytes(24).toString('hex'),setupToken:setup})});
 if(response.status!==200)throw Error('Cannot create UI fixture');
 const cookies=response.headers.getSetCookie().map(c=>{const pair=c.split(';')[0],i=pair.indexOf('=');return{name:pair.slice(0,i),value:pair.slice(i+1),url:base}}),cookie=cookies.map(c=>c.name+'='+c.value).join('; ');
 const user=app.db.prepare('SELECT id FROM user').get(),state=JSON.parse(app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get().data);
 const text='Синтетический пример. Участник не получил ответ до оплаты.';
 await writeFile(join(dir,'uploads','ui-file'),text);app.db.prepare('INSERT INTO mnema_uploads VALUES(?,?,?,?,?)').run('ui-file','Интервью.txt','text/plain',Buffer.byteLength(text),'ready');
 state.models=[{id:'fixture',name:'Тестовая модель',model:'fixture',url:'https://api.openai.com/v1',provider:'Совместимый API',apiType:'compatible',keyRef:'LLM_KEY_CUSTOM2',enabled:true}];state.modelId='fixture';
 state.studies=[{id:'sample',title:'Тестовый материал',fileId:'ui-file',fileName:'Интервью.txt',type:'Интервью',format:'TXT',date:'2026-11-16',status:'ready',duration:0,participants:1,tags:[],summary:[],report:'none',segments:[{id:'segment',speaker:'Документ',time:0,text}]}];
 state.findings=[{id:'finding',studyId:'sample',segmentId:'segment',title:'Нет ответа до оплаты',description:'Синтетический пример для проверки интерфейса.',kind:'Проблема',importance:'Критично',status:'verified',origin:'human',significant:false,history:[]}];
 state.projectProfile={category:'Продукт',report:'none',conducted:'',method:'Тест',audience:'Синтетические данные',contact:'',revision:1};
 app.db.prepare("UPDATE mnema_workspaces SET name=?,data=?,created_by=? WHERE id='main'").run('Тест интерфейса',JSON.stringify(state),user.id);
 for(const name of ['Другой раздел','Длинное название для проверки переноса текста на телефоне']){const r=await fetch(base+'/api/workspaces',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Mnema-Request':'1'},body:JSON.stringify({name})});if(r.status!==201)throw Error('Cannot create project fixture')}
 return {base,cookies,app,async close(){app.notifications.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.storage.close();app.db.close();await rm(dir,{recursive:true,force:true});delete process.env.LLM_KEY_CUSTOM2}};
}
