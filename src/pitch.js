/** Independent YIN-style monophonic pitch detector. MIT. No third-party code. */
export function detectPitch(samples, sampleRate, {minFrequency=60, maxFrequency=1200, threshold=0.15, minRms=0.004, minConfidence=0.8}={}) {
  const size=samples.length, half=Math.floor(size/2);
  if(half<32 || !Number.isFinite(sampleRate) || sampleRate<=0) return {frequency:null,midi:null,confidence:0,rms:0};
  let mean=0;for(let i=0;i<size;i++)mean+=samples[i];mean/=size;
  let power=0;for(let i=0;i<size;i++){const s=samples[i]-mean;power+=s*s;}
  const rms=Math.sqrt(power/size);
  const silent={frequency:null,midi:null,confidence:0,rms};
  if(!Number.isFinite(rms) || rms<minRms) return silent;
  const minTau=Math.max(2,Math.floor(sampleRate/maxFrequency));
  const maxTau=Math.min(half-1,Math.ceil(sampleRate/minFrequency));
  if(minTau>=maxTau)return silent;
  const d=new Float32Array(maxTau+1); let running=0;
  for(let tau=1;tau<=maxTau;tau++){
    let sum=0;for(let j=0;j<half;j++){const delta=samples[j]-samples[j+tau];sum+=delta*delta;}
    running+=sum;d[tau]=running>1e-20 ? sum*tau/running : 1;
  }
  let candidate=-1;
  for(let tau=minTau;tau<maxTau;tau++) if(d[tau]<threshold){while(tau+1<maxTau&&d[tau+1]<d[tau])tau++;candidate=tau;break;}
  if(candidate<0){let best=1;for(let tau=minTau;tau<maxTau;tau++)if(d[tau]<best){best=d[tau];candidate=tau;}}
  if(candidate<0 || 1-d[candidate]<minConfidence)return silent;
  const a=d[candidate-1],b=d[candidate],c=d[candidate+1];
  const denominator=a-2*b+c;
  const refined=candidate+(Math.abs(denominator)>1e-12 ? 0.5*(a-c)/denominator : 0);
  const frequency=sampleRate/refined;
  if(frequency<minFrequency*0.97 || frequency>maxFrequency*1.03)return silent;
  return {frequency,midi:69+12*Math.log2(frequency/440),confidence:Math.max(0,Math.min(1,1-b)),rms};
}
export function pitchDistance(a,b,octaveInvariant=true) {
  if(!Number.isFinite(a)||!Number.isFinite(b))return Infinity;
  let diff=Math.abs(a-b);if(octaveInvariant){diff%=12;diff=Math.min(diff,12-diff);}return diff;
}
