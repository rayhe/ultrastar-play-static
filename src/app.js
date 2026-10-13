import {parseSong,phraseAt,midiName,formatTime} from './song.js';
import {Scorer} from './scoring.js';
import {Microphone} from './microphone.js';
import {NoteRenderer} from './renderer.js';
import {collectFiles,droppedEntries,importEntries,mediaUrl,revokeSong,savedSongs,saveSong,deleteSaved,clearSaved,loadCatalog,songId,resolveLocalFile} from './library.js';
import {createDemo,makeDemoAudio} from './demo.js';

const $=id=>document.getElementById(id);
const el=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
function readLocal(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function writeLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
function showDialog(id){if(!$(id).open)$(id).showModal();}
const audio=$('songAudio'),video=$('backgroundVideo'),renderer=new NoteRenderer($('noteCanvas'));
const songs=[createDemo()],queue=[];
const favorites=new Set(readLocal('usp-favorites',[]));
const scores=readLocal('usp-highscores',{});
let ctx=null,mics=[null,null],pitches=[null,null],run=null,optionSong=null,pendingSong=null,editingSong=null,preparing=0,busyImport=false,lastResult=null,animation=0;
let prefs={difficulty:'normal',latency:0,noiseGate:-48,octaveInvariant:true,playerName1:'Player one',playerName2:'Player two',rememberSongs:false,...readLocal('usp-settings',{})};
const preferenceKeys=['difficulty','latency','noiseGate','octaveInvariant','playerName1','playerName2','rememberSongs'];
for(const key of preferenceKeys){const input=$(key);if(input.type==='checkbox')input.checked=Boolean(prefs[key]);else input.value=prefs[key];}
function settings(){return {difficulty:['easy','normal','hard'].includes($('difficulty').value)?$('difficulty').value:'normal',latency:Math.max(-300,Math.min(600,Number($('latency').value)||0)),noiseGate:Math.max(-65,Math.min(-15,Number($('noiseGate').value)||-48)),octaveInvariant:$('octaveInvariant').checked,playerName1:$('playerName1').value.trim()||'Player one',playerName2:$('playerName2').value.trim()||'Player two',rememberSongs:$('rememberSongs').checked};}
function storeSettings(){prefs=settings();writeLocal('usp-settings',prefs);for(const mic of mics)if(mic)mic.noiseGate=10**(prefs.noiseGate/20);}
for(const key of preferenceKeys)$(key).addEventListener('change',storeSettings);
function context(){
  if(!ctx){const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)throw Error('Web Audio is unavailable in this browser.');ctx=new AudioContext({latencyHint:'interactive'});ctx.onstatechange=()=>{if(ctx.state!=='running'&&run?.playing){pauseSong();toast('Audio was interrupted. Resume the song when you are ready.');}};}
  return ctx;
}
const activeSlots=()=>mics.map((m,i)=>m?.active?i:-1).filter(i=>i>=0);
function micError(message){$('micError').textContent=message;}
function updateMicLabels(){
  $('micCount').textContent=String(activeSlots().length);
  for(let i=0;i<2;i++){$(`connect${i+1}`).textContent=mics[i]?.active?'Disconnect microphone':'Connect microphone';if(!mics[i]?.active){$(`pitch${i+1}`).textContent='Not connected';$(`meter${i+1}`).value=0;}}
}
async function refreshDevices(){
  if(!navigator.mediaDevices?.enumerateDevices)return;
  const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');
  for(let i=0;i<2;i++){
    const select=$(`device${i+1}`),previous=select.value;select.replaceChildren();const option=el('option','',i===0?'System default':'Choose a different input');option.value='';select.append(option);
    for(const d of devices){const o=el('option','',d.label||`Microphone ${select.options.length}`);o.value=d.deviceId;select.append(o);}
    if([...select.options].some(o=>o.value===previous))select.value=previous;
  }
}
function onPitch(slot,pitch){
  pitch.received=performance.now();pitches[slot]=pitch;
  if(!run?.playing||run.finished||audio.paused||audio.readyState<3||pitch.time<(run.captureCutoff??0))return;
  const player=run.players.find(p=>p.slot===slot);if(!player?.scorer)return;
  const age=ctx.currentTime-pitch.time;if(age<-.02||age>.5)return;
  const time=audio.currentTime-age*audio.playbackRate-run.settings.latency/1000;
  const span=player.lastSample === null ? .03 : Math.max(0,Math.min(.08,time-player.lastSample));
  player.scorer.sample(time,pitch,span);player.lastSample=time;player.pitch=pitch;
  player.history.push({time,midi:pitch.midi});if(player.history.length>160)player.history.splice(0,player.history.length-160);
}
async function toggleMicrophone(slot){
  const button=$(`connect${slot+1}`);micError('');button.disabled=true;
  try{
    if(mics[slot]?.active){mics[slot].stop();pitches[slot]=null;return;}
    storeSettings();
    if(slot===1&&!$(`device${slot+1}`).value)throw Error('Select a separate microphone for player two. One mixed input cannot distinguish two singers.');
    const mic=new Microphone(context(),p=>onPitch(slot,p),message=>{if(run&&!run.finished){run.eligible=false;updateMode();pauseSong();}updateMicLabels();toast(message);});
    mics[slot]=mic;mic.noiseGate=10**(prefs.noiseGate/20);
    const label=await mic.start($(`device${slot+1}`).value);
    const other=mics[1-slot];
    if(other?.active&&other.deviceId===mic.deviceId){mic.stop();throw Error('Both players selected the same physical microphone. Choose two different inputs.');}
    await refreshDevices();if([...$(`device${slot+1}`).options].some(o=>o.value===mic.deviceId))$(`device${slot+1}`).value=mic.deviceId;
    toast(`Connected ${label||'microphone'}. Sing a steady vowel to test it.`);
  }catch(e){mics[slot]?.stop();const messages={NotAllowedError:'Microphone permission was denied. Allow microphone access in your browser’s site permissions, then reconnect.',NotFoundError:'No microphone was found. Connect one, or use rehearsal mode.',NotReadableError:'The microphone is unavailable or in use by another application.',OverconstrainedError:'That input is unavailable. Choose another microphone.'};micError(messages[e.name]||e.message);}
  finally{button.disabled=false;updateMicLabels();}
}
for(let i=0;i<2;i++)$(`connect${i+1}`).onclick=()=>toggleMicrophone(i);
for(const id of ['soundcheckButton','asideMicButton'])$(id).onclick=()=>{pendingSong=null;micError('');refreshDevices().catch(()=>{});showDialog('settingsDialog');};
$('settingsDone').onclick=()=>{storeSettings();$('settingsDialog').close();if(pendingSong){const song=pendingSong;pendingSong=null;openOptions(song);}};
$('rehearsePending').onclick=()=>{storeSettings();$('settingsDialog').close();const song=pendingSong||songs[0];pendingSong=null;openOptions(song);};
$('testTone').onclick=async()=>{try{const c=context();await c.resume();const oscillator=c.createOscillator(),gain=c.createGain();oscillator.frequency.value=440;gain.gain.setValueAtTime(0,c.currentTime);gain.gain.linearRampToValueAtTime(.08,c.currentTime+.02);gain.gain.setValueAtTime(.08,c.currentTime+.6);gain.gain.linearRampToValueAtTime(0,c.currentTime+.8);oscillator.connect(gain);gain.connect(c.destination);oscillator.start();oscillator.stop(c.currentTime+.81);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};}catch(e){micError(e.message);}};
navigator.mediaDevices?.addEventListener?.('devicechange',()=>refreshDevices().catch(()=>{}));

