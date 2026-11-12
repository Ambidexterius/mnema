import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractDocument,processingProgress,transcribeRecording} from './processing.ts';
test('mixed PDF uses OCR only for scanned pages and preserves stable page citations',async()=>{
 const calls=[];const run=async(cmd:string,args:string[]):Promise<{stdout:string}>=>{calls.push([cmd,args]);if(cmd==='pdfinfo')return{stdout:'Pages: 2\n'};if(cmd==='pdftotext')return{stdout:args[1]==='1'?'Достаточный текст первого листа. Пользователь проверяет календарь.':''};if(cmd==='tesseract')return{stdout:'Распознанный скан второго листа.'};return{stdout:''}};
 const first=await extractDocument({filePath:'/tmp/neutral.pdf',fileName:'neutral.pdf',fileId:'fixture',run});
 assert.equal(first.ocrPages,1);assert.deepEqual(first.segments.map(s=>s.page),[1,2]);assert.equal(calls.filter(c=>c[0]==='tesseract').length,1);
 const again=await extractDocument({filePath:'/tmp/neutral.pdf',fileName:'neutral.pdf',fileId:'fixture',run});assert.equal(first.segments[1].id,again.segments[1].id);
});

test('processor progress accepts measured phases without exposing arbitrary stdout',()=>{
 assert.equal(processingProgress('private transcript text'),null);
 assert.equal(processingProgress(JSON.stringify({event:'progress',phase:'private text'})),null);
 assert.equal(processingProgress(JSON.stringify({event:'progress',phase:'transcribing',processedSeconds:925,totalSeconds:3720,chunk:2,chunks:5})),'Распознаём запись: 15:25 из 1:02:00 · часть 2 из 5');
 assert.equal(processingProgress(JSON.stringify({event:'progress',phase:'diarization',processedSeconds:900,totalSeconds:3720,chunk:2,chunks:5})),'Определяем спикеров: 15:00 из 1:02:00 · часть 2 из 5');
 assert.equal(processingProgress(JSON.stringify({event:'progress',phase:'transcribing',processedSeconds:-1,totalSeconds:10,chunk:99,chunks:1})),'Распознаём запись');
});

test('complete ASR checkpoint survives interrupted optional speaker stage; partial ASR still fails',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const dir=await mkdtemp(join(tmpdir(),'mnema-asr-checkpoint-')),before=process.env.ASR_MODEL_DIR;process.env.ASR_MODEL_DIR=dir;
 try{
  await writeFile(join(dir,'model.bin'),'fixture');const progress:string[]=[];let complete=true;
  const run=async(cmd:string,args:string[],options:any)=>{
   if(cmd==='ffprobe')return{stdout:JSON.stringify({format:{duration:1000,format_name:'webm'}})};
   if(args[0]?.endsWith('transcribe.py')){
    options.onStdoutLine(JSON.stringify({event:'progress',phase:'diarization',processedSeconds:0,totalSeconds:1000,chunk:1,chunks:2}));
    await writeFile(args[2],JSON.stringify({transcriptionComplete:complete,diarizationError:'NotCompleted',segments:[{time:0,end:2,speaker:'Запись',text:'Complete fixture speech'}],duration:1000}));
    throw Object.assign(new Error('fixture process killed'),{signal:'SIGKILL'});
   }return{stdout:''};
  };
  const result=await transcribeRecording({filePath:'fixture.webm',fileId:'checkpoint',run,onProgress:p=>progress.push(p)});
  assert.equal(result.segments[0].text,'Complete fixture speech');assert.equal(result.diarization,false);assert.equal(result.diarizationError,'Interrupted');assert(progress.some(p=>p.startsWith('Определяем спикеров')));
  complete=false;await assert.rejects(transcribeRecording({filePath:'fixture.webm',fileId:'partial',run}),/fixture process killed/);
 }finally{if(before===undefined)delete process.env.ASR_MODEL_DIR;else process.env.ASR_MODEL_DIR=before;await rm(dir,{recursive:true,force:true})}
});

