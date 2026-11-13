import {brotliCompress,gzip,constants} from 'node:zlib';
import {promisify} from 'node:util';

const brotli=promisify(brotliCompress),gz=promisify(gzip);
/** Below this size compression costs more than it saves. */
export const MIN_COMPRESS_BYTES=1024;
const COMPRESSIBLE=/^(?:text\/|application\/(?:json|javascript|xml)|image\/svg\+xml)/;

/** Picks br, then gzip, from an Accept-Encoding header; q=0 disables a coding. */
export function pickEncoding(header:string|string[]|undefined):'br'|'gzip'|null{
 const accepted=new Map<string,number>();
 for(const part of String(header||'').toLowerCase().split(',')){
  const [name,...params]=part.trim().split(';');if(!name)continue;
  const q=params.map(p=>p.trim()).find(p=>p.startsWith('q='));
  accepted.set(name.trim(),q?Number(q.slice(2))||0:1);
 }
 const allowed=(name:string)=>(accepted.get(name)??accepted.get('*')??0)>0;
 return allowed('br')?'br':allowed('gzip')?'gzip':null;
}

export const compressible=(type:string|undefined)=>COMPRESSIBLE.test(String(type||''));

/** Fast settings: transcripts compress well even at low levels, and the event loop stays free. */
export async function encode(body:Buffer,encoding:'br'|'gzip'):Promise<Buffer>{
 return encoding==='br'
  ?brotli(body,{params:{[constants.BROTLI_PARAM_QUALITY]:4,[constants.BROTLI_PARAM_SIZE_HINT]:body.length}})
  :gz(body,{level:5});
}

/** Writes a body, compressed when the client allows it and the content type benefits. */
export async function sendBody(req:{headers:Record<string,any>,method?:string}|undefined,res:any,status:number,headers:Record<string,any>,body:Buffer){
 const encoding=compressible(headers['Content-Type'])&&body.length>=MIN_COMPRESS_BYTES?pickEncoding(req?.headers?.['accept-encoding']):null;
 const vary={Vary:'Accept-Encoding'};
 if(!encoding){res.writeHead(status,{...headers,...(compressible(headers['Content-Type'])?vary:{}),'Content-Length':body.length});res.end(req?.method==='HEAD'?undefined:body);return}
 const encoded=await encode(body,encoding);
 if(res.headersSent||res.destroyed)return;
 res.writeHead(status,{...headers,...vary,'Content-Encoding':encoding,'Content-Length':encoded.length});res.end(req?.method==='HEAD'?undefined:encoded);
}
