import React,{useId,useRef,useState} from 'react';
import {Button,TextInput} from '@gravity-ui/uikit';
import {ArrowLeft,ArrowRight,Eye,EyeOff,Moon,Sun} from 'lucide-react';
import {api} from './api.ts';

function Field({label,children}){const id=useId();return <div className="form-field"><label htmlFor={id}>{label}</label>{React.cloneElement(children,{id})}</div>}
export default function AuthPage({theme,onTheme,login,onComplete,setupRequired=false,setupEnabled=false}){
 const search=new URLSearchParams(location.hash.split('?')[1]||'');
 const invited=search.has('invite');
 const setup=setupRequired&&setupEnabled;
 const [email,setEmail]=useState(search.get('email')||'');
 const [name,setName]=useState('');
 const [password,setPassword]=useState('');
 const [setupToken,setSetupToken]=useState('');
 const [visible,setVisible]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [invalid,setInvalid]=useState('');
 const mail=useRef(null),pass=useRef(null),nameInput=useRef(null);
 const register=!login&&(invited||setup);
 async function submit(e){e.preventDefault();if(busy)return;setError('');setInvalid('');
  if(!/^\S+@\S+\.\S+$/.test(email.trim())){setError('Введите рабочую почту в формате name@company.ru.');setInvalid('email');mail.current?.focus();return}
  if(register&&!name.trim()){setError('Укажите, как к вам обращаться.');setInvalid('name');nameInput.current?.focus();return}
  if(password.length<(register?12:1)){setError(register?'Используйте пароль от 12 символов.':'Введите пароль.');setInvalid('password');pass.current?.focus();return}
  setBusy(true);try{if(register)await api('/api/register',{email:email.trim(),name:name.trim(),password,setupToken,inviteToken:search.get('invite')||''});else await api('/api/auth/sign-in/email',{email:email.trim(),password,rememberMe:true});setPassword('');await onComplete()}catch(err){setError(err.message);setInvalid('password')}finally{setBusy(false)}
 }
 const title=setup?'Создать пространство':register?'Присоединиться к команде':login?'Войти в Мнему':'Исследования помнят больше вместе';
 return <div className="auth-page auth-v3"><header className="auth-header"><a className="auth-brand" href="#/login" aria-label="Мнема — вход"><span className="brand-mark">М</span><strong>Мнема</strong></a><Button view="flat" size="l" aria-label={theme==='dark'?'Включить светлую тему':'Включить тёмную тему'} onClick={onTheme}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</Button></header>
 <main className="auth-main"><section className="auth-form"><div className="overline">Память команды</div><h1>{title}</h1><p className="auth-intro">{setup?'Настройте аккаунт владельца. После этого вы сможете пригласить команду.':register?'Создайте аккаунт, чтобы открыть материалы вашего пространства.':login?'Продолжите работу с материалами и находками команды.':'Мнема соединяет материалы, выводы и решения. Доступ в пространство открывает его владелец.'}</p>
 {(register||login)?<form onSubmit={submit} noValidate>{register?<Field label="Имя"><TextInput value={name} onUpdate={setName} size="xl" autoComplete="name" controlRef={nameInput} validationState={invalid==='name'?'invalid':undefined}/></Field>:null}<Field label="Рабочая почта"><TextInput value={email} onUpdate={setEmail} size="xl" type="email" autoComplete="email" controlRef={mail} validationState={invalid==='email'?'invalid':undefined}/></Field><Field label="Пароль"><TextInput value={password} onUpdate={setPassword} size="xl" type={visible?'text':'password'} autoComplete={register?'new-password':'current-password'} controlRef={pass} validationState={invalid==='password'?'invalid':undefined} controlProps={{'aria-describedby':register?'password-hint':undefined,maxLength:128}} endContent={<Button view="flat" aria-label={visible?'Скрыть пароль':'Показать пароль'} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</Button>}/></Field>{register?<p className="password-hint" id="password-hint">От 12 символов. Можно использовать фразу из нескольких слов.</p>:null}{setup?<Field label="Ключ настройки владельца"><TextInput value={setupToken} onUpdate={setSetupToken} type="password" size="xl" autoComplete="off" controlProps={{maxLength:256}}/></Field>:null}<p className="auth-error" role="alert">{error}</p><Button type="submit" view="action" size="xl" width="max" loading={busy} disabled={busy}>{busy?'Проверяем данные…':setup?'Создать пространство':register?'Присоединиться':'Войти'}<ArrowRight size={18}/></Button>{register?<p className="auth-note">Доступ выдаётся по приглашению. Назначенные права сохранятся после регистрации.</p>:null}</form>:<div className="access-request"><div className="access-request-line"><span>01</span><div><h2>Получите приглашение</h2><p>Попросите владельца пространства добавить вашу рабочую почту.</p></div></div><div className="access-request-line"><span>02</span><div><h2>Присоединитесь по ссылке</h2><p>Создайте аккаунт и откройте доступные вашей роли материалы.</p></div></div><Button view="action" size="xl" href="#/login" width="max">У меня уже есть аккаунт<ArrowRight size={18}/></Button>{setupRequired&&!setupEnabled?<p className="auth-note">Пространство ещё настраивается. Владелец скоро откроет доступ.</p>:null}</div>}
 {register?<Button view="flat" href="#/login"><ArrowLeft size={16}/>Уже есть аккаунт</Button>:login?<Button view="flat" href="#/signup">Как присоединиться к команде<ArrowRight size={16}/></Button>:null}</section>
 <aside className="auth-editorial" aria-label="О Мнеме"><div className="editorial-index">Мнема / Исследования команды</div><blockquote>Чтобы выводы<br/>не оставались<br/>в одной голове.</blockquote><div className="editorial-rule"/><div className="editorial-content"><span>Материалы</span><p>Интервью, встречи и отчёты с сохранённым контекстом.</p><span>Находки</span><p>Наблюдения и гипотезы рядом с подтверждающими фрагментами.</p><span>Решения</span><p>Ответы, которые можно проверить по первоисточнику.</p></div><div className="editorial-footnote">Память команды, а не ещё одна папка с записями.</div></aside>
 </main><footer className="auth-footer"><span>Мнема · Память команды</span><span>v0.3</span></footer></div>
}
