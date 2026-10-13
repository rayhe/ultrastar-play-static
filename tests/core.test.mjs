import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {parseSong,decodeSong,noteAt,midiName,phraseAt,formatTime} from '../src/song.js';
import {detectPitch,pitchDistance} from '../src/pitch.js';
import {Scorer} from '../src/scoring.js';
import {normalizePath,resolveLocalFile,safeRemoteUrl} from '../src/library.js';
import {readZip,crc32} from '../src/zip.js';
import {createDemo,makeDemoAudio} from '../src/demo.js';
const chart=(body,extra='')=>`#TITLE:Test\n#ARTIST:Test artist\n#BPM:120\n${extra}${body}\nE\n`;
const parse=(body,extra='')=>parseSong(chart(body,extra));
const near=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b} ±${epsilon}`);

test('TXT BPM uses four ticks, GAP is milliseconds, C4=60',()=>{const s=parse(': 0 4 0 Hello','#GAP:1500\n');near(s.voices[0].notes[0].start,1.5);near(s.voices[0].notes[0].end,2);assert.equal(s.voices[0].notes[0].midi,60);});
test('UTF-8 BOM, CRLF, comma decimal BPM, and exact lyric spaces',()=>{const s=parseSong('\uFEFF#TITLE:T\r\n#ARTIST:A\r\n#BPM:120,0\r\n: 0 4 0  two spaces  \r\nE');assert.equal(s.voices[0].notes[0].text,' two spaces  ');near(s.lastNote,.5);});
test('empty lyrics accepted; ~ hides in phrase text',()=>{const s=parse(': 0 4 0\n: 4 4 2 ~');assert.equal(s.voices[0].notes[0].text,'');assert.equal(s.voices[0].phrases[0].text,'');});
test('MP3 and AUDIO aliases, new AUDIO preferred',()=>{const s=parse(': 0 4 0 La','#MP3:old.mp3\n#AUDIO:new.mp3\n');assert.equal(s.audioName,'new.mp3');});
test('negative note beats remain valid before the GAP',()=>near(parse(': -4 4 -12 La','#GAP:1000\n').voices[0].notes[0].start,.5));
test('legacy START and VIDEOGAP are seconds, END is milliseconds',()=>{const s=parse(': 0 4 0 La','#START:1.5\n#END:10000\n#VIDEOGAP:-0.5\n');near(s.start,1.5);near(s.end,10);near(s.videoGap,-.5);});
test('v2 START and VIDEOGAP are milliseconds',()=>{const s=parse(': 0 4 0 La','#VERSION:2.0.0\n#START:1500\n#VIDEOGAP:500\n');near(s.start,1.5);near(s.videoGap,.5);});
test('relative timings accumulate from previous note start as upstream Play does',()=>{const s=parse(': 0 4 0 One\n: 4 4 2 two\n: 4 4 4 three','#RELATIVE:yes\n');assert.deepEqual(s.voices[0].notes.map(n=>n.beat),[0,4,8]);});
test('relative phrase break with two values uses the same preceding base',()=>{const s=parse(': 4 4 0 A\n- 8 16\n: 0 4 2 B','#RELATIVE:true\n');assert.deepEqual(s.voices[0].notes.map(n=>n.beat),[4,20]);});
test('absolute duet sections keep separate timelines',()=>{const s=parse('P 1\n: 0 4 0 First\nP2\n: 0 4 7 Second','#P1:Alice\n#DUETSINGERP2:Bob\n');assert.deepEqual(s.voices.map(v=>v.name),['Alice','Bob']);near(s.voices[1].notes[0].start,0);});
test('rejects ambiguous extra players rather than silently mis-scoring',()=>assert.throws(()=>parse('P3\n: 0 4 0 La'),/Only P1 and P2/));
test('tempo changes integrate timing across boundaries',()=>{const s=parse(': 0 8 0 La\nB 4 60\n: 8 4 0 la');near(s.voices[0].notes[0].end,1.5);near(s.lastNote,2.5);});
test('relative + tempo extension rejected explicitly',()=>assert.throws(()=>parse('B 0 60\n: 0 4 0 La','#RELATIVE:yes\n'),/unsupported/));
test('all five note types recognized',()=>assert.deepEqual(parse(': 0 1 0 a\n* 1 1 0 b\nF 2 1 0 c\nR 3 1 0 d\nG 4 1 0 e').voices[0].notes.map(n=>n.type),[':','*','F','R','G']));
test('overlapping notes rejected with line information',()=>assert.throws(()=>parse(': 0 8 0 A\n: 4 4 0 B'),/Line.*Overlapping/));
test('zero length and invalid pitch rejected',()=>{assert.throws(()=>parse(': 0 0 0 x'),/out of range/);assert.throws(()=>parse(': 0 4 999 x'),/out of range/);});
test('invalid BPM is not silently defaulted',()=>{assert.throws(()=>parseSong(chart(': 0 4 0 A').replace('120','0')),/BPM/);assert.throws(()=>parseSong(chart(': 0 4 0 A').replace('#BPM:120\n','')),/Missing/);});
test('unknown instructions rejected',()=>assert.throws(()=>parse('X 0 4 0 hi'),/Line/));
test('missing artist/title and empty song rejected',()=>{assert.throws(()=>parseSong('#BPM:120\nE'),/TITLE/);assert.throws(()=>parse(''),/no notes/);});
test('future chart versions rejected',()=>assert.throws(()=>parse(': 0 4 0 x','#VERSION:3.0\n'),/newer than/));
test('END before START rejected',()=>assert.throws(()=>parse(': 0 4 0 x','#START:20\n#END:1000\n'),/END/));
test('missing E warns but does not discard notes',()=>assert.ok(parseSong(chart(': 0 4 0 La').replace('\nE\n','')).warnings.some(w=>w.includes('Missing E'))));
test('line endings, note lookup, phrase breaks, musical names',()=>{const s=parse(': 0 4 0 A\n- 6\n: 8 4 2 B');assert.equal(noteAt(s.voices[0].notes,.2).text,'A');assert.equal(noteAt(s.voices[0].notes,.5),null);assert.equal(phraseAt(s.voices[0],.8).phrase.text,'B');assert.equal(midiName(69),'A4');assert.equal(midiName(null),'—');assert.equal(formatTime(125),'2:05');});
test('UTF-8 and explicit CP1252 decoding',()=>{assert.equal(decodeSong(new TextEncoder().encode('Björk').buffer),'Björk');const bytes=Uint8Array.from([...new TextEncoder().encode('#ENCODING:CP1252\n'),0xe9]);assert.ok(decodeSong(bytes.buffer).endsWith('é'));});
test('UTF16 BOM decoding',()=>{assert.equal(decodeSong(Uint8Array.from([0xff,0xfe,0x41,0,0x42,0]).buffer),'AB');});

function sine(frequency,{amplitude=.5,rate=16000,size=1024,harmonic=0}={}){return Float32Array.from({length:size},(_,i)=>amplitude*Math.sin(2*Math.PI*frequency*i/rate)+harmonic*Math.sin(4*Math.PI*frequency*i/rate));}
for(const frequency of [65.41,82.41,110,220,440,880,1046.5])test(`pitch detector tracks ${frequency} Hz`,()=>{const p=detectPitch(sine(frequency),16000);assert.ok(p.frequency);assert.ok(Math.abs(1200*Math.log2(p.frequency/frequency))<8,JSON.stringify(p));assert.ok(p.confidence>.9);});
test('harmonic-rich voice fundamental',()=>{const p=detectPitch(sine(220,{amplitude:.6,harmonic:.8}),16000);assert.ok(Math.abs(p.frequency-220)<2);});
test('silence and DC rejected',()=>{assert.equal(detectPitch(new Float32Array(1024),16000).midi,null);assert.equal(detectPitch(new Float32Array(1024).fill(.5),16000).midi,null);});
test('quiet signal below gate rejected',()=>assert.equal(detectPitch(sine(440,{amplitude:.001}),16000).midi,null));
test('aperiodic noise rejected',()=>{let seed=42;const samples=Float32Array.from({length:1024},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/2**32-.5;});assert.equal(detectPitch(samples,16000).midi,null);});
test('nonfinite and empty samples rejected',()=>{assert.equal(detectPitch(new Float32Array([NaN,NaN]),16000).midi,null);assert.equal(detectPitch(new Float32Array(),16000).midi,null);});
test('octave distance and semitone boundary',()=>{near(pitchDistance(60,72),0);near(pitchDistance(60,72,false),12);near(pitchDistance(60,71.8),.2);assert.equal(pitchDistance(null,60),Infinity);});

const note=(id,type,start,end,midi=60)=>({id,type,start,end,midi});
const good={midi:60,confidence:.99,rms:.1};
function singAll(scorer,pitch=good){for(let i=1;i<=100;i++)scorer.sample(i/100,pitch,.01);return scorer.snapshot();}
test('perfect pitch earns 10000',()=>assert.equal(singAll(new Scorer([note(1,':',0,1)])).score,10000));
test('silence never earns points',()=>assert.equal(singAll(new Scorer([note(1,':',0,1)]),{midi:null,confidence:0,rms:0}).score,0));
test('wrong pitch earns zero',()=>assert.equal(singAll(new Scorer([note(1,':',0,1)]),{...good,midi:64}).score,0));
test('easy, normal, and hard pitch tolerance',()=>{assert.equal(singAll(new Scorer([note(1,':',0,1)],{difficulty:'easy'}),{...good,midi:60.7}).score,10000);assert.equal(singAll(new Scorer([note(1,':',0,1)],{difficulty:'normal'}),{...good,midi:60.7}).score,0);assert.equal(singAll(new Scorer([note(1,':',0,1)],{difficulty:'hard'}),{...good,midi:60.3}).score,0);});
test('octave flexibility is configurable',()=>{assert.equal(singAll(new Scorer([note(1,':',0,1)]),{...good,midi:72}).score,10000);assert.equal(singAll(new Scorer([note(1,':',0,1)],{octaveInvariant:false}),{...good,midi:72}).score,0);});
test('golden duration contributes double',()=>{const s=new Scorer([note(1,':',0,.5),note(2,'*',.5,1)]);for(let i=51;i<=100;i++)s.sample(i/100,good,.01);assert.equal(s.snapshot().score,6667);});
test('freestyle excluded from score denominator',()=>{const s=new Scorer([note(1,'F',0,.5),note(2,':',.5,1)]);assert.equal(singAll(s).score,10000);});
test('rap scores vocal activity without a stable pitch',()=>assert.equal(singAll(new Scorer([note(1,'R',0,1)]),{midi:null,confidence:0,rms:.1}).score,10000));
test('duplicate samples cannot award points twice',()=>{const s=new Scorer([note(1,':',0,1)]);singAll(s);singAll(s);assert.equal(s.snapshot().score,10000);near(s.hit,1);});
test('large sample gaps are capped instead of awarding stale pitch',()=>{const s=new Scorer([note(1,':',0,1)]);s.sample(1,good,1);assert.ok(s.snapshot().score<=800);});
test('out of order samples cannot change scored history',()=>{const s=new Scorer([note(1,':',0,1)]);s.sample(.5,good,.05);const before=s.hit;s.sample(.48,good,.02);near(s.hit,before);});
test('low-confidence pitched noise receives no points',()=>assert.equal(singAll(new Scorer([note(1,':',0,1)]),{...good,confidence:.2}).score,0));

test('folder matching is case-insensitive and preserves directories',()=>{const entries=[{path:'Set/A/song.MP3',file:1},{path:'Set/B/song.mp3',file:2}];assert.equal(resolveLocalFile(entries,'Set/A/chart.txt','SONG.mp3').file,1);});
test('ambiguous filename fallback refuses to attach wrong track',()=>assert.equal(resolveLocalFile([{path:'A/a.mp3'},{path:'B/a.mp3'}],'C/chart.txt','a.mp3'),null));
test('unambiguous multi-file fallback',()=>assert.equal(resolveLocalFile([{path:'music.wav',file:3}],'chart.txt','music.wav').file,3));
test('local path normalization and traversal guard',()=>{assert.equal(normalizePath('Songs\\A/./track.wav'),'Songs/A/track.wav');assert.equal(normalizePath('Songs/A/../track.wav'),'Songs/track.wav');assert.throws(()=>normalizePath('../../secret'),/escapes/);});
test('chart cannot load an external URL during local import',()=>assert.equal(resolveLocalFile([],'song.txt','https://example.com/music.mp3'),null));
test('remote URL rejects javascript/data/credential URLs',()=>{assert.throws(()=>safeRemoteUrl('javascript:alert(1)','https://example.com'),/HTTPS/);assert.throws(()=>safeRemoteUrl('data:audio/wav,x','https://example.com'),/HTTPS/);assert.throws(()=>safeRemoteUrl('https://name:password@example.com/x','https://example.com'),/Credentials/);});

function zip(name,content,{deflate=false,crcBad=false,method=null}={}){
  const body=Buffer.from(content),encoded=Buffer.from(name),packed=deflate?deflateRawSync(body):body,crc=crc32(body)+(crcBad?1:0),m=method??(deflate?8:0);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(m,8);local.writeUInt32LE(crc>>>0,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(encoded.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(m,10);central.writeUInt32LE(crc>>>0,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(encoded.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+encoded.length,12);end.writeUInt32LE(local.length+encoded.length+packed.length,16);
  return new File([local,encoded,packed,central,encoded,end],'test.zip');
}
test('ZIP stored entries preserve content and UTF8 names',async()=>{const result=await readZip(zip('Tést/song.txt','hello'));assert.equal(result[0].path,'Tést/song.txt');assert.equal(await result[0].file.text(),'hello');});
test('ZIP deflate entries expand with native API',async()=>{const result=await readZip(zip('song.txt','hello '.repeat(100),{deflate:true}));assert.equal(await result[0].file.text(),'hello '.repeat(100));});
test('ZIP path traversal rejected',async()=>assert.rejects(()=>readZip(zip('../song.txt','x')),/Unsafe/));
test('ZIP CRC corruption rejected',async()=>assert.rejects(()=>readZip(zip('song.txt','x',{crcBad:true})),/checksum/));
test('invalid ZIP rejected',async()=>assert.rejects(()=>readZip(new File(['nope'],'x.zip')),/valid ZIP/));
test('unsupported ZIP compression rejected',async()=>assert.rejects(()=>readZip(zip('song.txt','x',{method:99})),/Unsupported/));
test('procedural demo generates a playable WAV header and original chart',async()=>{const demo=createDemo();assert.equal(demo.chart.voices[0].notes.length,16);const wav=makeDemoAudio(demo.chart),buffer=await wav.arrayBuffer();assert.equal(new TextDecoder().decode(buffer.slice(0,4)),'RIFF');assert.equal(new TextDecoder().decode(buffer.slice(8,12)),'WAVE');assert.ok(buffer.byteLength>100000);});
