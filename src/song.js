/**
 * UltraStar browser song model and parser. MIT.
 * Timing and relative-note behavior adapted from UltraStar Play; see NOTICE.md.
 * No Unity runtime or upstream art is included.
 */
export class SongParseError extends Error {
  constructor(message, line = 0) { super(`${line ? `Line ${line}: ` : ''}${message}`); this.name = 'SongParseError'; this.line = line; }
}
const numericPattern = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
function number(value, label, fallback) {
  if (value === undefined || value === '') { if (fallback !== undefined) return fallback; throw new SongParseError(`Missing ${label}.`); }
  if (!numericPattern.test(String(value).trim())) throw new SongParseError(`Invalid ${label}: ${value}`);
  const result = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(result)) throw new SongParseError(`Invalid ${label}.`);
  return result;
}
export function decodeSong(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const sample = new TextDecoder('windows-1252').decode(bytes.slice(0, 8192));
  let encoding = sample.match(/^#ENCODING:\s*([^\r\n]+)/im)?.[1]?.trim().toLowerCase();
  const aliases = {cp1250:'windows-1250', cp1252:'windows-1252', utf8:'utf-8', 'utf-8':'utf-8'};
  if (encoding && encoding !== 'auto') {
    encoding = aliases[encoding] || encoding;
    try { return new TextDecoder(encoding, {fatal:true}).decode(bytes); }
    catch { throw new SongParseError(`Cannot decode #ENCODING:${encoding}. Save the chart as UTF-8.`); }
  }
  try { return new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}
export function parseSong(text, sourceName = 'song.txt') {
  if (typeof text !== 'string' || text.length > 2_000_000) throw new SongParseError('Chart must be text, at most 2 MB.');
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const headers = Object.create(null), warnings = [];
  for (const raw of lines) {
    const match = raw.trimStart().match(/^#([^:]+):(.*)$/);
    if (match) {
      const key = match[1].trim().toUpperCase();
      if (Object.hasOwn(headers,key)) warnings.push(`Duplicate #${key}; using the last value.`);
      headers[key] = match[2].trim();
    }
  }
  if (!headers.TITLE || !headers.ARTIST) throw new SongParseError('Not an UltraStar chart: #TITLE and #ARTIST are required.');
  const bpm = number(headers.BPM, '#BPM');
  if (bpm < 1 || bpm > 10000) throw new SongParseError('#BPM must be between 1 and 10000.');
  const gap = number(headers.GAP ?? headers.AUDIOGAP, '#GAP', 0) / 1000;
  const modern = Number((headers.VERSION || '1').split('.')[0]) >= 2;
  if (Number((headers.VERSION || '1').split('.')[0]) > 2) throw new SongParseError('Chart version newer than 2.x is not supported.');
  const timeUnit = modern ? 0.001 : 1;
  const start = Math.max(0, number(headers.START, '#START', 0) * timeUnit);
  const end = headers.END ? number(headers.END, '#END') / 1000 : null;
  const videoGap = number(headers.VIDEOGAP, '#VIDEOGAP', 0) * timeUnit;
  const relative = /^(yes|true|1)$/i.test(headers.RELATIVE || '');
  const voices = new Map(); let current = '1', lastBeat = 0, foundEnd = false, noteCount = 0;
  const changes = [{beat:0, bpm}];
  function voice(id) {
    if (!voices.has(id)) voices.set(id,{id, name:headers[`P${id}`] || headers[`DUETSINGERP${id}`] || `Voice ${id}`, notes:[], phrases:[], pending:[]});
    return voices.get(id);
  }
  function flush(v, breakBeat = null) {
    if (!v.pending.length) return;
    v.phrases.push({id:`${v.id}-${v.phrases.length}`, notes:v.pending, breakBeat}); v.pending=[];
  }
  for (let i=0;i<lines.length;i++) {
    const line=lines[i].trimStart();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    if (/^E\s*$/.test(line)) { foundEnd=true; break; }
    const p=line.match(/^P\s*([12])\s*$/);
    if (p) { flush(voice(current)); current=p[1]; voice(current); continue; }
    if (/^P/.test(line)) throw new SongParseError('Only P1 and P2 duet sections are supported; split additional voices into separate charts.',i+1);
    if (line[0] === '-') {
      const m=line.match(/^-\s*(?:([+-]?\d+)(?:\s+([+-]?\d+))?)?\s*$/);
      if (!m) throw new SongParseError('Invalid phrase break.', i+1);
      const base=relative ? lastBeat : 0;
      const b=m[1] === undefined ? null : Number(m[1])+base;
      flush(voice(current), b);
      if(m[1] !== undefined) lastBeat=(m[2] === undefined ? Number(m[1]) : Number(m[2]))+base;
      continue;
    }
    const tempo=line.match(/^B\s+([+-]?\d+)\s+([\d.,]+)\s*$/);
    if (tempo) {
      if(relative) throw new SongParseError('Relative charts combined with B tempo changes are unsupported. Convert to absolute timings.',i+1);
      const b=Number(tempo[1]), value=number(tempo[2],'tempo');
      if(b<0 || value<1 || value>10000) throw new SongParseError('Invalid tempo change.',i+1);
      changes.push({beat:b,bpm:value}); continue;
    }
    const m=line.match(/^([:*FRG])\s+([+-]?\d+)\s+(\d+)\s+([+-]?\d+)(?:[ \t](.*))?$/);
    if(!m) throw new SongParseError('Expected a note (: * F R G), phrase break (-), P1/P2, or E.',i+1);
    const beat=Number(m[2])+(relative ? lastBeat : 0), length=Number(m[3]), pitch=Number(m[4]);
    if(length<=0 || length>1_000_000 || Math.abs(beat)>10_000_000 || pitch < -60 || pitch > 120) throw new SongParseError('Note timing or pitch is out of range.',i+1);
    lastBeat=beat;
    if (++noteCount>30000) throw new SongParseError('Chart exceeds 30,000 notes.');
    const note={id:noteCount, type:m[1], beat, length, pitch, midi:pitch+60, text:m[5] || '', line:i+1};
    voice(current).notes.push(note); voice(current).pending.push(note);
  }
  for(const v of voices.values()) flush(v);
  if(!noteCount) throw new SongParseError('Chart contains no notes.');
  if(!foundEnd) warnings.push('Missing E end marker.');
  // Last tempo declaration at a beat wins. UltraStar TXT BPM has four ticks per beat.
  const tempoMap=new Map(changes.map(c=>[c.beat,c.bpm]));
  const tempos=[...tempoMap].sort((a,b)=>a[0]-b[0]).map(([beat,bpm])=>({beat,bpm,seconds:0}));
  for(let i=1;i<tempos.length;i++) tempos[i].seconds=tempos[i-1].seconds+(tempos[i].beat-tempos[i-1].beat)*15/tempos[i-1].bpm;
  const secondsAt = beat => {
    let lo=0,hi=tempos.length-1;
    while(lo<hi) {const mid=Math.ceil((lo+hi)/2);if(tempos[mid].beat<=beat)lo=mid;else hi=mid-1;}
    const t=tempos[lo];return gap+t.seconds+(beat-t.beat)*15/t.bpm;
  };
  const resultVoices=[...voices.values()].filter(v=>v.notes.length);
  for(const v of resultVoices) {
    delete v.pending;
    v.notes.sort((a,b)=>a.beat-b.beat || a.id-b.id);
    for(let i=0;i<v.notes.length;i++) {
      const n=v.notes[i]; n.start=secondsAt(n.beat);n.end=secondsAt(n.beat+n.length);
      if(i && n.start<v.notes[i-1].end-0.0001) throw new SongParseError(`Overlapping notes in P${v.id}. Repair the chart before singing.`,n.line);
    }
    for(const p of v.phrases) {p.start=Math.min(...p.notes.map(n=>n.start));p.end=Math.max(...p.notes.map(n=>n.end));p.breakTime=p.breakBeat===null?p.end:Math.max(p.end,secondsAt(p.breakBeat));p.text=p.notes.map(n=>n.text.replace(/~/g,'')).join('');}
    v.phrases.sort((a,b)=>a.start-b.start);
  }
  const lastNote=Math.max(...resultVoices.map(v=>v.notes.at(-1).end));
  if(lastNote>7200) throw new SongParseError('Charts longer than two hours are unsupported. Check #BPM.');
  if(end!==null && end<=start) throw new SongParseError('#END must be later than #START.');
  if(end!==null && end<lastNote) warnings.push('#END cuts off chart notes; this run will be treated as practice.');
  if(start>Math.min(...resultVoices.map(v=>v.notes[0].start))) warnings.push('#START skips chart notes; this run will be treated as practice.');
  const ignored=['MEDLEYSTARTBEAT','MEDLEYENDBEAT','MEDLEYSTART','MEDLEYEND','VOCALS','VOCALSAUDIO'];
  for(const k of ignored) if(headers[k]) warnings.push(`#${k} is preserved in the editor but not used for playback.`);
  return {title:headers.TITLE,artist:headers.ARTIST,bpm,gap,start,end,videoGap,headers,tempos,relative,voices:resultVoices,warnings,lastNote,sourceName,text,
    audioName:headers.AUDIO || headers.MP3 || '', instrumentalName:headers.INSTRUMENTAL || headers.INSTRUMENTALAUDIO || '',
    coverName:headers.COVER || '', backgroundName:headers.BACKGROUND || '', videoName:headers.VIDEO || '',
    language:headers.LANGUAGE || 'Unknown', genre:headers.GENRE || 'Karaoke'};
}
export function noteAt(notes, time) {
  let lo=0,hi=notes.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(notes[mid].start<=time)lo=mid+1;else hi=mid;}
  const n=notes[lo-1];return n && time<n.end ? n : null;
}
export function phraseAt(voice,time) {
  const phrases=voice.phrases;
  if(!phrases.length)return null;
  let index=phrases.findIndex((p,i)=>time<Math.max(p.end,Math.min(p.breakTime,phrases[i+1]?.start ?? Infinity)));
  if(index<0)index=phrases.length-1;
  return {phrase:phrases[index],next:phrases[index+1] || null,index};
}
export function midiName(midi) {
  if(!Number.isFinite(midi))return '—';
  const n=Math.round(midi);return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((n%12)+12)%12]+(Math.floor(n/12)-1);
}
export function formatTime(seconds) {
  seconds=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}
