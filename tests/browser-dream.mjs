import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=createServer(async(req,res)=>{try{const path=req.url.split('?')[0];res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(new URL('..'+(path==='/'?'/index.html':path),import.meta.url)));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(8787,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8787');
 for(const width of [390,1440]) {
   await page.setViewportSize({width,height:900});
   await page.locator('[data-tab="dream"]').click();
   assert.equal(await page.locator('#controls input').count(),5);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 const result=await page.evaluate(async()=>{
  const {Drone}=await import('./audio.js');
  window.AudioContext=class extends OfflineAudioContext {constructor(){super(2,48000*35,48000);}async resume(){}};
  const render=async(settings,changes=false)=>{
   const d=new Drone();d.update({...d.settings,detune:0,attack:0.01,decay:0.01,sustain:1,...settings});
   await d.play([40,45,50,55,59,64]);
   const identity=[...d.voices];
   if(changes) for(let at=2;at<=24;at+=2) d.ctx.suspend(at).then(()=>{
    d.move([40+at%5,45,50+at%3,55,at%4?59:null,64]);
    d.update({...d.settings,shimmerDecay:at%4?12:1,diffusion:at%4?1:0,dryDrift:at%4?1:0,wetDrift:at%4?1:0});
    d.move([40+at%5,45,50+at%3,55,59,64]);
    OfflineAudioContext.prototype.resume.call(d.ctx);
   });
   d.ctx.suspend(26).then(()=>{d.move(Array(6).fill(null));OfflineAudioContext.prototype.resume.call(d.ctx);});
   const b=await d.ctx.startRendering(),a=b.getChannelData(0);
   let peak=0,step=0,tail=0;for(let i=1;i<a.length;i++) {if(!Number.isFinite(a[i]))throw Error('nonfinite');peak=Math.max(peak,Math.abs(a[i]));step=Math.max(step,Math.abs(a[i]-a[i-1]));if(i>29*48000)tail+=a[i]*a[i];}
   if(!d.voices.every((v,i)=>v===identity[i]))throw Error('voice replaced');
   return {peak,step,tail:Math.sqrt(tail/(6*48000)),samples:Array.from(a.slice(20*48000,20*48000+24000))};
  };
  const off={dryDrift:0,wetDrift:0,shimmer:0,reverb:0,delay:0};
  const clean=await render(off),dry=await render({...off,dryDrift:1}),wet=await render({...off,shimmer:1,wetDrift:1,shimmerDecay:12}),zeroBloom=await render({...off,bloom:0,shimmer:1,harmonics:1}),stress=await render({shimmer:1,shimmerDecay:12,volume:1,harmonics:1,bloom:1,wetDrift:1},true);
  const wetStable=await render({...off,shimmer:1,shimmerDecay:12});
  const zeroBloomStable=await render({...off,bloom:0,harmonics:1});
  const difference=(a,b)=>Math.sqrt(a.samples.reduce((s,x,i)=>s+(x-b.samples[i])**2,0)/a.samples.length);
  const dryDifference=difference(clean,dry),wetDifference=difference(clean,wet);
  const wetDriftDifference=difference(wetStable,wet),zeroBloomDifference=difference(zeroBloomStable,zeroBloom);
  for(const x of [clean,dry,wet,zeroBloom,stress])delete x.samples;
  return {clean,dry,wet,zeroBloom,stress,dryDifference,wetDifference,wetDriftDifference,zeroBloomDifference};
 });
 console.log(JSON.stringify(result,null,2));
 assert.ok(result.wetDriftDifference>0.00001);assert.ok(result.zeroBloomDifference<1e-7);
 assert.ok(result.dryDifference>0.001);assert.ok(result.wetDifference>0.0001);
 assert.ok(result.wet.tail>result.clean.tail*10+1e-7);
 assert.ok(result.zeroBloom.tail<1e-7);
 for(const x of ['clean','dry','wet','zeroBloom','stress']){assert.ok(result[x].peak<0.9);assert.ok(result[x].step<0.08);}
 assert.deepEqual(errors,[]);
} finally {await browser.close();await new Promise(r=>server.close(r));}
