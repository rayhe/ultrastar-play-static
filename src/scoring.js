import { pitchDistance } from './pitch.js';
export const DIFFICULTY={easy:1,normal:0.5,hard:0.25};
export const noteWeight=n=>n.type==='F'?0:(n.type==='*'||n.type==='G'?2:1);
/**
 * Browser score v1: time-integrated pitch hits; golden notes double, freestyle zero.
 * Normalized to 10,000. NOT a bit-identical recreation of native UltraStar scoring.
 * Per-note monotonic cursors prevent duplicate credit on repeated samples/seeks.
 */
export class Scorer {
  constructor(notes,{difficulty='normal',octaveInvariant=true,noiseGate=0.004}={}) {
    this.notes=notes;this.tolerance=DIFFICULTY[difficulty] ?? 0.5;this.octaveInvariant=octaveInvariant;this.noiseGate=noiseGate;
    this.states=new Map(notes.map(n=>[n.id,{last:n.start,hit:0,covered:0}]));
    this.total=notes.reduce((s,n)=>s+(n.end-n.start)*noteWeight(n),0);this.hit=0;this.covered=0;this.lastTime=null;
  }
  sample(time,pitch,span=0.03) {
    if(!Number.isFinite(time) || !Number.isFinite(span) || span<=0)return;
    const begin=time-Math.min(span,0.08), end=time;
    // Lower bound on note end avoids scanning the whole chart on every mic frame.
    let lo=0,hi=this.notes.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(this.notes[mid].end<=begin)lo=mid+1;else hi=mid;}
    for(let i=lo;i<this.notes.length && this.notes[i].start<end;i++){
      const n=this.notes[i],state=this.states.get(n.id),w=noteWeight(n);
      const a=Math.max(begin,n.start,state.last),b=Math.min(end,n.end);if(b<=a)continue;
      state.last=b;const dt=b-a;state.covered+=dt;this.covered+=dt*w;
      const voiced=(pitch?.rms ?? 0)>=this.noiseGate;
      const rap=n.type==='R'||n.type==='G';
      const hit=voiced&&(rap||(pitch?.confidence>=0.8&&pitchDistance(pitch.midi,n.midi,this.octaveInvariant)<=this.tolerance));
      if(hit){state.hit+=dt;this.hit+=dt*w;}
    }
    this.lastTime=time;
  }
  snapshot() {return {score:this.total ? Math.min(10000,Math.round(10000*this.hit/this.total)) : 0,accuracy:this.covered>0?Math.min(1,this.hit/this.covered):0,coverage:this.total?Math.min(1,this.covered/this.total):0};}
  noteAccuracy(id){const n=this.notes.find(n=>n.id===id),s=this.states.get(id);return n&&s?s.hit/(n.end-n.start):0;}
}
