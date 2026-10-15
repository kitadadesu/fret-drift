// Optional real Chrome audio + responsive UI checks. Uses the same env as browser.mjs.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
const base = process.env.BASE_URL || 'http://127.0.0.1:8787';
try {
  for (const [width, height] of [[1440,1000], [390,844]]) {
    const page = await browser.newPage({viewport:{width,height}});
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.goto(base);
    await page.locator('[data-tab="spectrum"]').click();
    for (const [name,value] of [['Harmonics','0.7'],['Inharmonicity','0.5'],['Spectral Drift','1']]) {
      await page.getByRole('slider',{name,exact:true}).fill(value);
      assert.equal(await page.getByRole('slider',{name,exact:true}).inputValue(),value);
    }
    const layout = await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth, bottom:document.querySelector('#controls').getBoundingClientRect().bottom, height:innerHeight}));
    assert.equal(layout.overflow,false);
    assert.ok(layout.bottom<=layout.height,JSON.stringify(layout));
    assert.deepEqual(errors,[]);
    await page.close();
  }
  const page=await browser.newPage();
  await page.goto(base);
  const result=await page.evaluate(async()=>{
    // Real WebAudio, hardware output silenced after the analyser.
    const connect=AudioNode.prototype.connect;
    window.realAudioConnect = connect;
    AudioNode.prototype.connect=function(dest,...args){
      if(dest instanceof AudioDestinationNode){const silent=this.context.createGain();silent.gain.value=0;connect.call(this,silent);return connect.call(silent,dest);}
      return connect.call(this,dest,...args);
    };
    const {Drone,partialTarget}=await import('./audio.js');
    const d=new Drone();
    d.update({...d.settings,harmonics:1,inharmonicity:0.7,drift:1,glide:0.15,attack:0.01,decay:0.01,release:0.03,volume:1,reverb:1,delay:0.7,feedback:0.65});
    await d.play([40,45,50,55,59,64]);
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    await sleep(200);
    const stages=[d.voices[0].partials.map(p=>p.osc.frequency.value)];
    d.move([45,48,53,58,62,67]);
    await sleep(50);
    stages.push(d.voices[0].partials.map(p=>p.osc.frequency.value));
    d.move([42,47,52,57,61,66]);
    await sleep(250);
    stages.push(d.voices[0].partials.map(p=>p.osc.frequency.value));
    const v=d.voices[0];
    const fundamental=v.oscs[0].frequency.value;
    const partial=v.partials[3].osc.frequency.value;
    const target=partialTarget(42,3,d.settings,d.ctx.sampleRate).frequency;
    let peak=0, maxStep=0;
    for(let i=0;i<30;i++){
      d.update({...d.settings,harmonics:i%2,inharmonicity:(i%10)/10});
      const a=new Float32Array(d.analyser.fftSize);d.analyser.getFloatTimeDomainData(a);
      for(let j=0;j<a.length;j++){peak=Math.max(peak,Math.abs(a[j]));if(j)maxStep=Math.max(maxStep,Math.abs(a[j]-a[j-1]));}
      await sleep(10);
    }
    // All strings muted, then recovered without rebuilding spectra.
    d.move([null,null,null,null,null,null]);await sleep(80);
    const muted=d.voices.every(v=>v.gain.gain.value<0.000001);
    d.move([40,45,50,55,59,64]);await sleep(100);
    d.stop();await sleep(150);
    const a=new Float32Array(d.analyser.fftSize);d.analyser.getFloatTimeDomainData(a);
    const stopped=Math.max(...a.map(Math.abs));
    const retiring=d.retiring.size;
    await d.play([40,45,50,55,59,64]);await sleep(100);
    d.analyser.getFloatTimeDomainData(a);
    const resumed=Math.max(...a.map(Math.abs));
    await d.dispose();
    return {stages,fundamental,partial,target,peak,maxStep,muted,stopped,retiring,resumed};
  });
  const spectrum = await page.evaluate(async () => {
    const {Drone} = await import('./audio.js');
    const Realtime = window.AudioContext;
    const silencedConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = window.realAudioConnect;
    window.AudioContext = class extends OfflineAudioContext {
      constructor() { super(1, 48000, 48000); }
      async resume() {}
    };
    try {
      const render = async (harmonics) => {
        const d = new Drone();
        d.update({...d.settings, harmonics, inharmonicity:0, drift:0, detune:0,
          reverb:0, delay:0, attack:0.01, decay:0.01, sustain:1});
        await d.play([69,null,null,null,null,null]);
        const buffer = await d.ctx.startRendering();
        const a = buffer.getChannelData(0);
        const amplitude = (hz) => {
          let sin=0, cos=0;
          for(let i=12000;i<36000;i++) {
            sin += a[i]*Math.sin(2*Math.PI*hz*i/48000);
            cos += a[i]*Math.cos(2*Math.PI*hz*i/48000);
          }
          return 2*Math.hypot(sin,cos)/24000;
        };
        return {fundamental:amplitude(440), second:amplitude(880), third:amplitude(1320)};
      };
      return {clean:await render(0), colored:await render(1)};
    } finally {window.AudioContext = Realtime; AudioNode.prototype.connect = silencedConnect;}
  });
  console.log(JSON.stringify({spectrum},null,2));
  assert.ok(spectrum.colored.second / spectrum.colored.fundamental > 0.25);
  assert.ok(spectrum.colored.third / spectrum.colored.fundamental > 0.18);
  assert.ok(spectrum.clean.second < spectrum.colored.second * 0.01);
  console.log(JSON.stringify(result,null,2));
  assert.ok(Math.abs(result.fundamental-440*2**((42-69)/12))<0.01);
  assert.ok(result.partial>0);
  assert.ok(Math.abs(result.partial-result.target)>0.1,'slow partial must still be travelling after fundamental arrives');
  assert.ok(result.peak>0.00001 && result.peak<1);
  assert.ok(result.maxStep<0.25,`unexpected waveform discontinuity ${result.maxStep}`);
  assert.equal(result.muted,true);
  assert.equal(result.stopped,0);
  assert.equal(result.retiring,0);
  assert.ok(result.resumed>0.00001);
} finally {await browser.close();}
