import React,{useRef,useState} from 'react';
import {Button,Dialog,DropdownMenu,RadioGroup,TextInput} from '@gravity-ui/uikit';
import {FileText,MoreHorizontal,Pencil,Trash2,UserPlus} from 'lucide-react';
import {api} from './api.ts';

export type ProjectRef={id:string;name:string;role:'view'|'full';admin:boolean;fileCount?:number;filePreviews?:{name:string;format:string}[]};
export const fileCount=(n:number)=>`${n} ${new Intl.PluralRules('ru').select(n)==='one'?'файл':new Intl.PluralRules('ru').select(n)==='few'?'файла':'файлов'}`;
export function ProjectMenu({project,onAction}:{project:ProjectRef;onAction:(action:string,project:ProjectRef)=>void}){
 const [menuOpen,setMenuOpen]=useState(false);
 return <DropdownMenu switcherWrapperClassName="project-menu-anchor" open={menuOpen} onOpenToggle={setMenuOpen} size="l" popupProps={{strategy:'fixed',placement:['bottom-end','top-end'],className:'project-actions-popup'}}
  renderSwitcher={props=><Button {...props} className="project-menu-trigger" size="l" view="flat" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={'Действия проекта «'+project.name+'»'}><MoreHorizontal size={20}/></Button>}
  items={[
   {text:fileCount(project.fileCount||0),iconStart:<FileText size={16}/>,action:()=>onAction('files',project)},
   ...(project.admin?[
    {text:'Переименовать',iconStart:<Pencil size={16}/>,action:()=>onAction('rename',project)},
    {text:'Добавить пользователя',iconStart:<UserPlus size={16}/>,action:()=>onAction('invite',project)},
    {text:'Удалить проект',iconStart:<Trash2 size={16}/>,theme:'danger' as const,action:()=>onAction('delete',project)},
   ]:[])
  ]}/>;
}
export function ProjectDialog({action,project,onClose,onChanged,notify,returnFocus}:{action:string;project:ProjectRef;onClose:()=>void;onChanged:(id:string,deleted?:boolean)=>Promise<void>;notify:(text:string)=>void;returnFocus?:React.RefObject<HTMLElement|null>}){
 const first=useRef<HTMLInputElement>(null);
 const [name,setName]=useState(project.name),[email,setEmail]=useState(''),[person,setPerson]=useState(''),[role,setRole]=useState('view'),[confirmation,setConfirmation]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[inviteURL,setInviteURL]=useState('');
 const close=()=>{if(!busy)onClose()};
 async function submit(){
  if(busy)return;setError('');
  if(action==='rename'&&(!name.trim()||name.trim().length>60)){setError('Укажите название от 1 до 60 символов.');return}
  if(action==='invite'&&(!person.trim()||!/^\S+@\S+\.\S+$/.test(email.trim()))){setError('Укажите имя и рабочую почту участника.');return}
  setBusy(true);
  try{
   const path='/api/workspaces/'+encodeURIComponent(project.id);
   if(action==='invite'){
    const result=await api(path+'/invitations',{name:person.trim(),email:email.trim(),role},'POST',false);
    if(result.inviteURL){setInviteURL(result.inviteURL);return}
    notify('Пользователь добавлен в проект «'+project.name+'».');
   }else if(action==='rename')await api(path,{name:name.trim()},'PATCH',false);
   else await api(path,{name:project.name},'DELETE',false);
   await onChanged(project.id,action==='delete');onClose();
   if(action!=='invite')notify(action==='delete'?'Проект удалён.':'Название проекта изменено.');
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const title=action==='rename'?'Переименовать проект':action==='delete'?'Удалить проект?':'Добавить пользователя';
 return <Dialog open className="project-action-dialog" initialFocus={first} returnFocus={returnFocus} onClose={close} size="s" aria-label={title}><Dialog.Header caption={title}/><Dialog.Body>
  <div className="project-action-form">
   {action==='rename'?<label>Название проекта<TextInput controlRef={first} value={name} onUpdate={setName} controlProps={{'aria-label':'Название проекта',maxLength:60}} onKeyDown={e=>{if(e.key==='Enter')submit()}}/></label>:null}
   {action==='delete'?<><p>Проект «{project.name}», его файлы, находки и доступ участников будут удалены без возможности восстановления.</p><p className="muted">{fileCount(project.fileCount||0)} в проекте. Другие проекты сохранятся.</p><label>Введите название проекта<TextInput controlRef={first} value={confirmation} onUpdate={setConfirmation} controlProps={{'aria-label':'Введите название проекта',autoComplete:'off'}}/></label></>:null}
   {action==='invite'?<><p className="project-dialog-context">Проект: <strong>{project.name}</strong></p>{inviteURL?<div className="project-invite-result"><p>Передайте ссылку участнику. Она действует 7 дней и используется один раз.</p><TextInput readOnly value={inviteURL} controlProps={{'aria-label':'Ссылка приглашения'}}/><Button onClick={()=>navigator.clipboard.writeText(inviteURL).then(()=>notify('Ссылка скопирована.')).catch(()=>setError('Выделите и скопируйте ссылку вручную.'))}>Скопировать ссылку</Button></div>:<><label>Имя<TextInput controlRef={first} value={person} onUpdate={setPerson} controlProps={{'aria-label':'Имя',maxLength:70,autoComplete:'off'}}/></label><label>Рабочая почта<TextInput value={email} onUpdate={setEmail} type="email" controlProps={{'aria-label':'Рабочая почта',maxLength:150,autoComplete:'off'}}/></label><fieldset><legend>Доступ к этому проекту</legend><RadioGroup value={role} onUpdate={setRole} options={[{value:'view',content:'Просмотр'},{value:'full',content:'Полный доступ'}]}/><p className="muted">{role==='view'?'Материалы и проверенные находки. Без редактирования.':'Добавление и изменение материалов, проверка находок. Управление участниками остаётся у владельца.'}</p></fieldset><p className="muted">Если аккаунт уже есть, доступ появится сразу. Для нового пользователя создадим ссылку приглашения. Письмо автоматически не отправляется.</p></>}</>:null}
   {error?<p className="form-error" role="alert">{error}</p>:null}
  </div>
 </Dialog.Body><Dialog.Footer textButtonCancel={inviteURL?'Готово':'Отмена'} onClickButtonCancel={close} propsButtonCancel={{disabled:busy}}
  {...(!inviteURL?{textButtonApply:action==='rename'?'Сохранить':action==='delete'?'Удалить проект':'Добавить',onClickButtonApply:submit,propsButtonApply:{view:action==='delete'?'outlined-danger' as const:'action' as const,loading:busy,disabled:busy||action==='delete'&&confirmation!==project.name}}:{})}/></Dialog>;
}
