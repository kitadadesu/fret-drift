// Real WebAudio render: no reverb/delay can conceal the Bloom envelope.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try {
  const page=await browser.newPage();
  await page.goto(process.env.BASE_URL||'http://127.0.0.1:8787');
  const result=await page.evaluate(async()=>{
    const {Drone}=await import('./audio.js');
    const Native=window.AudioContext;
    window.AudioContext=class extends OfflineAudioContext {
      constructor(){super(1,48000*15,48000);}
      async resume(){}
    };
    const render=async(bloom,changes=false)=>{
      const d=new Drone();
      d.update({...d.settings,bloom,detune:0,inharmonicity:0,drift:0,reverb:0,delay:0,attack:0.01,decay:0.01,sustain:1});
      await d.play([69,null,null,null,null,null]);
      if(changes) {
        for(const [at,amount] of [[2,0],[3,1],[5,0.4],[6,1]]) {
          d.ctx.suspend(at).then(()=>{d.update({...d.settings,bloom:amount});OfflineAudioContext.prototype.resume.call(d.ctx);});
        }
      }
      const buffer=await d.ctx.startRendering(),a=buffer.getChannelData(0);
      const amplitude=(hz,start)=>{
        let sin=0,cos=0;const first=Math.round(start*48000),len=12000;
        for(let i=first;i<first+len;i++){sin+=a[i]*Math.sin(2*Math.PI*hz*i/48000);cos+=a[i]*Math.cos(2*Math.PI*hz*i/48000);}
        return 2*Math.hypot(sin,cos)/len;
      };
      const stages=[0.1,1,3,5,8,13].map(t=>[440,880,1320,1760,2640].map(hz=>amplitude(hz,t)));
      let peak=0,step=0;for(let i=1;i<a.length;i++){peak=Math.max(peak,Math.abs(a[i]));step=Math.max(step,Math.abs(a[i]-a[i-1]));}
      return {stages,peak,step};
    };
    try{return {clean:await render(0),bloom:await render(1),live:await render(1,true)};}
    finally{window.AudioContext=Native;}
  });
  console.log(JSON.stringify(result,null,2));
  const {clean,bloom,live}=result;
  assert.ok(bloom.stages[1][1]>bloom.stages[0][1]*10);
  assert.ok(bloom.stages[2][2]>bloom.stages[1][2]*10);
  assert.ok(bloom.stages[4][4]>bloom.stages[2][4]*10);
  assert.ok(clean.stages[5][1]<bloom.stages[5][1]*0.001);
  assert.ok(bloom.stages[5][0]>bloom.stages[5][1]*4);
  assert.ok(live.stages.every(s=>s[0]>0.01));
  for(const r of [clean,bloom,live]){assert.ok(r.peak<0.08);assert.ok(r.step<0.02);}
} finally{await browser.close();}