function renderLibrary(){
  const query=$('search').value.toLocaleLowerCase().trim(),filter=$('libraryFilter').value;
  const visible=songs.filter(s=>(!query||`${s.chart.title} ${s.chart.artist} ${s.chart.language}`.toLocaleLowerCase().includes(query))&&(filter==='all'||filter==='favorites'&&favorites.has(s.id)||filter==='duets'&&s.chart.voices.length>1||filter==='local'&&s.source==='local'));
  $('songCount').textContent=String(songs.length);$('songGrid').replaceChildren();$('emptyState').hidden=visible.length>0;
  visible.forEach((song,index)=>{
    const chart=song.chart,card=el('article','song-card');card.dataset.songId=song.id;
    const art=el('div',`song-art ${song.source==='demo'?'art-demo':`art-${index%4}`}`);
    const cover=mediaUrl(song,'cover');if(cover){const image=el('img');image.src=cover;image.alt='';image.loading='lazy';image.onerror=()=>image.remove();art.append(image);}
    art.append(el('span','art-label',song.source==='demo'?'THE ORIGINAL WARM-UP':chart.genre));
    if(!cover){art.append(el('div','cover-title',chart.title),el('span','cover-star','✦'));}
    const favorite=el('button',`favorite-button ${favorites.has(song.id)?'selected':''}`,favorites.has(song.id)?'★':'☆');favorite.setAttribute('aria-label',`${favorites.has(song.id)?'Unfavorite':'Favorite'} ${chart.title}`);favorite.onclick=()=>{if(favorites.has(song.id))favorites.delete(song.id);else favorites.add(song.id);writeLocal('usp-favorites',[...favorites]);renderLibrary();};art.append(favorite);
    const info=el('div','song-info'),title=el('h3','',chart.title);title.title=chart.title;info.append(title,el('p','song-artist',chart.artist));
    const meta=el('div','song-meta');for(const value of [chart.language,chart.voices.length>1?'Duet':'Solo',`~${formatTime(chart.lastNote)}`])meta.append(el('span','',value));info.append(meta);
    const controls=el('div','song-controls'),sing=el('button','primary sing','Sing →'),add=el('button','secondary queue-add','＋');
    const ready=song.source==='demo'||Boolean(song.files.audio||song.urls.audio||song.files.instrumental||song.urls.instrumental);
    sing.disabled=!ready;sing.onclick=()=>openOptions(song);sing.setAttribute('aria-label',`Sing ${chart.title}`);add.disabled=!ready;add.setAttribute('aria-label',`Queue ${chart.title}`);add.onclick=()=>{if(queue.length>=100){toast('Queue limit: 100 songs.');return;}queue.push(song.id);renderQueue();toast(`Added ${chart.title} to the queue.`);};controls.append(sing,add);info.append(controls);
    const footer=el('div','card-footer'),status=el('span',`source-status ${ready?'':'missing'}`,ready?(song.saved?'Saved on device':song.source==='demo'?'Built-in demo':song.source==='catalog'?'Hosted catalog':'Local · this session'):'Audio missing');
    const editor=el('button','','Edit chart');editor.onclick=()=>openEditor(song);footer.append(status,editor);info.append(footer);card.append(art,info);$('songGrid').append(card);
  });
}
function renderQueue(){
  $('queueCount').textContent=String(queue.length);$('queueList').replaceChildren();$('playQueueButton').disabled=!queue.length;
  if(!queue.length){const empty=el('p','queue-empty');empty.append(el('b','','＋'),document.createTextNode('Add a few favorites. Your next song will be ready when you are.'));$('queueList').append(empty);}
  queue.forEach((id,index)=>{const song=songs.find(s=>s.id===id);if(!song)return;const item=el('div','queue-item'),text=el('div','queue-text');text.append(el('b','',song.chart.title),el('span','',song.chart.artist));const remove=el('button','','×');remove.setAttribute('aria-label',`Remove ${song.chart.title} from queue`);remove.onclick=()=>{queue.splice(index,1);renderQueue();};item.append(el('span','queue-number',String(index+1).padStart(2,'0')),text,remove);$('queueList').append(item);});
}
$('search').oninput=renderLibrary;$('libraryFilter').onchange=renderLibrary;
function nextInQueue(){const id=queue.shift();renderQueue();const song=songs.find(s=>s.id===id);if(song)openOptions(song);}
$('playQueueButton').onclick=nextInQueue;
for(const id of ['heroImport','filesButton'])$(id).onclick=()=>$('filesInput').click();
$('folderButton').onclick=()=>$('folderInput').click();
$('demoButton').onclick=()=>openOptions(songs.find(s=>s.source==='demo')||songs[0]);
async function handleImport(entriesPromise){
  if(busyImport){Promise.resolve(entriesPromise).catch(()=>{});toast('An import is already running.');return;}
  if(run){Promise.resolve(entriesPromise).catch(()=>{});toast('Return to the library before importing songs.');return;}
  busyImport=true;$('filesButton').disabled=true;$('folderButton').disabled=true;toast('Reading song files locally…');
  try{
    const {songs:imported,errors}=await importEntries(await entriesPromise);let added=0,duplicates=0;
    for(const song of imported){if(songs.some(s=>s.id===song.id)){duplicates++;continue;}songs.push(song);added++;if($('rememberSongs').checked){try{await saveSong(song);}catch(e){errors.push(`Could not save ${song.chart.title}: ${e.name==='QuotaExceededError'?'Browser storage is full.':e.message} The song remains available for this session.`);}}}
    const warnings=imported.flatMap(s=>s.chart.warnings.map(w=>`${s.chart.title}: ${w}`));
    $('importReport').hidden=!(errors.length||warnings.length);$('importSummary').textContent=`Import report · ${errors.length} issue(s), ${warnings.length} warning(s)`;$('importMessages').textContent=[...errors,...warnings].join('\n');
    renderLibrary();toast(`Added ${added} song${added===1?'':'s'}.${duplicates?` ${duplicates} already in library.`:''}${errors.length?' See the import report for issues.':''}`);
  }catch(e){toast(e.message);}finally{busyImport=false;$('filesButton').disabled=false;$('folderButton').disabled=false;}
}
for(const id of ['filesInput','folderInput'])$(id).onchange=e=>{const files=Array.from(e.target.files);e.target.value='';if(files.length)handleImport(collectFiles(files));};
let dragDepth=0;
window.addEventListener('dragenter',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();dragDepth++;$('dropOverlay').hidden=false;}});
window.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files'))e.preventDefault();});
window.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('dropOverlay').hidden=true;});
window.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('dropOverlay').hidden=true;if(e.dataTransfer.items.length)handleImport(droppedEntries(e.dataTransfer.items));});
$('clearStorageButton').onclick=async()=>{
  if(!confirm('Remove saved song copies from this browser? Your original files and local high scores will not be deleted.'))return;
  try{await clearSaved();for(let i=songs.length-1;i>=0;i--)if(songs[i].saved){revokeSong(songs[i]);const id=songs[i].id;for(let j=queue.length-1;j>=0;j--)if(queue[j]===id)queue.splice(j,1);songs.splice(i,1);}renderLibrary();renderQueue();toast('Saved imports removed from this browser.');}catch(e){toast(e.message);}
};

