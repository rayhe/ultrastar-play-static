import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {detectPitch} from '../src/pitch.js';
import {parseSong} from '../src/song.js';
import {Scorer} from '../src/scoring.js';
import {loadCatalog,importEntries,mediaUrl,revokeSong} from '../src/library.js';
import {Microphone} from '../src/microphone.js';

const source=await readFile(new URL('../src/capture-worklet.js',import.meta.url),'utf8');
function captured(rate=48000,frequency=440,duration=2,amplitude=.35){
  const frames=[];let Processor;
  const sandbox={sampleRate:rate,currentFrame:0,Float32Array,Math,
    AudioWorkletProcessor:class{constructor(){this.port={onmessage:null,postMessage:data=>frames.push(data)};}},
    registerProcessor:(name,impl)=>{assert.equal(name,'pitch-capture');Processor=impl;}};
  vm.runInNewContext(source,sandbox,{filename:'capture-worklet.js'});
  const processor=new Processor();
  for(let offset=0;offset<rate*duration;offset+=128){sandbox.currentFrame=offset;const input=Float32Array.from({length:128},(_,i)=>amplitude*Math.sin(2*Math.PI*frequency*(offset+i)/rate));const output=new Float32Array(128).fill(1);assert.equal(processor.process([[input]],[[output]]),true);assert.ok(output.every(v=>v===0));}
  return {frames,processor};
}
for(const rate of [44100,48000,96000])test(`worklet simulation at ${rate} Hz: windows, timestamps, pitch and silence output`,()=>{
  const {frames}=captured(rate);assert.ok(frames.length>55&&frames.length<70);
  for(let i=0;i<frames.length;i++){
    const f=frames[i];assert.equal(f.samples.length,1024);assert.equal(f.sequence,i);assert.ok(f.sampleRate>=14000&&f.sampleRate<=22050);
    if(i>0)assert.ok(Math.abs((f.time-frames[i-1].time)-.03)<.001);
    const pitch=detectPitch(f.samples,f.sampleRate);assert.ok(Math.abs(pitch.frequency-440)<2);
  }
  assert.ok(frames[0].time>0&&frames[0].time<.05);
});
test('capture worklet stops on an explicit stop message',()=>{const {processor}=captured(48000,440,.1);processor.port.onmessage({data:'stop'});assert.equal(processor.process([],[]),false);});
test('capture worklet tolerates temporarily empty input',()=>{const {processor}=captured(48000,440,.1);assert.equal(processor.process([],[[new Float32Array(128)]]),true);});
test('simulated capture -> detector -> scorer gives near-perfect A4 without guide-note injection',()=>{
  const chart=parseSong('#TITLE:A4\n#ARTIST:Test\n#BPM:120\n#GAP:200\n: 0 12 9 Ah\nE');
  const scorer=new Scorer(chart.voices[0].notes);const {frames}=captured();let previous=null;
  for(const f of frames){const pitch=detectPitch(f.samples,f.sampleRate);scorer.sample(f.time,pitch,previous===null?.03:f.time-previous);previous=f.time;}
  assert.ok(scorer.snapshot().score>9900,JSON.stringify(scorer.snapshot()));
});
test('simulated silent capture -> detector -> scorer yields zero',()=>{
  const chart=parseSong('#TITLE:A4\n#ARTIST:Test\n#BPM:120\n#GAP:200\n: 0 12 9 Ah\nE');const scorer=new Scorer(chart.voices[0].notes);
  for(const f of captured(48000,440,2,0).frames)scorer.sample(f.time,detectPitch(f.samples,f.sampleRate));
  assert.equal(scorer.snapshot().score,0);
});
test('pitch Worker message contract retains capture timestamp and sequence',async()=>{
  let listener,result;const code=await readFile(new URL('../src/pitch-worker.js',import.meta.url),'utf8');
  const sandbox={detectPitch,self:{postMessage:data=>{result=data;}}};
  vm.runInNewContext(code.replace(/^import[^\n]+\n/,''),sandbox);
  listener=sandbox.self.onmessage||sandbox.onmessage;
  const input=captured().frames[5];listener({data:{...input,noiseGate:.004}});
  assert.equal(result.time,input.time);assert.equal(result.sequence,input.sequence);assert.ok(Math.abs(result.midi-69)<.1);
});
const text='#TITLE:Catalog test\n#ARTIST:Test\n#BPM:120\n#AUDIO:my song.wav\n: 0 4 0 La\nE';
async function withFetch(fn,body){const old=globalThis.fetch;globalThis.fetch=fn;try{return await body();}finally{globalThis.fetch=old;}}
test('static catalog array and explicit audio/cover overrides use catalog-relative URLs',()=>withFetch(async url=>new Response(String(url).endsWith('.json')?JSON.stringify([{chart:'charts/song.txt',audio:'media/song.wav',cover:'https://media.example.org/art.jpg'}]):text),async()=>{
  const result=await loadCatalog('https://site.example.org/songs/catalog.json');assert.equal(result.errors.length,0);const s=result.songs[0];assert.equal(s.urls.audio,'https://site.example.org/songs/media/song.wav');assert.equal(s.urls.cover,'https://media.example.org/art.jpg');
}));
test('catalog chart-relative filename spaces are URL encoded',()=>withFetch(async url=>new Response(String(url).endsWith('.json')?JSON.stringify({songs:['./charts/song.txt']}):text),async()=>{const result=await loadCatalog('https://example.org/catalog.json');assert.equal(result.songs[0].urls.audio,'https://example.org/charts/my%20song.wav');}));
test('catalog invalid entries fail independently, unsafe media URLs rejected',()=>withFetch(async url=>new Response(String(url).endsWith('.json')?JSON.stringify({songs:[null,{}, {chart:'ok.txt',audio:'javascript:alert(1)'},'works.txt']}):text),async()=>{const result=await loadCatalog('https://example.org/catalog.json');assert.equal(result.errors.length,3);assert.equal(result.songs.length,1);}));
test('oversize catalog rejected before launching chart requests',()=>withFetch(async()=>new Response(JSON.stringify({songs:Array(1001).fill('x.txt')})),async()=>assert.rejects(loadCatalog('https://example.org/catalog.json'),/at most 1000/)));
test('local imports preserve media blobs and revoke cached object URLs',async()=>{
  const results=await importEntries([{path:'collection/song.txt',file:new Blob([text])},{path:'collection/my song.wav',file:new Blob(['data'])}]);assert.equal(results.errors.length,0);const s=results.songs[0],url=mediaUrl(s,'audio');assert.ok(url.startsWith('blob:'));assert.equal(mediaUrl(s,'audio'),url);revokeSong(s);assert.deepEqual(s.urls,{});
});