test('real subprocess streams progress before termination and joins split stdout lines',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const dir=await mkdtemp(join(tmpdir(),'mnema-asr-stream-')),keys=['PATH','ASR_MODEL_DIR','ASR_PYTHON'];const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  await writeFile(join(dir,'model.bin'),'fixture');
  await writeFile(join(dir,'ffprobe'),'#!/usr/bin/env node\nconsole.log(JSON.stringify({format:{duration:60,format_name:"webm"}}));',{mode:0o700});
  await writeFile(join(dir,'ffmpeg'),'#!/usr/bin/env node\n',{mode:0o700});
  await writeFile(join(dir,'python-fixture'),'#!/usr/bin/env node\nconst fs=require("node:fs");process.stdout.write("{\\\"event\\\":\\\"progress\\\",\\\"phase\\\":");setTimeout(()=>{process.stdout.write("\\\"transcribing\\\",\\\"processedSeconds\\\":30,\\\"totalSeconds\\\":60}\\n");setTimeout(()=>{fs.writeFileSync(process.argv[4],JSON.stringify({segments:[{time:0,text:"Fixture"}]}));},300);},25);',{mode:0o700});
  process.env.PATH=dir+':'+before.PATH;process.env.ASR_MODEL_DIR=dir;process.env.ASR_PYTHON=join(dir,'python-fixture');
  let progressAt=0;await transcribeRecording({filePath:'fixture.webm',fileId:'stream',onProgress:p=>{if(p.includes('0:30 из 1:00'))progressAt=Date.now()}});
  assert(progressAt>0,'progress must arrive while the child runs');assert(Date.now()-progressAt>=200,'progress must not wait for buffered stdout at exit');
 }finally{for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key]}await rm(dir,{recursive:true,force:true})}
});

