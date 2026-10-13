export class Microphone {
  constructor(context,onPitch,onEnded=()=>{}) {this.context=context;this.onPitch=onPitch;this.onEnded=onEnded;this.active=false;this.busy=false;this.noiseGate=0.004;}
  async start(deviceId='') {
    this.stop();
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone access requires HTTPS (or localhost) and a supported browser.');
    if(!this.context.audioWorklet)throw Error('This browser does not support AudioWorklet. Use a current Chrome, Edge, Firefox, or Safari.');
    this.stream=await navigator.mediaDevices.getUserMedia({video:false,audio:{...(deviceId?{deviceId:{exact:deviceId}}:{}),channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    try {
      await this.context.resume();
      await this.context.audioWorklet.addModule(new URL('./capture-worklet.js',import.meta.url));
      this.worker=new Worker(new URL('./pitch-worker.js',import.meta.url),{type:'module'});
      this.node=new AudioWorkletNode(this.context,'pitch-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1});
      this.source=this.context.createMediaStreamSource(this.stream);
      this.mute=this.context.createGain();this.mute.gain.value=0;
      this.source.connect(this.node);this.node.connect(this.mute);this.mute.connect(this.context.destination);
      this.active=true;this.busy=false;
      this.node.port.onmessage=({data})=>{if(!this.active||this.busy)return;this.busy=true;this.worker.postMessage({...data,noiseGate:this.noiseGate},[data.samples.buffer]);};
      this.worker.onmessage=({data})=>{this.busy=false;if(this.active)this.onPitch(data);};
      this.worker.onerror=()=>{this.stop();this.onEnded('Pitch analysis stopped unexpectedly. Reconnect the microphone.');};
      const track=this.stream.getAudioTracks()[0];
      track.onended=()=>{this.stop();this.onEnded('Microphone disconnected. Reconnect it to continue scoring.');};
      this.deviceId=track.getSettings().deviceId || deviceId;return track.label;
    }catch(e){this.stop();throw e;}
  }
  stop() {
    this.active=false;this.node?.port.postMessage('stop');this.source?.disconnect();this.node?.disconnect();this.mute?.disconnect();this.worker?.terminate();
    this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});this.stream=null;this.worker=null;this.node=null;this.source=null;this.mute=null;this.busy=false;
  }
}
