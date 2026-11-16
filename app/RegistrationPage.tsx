import React,{useEffect,useRef,useState} from 'react';
import {Button,TextInput,Avatar,Loader,Link} from '@gravity-ui/uikit';
import {ArrowLeft,Eye,EyeOff,Moon,Sun} from 'lucide-react';
import AuthMatrix from './AuthMatrix.tsx';
import BrandMark,{BetaMark} from './BrandMark.tsx';
import OtpInput from './OtpInput.tsx';
import {api} from './api.ts';
import {normalizeCorporateEmail} from './corporate-email.ts';
import './registration.css';

type Stage='email'|'code'|'password'|'profile';
type Pending={pending:boolean;email?:string;verified?:boolean;expiresAt?:number;resendAt?:number;locked?:boolean;serverNow?:number};
export default function RegistrationPage({theme,onTheme,onComplete}:{theme:string;onTheme:()=>void;onComplete:()=>Promise<void>}){
 const [stage,setStage]=useState<Stage>('email'),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[pending,setPending]=useState<Pending>({pending:false});
 const [login,setLogin]=useState(''),[code,setCode]=useState(''),[generation,setGeneration]=useState(0),[password,setPassword]=useState(''),[visible,setVisible]=useState(false);
 const [firstName,setFirstName]=useState(''),[lastName,setLastName]=useState(''),[photo,setPhoto]=useState(''),[readingPhoto,setReadingPhoto]=useState(false),[created,setCreated]=useState(false),[photoLost,setPhotoLost]=useState(false);
 const [errors,setErrors]=useState<Record<string,string>>({}),[notice,setNotice]=useState(''),[now,setNow]=useState(Date.now());
 const emailRef=useRef<HTMLInputElement>(null),passwordRef=useRef<HTMLInputElement>(null),firstRef=useRef<HTMLInputElement>(null),lastRef=useRef<HTMLInputElement>(null),photoRef=useRef<HTMLInputElement>(null);
 const busyRef=useRef(false),alive=useRef(true),photoSequence=useRef(0),clock=useRef({server:Date.now(),local:performance.now()});
 const email=normalizeCorporateEmail(login);
 const cooldown=Math.max(0,Math.ceil(((pending.resendAt||0)-now)/1000)),expired=Boolean(pending.pending&&pending.expiresAt!==undefined&&pending.expiresAt<=now);
 function receivePending(state:Pending){clock.current={server:state.serverNow??Date.now(),local:performance.now()};setPending(state);setNow(clock.current.server)}
 function clearDraft(){try{sessionStorage.removeItem('mnema.registration-profile')}catch{}}
 useEffect(()=>{alive.current=true;api('/api/registration/status',undefined,'GET',false).then((state:Pending)=>{if(!alive.current)return;receivePending(state);if(state.email)setLogin(state.email);if(state.pending){setStage(state.verified?'password':'code');if(state.verified){setNotice('Почта подтверждена. Введите пароль, чтобы продолжить регистрацию');try{const draft=JSON.parse(sessionStorage.getItem('mnema.registration-profile')||'null');if(draft?.email===state.email){if(typeof draft.firstName==='string')setFirstName(draft.firstName.slice(0,70));if(typeof draft.lastName==='string')setLastName(draft.lastName.slice(0,70));setPhotoLost(Boolean(draft.hasPhoto))}}catch{}}}}).catch(()=>{if(alive.current)setErrors({general:'Не удалось проверить регистрацию. Попробуйте получить код ещё раз'})}).finally(()=>{if(alive.current)setLoading(false)});return()=>{alive.current=false;photoSequence.current++}},[]);
 useEffect(()=>{if(stage!=='code')return;const tick=()=>setNow(clock.current.server+performance.now()-clock.current.local);tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer)},[stage]);
 useEffect(()=>{if(created){clearDraft();return}if(!pending.verified||!pending.email)return;try{sessionStorage.setItem('mnema.registration-profile',JSON.stringify({email:pending.email,firstName,lastName,hasPhoto:Boolean(photo)||photoLost}))}catch{}},[firstName,lastName,photo,photoLost,pending.email,pending.verified,created]);
 useEffect(()=>{if(loading)return;const ref={email:emailRef,password:passwordRef,profile:firstRef}[stage];ref?.current?.focus()},[stage,loading]);
 const update=(field:string,value:string,setter:(value:string)=>void)=>{setter(value);setErrors(previous=>({...previous,[field]:''}))};
 const emailError=()=>{if(!email)setErrors(previous=>({...previous,email:'Используйте рабочую почту @sutochno.ru'}))};
 async function action(kind:'submit'|'resend'|'change-email'='submit'){
  if(busyRef.current||readingPhoto)return;
  if(created){location.assign('/projects');return}
  if(kind==='submit'&&stage==='email'&&!email){emailError();emailRef.current?.focus();return}
  if(kind==='submit'&&stage==='password'){
   if(password.length<8||password.length>128){setErrors({password:password.length>128?'Пароль слишком длинный. Сократите его.':'Минимум 8 символов'});passwordRef.current?.focus();return}
   setErrors({});setNotice(photoLost?'Фотографию нужно выбрать ещё раз':'');setStage('profile');return;
  }
  if(kind==='submit'&&stage==='profile'){
   if(!firstName.trim()||firstName.trim().length>70){setErrors({firstName:'Укажите имя от 1 до 70 символов'});firstRef.current?.focus();return}
   if(!lastName.trim()||lastName.trim().length>70){setErrors({lastName:'Укажите фамилию от 1 до 70 символов'});lastRef.current?.focus();return}
  }
  busyRef.current=true;setBusy(true);setErrors(previous=>({photo:previous.photo||''}));setNotice('');
  try{
   if(kind==='change-email'){
    await api('/api/registration/cancel',{},'POST',false);if(!alive.current)return;
    setPending({pending:false});clearDraft();setPassword('');setCode('');setFirstName('');setLastName('');setPhoto('');setPhotoLost(false);photoSequence.current++;setGeneration(g=>g+1);setStage('email');return;
   }
   if(stage==='email'||kind==='resend'){
    const state=await api('/api/registration/request-code',{email:kind==='resend'?pending.email:email},'POST',false);if(!alive.current)return;
    receivePending(state);setCode('');setGeneration(g=>g+1);setStage('code');return;
   }
   if(stage==='code'){
    const state=await api('/api/registration/verify-code',{email:pending.email,code},'POST',false);if(!alive.current)return;
    receivePending(state);if(state.existingAccount){clearDraft();location.assign('/login?email='+encodeURIComponent(state.email));return}setStage('password');return;
   }
   await api('/api/register',{email:pending.email,password,firstName:firstName.trim(),lastName:lastName.trim(),photo},'POST',false);if(!alive.current)return;
   setCreated(true);setPassword('');setPhoto('');
   try{await onComplete()}catch{if(alive.current)setErrors({general:'Аккаунт создан. Не удалось открыть проекты. Попробуйте ещё раз'})}
  }catch(error){
   if(!alive.current)return;
   const message=error.message||'Не удалось выполнить действие. Попробуйте ещё раз',field=stage==='email'?'email':stage==='code'?'code':'general';
   if(error.code==='VERIFICATION_REQUIRED'||error.code==='EMAIL_CHANGED'){setPassword('');setPending({pending:false});setStage('email');setNotice('Подтвердите почту ещё раз. Имя и фамилия сохранены');setErrors({email:message})}
   else if(error.code==='ACCOUNT_EXISTS')location.assign('/login?email='+encodeURIComponent(pending.email||''));
   else if(error.code==='FIRST_NAME'){setErrors({firstName:message});firstRef.current?.focus()}
   else if(error.code==='LAST_NAME'){setErrors({lastName:message});lastRef.current?.focus()}
   else if(error.code==='PHOTO')setErrors({photo:message});
   else if(String(error.code||'').includes('PASSWORD')){setStage('password');setErrors({password:message})}
   else{setErrors({[['MAIL_FAILED','MAIL_UNAVAILABLE','MAIL_LIMIT','RESEND_WAIT','NETWORK'].includes(error.code)?'general':field]:message});if(error.code==='CODE_LOCKED')setPending(previous=>({...previous,locked:true}));if(error.code==='CODE_EXPIRED')setPending(previous=>({...previous,expiresAt:now-1}));}
  }finally{busyRef.current=false;if(alive.current)setBusy(false)}
 }
 async function choosePhoto(event:React.ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0],sequence=++photoSequence.current;event.target.value='';if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5000000||!file.size){setErrors(previous=>({...previous,photo:'Выберите JPG, PNG или WebP размером до 5 МБ'}));return}
  setReadingPhoto(true);setErrors(previous=>({...previous,photo:''}));
  try{
   const value=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file)});
   const image=new Image();image.src=value;await image.decode();if(image.width*image.height>20000000)throw Error('pixels');
   if(alive.current&&sequence===photoSequence.current){setPhoto(value);setPhotoLost(false)}
  }catch{if(alive.current&&sequence===photoSequence.current)setErrors(previous=>({...previous,photo:photo?'Не удалось открыть новое фото. Прежнее сохранено':'Не удалось открыть фото. Выберите другой файл или продолжите без него'}))}
  finally{if(alive.current&&sequence===photoSequence.current)setReadingPhoto(false)}
 }
 const error=(field:string)=><p className="registration-error" id={'registration-'+field+'-error'} role="alert">{errors[field]||''}</p>;
 const title={email:'Создайте аккаунт',code:'Подтвердите почту',password:'Придумайте пароль',profile:'Ваш профиль'};
 return <div className="auth-page auth-minimal auth-density-compact registration-page"><AuthMatrix theme={theme} paused={false}/><header className="auth-header"><Button view="flat" size="l" aria-label={theme==='dark'?'Включить светлую тему':'Включить тёмную тему'} onClick={onTheme}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</Button></header><main className="auth-minimal-main"><section className="auth-form"><div className="auth-form-heading"><div className="auth-brand auth-brand-centered"><BrandMark/><h1 className="auth-product-name">Мнемоника<span className="brand-beta" title="Бета-версия"><BetaMark/><span className="sr-only">, бета-версия</span></span></h1></div></div>{loading?<div className="registration-loading" role="status"><Loader size="m"/>Проверяем регистрацию…</div>:<>
 <h2 className="registration-title">{title[stage]}</h2><p className="registration-description">{stage==='email'?'Для сотрудников Суточно.ру':stage==='code'?'Отправили код на '+pending.email:stage==='password'?pending.email+' · почта подтверждена':'Так коллеги будут видеть вас в Мнемонике'}</p>
 {notice?<p className="registration-notice" role="status">{notice}</p>:null}
 <form aria-label="Регистрация в Мнемонике" noValidate onSubmit={event=>{event.preventDefault();void action()}} aria-busy={busy}>
 {stage==='email'?<><label className="registration-label" htmlFor="registration-email">Рабочая почта</label><TextInput id="registration-email" name="email" className="registration-email" placeholder="name@sutochno.ru" view="normal" type="email" hasClear value={login} onUpdate={value=>update('email',normalizeCorporateEmail(value)||value,setLogin)} onBlur={emailError} size="xl" autoComplete="username" controlRef={emailRef} disabled={busy} validationState={errors.email?'invalid':undefined} controlProps={{autoCapitalize:'none',spellCheck:false,inputMode:'email','aria-describedby':'registration-email-error','aria-invalid':Boolean(errors.email)}}/>{error('email')}</>:null}
 {stage==='code'?<><OtpInput key={generation} onChange={value=>{setCode(value);setErrors(previous=>({...previous,code:''}))}} disabled={busy||expired||Boolean(pending.locked)} error={errors.code||(expired?'Код истёк. Запросите новый':'')}/>{pending.locked&&!errors.code?<p className="registration-error" role="alert">Слишком много попыток. Запросите новый код</p>:null}</>:null}
 {stage==='password'?<><TextInput label="Пароль" value={password} onUpdate={value=>update('password',value,setPassword)} size="xl" type={visible?'text':'password'} autoComplete="new-password" controlRef={passwordRef} validationState={errors.password?'invalid':undefined} controlProps={{minLength:8,maxLength:128,'aria-describedby':'registration-password-error registration-password-hint'}} endContent={<Button type="button" view="flat" aria-label={visible?'Скрыть пароль':'Показать пароль'} aria-pressed={visible} onClick={()=>setVisible(v=>!v)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</Button>}/>{error('password')}<p className="registration-hint" id="registration-password-hint">Минимум 8 символов</p></>:null}
 {stage==='profile'?<><TextInput label="Имя" value={firstName} onUpdate={value=>update('firstName',value,setFirstName)} controlRef={firstRef} autoComplete="given-name" size="xl" disabled={busy} validationState={errors.firstName?'invalid':undefined} controlProps={{maxLength:70,'aria-describedby':'registration-firstName-error'}}/>{error('firstName')}<TextInput className="registration-last-name" label="Фамилия" value={lastName} onUpdate={value=>update('lastName',value,setLastName)} controlRef={lastRef} autoComplete="family-name" size="xl" disabled={busy} validationState={errors.lastName?'invalid':undefined} controlProps={{maxLength:70,'aria-describedby':'registration-lastName-error'}}/>{error('lastName')}
 <div className="registration-photo"><Avatar imgUrl={photo||undefined} text={((firstName.trim()[0]||'')+(lastName.trim()[0]||'')).toUpperCase()||undefined} size="xl"/><div><Button type="button" view="outlined" size="l" onClick={()=>photoRef.current?.click()} disabled={busy||readingPhoto} loading={readingPhoto}>Загрузить фото</Button>{photo?<Button className="registration-remove-photo" type="button" view="flat" onClick={()=>{photoSequence.current++;setPhoto('');setPhotoLost(false);setReadingPhoto(false);setErrors(previous=>({...previous,photo:''}))}} disabled={busy}>Удалить фото</Button>:null}<p className="registration-hint">Необязательно · JPG, PNG, WebP до 5 МБ</p></div><input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Выбрать фотографию" hidden onChange={choosePhoto}/></div>{error('photo')}</>:null}
 {error('general')}<Button type="submit" view="action" size="xl" width="max" loading={busy} disabled={busy||readingPhoto||stage==='code'&&(code.length!==6||expired||Boolean(pending.locked))}>{created?'Открыть проекты':stage==='email'?'Получить код':stage==='code'?'Подтвердить':stage==='password'?'Продолжить':'Начать работу'}</Button>
 </form>
 {stage==='email'?<p className="registration-bottom">Уже есть аккаунт? <Link href="/login" underline>Войти</Link></p>:stage==='code'?<div className="registration-secondary-actions"><Button view="flat" onClick={()=>void action('resend')} disabled={busy||cooldown>0}>{cooldown?'Отправить ещё раз через '+cooldown+' с':'Отправить новый код'}</Button><Button view="flat" onClick={()=>void action('change-email')} disabled={busy}>Изменить почту</Button></div>:<Button className="registration-back" type="button" view="flat" onClick={()=>{if(stage==='password')void action('change-email');else{setErrors({});setStage('password')}}} disabled={busy}><ArrowLeft size={16}/>{stage==='password'?'Изменить почту':'Назад'}</Button>}
 </>}</section></main></div>;
}