test('Python ASR resumes completed chunks after restart, repeats interrupted chunk and isolates a new job',async()=>{
 const {mkdtemp,writeFile,readFile,mkdir,rm}=await import('node:fs/promises');const {join,resolve}=await import('node:path');const {tmpdir}=await import('node:os');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const dir=await mkdtemp(join(tmpdir(),'mnema-asr-resume-'));
 try{
  const audio=join(dir,'audio'),calls=join(dir,'calls.txt'),output=join(dir,'out.json'),wrapper=join(dir,'fixture.py'),checkpoint=join(dir,'job-one.json');await mkdir(audio);
  for(const name of ['audio-00000.flac','audio-00001.flac','audio-00002.flac'])await writeFile(join(audio,name),'fixture');
  await writeFile(wrapper,`import sys, os, json, runpy
from pathlib import Path
from types import ModuleType, SimpleNamespace
class Model:
    live = 0
    def __init__(self, *args, **kwargs): Model.live += 1
    def __del__(self): Model.live -= 1
    def transcribe(self, audio, **kwargs):
        name = Path(audio).name
        with open(os.environ['FIXTURE_CALLS'], 'a') as log: log.write(name + '\\n')
        def segments():
            yield SimpleNamespace(start=0, end=10, text=name)
            if name == os.environ.get('FIXTURE_FAIL'): raise RuntimeError('interrupted chunk fixture')
        return segments(), SimpleNamespace(duration=900, language='ru')
module = ModuleType('faster_whisper'); module.WhisperModel = Model
sys.modules['faster_whisper'] = module
diarize = ModuleType('diarize'); diarize.models_ready = lambda models: True
def speakers(chunks, *args, **kwargs):
    assert Model.live == 0, 'Whisper must be released before speaker models load'
    saved = json.loads(Path(sys.argv[2]).read_text())
    assert saved['transcriptionComplete'] and saved['diarizationError'] == 'NotCompleted'
    for index in range(1, len(chunks) + 1): kwargs['on_progress'](index * 900, index, len(chunks))
    return [], 0
diarize.diarize_chunks = speakers; diarize.label_segments = lambda segments, turns: (segments, 0)
sys.modules['diarize'] = diarize
script = sys.argv.pop(1)
runpy.run_path(script, run_name='__main__')
`);
  const run=(path:string,fail='')=>promisify(execFile)(process.env.DOC_PYTHON||'python3',[wrapper,resolve('server/transcribe.py'),audio,output,'--model','fixture-model','--duration','2700','--checkpoint',path],{env:{...process.env,FIXTURE_CALLS:calls,FIXTURE_FAIL:fail,ASR_DIARIZATION:'1'},maxBuffer:1024**2});
  await assert.rejects(run(checkpoint,'audio-00001.flac'),/interrupted chunk fixture/);
  const partial=JSON.parse(await readFile(checkpoint,'utf8'));assert.equal(partial.completedChunks,1);assert.equal(partial.segments.length,1);
  const resumed=await run(checkpoint);assert(resumed.stdout.includes('"diarization"'));const result=JSON.parse(await readFile(output,'utf8'));assert.equal(result.segments.length,3);assert.deepEqual(result.segments.map(s=>s.time),[0,900,1800]);
  assert.deepEqual((await readFile(calls,'utf8')).trim().split('\n'),['audio-00000.flac','audio-00001.flac','audio-00001.flac','audio-00002.flac']);
  await writeFile(calls,'');await run(checkpoint);assert.equal(await readFile(calls,'utf8'),'','a complete checkpoint does not run ASR again');
  await run(join(dir,'job-two.json'));assert.deepEqual((await readFile(calls,'utf8')).trim().split('\n'),['audio-00000.flac','audio-00001.flac','audio-00002.flac']);
  await writeFile(calls,'');await writeFile(checkpoint,'[]');await run(checkpoint);assert.equal((await readFile(calls,'utf8')).trim().split('\n').length,3,'malformed checkpoint must restart ASR safely');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('real diarize_chunks keeps chunk progress indices when an existing voice is reused',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const {resolve}=await import('node:path');
 const script=`import sys, json, math, importlib.util
from pathlib import Path
from types import ModuleType, SimpleNamespace
class Vec(list):
    def __mul__(self, value): return Vec(x * value for x in self)
    __rmul__ = __mul__
    def __add__(self, other): return Vec(a + b for a, b in zip(self, other))
    def __truediv__(self, value): return Vec(x / value for x in self)
    @property
    def shape(self): return (len(self),)
numpy = ModuleType('numpy')
numpy.float32 = float
numpy.array = lambda value, dtype=None: Vec(value)
numpy.zeros = lambda count, dtype=None: Vec([0.0] * count)
numpy.concatenate = lambda parts: Vec(value for part in parts for value in part)
numpy.dot = lambda a, b: sum(x * y for x, y in zip(a, b))
numpy.linalg = SimpleNamespace(norm=lambda vector: math.sqrt(sum(x * x for x in vector)))
sys.modules['numpy'] = numpy
class Config:
    def __init__(self, **kwargs): self.__dict__.update(kwargs)
    def validate(self): return True
class Diarizer:
    def __init__(self, config): pass
    def process(self, audio):
        turn = SimpleNamespace(speaker=0, start=0.0, end=12.0)
        return SimpleNamespace(sort_by_start_time=lambda: [turn])
class Extractor:
    def __init__(self, config): pass
    def create_stream(self): return SimpleNamespace(accept_waveform=lambda *args: None, input_finished=lambda: None)
    def compute(self, stream): return [1.0, 0.0]
sherpa = ModuleType('sherpa_onnx')
for name in ['OfflineSpeakerDiarizationConfig', 'OfflineSpeakerSegmentationModelConfig', 'OfflineSpeakerSegmentationPyannoteModelConfig', 'SpeakerEmbeddingExtractorConfig', 'FastClusteringConfig']:
    setattr(sherpa, name, Config)
sherpa.OfflineSpeakerDiarization = Diarizer
sherpa.SpeakerEmbeddingExtractor = Extractor
sys.modules['sherpa_onnx'] = sherpa
audio = ModuleType('faster_whisper.audio')
audio.decode_audio = lambda path, sampling_rate: Vec([0.0] * (sampling_rate * 12))
sys.modules['faster_whisper'] = ModuleType('faster_whisper')
sys.modules['faster_whisper.audio'] = audio
spec = importlib.util.spec_from_file_location('real_diarize_fixture', sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
progress = []
turns, count = module.diarize_chunks([Path('first.flac'), Path('second.flac')], 'fixture-models', on_progress=lambda done, index, total: progress.append((done, index, total)))
assert count == 1, 'the second chunk must reuse the existing voice'
assert turns == [(0.0, 12.0, 0), (12.0, 24.0, 0)], turns
assert [step[1] for step in progress] == [1, 1, 2, 2], progress
assert [step[0] for step in progress] == [0.0, 12.0, 12.0, 24.0], progress
assert all(step[2] == 2 for step in progress), progress
print(json.dumps({'progress': progress, 'speakers': count}))
`;
 const result=await promisify(execFile)(process.env.DOC_PYTHON||'python3',['-c',script,resolve('server/diarize.py')],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},maxBuffer:1024**2});
 const checked=JSON.parse(result.stdout);assert.deepEqual(checked.progress.map(step=>step[1]),[1,1,2,2]);assert.equal(checked.speakers,1);
});
test('PDF page limit stops before rendering',async()=>{let rendered=false;await assert.rejects(extractDocument({filePath:'/tmp/huge.pdf',fileName:'huge.pdf',fileId:'x',run:async(cmd:string):Promise<{stdout:string}>=>{if(cmd==='pdfinfo')return{stdout:'Pages: 101'};rendered=true;return{stdout:''}}}),/100/);assert.equal(rendered,false)});

