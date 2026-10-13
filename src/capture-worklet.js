// Capture/downsample only: CPU-heavy detection runs in a separate Web Worker.
// Worklet output is always silence. Microphone monitoring/feedback is disabled.
class PitchCapture extends AudioWorkletProcessor {
  constructor() {
    super();this.factor=Math.max(1,Math.floor(sampleRate/14000));this.effectiveRate=sampleRate/this.factor;
    this.ring=new Float32Array(1024);this.write=0;this.filled=0;this.sum=0;this.count=0;this.since=0;this.sequence=0;
    this.hop=Math.round(this.effectiveRate*0.03);this.active=true;
    this.port.onmessage=e=>{if(e.data==='stop')this.active=false;};
  }
  process(inputs,outputs) {
    for(const output of outputs)for(const channel of output)channel.fill(0);
    if(!this.active)return false;
    const input=inputs[0]?.[0];if(!input)return true;
    for(let i=0;i<input.length;i++){
      this.sum+=input[i];this.count++;
      if(this.count<this.factor)continue;
      this.ring[this.write]=this.sum/this.factor;this.sum=0;this.count=0;
      this.write=(this.write+1)%1024;this.filled=Math.min(1024,this.filled+1);this.since++;
      if(this.filled===1024 && this.since>=this.hop){
        this.since=0;const samples=new Float32Array(1024);
        for(let j=0;j<1024;j++)samples[j]=this.ring[(this.write+j)%1024];
        // Use center-of-window time, not message delivery time.
        const time=(currentFrame+i+1)/sampleRate-512/this.effectiveRate;
        this.port.postMessage({samples,sampleRate:this.effectiveRate,time,sequence:this.sequence++},[samples.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('pitch-capture',PitchCapture);
