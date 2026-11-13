import test from 'node:test';
import assert from 'node:assert/strict';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import {pickEncoding,compressible,sendBody,MIN_COMPRESS_BYTES} from './compression.ts';

test('accept-encoding prefers br, honours q=0 and wildcards', () => {
  assert.equal(pickEncoding('gzip, deflate, br'),'br');
  assert.equal(pickEncoding('gzip'),'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0.5'),'gzip');
  assert.equal(pickEncoding('*'),'br');
  assert.equal(pickEncoding('identity'),null);
  assert.equal(pickEncoding(undefined),null);
});

test('only text-like responses are compressed', () => {
  assert.ok(compressible('application/json; charset=utf-8'));
  assert.ok(compressible('text/javascript; charset=utf-8'));
  assert.ok(compressible('image/svg+xml'));
  assert.ok(!compressible('video/mp4'));
  assert.ok(!compressible('application/pdf'));
});

const fakeResponse=()=>{const r:any={headersSent:false,destroyed:false,status:0,headers:{},body:undefined as Buffer|undefined,
  writeHead(status:number,headers:any){this.status=status;this.headers=headers;this.headersSent=true},end(body?:Buffer){this.body=body}};return r};

test('large JSON is sent compressed with matching length and Vary', async () => {
  const body=Buffer.from(JSON.stringify({segments:Array.from({length:500},(_,i)=>({id:i,text:'Реплика респондента о бронировании '+i}))}));
  for(const [header,decode] of [['br',brotliDecompressSync],['gzip',gunzipSync]] as const){
    const res=fakeResponse();
    await sendBody({headers:{'accept-encoding':header}},res,200,{'Content-Type':'application/json; charset=utf-8'},body);
    assert.equal(res.headers['Content-Encoding'],header);
    assert.equal(res.headers.Vary,'Accept-Encoding');
    assert.equal(res.headers['Content-Length'],res.body.length);
    assert.ok(res.body.length<body.length/3);
    assert.deepEqual(decode(res.body),body);
  }
});

test('small bodies, binary types and clients without encodings stay plain', async () => {
  const small=Buffer.alloc(MIN_COMPRESS_BYTES-1,'a');const large=Buffer.alloc(MIN_COMPRESS_BYTES*4,'a');
  for(const [body,type,header] of [[small,'application/json','br'],[large,'video/mp4','br'],[large,'application/json','']] as const){
    const res=fakeResponse();
    await sendBody({headers:{'accept-encoding':header}},res,200,{'Content-Type':type},body);
    assert.equal(res.headers['Content-Encoding'],undefined);
    assert.deepEqual(res.body,body);
  }
  const head=fakeResponse();
  await sendBody({headers:{'accept-encoding':'br'},method:'HEAD'},head,200,{'Content-Type':'application/json'},large);
  assert.equal(head.body,undefined);assert.ok(head.headers['Content-Length']>0);
});
