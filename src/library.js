import {parseSong,decodeSong} from './song.js';
import {readZip} from './zip.js';
const MEDIA={'.mp3':'audio/mpeg','.ogg':'audio/ogg','.opus':'audio/ogg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.flac':'audio/flac','.mp4':'video/mp4','.m4v':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.avif':'image/avif'};
const ext=path=>path.toLowerCase().match(/\.[^.\/]+$/)?.[0]||'';
export function normalizePath(path) {
  const out=[];for(const s of String(path).replace(/\\/g,'/').split('/')){if(s==='..'){if(!out.length)throw Error('Media path escapes imported folder.');out.pop();}else if(s&&s!=='.')out.push(s);}
  return out.join('/').normalize('NFC');
}
const key=p=>normalizePath(p).toLowerCase();
export function resolveLocalFile(entries,chartPath,name) {
  if(!name)return null;
  if(/^[a-z][a-z\d+.-]*:|^\/\//i.test(name))return null;
  const dir=chartPath.includes('/')?chartPath.slice(0,chartPath.lastIndexOf('/')+1):'';
  const desired=key(dir+name),exact=entries.filter(e=>key(e.path)===desired);
  if(exact.length===1)return exact[0];if(exact.length>1)throw Error(`Ambiguous duplicate media path: ${name}`);
  const basename=key(name).split('/').at(-1),matches=entries.filter(e=>key(e.path).split('/').at(-1)===basename);
  return matches.length===1?matches[0]:null;
}
export async function songId(text,extra='') {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text+'\n'+extra));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,24);
}
export async function collectFiles(fileList) {
  const entries=[];
  for(const file of Array.from(fileList)){
    if(file.name.toLowerCase().endsWith('.zip'))entries.push(...await readZip(file));
    else entries.push({path:normalizePath(file.webkitRelativePath||file.name),file});
  }
  if(entries.length>20000)throw Error('Import at most 20,000 files at once.');
  return entries;
}
export async function droppedEntries(items) {
  // Capture handles synchronously: DataTransfer access expires after the event.
  const roots=Array.from(items).map(item=>({entry:item.webkitGetAsEntry?.(),file:item.getAsFile()}));
  const out=[];
  async function walk(entry) {
    if(out.length>20000)throw Error('Import at most 20,000 files at once.');
    if(entry.isFile){const file=await new Promise((r,j)=>entry.file(r,j));out.push({path:normalizePath(entry.fullPath),file});}
    else if(entry.isDirectory){const reader=entry.createReader();while(true){const batch=await new Promise((r,j)=>reader.readEntries(r,j));if(!batch.length)break;for(const child of batch)await walk(child);}}
  }
  for(const root of roots){if(root.entry)await walk(root.entry);else if(root.file)out.push({path:root.file.name,file:root.file});}
  const expanded=[];for(const e of out){if(ext(e.path)==='.zip')expanded.push(...await readZip(e.file));else expanded.push(e);}return expanded;
}
export async function importEntries(entries) {
  const charts=entries.filter(e=>ext(e.path)==='.txt'&&!e.path.startsWith('__MACOSX/'));
  if(!charts.length)throw Error('Select an UltraStar .txt chart together with its audio file, or open a song folder/ZIP.');
  const songs=[],errors=[];
  for(const entry of charts){
    try{
      if(entry.file.size>2_000_000)throw Error('Chart exceeds 2 MB.');
      const text=decodeSong(await entry.file.arrayBuffer()),chart=parseSong(text,entry.path);
      const files={};
      for(const [role,name] of Object.entries({audio:chart.audioName,instrumental:chart.instrumentalName,cover:chart.coverName,background:chart.backgroundName,video:chart.videoName})){
        const match=resolveLocalFile(entries,entry.path,name);
        if(match)files[role]={path:match.path,file:match.file};else if(name)chart.warnings.push(`Missing ${role}: ${name}`);
      }
      const id=await songId(text,entry.path+'|'+(files.audio?.file.size||0));
      songs.push({id,text,chart,files,source:'local',saved:false,urls:{}});
    }catch(e){errors.push(`${entry.path}: ${e.message}`);}
  }
  return {songs,errors};
}
export function mediaUrl(song,role) {
  if(song.urls[role])return song.urls[role];
  const entry=song.files?.[role];if(!entry)return '';
  const mime=MEDIA[ext(entry.path)]||entry.file.type||'application/octet-stream';
  song.urls[role]=URL.createObjectURL(entry.file.slice(0,entry.file.size,mime));return song.urls[role];
}
export function revokeSong(song){Object.values(song.urls||{}).forEach(url=>{if(url.startsWith('blob:'))URL.revokeObjectURL(url);});song.urls={};}
export function safeRemoteUrl(value,base) {
  const url=new URL(value,base);
  const local=typeof location!=='undefined'&&url.origin===location.origin;
  if(url.protocol!=='https:'&&!(local&&url.protocol==='http:'))throw Error('Remote media must use HTTPS.');
  if(url.username||url.password)throw Error('Credentials in media URLs are not allowed.');return url.href;
}
async function boundedText(response,maxBytes) {
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const reader=response.body.getReader();let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw Error('Remote text exceeds size limit.');}chunks.push(value);}}finally{reader.releaseLock();}
  const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}return decodeSong(data.buffer);
}
export async function loadCatalog(catalogUrl=new URL('../songs/catalog.json',import.meta.url)) {
  const catalog=JSON.parse(await boundedText(await fetch(catalogUrl,{signal:AbortSignal.timeout(12000)}),2_000_000));
  const records=Array.isArray(catalog)?catalog:catalog.songs;
  if(!Array.isArray(records)||records.length>1000)throw Error('Catalog must contain a songs array (at most 1000 charts).');
  const songs=[],errors=[];
  // Small sequential loads avoid a burst of requests for catalog-hosted charts.
  for(const record of records){
    try{
      const chartReference=typeof record==='string'?record:record?.chart;
      if(typeof chartReference!=='string'||!chartReference.trim())throw Error('Each catalog record needs a chart URL.');
      const chartUrl=safeRemoteUrl(chartReference,catalogUrl);
      const text=await boundedText(await fetch(chartUrl,{signal:AbortSignal.timeout(12000)}),2_000_000),chart=parseSong(text,chartUrl);
      const urls={};
      for(const [role,name] of Object.entries({audio:chart.audioName,instrumental:chart.instrumentalName,cover:chart.coverName,background:chart.backgroundName,video:chart.videoName})){
        if(record&&typeof record==='object'&&record[role]){
          if(typeof record[role]!=='string')throw Error(`Invalid ${role} URL.`);
          urls[role]=safeRemoteUrl(record[role],catalogUrl);
        }else if(name){const value=/^https:\/\//i.test(name)?name:name.replace(/\\/g,'/').split('/').map(encodeURIComponent).join('/');urls[role]=safeRemoteUrl(value,chartUrl);}
      }
      songs.push({id:await songId(text,chartUrl),text,chart,urls,files:{},source:'catalog',saved:false});
    }catch(e){errors.push(`Catalog chart: ${e.message}`);}
  }
  return {songs,errors};
}
let database;
async function db() {
  if(!globalThis.indexedDB)throw Error('Browser storage is unavailable. Songs can still be used for this session.');
  if(!database)database=new Promise((resolve,reject)=>{const r=indexedDB.open('ultrastar-static-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('songs',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  return database;
}
async function transaction(mode,operation) {
  const database=await db();return new Promise((resolve,reject)=>{const t=database.transaction('songs',mode);let request;try{request=operation(t.objectStore('songs'));}catch(e){reject(e);return;}t.oncomplete=()=>resolve(request?.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('Storage transaction aborted.'));});
}
export async function saveSong(song) {if(song.source!=='local')return;await transaction('readwrite',s=>s.put({id:song.id,text:song.text,sourceName:song.chart.sourceName,files:song.files}));song.saved=true;}
export async function savedSongs(){const rows=await transaction('readonly',s=>s.getAll());const out=[];for(const row of rows){try{out.push({...row,chart:parseSong(row.text,row.sourceName),source:'local',saved:true,urls:{}});}catch{ /* Do not let one old/corrupt chart break the library. */ }}return out;}
export const deleteSaved=id=>transaction('readwrite',s=>s.delete(id));
export const clearSaved=()=>transaction('readwrite',s=>s.clear());
