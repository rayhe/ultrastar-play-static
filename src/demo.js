import {parseSong} from './song.js';
// Original procedural exercise, not a commercial recording. Included under MIT.
const pitches=[0,2,4,7, 7,4,2,0, 0,4,7,12, 12,7,4,0];
const syllables=['Find ','your ','own ','voice','Sing ','it ','out ','loud','Take ','it ','up ','high','Bring ','it ','back ','home'];
let chartText='#TITLE:Find Your Voice\n#ARTIST:UltraStar Play Static\n#BPM:120\n#GAP:2000\n#AUDIO:find-your-voice.wav\n#GENRE:Original warm-up\n#LANGUAGE:English\n';
for(let i=0;i<pitches.length;i++){
  const phrase=Math.floor(i/4),beat=phrase*40+(i%4)*8;
  chartText+=`${i%4===3?'*':':'} ${beat} ${i%4===3?12:6} ${pitches[i]} ${syllables[i]}\n`;
  if(i%4===3)chartText+=`- ${beat+14}\n`;
}
chartText+='E\n';
export const DEMO_TEXT=chartText;
export function createDemo(){return {id:'demo-find-your-voice-v1',text:chartText,chart:parseSong(chartText,'Find Your Voice.txt'),files:{},urls:{},source:'demo',saved:false};}
export function makeDemoAudio(chart) {
  const sampleRate=22050,duration=chart.lastNote+2,data=new Float32Array(Math.ceil(duration*sampleRate));
  function tone(time,length,freq,amplitude,kind='sine') {
    const start=Math.round(time*sampleRate),count=Math.round(length*sampleRate);
    for(let j=0;j<count&&start+j<data.length;j++){
      const t=j/sampleRate,env=Math.min(1,t/.014)*Math.min(1,(length-t)/.08),angle=2*Math.PI*freq*t;
      const value=kind==='bell'?Math.sin(angle)*Math.exp(-3*t)+.16*Math.sin(2*angle)*Math.exp(-5*t):Math.sin(angle)+.15*Math.sin(2*angle);
      if(start+j>=0)data[start+j]+=value*env*amplitude;
    }
  }
  for(const n of chart.voices[0].notes)tone(n.start,n.end-n.start,440*2**((n.midi-69)/12),.18,'bell');
  for(let t=0;t<duration;t+=.5)tone(t,.09,t%2<.01?880:440,.06,'bell');
  for(let t=2;t<duration-2;t+=5){tone(t,3.8,130.8128,.025);tone(t,3.8,195.9977,.02);}
  const buffer=new ArrayBuffer(44+data.length*2),v=new DataView(buffer);
  const string=(offset,s)=>{for(let i=0;i<s.length;i++)v.setUint8(offset+i,s.charCodeAt(i));};
  string(0,'RIFF');v.setUint32(4,36+data.length*2,true);string(8,'WAVE');string(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);string(36,'data');v.setUint32(40,data.length*2,true);
  for(let i=0;i<data.length;i++)v.setInt16(44+i*2,Math.max(-1,Math.min(1,data[i]))*32767,true);
  return new Blob([buffer],{type:'audio/wav'});
}
