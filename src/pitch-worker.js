import {detectPitch} from './pitch.js';
self.onmessage=({data})=>{
  const result=detectPitch(data.samples,data.sampleRate,{minRms:data.noiseGate});
  self.postMessage({...result,time:data.time,sequence:data.sequence});
};