function openOptions(song){
  if(run)leaveStage();optionSong=song;const chart=song.chart;
  $('optionsTitle').textContent=chart.title;$('optionsArtist').textContent=chart.artist;
  for(let i=0;i<2;i++){const select=$(`voice${i+1}`);select.replaceChildren();for(const v of chart.voices){const o=el('option','',v.name);o.value=v.id;select.append(o);}select.value=chart.voices[Math.min(i,chart.voices.length-1)].id;}
  $('voice2Label').hidden=activeSlots().length<2;
  $('backingTrack').replaceChildren();
  for(const [role,label] of [['audio','Original audio'],['instrumental','Instrumental (provided stem)']])if(song.source==='demo'&&role==='audio'||song.files[role]||song.urls[role]){const o=el('option','',label);o.value=role;$('backingTrack').append(o);}
  $('optionsSing').textContent=activeSlots().length?'Take the stage →':'Connect a microphone →';
  $('optionsWarnings').textContent=chart.warnings.slice(0,5).join('\n');showDialog('songOptionsDialog');
}
$('optionsRehearse').onclick=()=>prepareSong(optionSong,'rehearsal');
$('optionsSing').onclick=()=>{
  if(!activeSlots().length){pendingSong=optionSong;$('songOptionsDialog').close();micError('');refreshDevices().catch(()=>{});showDialog('settingsDialog');}
  else prepareSong(optionSong,'sing');
};
function updateMode(){if(!run)return;$('modeBadge').textContent=run.mode==='rehearsal'?'REHEARSAL · NO SCORE':run.eligible?'LIVE MICROPHONE SCORING':'PRACTICE · NOT RANKED';}
function createScoreboard(){
  $('scoreboard').replaceChildren();$('lyrics').replaceChildren();
  for(const player of run.players){
    const panel=el('div',`score-panel ${player.slot===1?'player-two':''}`),name=el('div','score-name');name.append(el('b','',player.name),el('span','',player.voice.name));
    player.scoreElement=el('span','score-value',player.scorer?'0':'—');player.pitchElement=el('span','pitch-readout','—');panel.append(name,player.scoreElement,player.pitchElement);$('scoreboard').append(panel);
    const lyric=el('div','lyric-player');if(run.players.length>1)lyric.append(el('div','lyric-singer',player.name));player.lyricLine=el('div','lyric-line');player.nextLine=el('div','lyric-next');lyric.append(player.lyricLine,player.nextLine);$('lyrics').append(lyric);player.lyricId=null;
  }
}
function waitMetadata(element,generation){return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);element.removeEventListener('loadedmetadata',ok);element.removeEventListener('error',bad);};
  const ok=()=>{cleanup();if(generation!==preparing)reject(Error('Playback cancelled.'));else resolve();};
  const bad=()=>{cleanup();reject(Error('This audio file could not be played. Check that it is present and uses a codec supported by your browser (MP3 or WAV is a good baseline).'));};
  const timer=setTimeout(()=>{cleanup();reject(Error('Audio did not load. For hosted files, check the URL, network access, and media permissions.'));},15000);
  element.addEventListener('loadedmetadata',ok);element.addEventListener('error',bad);
});}
async function prepareSong(song,mode){
  if(!song)return;for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
  const generation=++preparing;audio.pause();video.pause();storeSettings();
  if(song.source==='demo'&&!song.urls.audio)song.urls.audio=URL.createObjectURL(makeDemoAudio(song.chart));
  const role=$('backingTrack').value||'audio',url=mediaUrl(song,role);if(!url){toast('Audio is missing. Import the .txt chart and matching audio together.');return;}
  const slots=mode==='sing'?activeSlots():[null];
  if(!slots.length){toast('Connect a microphone first, or choose rehearsal.');return;}
  const players=slots.map(slot=>{const voiceId=$(`voice${(slot??0)+1}`).value;const voice=song.chart.voices.find(v=>v.id===voiceId)||song.chart.voices[0];return {slot,name:slot===null?'Rehearsal':prefs[`playerName${slot+1}`],voice,scorer:slot===null?null:new Scorer(voice.notes,{difficulty:prefs.difficulty,octaveInvariant:prefs.octaveInvariant,noiseGate:10**(prefs.noiseGate/20)}),history:[],pitch:null,lastSample:null};});
  const earliest=Math.min(...song.chart.voices.map(v=>v.notes[0].start));
  run={song,mode,players,settings:{...prefs},role,playing:false,started:false,finished:false,eligible:mode==='sing'&&song.chart.start<=earliest&&(!song.chart.end||song.chart.end>=song.chart.lastNote),generation,end:song.chart.lastNote+2};
  $('libraryView').hidden=true;document.querySelector('.app-header').hidden=true;$('stageView').hidden=false;$('stageView').classList.toggle('duet',players.length>1);document.body.style.overflow='hidden';
  $('stageTitle').textContent=song.chart.title;$('stageArtist').textContent=song.chart.artist;$('overlayEyebrow').textContent='GETTING THE STAGE READY';$('overlayTitle').textContent='Loading your song…';$('overlayDescription').textContent='All imported media stays on this device.';$('startButton').disabled=true;$('stageOverlay').hidden=false;$('speed').value='1';audio.playbackRate=1;
  $('stageStatus').textContent=mode==='rehearsal'?'Rehearsal mode: no microphone score is generated.':'Use headphones. Background vocals leaking into the mic can inflate your score.';
  createScoreboard();updateMode();
  const imageUrl=mediaUrl(song,'background')||mediaUrl(song,'cover');$('backgroundImage').hidden=!imageUrl;if(imageUrl)$('backgroundImage').src=imageUrl;else $('backgroundImage').removeAttribute('src');
  const videoUrl=mediaUrl(song,'video');video.hidden=!videoUrl;video.removeAttribute('src');if(videoUrl)video.src=videoUrl;video.muted=true;video.load();
  try{
    audio.removeAttribute('src');audio.load();const ready=waitMetadata(audio,generation);audio.src=url;audio.volume=Number($('volume').value);audio.load();await ready;
    if(!run||run.generation!==generation)return;
    if(!Number.isFinite(audio.duration)||audio.duration<=0)throw Error('The audio has no finite duration; live streams are unsupported.');
    run.end=Math.min(audio.duration,song.chart.end??Infinity);
    if(song.chart.start>=run.end)throw Error('#START is beyond the end of the audio. Fix the chart in the editor.');
    if(audio.duration<song.chart.lastNote-.05){run.eligible=false;toast('Audio ends before the chart. This run is practice only.');updateMode();}
    audio.currentTime=song.chart.start;$('seek').min=String(song.chart.start);$('seek').max=String(run.end);$('seek').value=String(song.chart.start);$('duration').textContent=formatTime(run.end);
    $('overlayEyebrow').textContent='READY WHEN YOU ARE';$('overlayTitle').textContent=mode==='rehearsal'?'Listen. Learn. Sing.':'This is your moment.';$('overlayDescription').textContent=mode==='rehearsal'?'Follow the guide notes. Rehearsal does not generate a score.':`${players.map(p=>p.name).join(' + ')} · ${prefs.difficulty} difficulty · ${prefs.octaveInvariant?'octave flexibility on':'exact octave'}`;$('startButton').textContent=mode==='rehearsal'?'▶ Start rehearsal':'▶ Start singing';$('startButton').disabled=false;
  }catch(e){if(generation!==preparing)return;$('overlayEyebrow').textContent='PLAYBACK PROBLEM';$('overlayTitle').textContent='Could not load this song.';$('overlayDescription').textContent=e.message;$('startButton').disabled=true;toast(e.message);}
  ensureAnimation();
}
async function startPlayback(){
  if(!run||run.finished||$('startButton').disabled)return;
  const current=run;
  try{
    if(current.mode==='sing'){if(current.players.some(p=>!mics[p.slot]?.active))throw Error('A microphone was disconnected. Return to Soundcheck before continuing.');await context().resume();}
    if(current!==run)return;current.captureCutoff=ctx?.currentTime??0;current.players.forEach(p=>{p.lastSample=null;});
    await audio.play();if(current!==run){audio.pause();return;}
    current.started=true;current.playing=true;$('stageOverlay').hidden=true;$('pauseButton').textContent='Ⅱ';syncVideo(true);ensureAnimation();
    try{run.wakeLock=await navigator.wakeLock?.request('screen');}catch{/* Optional capability. */}
  }catch(e){toast(e.message);}
}
function pauseSong(){
  if(!run||run.finished)return;run.playing=false;audio.pause();video.pause();run.wakeLock?.release().catch(()=>{});run.wakeLock=null;
  if(run.started){$('overlayEyebrow').textContent='TAKE A BREATH';$('overlayTitle').textContent='Your stage is waiting.';$('overlayDescription').textContent='Resume when you are ready. No notes are scored while paused.';$('startButton').textContent='▶ Resume singing';$('startButton').disabled=false;$('stageOverlay').hidden=false;}
  $('pauseButton').textContent='▶';
}
$('startButton').onclick=startPlayback;$('pauseButton').onclick=()=>run?.playing?pauseSong():startPlayback();
function syncVideo(force=false){
  if(!run||!video.getAttribute('src')||video.readyState<1)return;
  const expected=audio.currentTime-run.song.chart.videoGap;
  if(expected<0){video.pause();video.hidden=true;return;}video.hidden=false;
  const target=Math.max(0,Math.min(expected,Number.isFinite(video.duration)?Math.max(0,video.duration-.01):expected));
  if(force||Math.abs(video.currentTime-target)>.15)try{video.currentTime=target;}catch{/* A video not yet seekable must not stop the song. */}
  video.playbackRate=audio.playbackRate;if(run.playing&&video.paused&&expected<video.duration)video.play().catch(()=>{});
}
video.onloadedmetadata=()=>syncVideo(true);video.onerror=()=>{if(video.getAttribute('src')){video.hidden=true;toast('Background video is unsupported or unavailable. Audio and scoring can continue.');}};
$('backgroundImage').onerror=()=>$('backgroundImage').hidden=true;
audio.onplaying=()=>{if(run?.started){run.playing=true;run.captureCutoff=ctx?.currentTime??0;run.players.forEach(p=>p.lastSample=null);}};
audio.onwaiting=()=>{if(run){run.playing=false;video.pause();$('stageStatus').textContent='Buffering audio… scoring is paused.';}};
audio.onended=()=>{if(run?.started&&!run.finished)finishSong();};
audio.onerror=()=>{if(run?.started&&!run.finished){run.eligible=false;pauseSong();toast('Audio playback failed. Return to the library and check the media file.');}};
$('volume').oninput=()=>audio.volume=Number($('volume').value);
$('seek').oninput=()=>{if(!run)return;run.eligible=false;updateMode();audio.currentTime=Number($('seek').value);run.captureCutoff=ctx?.currentTime??0;for(const p of run.players){p.history=[];p.lastSample=null;}syncVideo(true);$('stageStatus').textContent='Seeking makes this an unranked practice run. Restart to record a high score.';};
$('speed').onchange=()=>{if(!run)return;audio.playbackRate=Number($('speed').value);if(audio.playbackRate!==1){run.eligible=false;updateMode();}run.players.forEach(p=>p.lastSample=null);syncVideo(true);};
function updateLyrics(player,time){
  const info=phraseAt(player.voice,time);if(!info)return;
  const {phrase,next}=info;
  if(player.lyricId!==phrase.id){player.lyricId=phrase.id;player.lyricLine.replaceChildren();player.wordElements=phrase.notes.map(n=>{const span=el('span','lyric-word',n.text.replace(/~/g,''));player.lyricLine.append(span);return {note:n,span};});player.nextLine.textContent=next?.text||'';}
  for(const {note,span} of player.wordElements){span.className='lyric-word'+(time>=note.end?' sung':time>=note.start?' current':'');if(time>=note.start&&time<note.end)span.style.setProperty('--fill',`${Math.max(0,Math.min(100,100*(time-note.start)/(note.end-note.start)))}%`);}
}
let lastVideoSync=0;
function frame(){
  animation=0;
  for(let i=0;i<2;i++)if(mics[i]?.active){const p=pitches[i],fresh=p&&performance.now()-p.received<350;$(`meter${i+1}`).value=fresh?Math.min(1,p.rms*7):0;$(`pitch${i+1}`).textContent=fresh&&p.midi!==null?`${midiName(p.midi)} · ${Math.round(p.frequency)} Hz`:fresh?'Listening…':'Waiting for audio…';}
  if(run){
    const time=audio.currentTime||0;renderer.draw(time,run.players,run.settings);
    for(const p of run.players){const snap=p.scorer?.snapshot();p.scoreElement.textContent=snap?String(snap.score).padStart(4,'0'):'—';p.pitchElement.textContent=p.pitch&&performance.now()-p.pitch.received<250?midiName(p.pitch.midi):'—';updateLyrics(p,time);}
    $('currentTime').textContent=formatTime(time);if(document.activeElement!==$('seek'))$('seek').value=String(time);
    if(performance.now()-lastVideoSync>350){syncVideo();lastVideoSync=performance.now();}
    if(run.started&&!run.finished&&time>=run.end-.01)finishSong();
  }
  if(run||activeSlots().length)animation=requestAnimationFrame(frame);
}
function ensureAnimation(){if(!animation)animation=requestAnimationFrame(frame);}
// Microphone connections also drive the soundcheck level meters while in the library.
function startMeterLoop(){if(activeSlots().length)ensureAnimation();}
for(let i=0;i<2;i++)$(`connect${i+1}`).onclick=async()=>{await toggleMicrophone(i);startMeterLoop();};
function scoreKey(player){return `${run.song.id}|${player.voice.id}|${run.settings.difficulty}|${run.settings.octaveInvariant?'octave':'exact'}|browser-v1`;}
function finishSong(){
  if(!run||run.finished)return;run.finished=true;run.playing=false;audio.pause();video.pause();run.wakeLock?.release().catch(()=>{});run.wakeLock=null;
  const result={version:1,app:'UltraStar Play Static',scoring:'browser-v1',song:{title:run.song.chart.title,artist:run.song.chart.artist,id:run.song.id},date:new Date().toISOString(),ranked:run.eligible,settings:run.settings,players:[]};
  $('resultsTitle').textContent=run.mode==='rehearsal'?'Ready for your moment?':'That was your moment.';$('resultsSong').textContent=`${run.song.chart.title} · ${run.song.chart.artist}`;$('resultsScores').replaceChildren();
  for(const p of run.players){
    const snap=p.scorer?.snapshot();let best=false;
    if(snap&&run.eligible){const key=scoreKey(p),previous=scores[key]?.score??-1;if(snap.score>previous){scores[key]={score:snap.score,name:p.name,date:result.date};best=true;}}
    result.players.push({name:p.name,voice:p.voice.id,...(snap||{score:null,accuracy:null,coverage:null}),newBest:best});
    const card=el('div','result-card');card.append(el('b','',p.name),el('span','result-number',snap?String(snap.score):'✦'));
    if(snap){card.append(el('small','',`of 10,000 points`),el('p','',`${Math.round(snap.accuracy*100)}% pitch/activity hits on analyzed note time`),el('small','',`${Math.round(snap.coverage*100)}% note-time analysis coverage`));if(best)card.append(el('span','result-badge','NEW LOCAL BEST'));}
    else card.append(el('p','','Rehearsal complete. Connect a microphone to earn points.'));
    $('resultsScores').append(card);
  }
  if(run.eligible&&!writeLocal('usp-highscores',scores))toast('Results are available, but your browser did not allow saving the high score.');
  lastResult=result;
  $('resultsNote').textContent=run.mode==='rehearsal'?'No microphone score was generated.':run.eligible?'Scores are stored only in this browser. This is browser scoring v1, not the native UltraStar scoring algorithm.':'Practice run: this result is not eligible for local high scores. Seeking, altered speed, missing audio/notes, or a microphone interruption can make a run unranked.';
  $('nextButton').hidden=queue.length===0;showDialog('resultsDialog');
}
function leaveStage(){
  if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});
  preparing++;if(run){run.wakeLock?.release().catch(()=>{});run=null;}audio.pause();video.pause();audio.removeAttribute('src');audio.load();video.removeAttribute('src');video.load();$('backgroundImage').removeAttribute('src');
  $('stageView').hidden=true;$('libraryView').hidden=false;document.querySelector('.app-header').hidden=false;document.body.style.overflow='';
  for(const d of document.querySelectorAll('dialog[open]'))d.close();renderLibrary();
}
$('backButton').onclick=leaveStage;$('homeButton').onclick=leaveStage;$('resultsHome').onclick=leaveStage;
$('retryButton').onclick=()=>{const song=run?.song,mode=run?.mode;prepareSong(song,mode);};
$('nextButton').onclick=()=>{leaveStage();nextInQueue();};
$('resultsDialog').addEventListener('cancel',e=>{e.preventDefault();leaveStage();});
$('exportResults').onclick=()=>{if(lastResult)download(JSON.stringify(lastResult,null,2),'ultrastar-results.json','application/json');};
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else if($('stageView').requestFullscreen)await $('stageView').requestFullscreen();else toast('Fullscreen is unavailable here. Add the site to your home screen for a larger view.');}catch(e){toast(e.message);}}
$('fullscreenButton').onclick=fullscreen;
document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)||!run)return;if(e.code==='Space'){e.preventDefault();run.playing?pauseSong():startPlayback();}else if(e.key.toLowerCase()==='f'){e.preventDefault();fullscreen();}else if(e.key==='Escape')leaveStage();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&run?.playing)pauseSong();});
window.addEventListener('pagehide',()=>{for(const m of mics)m?.stop();if(run)pauseSong();});

