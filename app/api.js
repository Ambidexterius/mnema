export async function api(path,body,method=body===undefined?'GET':'POST'){
 const response=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Mnema-Request':'1'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 let result;try{result=await response.json()}catch{throw new Error('Сервер вернул неожиданный ответ. Обновите страницу.')}
 if(!response.ok){const e=new Error(result.error||result.message||'Не удалось выполнить действие.');e.status=response.status;throw e}return result;
}
