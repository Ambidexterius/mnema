// Explicit names are a conservative scope guard, not entity inference or sentiment analysis.
const brand=(source:string)=>new RegExp('(?:^|[^\\p{L}\\p{N}])(?:'+source+')(?=$|[^\\p{L}\\p{N}])','iu');
const products:[string,RegExp][]=[['sutochno',brand('суточно(?:\\.ру)?|sutochno(?:\\.ru)?')],['ozon',brand('озон[а-яё]*|ozon(?:\\s*travel)?')],['ostrovok',brand('остров[оа]к[а-яё]*|ostrovok')],['yandex',brand('яндекс[а-яё]*|yandex')],['booking',brand('букинг[а-яё]*|booking(?:\\.com)?')],['avito',brand('авито|avito')],['tvil',brand('твил|tvil')],['airbnb',brand('airbnb|эйрбиэнби')]];
export const mentionedProducts=(text:string)=>products.filter(([,pattern])=>pattern.test(text)).map(([name])=>name);
export const requestedProduct=(question:string)=>{const names=mentionedProducts(question);return names.length===1?names[0]:undefined};
