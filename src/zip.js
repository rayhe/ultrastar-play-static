/** Minimal bounded ZIP reader for local song packages. MIT. No network or eval. */
const MAX_TOTAL=256*1024*1024, MAX_FILES=4000;
const crcTable=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
export function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function safePath(path) {
  const p=String(path).replace(/\\/g,'/');
  if(p.startsWith('/')||/^[A-Za-z]:/.test(p)||p.includes('\0')||p.split('/').includes('..'))throw Error(`Unsafe archive path: ${path}`);
  return p.split('/').filter(s=>s&&s!=='.').join('/');
}
async function inflateBounded(bytes,size) {
  let transform;try{transform=new DecompressionStream('deflate-raw');}catch{throw Error('ZIP decompression is unavailable in this browser. Extract the ZIP first, then use Open folder.');}
  const reader=new Blob([bytes]).stream().pipeThrough(transform).getReader();
  let length=0;const chunks=[];
  try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>size||length>MAX_TOTAL){await reader.cancel();throw Error('ZIP expands beyond its declared size.');}chunks.push(value);}}finally{reader.releaseLock();}
  const out=new Uint8Array(length);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return out;
}
export async function readZip(file) {
  if(file.size>MAX_TOTAL)throw Error('ZIP exceeds the 256 MiB safety limit. Extract it and use Open folder instead.');
  const buffer=await file.arrayBuffer(),bytes=new Uint8Array(buffer),v=new DataView(buffer);
  let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){eocd=i;break;}
  if(eocd<0)throw Error('Not a valid ZIP archive.');
  const count=v.getUint16(eocd+10,true),directorySize=v.getUint32(eocd+12,true),directory=v.getUint32(eocd+16,true);
  if(v.getUint16(eocd+4,true)!==0||v.getUint16(eocd+6,true)!==0||v.getUint16(eocd+8,true)!==count)throw Error('Multi-disk ZIPs are unsupported.');
  if(count===65535||directory===0xffffffff||directorySize===0xffffffff)throw Error('ZIP64 is unsupported. Extract and import the folder.');
  if(count>MAX_FILES||directory+directorySize>eocd)throw Error('ZIP directory is too large or corrupt.');
  let pos=directory,total=0;const records=[],seen=new Set();
  for(let i=0;i<count;i++){
    if(pos+46>directory+directorySize||v.getUint32(pos,true)!==0x02014b50)throw Error('Corrupt ZIP directory.');
    const flags=v.getUint16(pos+8,true),method=v.getUint16(pos+10,true),crc=v.getUint32(pos+16,true),compressed=v.getUint32(pos+20,true),size=v.getUint32(pos+24,true),nameLength=v.getUint16(pos+28,true),extraLength=v.getUint16(pos+30,true),commentLength=v.getUint16(pos+32,true),offset=v.getUint32(pos+42,true);
    const next=pos+46+nameLength+extraLength+commentLength;if(next>directory+directorySize)throw Error('Truncated ZIP directory.');
    if(flags&1)throw Error('Password-protected ZIPs are unsupported.');
    if(compressed===0xffffffff||size===0xffffffff||offset===0xffffffff)throw Error('ZIP64 is unsupported.');
    let name;
    try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(pos+46,pos+46+nameLength));}
    catch{throw Error('ZIP filenames must use UTF-8. Extract and import the folder to preserve legacy filenames.');}
    const path=safePath(name);pos=next;
    if(name.endsWith('/')||!path||path.split('/').some(p=>p.startsWith('.'))||path.startsWith('__MACOSX/'))continue;
    if(seen.has(path.toLowerCase()))throw Error(`Duplicate ZIP path: ${path}`);seen.add(path.toLowerCase());
    total+=size;
    if(total>MAX_TOTAL||size>MAX_TOTAL||size>Math.max(1,compressed)*1000)throw Error('ZIP expansion exceeds safety limits. Extract and import the folder.');
    if(![0,8].includes(method))throw Error(`Unsupported ZIP compression method ${method}. Extract and import the folder.`);
    records.push({path,method,crc,compressed,size,offset});
  }
  const result=[];
  for(const r of records){
    if(r.offset+30>directory||v.getUint32(r.offset,true)!==0x04034b50)throw Error('Corrupt ZIP entry.');
    const begin=r.offset+30+v.getUint16(r.offset+26,true)+v.getUint16(r.offset+28,true),end=begin+r.compressed;
    if(end>directory)throw Error('ZIP entry points outside file data.');
    const content=r.method===0?bytes.slice(begin,end):await inflateBounded(bytes.subarray(begin,end),r.size);
    if(content.length!==r.size||crc32(content)!==r.crc)throw Error(`ZIP checksum failed: ${r.path}`);
    result.push({path:r.path,file:new File([content],r.path.split('/').at(-1))});
  }
  return result;
}