function download(data,name,type){const blob=data instanceof Blob?data:new Blob([data],{type});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name.replace(/[\\/:*?"<>|]/g,'_');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function openEditor(song){editingSong=song;$('editorTitle').textContent=song.chart.title;$('chartText').value=song.text;$('exportDemoAudio').hidden=song.source!=='demo';validateEditor();showDialog('editorDialog');}
function validateEditor(){try{const chart=parseSong($('chartText').value,editingSong?.chart.sourceName);$('editorStatus').className='editor-status';$('editorStatus').textContent=`Valid · ${chart.voices.reduce((s,v)=>s+v.notes.length,0)} notes · ${chart.voices.length} voice(s) · last note ${formatTime(chart.lastNote)}${chart.warnings.length?'\n'+chart.warnings.join('\n'):''}`;return chart;}catch(e){$('editorStatus').className='editor-status error';$('editorStatus').textContent=e.message;return null;}}
$('validateChart').onclick=validateEditor;
function shiftGap(delta){const text=$('chartText').value,match=text.match(/^#(?:GAP|AUDIOGAP):\s*([+-]?[\d.,]+)/im);const gap=(match?Number(match[1].replace(',','.')):0)+delta;$('chartText').value=match?text.replace(/^#(?:GAP|AUDIOGAP):[^\r\n]*/im,`#GAP:${gap}`):`#GAP:${gap}\n${text}`;validateEditor();}
function shiftPitch(delta){$('chartText').value=$('chartText').value.replace(/^([:*FRG]\s+[+-]?\d+\s+\d+\s+)([+-]?\d+)/gm,(_,prefix,pitch)=>prefix+(Number(pitch)+delta));validateEditor();}
$('gapEarlier').onclick=()=>shiftGap(-100);$('gapLater').onclick=()=>shiftGap(100);$('pitchDown').onclick=()=>shiftPitch(-1);$('pitchUp').onclick=()=>shiftPitch(1);
$('exportChart').onclick=()=>{const chart=validateEditor();if(chart)download($('chartText').value,`${chart.artist} - ${chart.title}.txt`,'text/plain;charset=utf-8');};
$('exportDemoAudio').onclick=()=>{const chart=validateEditor();if(chart)download(makeDemoAudio(chart),'find-your-voice.wav','audio/wav');};
$('saveChart').onclick=async()=>{
  const chart=validateEditor();if(!chart||!editingSong)return;const button=$('saveChart');button.disabled=true;
  try{
    const old=editingSong,text=$('chartText').value,id=await songId(text,chart.sourceName),files={},urls={};
    const available=Object.values(old.files);
    for(const [role,name] of Object.entries({audio:chart.audioName,instrumental:chart.instrumentalName,cover:chart.coverName,background:chart.backgroundName,video:chart.videoName})){
      const match=resolveLocalFile(available,chart.sourceName,name);if(match)files[role]=match;
      const oldName=old.chart[`${role}Name`];if(old.source==='catalog'&&name===oldName)urls[role]=old.urls[role];
    }
    const song={...old,id,text,chart,files,urls,saved:false};
    if(old.saved){await saveSong(song);if(old.id!==id)await deleteSaved(old.id);}
    const index=songs.findIndex(s=>s.id===old.id);revokeSong(old);songs[index]=song;
    for(let i=0;i<queue.length;i++)if(queue[i]===old.id)queue[i]=id;
    if(favorites.has(old.id)){favorites.delete(old.id);favorites.add(id);writeLocal('usp-favorites',[...favorites]);}
    editingSong=song;$('editorDialog').close();renderLibrary();renderQueue();toast('Chart changes applied. Original disk files were not modified.');
  }catch(e){$('editorStatus').textContent=e.message;$('editorStatus').className='editor-status error';}finally{button.disabled=false;}
};
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();
$('helpButton').onclick=()=>showDialog('helpDialog');
renderLibrary();renderQueue();updateMicLabels();
async function boot(){
  try{const saved=await savedSongs();for(const song of saved)if(!songs.some(s=>s.id===song.id))songs.push(song);renderLibrary();}catch{/* Private browsing/storage restrictions must not prevent session-only play. */}
  try{const catalog=await loadCatalog();for(const song of catalog.songs)if(!songs.some(s=>s.id===song.id))songs.push(song);if(catalog.errors.length)toast(catalog.errors[0]);renderLibrary();}catch(e){if(navigator.onLine)toast(`Hosted catalog unavailable: ${e.message}. Local imports still work.`);}
  if('serviceWorker'in navigator&&location.protocol!=='file:'){try{await navigator.serviceWorker.register(new URL('../sw.js',import.meta.url),{scope:new URL('../',import.meta.url).pathname});}catch{/* Offline install is optional. */}}
}
boot();
