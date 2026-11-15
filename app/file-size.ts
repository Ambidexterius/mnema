const number=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
const units=['Б','КБ','МБ','ГБ','ТБ'];
export function formatFileSize(bytes:unknown):string{
 if(typeof bytes!=='number'||!Number.isSafeInteger(bytes)||bytes<0)return '—';
 const unit=bytes?Math.min(Math.floor(Math.log(bytes)/Math.log(1000)),units.length-1):0;
 return number.format(bytes/1000**unit)+'\u00a0'+units[unit];
}
