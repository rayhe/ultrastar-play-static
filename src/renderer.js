import {midiName,noteAt} from './song.js';
export class NoteRenderer {
  constructor(canvas){this.canvas=canvas;this.context=canvas.getContext('2d');}
  draw(time,players,{octaveInvariant=true}={}) {
    const c=this.canvas,rect=c.getBoundingClientRect();if(rect.width<1||rect.height<1)return;
    const dpr=Math.min(window.devicePixelRatio||1,2),w=rect.width,h=rect.height;
    if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);}
    const ctx=this.context;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const left=52,right=w-18,span=8,start=time-1.5,x=t=>left+(t-start)/span*(right-left);
    const laneHeight=h/Math.max(1,players.length);
    players.forEach((player,index)=>{
      const top=index*laneHeight+27,bottom=(index+1)*laneHeight-25;
      const notes=player.voice.notes,color=player.slot===1?'#ff80bc':'#6ce6eb';
      let min=player.range?.[0],max=player.range?.[1];
      if(min===undefined){const pitched=notes.filter(n=>!['R','G','F'].includes(n.type));min=Math.min(...(pitched.length?pitched:notes).map(n=>n.midi))-3;max=Math.max(...(pitched.length?pitched:notes).map(n=>n.midi))+3;if(max-min<16){const mid=(min+max)/2;min=mid-8;max=mid+8;}player.range=[min,max];}
      const y=midi=>bottom-(midi-min)/(max-min)*(bottom-top);
      ctx.font='9px ui-monospace,monospace';ctx.textAlign='right';
      for(let midi=Math.ceil(min);midi<=max;midi++){
        const yy=y(midi);ctx.strokeStyle=midi%12===0?'#ffffff13':'#ffffff07';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();
        if(midi%3===0){ctx.fillStyle='#827591';ctx.fillText(midiName(midi),left-10,yy+3);}
      }
      for(let t=Math.ceil(start);t<start+span;t++){ctx.strokeStyle='#ffffff05';ctx.beginPath();ctx.moveTo(x(t),top);ctx.lineTo(x(t),bottom);ctx.stroke();}
      ctx.textAlign='left';ctx.fillStyle='#9c8da9';ctx.font='9px system-ui,sans-serif';ctx.fillText(`${player.name.toUpperCase()}  /  ${player.voice.name.toUpperCase()}`,left,index*laneHeight+17);
      ctx.save();ctx.beginPath();ctx.rect(left,top-8,right-left,bottom-top+16);ctx.clip();
      let lo=0,hi=notes.length;while(lo<hi){const mid=(lo+hi)>>1;if(notes[mid].end<start)lo=mid+1;else hi=mid;}
      for(let j=lo;j<notes.length&&notes[j].start<start+span;j++){
        const n=notes[j],nx=x(n.start),nw=Math.max(3,x(n.end)-nx),nh=Math.max(6,Math.min(15,(bottom-top)/(max-min)*.78));
        const rap=n.type==='R'||n.type==='G',gold=n.type==='*'||n.type==='G',free=n.type==='F';
        const ny=y(rap?(min+max)/2:n.midi)-nh/2;
        ctx.fillStyle=free?'#ffffff0c':gold?'#b1873338':`${color}2c`;
        ctx.strokeStyle=free?'#ffffff40':gold?'#ffce62aa':`${color}aa`;ctx.lineWidth=free?1:1.1;
        ctx.setLineDash(free?[3,3]:[]);ctx.beginPath();ctx.roundRect(nx,ny,nw,nh,Math.min(4,nh/2));ctx.fill();ctx.stroke();ctx.setLineDash([]);
        const accuracy=player.scorer?.states.get(n.id);const fraction=accuracy?Math.min(1,accuracy.hit/(n.end-n.start)):0;
        if(fraction>0){ctx.fillStyle=gold?'#ffce62':color;ctx.beginPath();ctx.roundRect(nx,ny,nw*fraction,nh,Math.min(4,nh/2));ctx.fill();}
        if(gold&&n.start<=time&&n.end>=time){ctx.shadowColor='#ffce62';ctx.shadowBlur=13;ctx.strokeStyle='#ffce62';ctx.strokeRect(nx,ny,nw,nh);ctx.shadowBlur=0;}
        if(nw>36&&n.text.trim()){ctx.fillStyle='#d9cfeb';ctx.font='10px system-ui,sans-serif';ctx.fillText(n.text.replace(/~/g,''),nx+3,ny+nh+13,Math.max(1,nw-5));}
      }
      let previous=null;ctx.lineWidth=3;ctx.strokeStyle='#ffffff';ctx.shadowColor=color;ctx.shadowBlur=9;
      for(const p of player.history||[]){
        if(p.time<start||p.time>time+.15||!Number.isFinite(p.midi)){previous=null;continue;}
        let midi=p.midi;const target=noteAt(notes,p.time);
        if(octaveInvariant&&target)midi+=12*Math.round((target.midi-midi)/12);
        const point={x:x(p.time),y:y(midi),time:p.time};
        if(previous&&point.time-previous.time<.12){ctx.beginPath();ctx.moveTo(previous.x,previous.y);ctx.lineTo(point.x,point.y);ctx.stroke();}
        previous=point;
      }
      ctx.shadowBlur=0;
      const playhead=x(time);ctx.strokeStyle='#ffffff65';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(playhead,top-6);ctx.lineTo(playhead,bottom+7);ctx.stroke();
      const fresh=player.pitch&&performance.now()-player.pitch.received<220;
      if(fresh&&Number.isFinite(player.pitch.midi)){
        let midi=player.pitch.midi;const target=noteAt(notes,time);if(octaveInvariant&&target)midi+=12*Math.round((target.midi-midi)/12);
        ctx.fillStyle='#fff';ctx.shadowColor=color;ctx.shadowBlur=18;ctx.beginPath();ctx.arc(playhead,Math.max(top,Math.min(bottom,y(midi))),5,0,2*Math.PI);ctx.fill();ctx.shadowBlur=0;
      }
      ctx.restore();
      if(index<players.length-1){ctx.fillStyle='#ffffff12';ctx.fillRect(20,(index+1)*laneHeight,w-40,1);}
    });
    ctx.fillStyle='#9b8eaa';ctx.font='8px system-ui,sans-serif';ctx.textAlign='left';ctx.fillText('NOW',x(time)-10,h-7);ctx.textAlign='right';ctx.fillText('GOLDEN ×2     FREESTYLE = NO SCORE',right,h-7);
  }
}
