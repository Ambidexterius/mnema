import {randomUUID} from 'node:crypto';
import {sendSmtp,smtpConfigured,type CompletionMail} from './completion-mail.ts';

export type InvitationMailStatus='sent'|'failed'|'not_configured';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export interface InvitationMailInput{
 to:string;name:string;workspaceId:string;workspaceName:string;inviterName:string;role:'view'|'full';baseURL:string;inviteURL?:string;
}
export function invitationEmail(input:InvitationMailInput):CompletionMail{
 const {to,name,workspaceId,workspaceName,inviterName,role,baseURL,inviteURL}=input;
 const projectURL=new URL('/',baseURL);projectURL.searchParams.set('workspace',workspaceId);projectURL.hash='/overview';
 const url=inviteURL||projectURL.href;
 if(new URL(url).origin!==new URL(baseURL).origin)throw new Error('invalid_invitation_origin');
 const access=role==='full'?'Полный доступ':'Просмотр';
 const title=inviteURL?'Вас пригласили в проект':'Вас добавили в проект';
 const action=inviteURL?'Принять приглашение':'Открыть проект';
 const note=inviteURL?'Ссылка действует 7 дней и используется один раз. Зарегистрируйтесь с почтой, на которую пришло это письмо.':'Войдите с почтой, на которую пришло это письмо.';
 const text=[name+',',inviterName+' приглашает вас в проект «'+workspaceName+'» в Мнемонике.','Доступ: '+access+'.',note,action+': '+url,'Если вы не ожидали приглашения, пропустите это письмо.'].join('\n\n');
 const html='<!doctype html><html lang="ru"><meta charset="utf-8"><body style="margin:0;padding:32px 16px;background:#f2f2f2;color:#242424;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto"><tr><td style="padding:0 0 24px;font-size:20px;font-weight:bold">Мнемоника <span style="color:#EE204D">β</span></td></tr><tr><td style="border:1px solid #e5e5e5;border-radius:8px;padding:24px;background:#fff"><h1 style="font-size:22px;line-height:30px;margin:0 0 16px">'+escape(title)+'</h1><p style="line-height:24px">'+escape(inviterName)+' приглашает вас в проект <strong>«'+escape(workspaceName)+'»</strong>.</p><p>Доступ: '+access+'.</p><p style="font-size:14px;line-height:22px;color:#656565">'+note+'</p><p style="margin:24px 0"><a href="'+escape(url)+'" style="display:inline-block;padding:12px 20px;background:#EE204D;border-radius:8px;color:#fff;text-decoration:none">'+action+'</a></p><p style="font-size:13px;line-height:20px;color:#656565">Если вы не ожидали приглашения, пропустите это письмо.</p></td></tr></table></body></html>';
 return{to,subject:(inviteURL?'Приглашение':'Доступ')+' в проект «'+workspaceName.replace(/[\r\n]/g,' ').slice(0,120)+'»',text,html,messageId:'<mnemonika-invite-'+randomUUID()+'@'+new URL(baseURL).hostname+'>'};
}
export async function sendInvitationEmail(input:InvitationMailInput,send?:((mail:CompletionMail)=>Promise<void>)):Promise<InvitationMailStatus>{
 if(!send&&!smtpConfigured())return 'not_configured';
 try{await (send||sendSmtp)(invitationEmail(input));return 'sent'}
 catch{console.error('Invitation email delivery failed');return 'failed'}
}