test('Word text keeps stable source IDs without invented pages',async()=>{let engine='';const run=async(cmd:string)=>{engine=cmd;return{stdout:'Первый абзац про даты.\n\nВторой абзац про цены.'}};const first=await extractDocument({filePath:'/tmp/test.docx',fileName:'test.docx',fileId:'word',run});assert.equal(first.segments.length,2);assert.equal(first.segments[0].page,null);assert.equal(engine,process.env.DOC_PYTHON||'python3');const again=await extractDocument({filePath:'/tmp/test.docx',fileName:'test.docx',fileId:'word',run});assert.equal(first.segments[1].id,again.segments[1].id);await assert.rejects(extractDocument({filePath:'/tmp/broken.doc',fileName:'broken.doc',fileId:'broken',run:async()=>{throw new Error('bad file')}}),/Сохраните его как DOCX или PDF/)});

test('fractional recording duration produces valid integer subprocess timeouts for ASR and speakers',async()=>{
 const {transcribeRecording,detectSpeakers}=await import('./processing.ts');const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'mnema-timeout-'));const keys=['ASR_MODEL_DIR','ASR_DIARIZATION_DIR','ASR_DIARIZATION'];const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const timeouts:number[]=[];
 try{
  for(const name of ['model.bin','segmentation.onnx','embedding.onnx'])await writeFile(join(dir,name),'fixture');process.env.ASR_MODEL_DIR=dir;process.env.ASR_DIARIZATION_DIR=dir;process.env.ASR_DIARIZATION='1';
  const run=async(cmd:string,args:string[],options:any)=>{assert(Number.isSafeInteger(options.timeout));assert(options.timeout>0);timeouts.push(options.timeout);if(cmd==='ffprobe')return{stdout:JSON.stringify({format:{duration:2049.14392,format_name:'webm'}})};if(args[0]?.endsWith('transcribe.py'))await writeFile(args[2],JSON.stringify({segments:[{time:0,end:2,speaker:'Запись',text:'Fixture speech'}]}));if(args[0]?.endsWith('diarize.py'))await writeFile(args[3],JSON.stringify({speakers:{s:'Спикер 1'},count:1,engine:'fixture'}));return{stdout:''}};
  const result=await transcribeRecording({filePath:'fixture.webm',fileId:'fixture',run});assert.equal(result.segments.length,1);assert(timeouts.includes(10245720));
  const speakers=await detectSpeakers({filePath:'fixture.webm',segments:[{id:'s',time:0,end:2,speaker:'Запись',text:'Fixture speech'}],run});assert.equal(speakers.count,1);
 }finally{for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key]}await rm(dir,{recursive:true,force:true})}
});