function fakeGraph({denied=false,moduleFailure=false}={}){
  const log=[];const track={label:'Synthetic test input',getSettings:()=>({deviceId:'fake1'}),stop:()=>log.push('track.stop'),onended:null};
  const node=()=>({connect(){log.push('connect');},disconnect(){log.push('disconnect');},port:{postMessage:()=>{},onmessage:null}});
  const context={resume:async()=>{},audioWorklet:{addModule:async()=>{if(moduleFailure)throw Error('module failed');}},createMediaStreamSource:()=>node(),createGain:()=>({...node(),gain:{value:1}}),destination:{}};
  const props={navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),Worker:Object.getOwnPropertyDescriptor(globalThis,'Worker'),AudioWorkletNode:Object.getOwnPropertyDescriptor(globalThis,'AudioWorkletNode')};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>{if(denied)throw Object.assign(Error('denied'),{name:'NotAllowedError'});return {getTracks:()=>[track],getAudioTracks:()=>[track]};}}}});
  globalThis.Worker=class{constructor(){this.onmessage=null;this.onerror=null;}postMessage(message){this.last=message;}terminate(){log.push('worker.terminate');}};
  globalThis.AudioWorkletNode=class{constructor(){Object.assign(this,node());}};
  return {context,log,track,restore:()=>{for(const [key,desc]of Object.entries(props)){if(desc)Object.defineProperty(globalThis,key,desc);else delete globalThis[key];}}};
}
test('microphone lifecycle contract: start, transfer to worker, drop backpressure, stop tracks',async()=>{
  const fake=fakeGraph();try{let received;const mic=new Microphone(fake.context,x=>{received=x;});assert.equal(await mic.start(),'Synthetic test input');assert.ok(mic.active);assert.equal(mic.deviceId,'fake1');
    const input={samples:new Float32Array(1024),time:1};mic.node.port.onmessage({data:input});assert.ok(mic.busy);const before=mic.worker.last;mic.node.port.onmessage({data:{...input,time:2}});assert.equal(mic.worker.last,before);mic.worker.onmessage({data:{midi:69}});assert.equal(received.midi,69);assert.equal(mic.busy,false);mic.stop();assert.ok(fake.log.includes('track.stop'));assert.ok(fake.log.includes('worker.terminate'));assert.equal(mic.active,false);
  }finally{fake.restore();}
});
test('microphone acquisition denial propagates without becoming active',async()=>{const fake=fakeGraph({denied:true});try{const mic=new Microphone(fake.context,()=>{});await assert.rejects(mic.start(),{name:'NotAllowedError'});assert.equal(mic.active,false);}finally{fake.restore();}});
test('microphone module failure releases acquired tracks',async()=>{const fake=fakeGraph({moduleFailure:true});try{const mic=new Microphone(fake.context,()=>{});await assert.rejects(mic.start(),/module failed/);assert.ok(fake.log.includes('track.stop'));assert.equal(mic.active,false);}finally{fake.restore();}});
test('device ending stops graph and notifies caller',async()=>{const fake=fakeGraph();try{let ended;const mic=new Microphone(fake.context,()=>{},message=>{ended=message;});await mic.start();fake.track.onended();assert.match(ended,/disconnected/);assert.equal(mic.active,false);}finally{fake.restore();}});
