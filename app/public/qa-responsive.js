const frame=document.querySelector('iframe');
for(const button of document.querySelectorAll('[data-width]'))button.addEventListener('click',()=>{frame.style.width=button.dataset.width+'px';for(const item of document.querySelectorAll('[data-width]'))item.setAttribute('aria-pressed',String(item===button));});
document.querySelector('#route').addEventListener('change',event=>{frame.src='/#/'+event.target.value;});
